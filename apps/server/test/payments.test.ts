/**
 * Payment, gating, and room-activation tests.
 *
 * These are the tests that matter for compliance. They prove, against a real
 * database with real constraints, that:
 *
 *   - a free room works with paid hosting disabled
 *   - a paid room is refused outright when the gate is shut
 *   - a room activates ONLY after the server verifies a payment
 *   - a client claiming success does not activate anything
 *   - a host is never charged twice, including on reconnect
 *   - friends join without being charged
 *   - refunds follow the disclosed policy
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '../src/errors.js';
import { resolvePaidHostingGate } from '../src/payments/gate.js';
import { MockPaymentProvider, mockPaymentSignature } from '../src/payments/mock-provider.js';
import { nullProvider } from '../src/payments/provider.js';
import {
  ensureHostingFeeOrder,
  idempotencyKeyFor,
  refundHostingFee,
  requireOpenGate,
  settleVerifiedPayment,
} from '../src/payments/service.js';
import { createRoom, joinRoom, assertRoomPlayable, toRoomView } from '../src/rooms/service.js';
import { createTestDb, grantApprovals, type TestDb } from './helpers/db.js';
import { makeConfig } from './helpers/config.js';

let db: TestDb;
// The services take a PrismaClient; the test client is structurally identical
// for every model these tests touch.
const asPrisma = (p: unknown) => p as never;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.dispose();
});

async function makePlayer(name: string, deviceKey: string): Promise<string> {
  const player = await db.prisma.player.create({ data: { displayName: name, deviceKey } });
  return player.id;
}

const DISABLED = makeConfig({ paidRoomHostingFlag: false, paymentProvider: 'none' });
const ENABLED = makeConfig({ paidRoomHostingFlag: true, paymentProvider: 'mock' });

function mockProvider(): MockPaymentProvider {
  return new MockPaymentProvider({ secret: 'test-webhook-secret' });
}

// ---------------------------------------------------------------------------
// 1. The gate
// ---------------------------------------------------------------------------

describe('paid hosting gate', () => {
  it('is shut by default, with every blocker reported', async () => {
    const gate = await resolvePaidHostingGate(asPrisma(db.prisma), DISABLED);

    expect(gate.allowed).toBe(false);
    expect(gate.blockers).toContain('PAID_ROOM_HOSTING_ENABLED is false');
    expect(gate.blockers.some((b) => b.includes('Legal review'))).toBe(true);
    expect(gate.blockers.some((b) => b.includes('Payment provider approval'))).toBe(true);
  });

  it('stays shut when the flag is on but approvals are missing', async () => {
    const gate = await resolvePaidHostingGate(asPrisma(db.prisma), ENABLED);

    expect(gate.allowed).toBe(false);
    // The flag alone must never be enough.
    expect(gate.blockers).not.toContain('PAID_ROOM_HOSTING_ENABLED is false');
    expect(gate.blockers.length).toBeGreaterThan(0);
  });

  it('stays shut when approvals exist but the flag is off', async () => {
    await grantApprovals(db.prisma);
    const gate = await resolvePaidHostingGate(asPrisma(db.prisma), DISABLED);

    expect(gate.allowed).toBe(false);
    expect(gate.blockers).toContain('PAID_ROOM_HOSTING_ENABLED is false');
  });

  it('stays shut when an approval has no written evidence recorded', async () => {
    await grantApprovals(db.prisma);
    await db.prisma.complianceApproval.update({
      where: { id: 'legal_opinion' },
      data: { evidenceRef: null },
    });

    const gate = await resolvePaidHostingGate(asPrisma(db.prisma), ENABLED);
    expect(gate.allowed).toBe(false);
    expect(gate.blockers.some((b) => b.includes('no evidence reference'))).toBe(true);
  });

  it('stays shut when an approval has expired', async () => {
    await grantApprovals(db.prisma);
    await db.prisma.complianceApproval.update({
      where: { id: 'payment_provider' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const gate = await resolvePaidHostingGate(asPrisma(db.prisma), ENABLED);
    expect(gate.allowed).toBe(false);
    expect(gate.blockers.some((b) => b.includes('expired'))).toBe(true);
  });

  it('stays shut when the approval covers a different provider', async () => {
    // An approval obtained for one provider must not carry over after a swap.
    await grantApprovals(db.prisma, { providerName: 'someotherprovider' });

    const gate = await resolvePaidHostingGate(asPrisma(db.prisma), ENABLED);
    expect(gate.allowed).toBe(false);
    expect(gate.blockers.some((b) => b.includes('covers'))).toBe(true);
  });

  it('opens only when the flag, both approvals, and the provider all line up', async () => {
    await grantApprovals(db.prisma, { providerName: 'mock' });

    const gate = await resolvePaidHostingGate(asPrisma(db.prisma), ENABLED);
    expect(gate.allowed).toBe(true);
    expect(gate.blockers).toEqual([]);
    // The mock provider never moves real money.
    expect(gate.testMode).toBe(true);
  });

  it('withholds blocker detail from the public view in production', async () => {
    const prod = makeConfig({
      paidRoomHostingFlag: false,
      paymentProvider: 'none',
      nodeEnv: 'production',
    });
    const gate = await resolvePaidHostingGate(asPrisma(db.prisma), prod);
    const { publicGateView } = await import('../src/payments/gate.js');

    expect(publicGateView(gate, prod).blockers).toEqual([]);
    expect(publicGateView(gate, DISABLED).blockers.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Free rooms — the shipping default
// ---------------------------------------------------------------------------

describe('free private rooms with paid hosting disabled', () => {
  it('creates an immediately active room and takes no money', async () => {
    const host = await makePlayer('Jasmin', 'device-host');

    const { room, transaction } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider: nullProvider,
      playerId: host,
      seatCount: 4,
      funding: 'free',
      c: DISABLED,
    });

    expect(room.status).toBe('active');
    expect(room.funding).toBe('free');
    expect(room.quotedFeePaise).toBe(0);
    expect(transaction).toBeUndefined();

    // No transaction row exists at all.
    expect(await db.prisma.transaction.count()).toBe(0);
  });

  it('lets friends join free and start a match', async () => {
    const host = await makePlayer('Jasmin', 'device-host');
    const { room } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider: nullProvider,
      playerId: host,
      seatCount: 4,
      funding: 'free',
      c: DISABLED,
    });

    for (const [i, name] of ['Ravi', 'Priya', 'Arjun'].entries()) {
      const friend = await makePlayer(name, `device-friend-${i}`);
      await joinRoom({ prisma: asPrisma(db.prisma), playerId: friend, code: room.code });
    }

    const playable = await assertRoomPlayable(asPrisma(db.prisma), room.id);
    const view = toRoomView(playable);

    expect(view.players).toHaveLength(4);
    expect(view.canStart).toBe(true);
    // Nobody was charged anything.
    expect(await db.prisma.transaction.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Paid rooms refused while the gate is shut
// ---------------------------------------------------------------------------

describe('paid room creation while paid hosting is disabled', () => {
  it('refuses with 402 and creates no room and no transaction', async () => {
    const host = await makePlayer('Jasmin', 'device-host');

    await expect(
      createRoom({
        prisma: asPrisma(db.prisma),
        provider: nullProvider,
        playerId: host,
        seatCount: 4,
        funding: 'paid',
        consent: {
          acceptedTerms: true,
          acknowledgedNoPrize: true,
          displayedAmountPaise: 100,
        },
        c: DISABLED,
      }),
    ).rejects.toMatchObject({ code: 'PAID_HOSTING_UNAVAILABLE', status: 402 });

    // Refused before anything was written — no debris left behind.
    expect(await db.prisma.room.count()).toBe(0);
    expect(await db.prisma.transaction.count()).toBe(0);
  });

  it('is never silently downgraded to a free room', async () => {
    const host = await makePlayer('Jasmin', 'device-host');

    await expect(
      createRoom({
        prisma: asPrisma(db.prisma),
        provider: nullProvider,
        playerId: host,
        seatCount: 2,
        funding: 'paid',
        consent: { acceptedTerms: true, acknowledgedNoPrize: true, displayedAmountPaise: 100 },
        c: DISABLED,
      }),
    ).rejects.toBeInstanceOf(ApiError);

    // A host must never end up in something other than what they confirmed.
    expect(await db.prisma.room.count()).toBe(0);
  });

  it('records the denial in the audit log', async () => {
    const host = await makePlayer('Jasmin', 'device-host');
    await expect(
      requireOpenGate({ prisma: asPrisma(db.prisma), playerId: host, c: DISABLED }),
    ).rejects.toBeInstanceOf(ApiError);

    const denials = await db.prisma.auditLog.findMany({ where: { action: 'gate.denied' } });
    expect(denials).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Consent
// ---------------------------------------------------------------------------

describe('fee consent', () => {
  beforeEach(async () => {
    await grantApprovals(db.prisma, { providerName: 'mock' });
  });

  it('refuses a paid room without explicit consent', async () => {
    const host = await makePlayer('Jasmin', 'device-host');

    await expect(
      createRoom({
        prisma: asPrisma(db.prisma),
        provider: mockProvider(),
        playerId: host,
        seatCount: 4,
        funding: 'paid',
        c: ENABLED,
      }),
    ).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
  });

  it('refuses when the amount shown does not match the server fee', async () => {
    const host = await makePlayer('Jasmin', 'device-host');

    await expect(
      createRoom({
        prisma: asPrisma(db.prisma),
        provider: mockProvider(),
        playerId: host,
        seatCount: 4,
        funding: 'paid',
        // Client displayed Rs 5 while the server fee is Rs 1.
        consent: { acceptedTerms: true, acknowledgedNoPrize: true, displayedAmountPaise: 500 },
        c: ENABLED,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('records what the host agreed to', async () => {
    const host = await makePlayer('Jasmin', 'device-host');
    const { room } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider: mockProvider(),
      playerId: host,
      seatCount: 4,
      funding: 'paid',
      consent: { acceptedTerms: true, acknowledgedNoPrize: true, displayedAmountPaise: 100 },
      c: ENABLED,
    });

    const stored = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(stored.consentAcceptedTerms).toBe(true);
    expect(stored.consentAcknowledgedNoPrize).toBe(true);
    expect(stored.consentDisplayedPaise).toBe(100);
    expect(stored.consentAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// 5. Activation only after verified payment
// ---------------------------------------------------------------------------

describe('room activation', () => {
  beforeEach(async () => {
    await grantApprovals(db.prisma, { providerName: 'mock' });
  });

  async function createPaidRoom(provider: MockPaymentProvider) {
    const host = await makePlayer('Jasmin', 'device-host');
    const result = await createRoom({
      prisma: asPrisma(db.prisma),
      provider,
      playerId: host,
      seatCount: 4,
      funding: 'paid',
      consent: { acceptedTerms: true, acknowledgedNoPrize: true, displayedAmountPaise: 100 },
      c: ENABLED,
    });
    return { host, ...result };
  }

  it('starts a paid room in pending_payment, not active', async () => {
    const { room, transaction } = await createPaidRoom(mockProvider());

    expect(room.status).toBe('pending_payment');
    expect(room.quotedFeePaise).toBe(100);
    expect(transaction).toBeDefined();

    const stored = await db.prisma.transaction.findUniqueOrThrow({
      where: { id: transaction!.id },
    });
    expect(stored.status).toBe('created');
    expect(stored.amountPaise).toBe(100);
  });

  it('refuses play while payment is unverified', async () => {
    const { room } = await createPaidRoom(mockProvider());

    await expect(assertRoomPlayable(asPrisma(db.prisma), room.id)).rejects.toMatchObject({
      code: 'PAYMENT_REQUIRED',
    });
  });

  it('refuses joiners while the room is unpaid', async () => {
    const { room } = await createPaidRoom(mockProvider());
    const friend = await makePlayer('Ravi', 'device-friend');

    await expect(
      joinRoom({ prisma: asPrisma(db.prisma), playerId: friend, code: room.code }),
    ).rejects.toMatchObject({ code: 'ROOM_NOT_ACTIVE' });
  });

  it('activates the room once the server verifies the payment', async () => {
    const provider = mockProvider();
    const { room, transaction } = await createPaidRoom(provider);

    await settleVerifiedPayment({
      prisma: asPrisma(db.prisma),
      transactionId: transaction!.id,
      providerPaymentId: 'pay_test_1',
      verificationPayload: { source: 'test' },
      actorType: 'provider',
    });

    const stored = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(stored.status).toBe('active');
    expect(stored.activatedAt).toBeInstanceOf(Date);

    const tx = await db.prisma.transaction.findUniqueOrThrow({ where: { id: transaction!.id } });
    expect(tx.status).toBe('verified');
    expect(tx.verifiedAt).toBeInstanceOf(Date);
  });

  it('does not activate when the client signature is wrong', async () => {
    const provider = mockProvider();
    const { room, transaction } = await createPaidRoom(provider);
    const stored = await db.prisma.transaction.findUniqueOrThrow({
      where: { id: transaction!.id },
    });

    // A client asserting success with a bogus signature proves nothing.
    const valid = await provider.verifyPaymentSignature({
      providerOrderId: stored.providerOrderId!,
      providerPaymentId: 'pay_test_1',
      signature: 'definitely-not-a-real-signature',
    });
    expect(valid).toBe(false);

    const after = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.status).toBe('pending_payment');
  });

  it('accepts a correctly signed confirmation', async () => {
    const provider = mockProvider();
    const { transaction } = await createPaidRoom(provider);
    const stored = await db.prisma.transaction.findUniqueOrThrow({
      where: { id: transaction!.id },
    });

    const signature = mockPaymentSignature(
      'test-webhook-secret',
      stored.providerOrderId!,
      'pay_test_1',
    );
    const valid = await provider.verifyPaymentSignature({
      providerOrderId: stored.providerOrderId!,
      providerPaymentId: 'pay_test_1',
      signature,
    });

    expect(valid).toBe(true);
  });

  it('settles only once when the same payment is confirmed twice', async () => {
    const { room, transaction } = await createPaidRoom(mockProvider());

    const first = await settleVerifiedPayment({
      prisma: asPrisma(db.prisma),
      transactionId: transaction!.id,
      providerPaymentId: 'pay_test_1',
      verificationPayload: {},
      actorType: 'provider',
    });
    const second = await settleVerifiedPayment({
      prisma: asPrisma(db.prisma),
      transactionId: transaction!.id,
      providerPaymentId: 'pay_test_1',
      verificationPayload: {},
      actorType: 'provider',
    });

    expect(first.alreadySettled).toBe(false);
    expect(second.alreadySettled).toBe(true);

    // Still exactly one transaction for the room.
    expect(await db.prisma.transaction.count({ where: { roomId: room.id } })).toBe(1);
  });

  it('does not resurrect a refunded room with a late success', async () => {
    const { room, transaction } = await createPaidRoom(mockProvider());
    await db.prisma.transaction.update({
      where: { id: transaction!.id },
      data: { status: 'refunded' },
    });
    await db.prisma.room.update({ where: { id: room.id }, data: { status: 'cancelled' } });

    const result = await settleVerifiedPayment({
      prisma: asPrisma(db.prisma),
      transactionId: transaction!.id,
      providerPaymentId: 'pay_late',
      verificationPayload: {},
      actorType: 'provider',
    });

    expect(result.alreadySettled).toBe(true);
    const after = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// 6. Charged at most once
// ---------------------------------------------------------------------------

describe('the host is charged at most once', () => {
  beforeEach(async () => {
    await grantApprovals(db.prisma, { providerName: 'mock' });
  });

  it('reuses the open order when payment is retried', async () => {
    const provider = mockProvider();
    const host = await makePlayer('Jasmin', 'device-host');
    const { room } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider,
      playerId: host,
      seatCount: 4,
      funding: 'paid',
      consent: { acceptedTerms: true, acknowledgedNoPrize: true, displayedAmountPaise: 100 },
      c: ENABLED,
    });

    const again = await ensureHostingFeeOrder({
      prisma: asPrisma(db.prisma),
      provider,
      roomId: room.id,
      playerId: host,
      c: ENABLED,
    });

    expect(again.reused).toBe(true);
    expect(await db.prisma.transaction.count({ where: { roomId: room.id } })).toBe(1);
  });

  it('does not charge again when the host reconnects after paying', async () => {
    const provider = mockProvider();
    const host = await makePlayer('Jasmin', 'device-host');
    const { room, transaction } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider,
      playerId: host,
      seatCount: 4,
      funding: 'paid',
      consent: { acceptedTerms: true, acknowledgedNoPrize: true, displayedAmountPaise: 100 },
      c: ENABLED,
    });

    await settleVerifiedPayment({
      prisma: asPrisma(db.prisma),
      transactionId: transaction!.id,
      providerPaymentId: 'pay_test_1',
      verificationPayload: {},
      actorType: 'provider',
    });

    // Host closes the tab and comes back, twice.
    for (let i = 0; i < 2; i++) {
      const resumed = await ensureHostingFeeOrder({
        prisma: asPrisma(db.prisma),
        provider,
        roomId: room.id,
        playerId: host,
        c: ENABLED,
      });
      expect(resumed.reused).toBe(true);
      expect(resumed.transaction.status).toBe('verified');
    }

    expect(await db.prisma.transaction.count({ where: { roomId: room.id } })).toBe(1);

    const verified = await db.prisma.transaction.findMany({
      where: { roomId: room.id, status: 'verified' },
    });
    const total = verified.reduce((acc, t) => acc + t.amountPaise, 0);
    // A four-player match generates Rs 1 gross, not Rs 4.
    expect(total).toBe(100);
  });

  it('rejoining by code does not create a transaction', async () => {
    const provider = mockProvider();
    const host = await makePlayer('Jasmin', 'device-host');
    const { room, transaction } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider,
      playerId: host,
      seatCount: 4,
      funding: 'paid',
      consent: { acceptedTerms: true, acknowledgedNoPrize: true, displayedAmountPaise: 100 },
      c: ENABLED,
    });
    await settleVerifiedPayment({
      prisma: asPrisma(db.prisma),
      transactionId: transaction!.id,
      providerPaymentId: 'pay_1',
      verificationPayload: {},
      actorType: 'provider',
    });

    await joinRoom({ prisma: asPrisma(db.prisma), playerId: host, code: room.code });

    expect(await db.prisma.transaction.count({ where: { roomId: room.id } })).toBe(1);
    const reconnects = await db.prisma.auditLog.findMany({
      where: { action: 'room.reconnected' },
    });
    expect(reconnects.length).toBeGreaterThan(0);
  });

  it('the idempotency key is unique per room and player', async () => {
    const a = idempotencyKeyFor('room1', 'player1');
    const b = idempotencyKeyFor('room1', 'player1');
    const c = idempotencyKeyFor('room2', 'player1');

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('the database rejects a second transaction with the same key', async () => {
    const provider = mockProvider();
    const host = await makePlayer('Jasmin', 'device-host');
    const { room } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider,
      playerId: host,
      seatCount: 4,
      funding: 'paid',
      consent: { acceptedTerms: true, acknowledgedNoPrize: true, displayedAmountPaise: 100 },
      c: ENABLED,
    });

    // Attempt to force a duplicate charge straight past the service layer.
    await expect(
      db.prisma.transaction.create({
        data: {
          roomId: room.id,
          playerId: host,
          status: 'created',
          amountPaise: 100,
          currency: 'INR',
          provider: 'mock',
          testMode: true,
          idempotencyKey: idempotencyKeyFor(room.id, host),
        },
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 7. Friends join without charge
// ---------------------------------------------------------------------------

describe('invited friends', () => {
  beforeEach(async () => {
    await grantApprovals(db.prisma, { providerName: 'mock' });
  });

  it('join a paid room at no cost once it is active', async () => {
    const provider = mockProvider();
    const host = await makePlayer('Jasmin', 'device-host');
    const { room, transaction } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider,
      playerId: host,
      seatCount: 4,
      funding: 'paid',
      consent: { acceptedTerms: true, acknowledgedNoPrize: true, displayedAmountPaise: 100 },
      c: ENABLED,
    });
    await settleVerifiedPayment({
      prisma: asPrisma(db.prisma),
      transactionId: transaction!.id,
      providerPaymentId: 'pay_1',
      verificationPayload: {},
      actorType: 'provider',
    });

    for (const [i, name] of ['Ravi', 'Priya', 'Arjun'].entries()) {
      const friend = await makePlayer(name, `device-friend-${i}`);
      const joined = await joinRoom({
        prisma: asPrisma(db.prisma),
        playerId: friend,
        code: room.code,
      });
      expect(joined.status).toBe('active');
    }

    // Four players in the room; still exactly one transaction, for Rs 1.
    const view = toRoomView(await assertRoomPlayable(asPrisma(db.prisma), room.id));
    expect(view.players).toHaveLength(4);

    const all = await db.prisma.transaction.findMany({ where: { roomId: room.id } });
    expect(all).toHaveLength(1);
    expect(all[0]!.playerId).toBe(host);
    expect(all[0]!.amountPaise).toBe(100);

    // Only the host carries a paid badge.
    expect(view.players.filter((p) => p.paidHost)).toHaveLength(1);
    expect(view.players.find((p) => p.paidHost)!.playerId).toBe(host);
  });

  it('audits a join as explicitly uncharged', async () => {
    const host = await makePlayer('Jasmin', 'device-host');
    const { room } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider: nullProvider,
      playerId: host,
      seatCount: 2,
      funding: 'free',
      c: DISABLED,
    });
    const friend = await makePlayer('Ravi', 'device-friend');
    await joinRoom({ prisma: asPrisma(db.prisma), playerId: friend, code: room.code });

    const joins = await db.prisma.auditLog.findMany({ where: { action: 'room.joined' } });
    expect(joins).toHaveLength(1);
    const detail = JSON.parse(joins[0]!.detail);
    expect(detail.charged).toBe(false);
    expect(detail.feePaise).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Failed payments
// ---------------------------------------------------------------------------

describe('failed payments', () => {
  beforeEach(async () => {
    await grantApprovals(db.prisma, { providerName: 'mock' });
  });

  it('leaves the room inactive when the provider rejects the order', async () => {
    const provider = mockProvider();
    provider.failNextOrder = true;
    const host = await makePlayer('Jasmin', 'device-host');

    await expect(
      createRoom({
        prisma: asPrisma(db.prisma),
        provider,
        playerId: host,
        seatCount: 4,
        funding: 'paid',
        consent: { acceptedTerms: true, acknowledgedNoPrize: true, displayedAmountPaise: 100 },
        c: ENABLED,
      }),
    ).rejects.toThrow();

    const rooms = await db.prisma.room.findMany();
    // The room row may exist, but it must not be active.
    for (const room of rooms) expect(room.status).toBe('pending_payment');
  });

  it('allows a retry after a failure without creating a second charge', async () => {
    const provider = mockProvider();
    const host = await makePlayer('Jasmin', 'device-host');
    const { room, transaction } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider,
      playerId: host,
      seatCount: 4,
      funding: 'paid',
      consent: { acceptedTerms: true, acknowledgedNoPrize: true, displayedAmountPaise: 100 },
      c: ENABLED,
    });

    const { markPaymentFailed } = await import('../src/payments/service.js');
    await markPaymentFailed({
      prisma: asPrisma(db.prisma),
      transactionId: transaction!.id,
      reason: 'card declined',
    });

    const retry = await ensureHostingFeeOrder({
      prisma: asPrisma(db.prisma),
      provider,
      roomId: room.id,
      playerId: host,
      c: ENABLED,
    });

    expect(retry.transaction.status).toBe('created');
    // Reset in place: one row, so the room can still only ever be paid once.
    expect(await db.prisma.transaction.count({ where: { roomId: room.id } })).toBe(1);
  });

  it('does not overwrite a verified payment with a later failure', async () => {
    const provider = mockProvider();
    const host = await makePlayer('Jasmin', 'device-host');
    const { transaction } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider,
      playerId: host,
      seatCount: 4,
      funding: 'paid',
      consent: { acceptedTerms: true, acknowledgedNoPrize: true, displayedAmountPaise: 100 },
      c: ENABLED,
    });
    await settleVerifiedPayment({
      prisma: asPrisma(db.prisma),
      transactionId: transaction!.id,
      providerPaymentId: 'pay_1',
      verificationPayload: {},
      actorType: 'provider',
    });

    const { markPaymentFailed } = await import('../src/payments/service.js');
    await markPaymentFailed({
      prisma: asPrisma(db.prisma),
      transactionId: transaction!.id,
      reason: 'late failure webhook',
    });

    const after = await db.prisma.transaction.findUniqueOrThrow({
      where: { id: transaction!.id },
    });
    expect(after.status).toBe('verified');
  });
});

// ---------------------------------------------------------------------------
// 9. Refunds
// ---------------------------------------------------------------------------

describe('cancellation and refunds', () => {
  beforeEach(async () => {
    await grantApprovals(db.prisma, { providerName: 'mock' });
  });

  async function paidActiveRoom(provider: MockPaymentProvider) {
    const host = await makePlayer('Jasmin', 'device-host');
    const { room, transaction } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider,
      playerId: host,
      seatCount: 4,
      funding: 'paid',
      consent: { acceptedTerms: true, acknowledgedNoPrize: true, displayedAmountPaise: 100 },
      c: ENABLED,
    });
    await settleVerifiedPayment({
      prisma: asPrisma(db.prisma),
      transactionId: transaction!.id,
      providerPaymentId: 'pay_1',
      verificationPayload: {},
      actorType: 'provider',
    });
    return { host, room, transactionId: transaction!.id };
  }

  it('refunds the full fee before the match starts', async () => {
    const provider = mockProvider();
    const { room } = await paidActiveRoom(provider);

    const result = await refundHostingFee({
      prisma: asPrisma(db.prisma),
      provider,
      roomId: room.id,
      reason: 'host cancelled',
      c: ENABLED,
    });

    expect(result.status).toBe('refunded');
    expect(result.amountPaise).toBe(100);
    expect(result.refundId).toBeTruthy();

    const stored = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(stored.status).toBe('cancelled');
  });

  it('refuses a refund once the match has started', async () => {
    const provider = mockProvider();
    const { room } = await paidActiveRoom(provider);
    await db.prisma.room.update({
      where: { id: room.id },
      data: { startedAt: new Date(), status: 'in_play' },
    });

    await expect(
      refundHostingFee({
        prisma: asPrisma(db.prisma),
        provider,
        roomId: room.id,
        reason: 'changed my mind',
        c: ENABLED,
      }),
    ).rejects.toMatchObject({ code: 'REFUND_WINDOW_CLOSED' });
  });

  it('still refunds a started room that could not be used', async () => {
    const provider = mockProvider();
    const { room } = await paidActiveRoom(provider);
    await db.prisma.room.update({
      where: { id: room.id },
      data: { startedAt: new Date(), status: 'in_play' },
    });

    const result = await refundHostingFee({
      prisma: asPrisma(db.prisma),
      provider,
      roomId: room.id,
      reason: 'server fault made the room unusable',
      roomUnusable: true,
      c: ENABLED,
    });

    expect(result.status).toBe('refunded');
  });

  it('is idempotent — a second refund returns the first result', async () => {
    const provider = mockProvider();
    const { room } = await paidActiveRoom(provider);

    const first = await refundHostingFee({
      prisma: asPrisma(db.prisma),
      provider,
      roomId: room.id,
      reason: 'cancelled',
      c: ENABLED,
    });
    const second = await refundHostingFee({
      prisma: asPrisma(db.prisma),
      provider,
      roomId: room.id,
      reason: 'cancelled again',
      c: ENABLED,
    });

    expect(second.refundId).toBe(first.refundId);
    expect(second.amountPaise).toBe(first.amountPaise);
  });

  it('refuses to refund a free room', async () => {
    const host = await makePlayer('Jasmin', 'device-host');
    const { room } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider: nullProvider,
      playerId: host,
      seatCount: 4,
      funding: 'free',
      c: DISABLED,
    });

    await expect(
      refundHostingFee({
        prisma: asPrisma(db.prisma),
        provider: mockProvider(),
        roomId: room.id,
        reason: 'nothing to refund',
        c: ENABLED,
      }),
    ).rejects.toMatchObject({ code: 'REFUND_NOT_APPLICABLE' });
  });
});

// ---------------------------------------------------------------------------
// 10. No prize pool — the revenue model
// ---------------------------------------------------------------------------

describe('revenue model', () => {
  beforeEach(async () => {
    await grantApprovals(db.prisma, { providerName: 'mock' });
  });

  it('a four-player paid match collects Rs 1 in total, not Rs 4', async () => {
    const provider = mockProvider();
    const host = await makePlayer('Jasmin', 'device-host');
    const { room, transaction } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider,
      playerId: host,
      seatCount: 4,
      funding: 'paid',
      consent: { acceptedTerms: true, acknowledgedNoPrize: true, displayedAmountPaise: 100 },
      c: ENABLED,
    });
    await settleVerifiedPayment({
      prisma: asPrisma(db.prisma),
      transactionId: transaction!.id,
      providerPaymentId: 'pay_1',
      verificationPayload: {},
      actorType: 'provider',
    });

    for (const [i, name] of ['Ravi', 'Priya', 'Arjun'].entries()) {
      const friend = await makePlayer(name, `device-friend-${i}`);
      await joinRoom({ prisma: asPrisma(db.prisma), playerId: friend, code: room.code });
    }

    const transactions = await db.prisma.transaction.findMany({ where: { roomId: room.id } });
    const gross = transactions
      .filter((t) => t.status === 'verified')
      .reduce((acc, t) => acc + t.amountPaise, 0);

    expect(transactions).toHaveLength(1);
    expect(gross).toBe(100);
  });

  it('records a winner without any payout', async () => {
    const host = await makePlayer('Jasmin', 'device-host');
    const { room } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider: nullProvider,
      playerId: host,
      seatCount: 2,
      funding: 'free',
      c: DISABLED,
    });
    const friend = await makePlayer('Ravi', 'device-friend');
    await joinRoom({ prisma: asPrisma(db.prisma), playerId: friend, code: room.code });

    const { startMatch } = await import('../src/match/service.js');
    await startMatch(asPrisma(db.prisma), room.id, host);

    // There is no balance, wallet, or payout column anywhere to credit.
    const match = await db.prisma.match.findUniqueOrThrow({ where: { roomId: room.id } });
    expect(match.winnerPlayerId).toBeNull();
    expect(Object.keys(match)).not.toContain('payoutPaise');
  });
});
