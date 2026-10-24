/**
 * Payment service.
 *
 * Invariants this module exists to hold:
 *
 *  - A host is charged at most once per room. Enforced by a unique
 *    idempotency key on (room, player, purpose), not by UI discipline.
 *  - A room is activated only by a transaction the SERVER verified. A client
 *    POSTing "it worked" is treated as a hint and re-checked.
 *  - The amount always comes from server config. The client is told the
 *    amount so it can display it, and is never asked what to charge.
 *  - Every state change is audited.
 */

import type { PaymentStatus } from '@ludolite/shared';
import type { PrismaClient, Transaction, TransactionStatus } from '@prisma/client';

import { audit } from '../audit.js';
import { config, type AppConfig } from '../config.js';
import { toDbJson } from '../db/json.js';
import { ApiError } from '../errors.js';
import { resolvePaidHostingGate } from './gate.js';
import type { PaymentProvider } from './provider.js';

/** One payment purpose today; named so the key stays meaningful if more appear. */
const PURPOSE_HOST_FEE = 'host_fee';

export function idempotencyKeyFor(roomId: string, playerId: string): string {
  return `${PURPOSE_HOST_FEE}:${roomId}:${playerId}`;
}

export interface EnsureOrderResult {
  readonly transaction: Transaction;
  readonly reused: boolean;
  readonly providerPublicKey?: string;
}

/**
 * Create the hosting-fee order for a room, or return the existing one.
 *
 * This is the function that makes "do not charge the creator again when they
 * reconnect" true: a second call for the same room and player finds the
 * existing transaction by idempotency key and returns it untouched. There is
 * no code path that creates a second charge for the same room.
 */
export async function ensureHostingFeeOrder(opts: {
  prisma: PrismaClient;
  provider: PaymentProvider;
  roomId: string;
  playerId: string;
  c?: AppConfig;
}): Promise<EnsureOrderResult> {
  const { prisma, provider, roomId, playerId } = opts;
  const c = opts.c ?? config;
  const key = idempotencyKeyFor(roomId, playerId);

  const existing = await prisma.transaction.findUnique({ where: { idempotencyKey: key } });

  if (existing) {
    // Already settled: hand back the record, never a fresh order.
    if (existing.status === 'verified') {
      await audit(prisma, {
        action: 'payment.duplicate_blocked',
        actorType: 'player',
        actorId: playerId,
        subjectType: 'transaction',
        subjectId: existing.id,
        detail: { roomId, reason: 'already verified' },
      });
      return { transaction: existing, reused: true };
    }

    // An open order can be resumed as-is.
    if (existing.status === 'created' || existing.status === 'pending') {
      await audit(prisma, {
        action: 'payment.order_reused',
        actorType: 'player',
        actorId: playerId,
        subjectType: 'transaction',
        subjectId: existing.id,
        detail: { roomId, status: existing.status },
      });
      return { transaction: existing, reused: true };
    }

    // Previously failed or cancelled: a retry is legitimate. Reset the same
    // row rather than creating a second one, so the room keeps exactly one
    // transaction and the "charged once" invariant stays checkable.
    const order = await provider.createOrder({
      amountPaise: c.hostingFeePaise,
      currency: c.currency,
      idempotencyKey: key,
      roomId,
      playerId,
      notes: { purpose: PURPOSE_HOST_FEE, roomId },
    });

    const retried = await prisma.transaction.update({
      where: { id: existing.id },
      data: {
        status: 'created',
        provider: provider.name,
        providerOrderId: order.providerOrderId,
        providerPaymentId: null,
        testMode: provider.testMode,
        failureReason: null,
        amountPaise: c.hostingFeePaise,
        currency: c.currency,
      },
    });

    await audit(prisma, {
      action: 'payment.order_created',
      actorType: 'player',
      actorId: playerId,
      subjectType: 'transaction',
      subjectId: retried.id,
      detail: { roomId, retryOfStatus: existing.status, amountPaise: c.hostingFeePaise },
    });

    return {
      transaction: retried,
      reused: false,
      providerPublicKey: order.providerPublicKey,
    };
  }

  const order = await provider.createOrder({
    amountPaise: c.hostingFeePaise,
    currency: c.currency,
    idempotencyKey: key,
    roomId,
    playerId,
    notes: { purpose: PURPOSE_HOST_FEE, roomId },
  });

  const created = await prisma.transaction.create({
    data: {
      roomId,
      playerId,
      status: 'created',
      amountPaise: c.hostingFeePaise,
      currency: c.currency,
      provider: provider.name,
      providerOrderId: order.providerOrderId,
      testMode: provider.testMode,
      idempotencyKey: key,
    },
  });

  await audit(prisma, {
    action: 'payment.order_created',
    actorType: 'player',
    actorId: playerId,
    subjectType: 'transaction',
    subjectId: created.id,
    detail: { roomId, amountPaise: c.hostingFeePaise, provider: provider.name },
  });

  return { transaction: created, reused: false, providerPublicKey: order.providerPublicKey };
}

/**
 * Mark a transaction verified and activate its room, atomically.
 *
 * Called from exactly two places: the signed-webhook handler, and the
 * confirm endpoint after it independently re-verifies the signature. Both
 * paths converge here so activation logic exists once.
 *
 * Idempotent: a webhook delivered twice, or a webhook racing the confirm
 * endpoint, settles the transaction once and activates the room once.
 */
export async function settleVerifiedPayment(opts: {
  prisma: PrismaClient;
  transactionId: string;
  providerPaymentId: string | null;
  /**
   * Evidence that this payment was verified.
   *
   * Pass the provider's raw webhook body as a string to retain it verbatim —
   * re-serializing the evidence would mean the stored bytes are no longer the
   * bytes that were signed. Any other value is serialized.
   */
  verificationPayload: unknown;
  actorType: 'provider' | 'player' | 'system';
  actorId?: string | null;
}): Promise<{ alreadySettled: boolean }> {
  const { prisma, transactionId, providerPaymentId, verificationPayload } = opts;
  const evidence =
    typeof verificationPayload === 'string'
      ? verificationPayload
      : toDbJson(verificationPayload ?? {});

  return prisma.$transaction(async (tx) => {
    const current = await tx.transaction.findUnique({ where: { id: transactionId } });
    if (!current) throw new ApiError('PAYMENT_FAILED', 'Transaction not found');

    if (current.status === 'verified') {
      return { alreadySettled: true };
    }
    if (current.status === 'refunded' || current.status === 'cancelled') {
      // A late success for a refunded order must not resurrect the room.
      return { alreadySettled: true };
    }

    await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'verified',
        providerPaymentId: providerPaymentId ?? current.providerPaymentId,
        verificationPayload: evidence,
        verifiedAt: new Date(),
        failureReason: null,
      },
    });

    // Activation is the whole point of verification. A paid room sits in
    // pending_payment until this line runs.
    const room = await tx.room.findUnique({ where: { id: current.roomId } });
    if (room && room.status === 'pending_payment') {
      await tx.room.update({
        where: { id: room.id },
        data: { status: 'active', activatedAt: new Date() },
      });
    }

    return { alreadySettled: false };
  });
}

export async function markPaymentFailed(opts: {
  prisma: PrismaClient;
  transactionId: string;
  reason: string;
}): Promise<void> {
  const { prisma, transactionId, reason } = opts;
  const current = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!current) return;

  // Never overwrite a settled transaction with a failure.
  if (current.status === 'verified' || current.status === 'refunded') return;

  await prisma.transaction.update({
    where: { id: transactionId },
    data: { status: 'failed', failureReason: reason.slice(0, 500) },
  });

  await audit(prisma, {
    action: 'payment.failed',
    actorType: 'system',
    subjectType: 'transaction',
    subjectId: transactionId,
    detail: { reason: reason.slice(0, 500), roomId: current.roomId },
  });
}

/**
 * Refund the hosting fee for a room.
 *
 * Applies the disclosed policy: a host may cancel for a full refund until the
 * match starts, and a room that can never be used is refundable regardless.
 */
export async function refundHostingFee(opts: {
  prisma: PrismaClient;
  provider: PaymentProvider;
  roomId: string;
  reason: string;
  /** Set when the room could not be used, which bypasses the time window. */
  roomUnusable?: boolean;
  c?: AppConfig;
}): Promise<{ status: PaymentStatus; refundId: string | null; amountPaise: number }> {
  const { prisma, provider, roomId, reason } = opts;
  const c = opts.c ?? config;

  const transaction = await prisma.transaction.findFirst({
    where: { roomId, status: { in: ['verified', 'refunded'] } },
    orderBy: { createdAt: 'desc' },
  });

  if (!transaction) {
    throw new ApiError(
      'REFUND_NOT_APPLICABLE',
      'There is no settled payment for this room to refund.',
    );
  }

  if (transaction.status === 'refunded') {
    return {
      status: 'refunded',
      refundId: transaction.refundId,
      amountPaise: transaction.refundAmountPaise ?? transaction.amountPaise,
    };
  }

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw new ApiError('ROOM_NOT_FOUND', 'Room not found');

  // The disclosed policy: full refund until the first move.
  const matchStarted = room.startedAt !== null;
  if (matchStarted && !opts.roomUnusable) {
    throw new ApiError(
      'REFUND_WINDOW_CLOSED',
      'The match has already started, so the hosting fee is no longer refundable.',
    );
  }

  if (!opts.roomUnusable) {
    const ageMinutes = (Date.now() - room.createdAt.getTime()) / 60_000;
    if (ageMinutes > c.refundWindowMinutes) {
      throw new ApiError(
        'REFUND_WINDOW_CLOSED',
        `The ${c.refundWindowMinutes}-minute cancellation window for this room has passed.`,
      );
    }
  }

  await audit(prisma, {
    action: 'refund.requested',
    actorType: 'player',
    actorId: transaction.playerId,
    subjectType: 'transaction',
    subjectId: transaction.id,
    detail: { roomId, reason, roomUnusable: Boolean(opts.roomUnusable) },
  });

  const result = await provider.refund({
    providerPaymentId: transaction.providerPaymentId ?? '',
    amountPaise: transaction.amountPaise,
    reason,
    idempotencyKey: `refund:${transaction.id}`,
  });

  await prisma.$transaction(async (tx) => {
    await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        status: 'refunded',
        refundId: result.refundId,
        refundedAt: new Date(),
        refundAmountPaise: transaction.amountPaise,
        refundReason: reason.slice(0, 500),
      },
    });
    await tx.room.update({
      where: { id: roomId },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
  });

  await audit(prisma, {
    action: 'refund.issued',
    actorType: 'system',
    subjectType: 'transaction',
    subjectId: transaction.id,
    detail: {
      roomId,
      refundId: result.refundId,
      amountPaise: transaction.amountPaise,
      providerStatus: result.status,
    },
  });

  return {
    status: 'refunded',
    refundId: result.refundId,
    amountPaise: transaction.amountPaise,
  };
}

export function toPaymentStatus(status: TransactionStatus): PaymentStatus {
  return status;
}

/** Throws unless the gate is fully open. Audits every denial. */
export async function requireOpenGate(opts: {
  prisma: PrismaClient;
  playerId?: string | null;
  roomId?: string | null;
  c?: AppConfig;
}): Promise<void> {
  const gate = await resolvePaidHostingGate(opts.prisma, opts.c ?? config);
  if (gate.allowed) return;

  await audit(opts.prisma, {
    action: 'gate.denied',
    actorType: 'system',
    actorId: opts.playerId ?? null,
    subjectType: opts.roomId ? 'room' : null,
    subjectId: opts.roomId ?? null,
    detail: { blockers: gate.blockers },
  });

  throw new ApiError(
    'PAID_HOSTING_UNAVAILABLE',
    'Paid hosting is not available yet. Free private matches are available while paid hosting is being prepared.',
    // Blockers are internal compliance detail; withhold them in production.
    (opts.c ?? config).isProduction ? undefined : gate.blockers.join('; '),
  );
}
