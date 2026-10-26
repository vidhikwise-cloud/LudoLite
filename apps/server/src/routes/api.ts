/**
 * HTTP API.
 *
 * Every endpoint that could cost someone money goes through the gate in
 * payments/gate.ts. Nothing here trusts a client assertion about payment.
 */

import type { PublicConfig } from '@ludolite/shared';
import type { PrismaClient } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { audit } from '../audit.js';
import { issuePlayerToken, upsertPlayer, verifyPlayerToken } from '../auth.js';
import { config } from '../config.js';
import { ApiError } from '../errors.js';
import { presenceCount } from '../presence.js';
import { publicGateView, resolvePaidHostingGate } from '../payments/gate.js';
import {
  ensureHostingFeeOrder,
  refundHostingFee,
  settleVerifiedPayment,
} from '../payments/service.js';
import { resolveProvider } from '../payments/registry.js';
import { createRoom, joinRoom, loadRoom, toRoomView } from '../rooms/service.js';
import { getMatchState, startMatch } from '../match/service.js';
import { wrap } from './wrap.js';

const createRoomSchema = z.object({
  seatCount: z.union([z.literal(2), z.literal(4)]),
  displayName: z.string().min(1).max(24),
  funding: z.enum(['free', 'paid']),
  deviceKey: z.string().max(128).optional(),
  bots: z
    .object({
      count: z.number().int().min(1).max(3),
      level: z.enum(['easy', 'normal', 'hard']),
    })
    .optional(),
  feeConsent: z
    .object({
      acceptedTerms: z.boolean(),
      acknowledgedNoPrize: z.boolean(),
      displayedAmountPaise: z.number().int().nonnegative(),
    })
    .optional(),
});

const joinRoomSchema = z.object({
  code: z.string().min(3).max(16),
  displayName: z.string().min(1).max(24),
  deviceKey: z.string().max(128).optional(),
});

const confirmSchema = z.object({
  transactionId: z.string().min(1),
  providerPaymentId: z.string().min(1).optional(),
  providerSignature: z.string().min(1).optional(),
});

const refundSchema = z.object({
  roomId: z.string().min(1),
  reason: z.string().min(1).max(300),
});

function requirePlayer(req: Request): string {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new ApiError('UNAUTHORIZED', 'Sign-in required for this action.');
  return verifyPlayerToken(token);
}

function clientMeta(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

export function apiRouter(prisma: PrismaClient): Router {
  const router = Router();

  // -------------------------------------------------------------------------
  // Config — the client renders payment UI only from this.
  // -------------------------------------------------------------------------
  /**
   * How many people are connected right now.
   *
   * In-memory and per-process -- see presence.ts. Cheap enough to poll,
   * which matters because the landing page does exactly that, and it never
   * touches the database.
   */
  router.get('/presence', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ online: presenceCount() });
  });

  router.get('/config', wrap(async (_req: Request, res: Response) => {
    const gate = await resolvePaidHostingGate(prisma);
    const view = publicGateView(gate);

    const body: PublicConfig = {
      paidHostingEnabled: view.paidHostingEnabled,
      paymentsAreTestMode: view.paymentsAreTestMode,
      hostingFeePaise: config.hostingFeePaise,
      currency: config.currency,
      refundWindowMinutes: config.refundWindowMinutes,
      paidHostingBlockers: view.blockers,
    };
    res.json(body);
  }));

  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------
  router.post('/rooms', wrap(async (req: Request, res: Response) => {
    const input = createRoomSchema.parse(req.body);
    const meta = clientMeta(req);

    const player = await upsertPlayer(prisma, {
      deviceKey: input.deviceKey,
      displayName: input.displayName,
    });

    const result = await createRoom({
      prisma,
      provider: resolveProvider(),
      playerId: player.id,
      seatCount: input.seatCount,
      funding: input.funding,
      consent: input.feeConsent,
      bots: input.bots,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const room = toRoomView(result.room);
    const transaction = result.transaction;

    res.status(201).json({
      room,
      playerToken: issuePlayerToken(player.id),
      deviceKey: player.deviceKey,
      ...(transaction
        ? {
            payment: {
              transactionId: transaction.id,
              providerOrderId: transaction.providerOrderId ?? '',
              provider: resolveProvider().name,
              amountPaise: config.hostingFeePaise,
              currency: config.currency,
              status: 'created',
              testMode: resolveProvider().testMode,
              providerPublicKey: transaction.providerPublicKey,
            },
          }
        : {}),
    });
  }));

  router.post('/rooms/join', wrap(async (req: Request, res: Response) => {
    const input = joinRoomSchema.parse(req.body);
    const meta = clientMeta(req);

    const player = await upsertPlayer(prisma, {
      deviceKey: input.deviceKey,
      displayName: input.displayName,
    });

    // No fee lookup, no gate check, no transaction: joining is free.
    const room = await joinRoom({
      prisma,
      playerId: player.id,
      code: input.code,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    res.json({
      room: toRoomView(room),
      playerToken: issuePlayerToken(player.id),
      deviceKey: player.deviceKey,
    });
  }));

  router.get('/rooms/:roomId', wrap(async (req: Request, res: Response) => {
    const roomId = z.string().min(1).parse(req.params.roomId);
    const room = await loadRoom(prisma, roomId);
    res.json({ room: toRoomView(room) });
  }));

  router.post('/rooms/:roomId/start', wrap(async (req: Request, res: Response) => {
    const playerId = requirePlayer(req);
    const roomId = z.string().min(1).parse(req.params.roomId);
    const state = await startMatch(prisma, roomId, playerId);
    const room = await loadRoom(prisma, roomId);
    res.json({ room: toRoomView(room), state });
  }));

  router.get('/rooms/:roomId/match', wrap(async (req: Request, res: Response) => {
    const roomId = z.string().min(1).parse(req.params.roomId);
    const state = await getMatchState(prisma, roomId);
    res.json({ state });
  }));

  // -------------------------------------------------------------------------
  // Payments
  // -------------------------------------------------------------------------

  /**
   * Resume payment for a room the caller already created.
   *
   * Returns the EXISTING transaction when one is open or settled, which is
   * what makes returning to a paid room free of a second charge.
   */
  router.post('/rooms/:roomId/payment', wrap(async (req: Request, res: Response) => {
    const playerId = requirePlayer(req);
    const roomId = z.string().min(1).parse(req.params.roomId);
    const room = await loadRoom(prisma, roomId);

    if (room.hostPlayerId !== playerId) {
      throw new ApiError('NOT_HOST', 'Only the host pays the hosting fee.');
    }
    if (room.funding !== 'paid') {
      throw new ApiError('INVALID_REQUEST', 'This is a free room; there is nothing to pay.');
    }

    const order = await ensureHostingFeeOrder({
      prisma,
      provider: resolveProvider(),
      roomId,
      playerId,
    });

    res.json({
      payment: {
        transactionId: order.transaction.id,
        providerOrderId: order.transaction.providerOrderId ?? '',
        provider: order.transaction.provider,
        amountPaise: order.transaction.amountPaise,
        currency: order.transaction.currency,
        status: order.transaction.status,
        testMode: order.transaction.testMode,
        providerPublicKey: order.providerPublicKey,
      },
      alreadySettled: order.transaction.status === 'verified',
    });
  }));

  /**
   * Called by the client after checkout closes.
   *
   * This is a HINT. The server re-verifies the signature itself and only then
   * settles. If the signature does not check out, the room stays inactive no
   * matter what the client's screen said.
   */
  router.post('/payments/confirm', wrap(async (req: Request, res: Response) => {
    const playerId = requirePlayer(req);
    const input = confirmSchema.parse(req.body);

    const transaction = await prisma.transaction.findUnique({
      where: { id: input.transactionId },
    });
    if (!transaction) throw new ApiError('PAYMENT_FAILED', 'Unknown transaction.');
    if (transaction.playerId !== playerId) {
      throw new ApiError('UNAUTHORIZED', 'That transaction belongs to another player.');
    }

    if (transaction.status === 'verified') {
      const room = await loadRoom(prisma, transaction.roomId);
      return res.json({ status: 'verified', room: toRoomView(room) });
    }

    const provider = resolveProvider();

    if (!input.providerPaymentId || !input.providerSignature) {
      throw new ApiError(
        'PAYMENT_FAILED',
        'The payment could not be confirmed. If you were charged, it will be refunded automatically.',
      );
    }

    const valid = await provider.verifyPaymentSignature({
      providerOrderId: transaction.providerOrderId ?? '',
      providerPaymentId: input.providerPaymentId,
      signature: input.providerSignature,
    });

    await audit(prisma, {
      action: 'payment.signature_checked',
      actorType: 'player',
      actorId: playerId,
      subjectType: 'transaction',
      subjectId: transaction.id,
      detail: { valid },
    });

    if (!valid) {
      throw new ApiError(
        'PAYMENT_FAILED',
        'We could not verify that payment. The room has not been activated.',
      );
    }

    await settleVerifiedPayment({
      prisma,
      transactionId: transaction.id,
      providerPaymentId: input.providerPaymentId,
      verificationPayload: { source: 'confirm-endpoint', checkedAt: new Date().toISOString() },
      actorType: 'player',
      actorId: playerId,
    });

    await audit(prisma, {
      action: 'payment.verified',
      actorType: 'player',
      actorId: playerId,
      subjectType: 'transaction',
      subjectId: transaction.id,
      detail: { via: 'confirm', roomId: transaction.roomId },
    });

    const room = await loadRoom(prisma, transaction.roomId);
    res.json({ status: 'verified', room: toRoomView(room) });
  }));

  router.post('/payments/refund', wrap(async (req: Request, res: Response) => {
    const playerId = requirePlayer(req);
    const input = refundSchema.parse(req.body);

    const room = await loadRoom(prisma, input.roomId);
    if (room.hostPlayerId !== playerId) {
      throw new ApiError('NOT_HOST', 'Only the host can cancel and request a refund.');
    }

    const result = await refundHostingFee({
      prisma,
      provider: resolveProvider(),
      roomId: input.roomId,
      reason: input.reason,
    });

    res.json(result);
  }));

  return router;
}
