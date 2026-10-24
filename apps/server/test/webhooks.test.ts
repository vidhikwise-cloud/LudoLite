/**
 * Webhook handling tests.
 *
 * The webhook is the authoritative settlement path, so these tests cover the
 * properties that keep it trustworthy: signatures are checked against the raw
 * body, replays settle once, unsigned deliveries are rejected, and a tampered
 * amount never activates a room.
 */

import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MockPaymentProvider } from '../src/payments/mock-provider.js';
import { setProviderForTesting } from '../src/payments/registry.js';
import { createRoom } from '../src/rooms/service.js';
import { webhookRouter } from '../src/routes/webhooks.js';
import { makeConfig } from './helpers/config.js';
import { createTestDb, grantApprovals, type TestDb } from './helpers/db.js';

let db: TestDb;
let provider: MockPaymentProvider;
let app: express.Express;

const asPrisma = (p: unknown) => p as never;
const ENABLED = makeConfig({ paidRoomHostingFlag: true, paymentProvider: 'mock' });

beforeEach(async () => {
  db = await createTestDb();
  await grantApprovals(db.prisma, { providerName: 'mock' });

  provider = new MockPaymentProvider({ secret: 'test-webhook-secret' });
  setProviderForTesting(provider);

  app = express();
  // Mirrors app.ts: the raw body, before any JSON parsing, is what gets
  // signature-checked.
  app.use('/api/webhooks', express.raw({ type: '*/*' }), webhookRouter(asPrisma(db.prisma)));
});

afterEach(async () => {
  setProviderForTesting(null);
  await db.dispose();
});

async function paidRoom() {
  const host = await db.prisma.player.create({
    data: { displayName: 'Jasmin', deviceKey: `device-${Math.random()}` },
  });
  const { room, transaction } = await createRoom({
    prisma: asPrisma(db.prisma),
    provider,
    playerId: host.id,
    seatCount: 4,
    funding: 'paid',
    consent: { acceptedTerms: true, acknowledgedNoPrize: true, displayedAmountPaise: 100 },
    c: ENABLED,
  });
  const stored = await db.prisma.transaction.findUniqueOrThrow({
    where: { id: transaction!.id },
  });
  return { host, room, transaction: stored };
}

describe('webhook signature verification', () => {
  it('rejects a delivery with no signature', async () => {
    const { transaction } = await paidRoom();

    const response = await request(app)
      .post('/api/webhooks/payments')
      .set('content-type', 'application/json')
      .send(
        JSON.stringify({
          id: 'evt_1',
          type: 'payment.captured',
          orderId: transaction.providerOrderId,
        }),
      );

    expect(response.status).toBe(401);

    const after = await db.prisma.room.findUniqueOrThrow({ where: { id: transaction.roomId } });
    expect(after.status).toBe('pending_payment');
  });

  it('rejects a forged signature', async () => {
    const { transaction } = await paidRoom();
    const { body } = provider.buildWebhook({
      type: 'payment.captured',
      orderId: transaction.providerOrderId!,
    });

    const response = await request(app)
      .post('/api/webhooks/payments')
      .set('content-type', 'application/json')
      .set('x-mock-signature', 'forged-signature-value')
      .send(body);

    expect(response.status).toBe(401);
    const after = await db.prisma.room.findUniqueOrThrow({ where: { id: transaction.roomId } });
    expect(after.status).toBe('pending_payment');
  });

  it('rejects a body modified after signing', async () => {
    const { transaction } = await paidRoom();
    const { body, headers } = provider.buildWebhook({
      type: 'payment.captured',
      orderId: transaction.providerOrderId!,
    });

    // Signature was computed over the original bytes.
    const tampered = body.replace('payment.captured', 'payment.refunded');

    const response = await request(app)
      .post('/api/webhooks/payments')
      .set('content-type', 'application/json')
      .set('x-mock-signature', headers['x-mock-signature']!)
      .send(tampered);

    expect(response.status).toBe(401);
  });

  it('records a rejected delivery for review', async () => {
    const { transaction } = await paidRoom();
    await request(app)
      .post('/api/webhooks/payments')
      .set('content-type', 'application/json')
      .set('x-mock-signature', 'nope')
      .send(JSON.stringify({ id: 'e', type: 'payment.captured', orderId: transaction.providerOrderId }));

    const rejected = await db.prisma.auditLog.findMany({ where: { action: 'webhook.rejected' } });
    expect(rejected.length).toBeGreaterThan(0);

    const stored = await db.prisma.webhookEvent.findMany({ where: { signatureValid: false } });
    expect(stored.length).toBe(1);
    // The unverified body must not be retained.
    expect(stored[0]!.payload).not.toContain('payment.captured');
  });
});

describe('webhook settlement', () => {
  it('activates the room on a correctly signed capture', async () => {
    const { room, transaction } = await paidRoom();
    const { body, headers } = provider.buildWebhook({
      type: 'payment.captured',
      orderId: transaction.providerOrderId!,
      paymentId: 'pay_ok_1',
      amountPaise: 100,
    });

    const response = await request(app)
      .post('/api/webhooks/payments')
      .set('content-type', 'application/json')
      .set(headers)
      .send(body);

    expect(response.status).toBe(200);

    const after = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.status).toBe('active');

    const tx = await db.prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(tx.status).toBe('verified');
    expect(tx.providerPaymentId).toBe('pay_ok_1');
  });

  it('settles exactly once when the provider retries the same event', async () => {
    const { room, transaction } = await paidRoom();
    const { body, headers } = provider.buildWebhook({
      id: 'evt_duplicate',
      type: 'payment.captured',
      orderId: transaction.providerOrderId!,
      paymentId: 'pay_ok_1',
      amountPaise: 100,
    });

    const first = await request(app)
      .post('/api/webhooks/payments')
      .set('content-type', 'application/json')
      .set(headers)
      .send(body);
    const second = await request(app)
      .post('/api/webhooks/payments')
      .set('content-type', 'application/json')
      .set(headers)
      .send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);

    // One stored event, one verified transaction, one activation.
    expect(await db.prisma.webhookEvent.count({ where: { signatureValid: true } })).toBe(1);
    expect(await db.prisma.transaction.count({ where: { roomId: room.id } })).toBe(1);

    const replays = await db.prisma.auditLog.findMany({ where: { action: 'webhook.replayed' } });
    expect(replays).toHaveLength(1);
  });

  it('refuses to settle when the provider reports a different amount', async () => {
    const { room, transaction } = await paidRoom();
    const { body, headers } = provider.buildWebhook({
      type: 'payment.captured',
      orderId: transaction.providerOrderId!,
      paymentId: 'pay_wrong_amount',
      // Correctly signed, but for the wrong amount.
      amountPaise: 1,
    });

    await request(app)
      .post('/api/webhooks/payments')
      .set('content-type', 'application/json')
      .set(headers)
      .send(body);

    const after = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.status).toBe('pending_payment');

    const tx = await db.prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(tx.status).toBe('failed');
    expect(tx.failureReason).toContain('amount mismatch');
  });

  it('marks a failure without activating the room', async () => {
    const { room, transaction } = await paidRoom();
    const { body, headers } = provider.buildWebhook({
      type: 'payment.failed',
      orderId: transaction.providerOrderId!,
      failureReason: 'insufficient funds',
    });

    await request(app)
      .post('/api/webhooks/payments')
      .set('content-type', 'application/json')
      .set(headers)
      .send(body);

    const after = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.status).toBe('pending_payment');

    const tx = await db.prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(tx.status).toBe('failed');
    expect(tx.failureReason).toBe('insufficient funds');
  });

  it('acknowledges a signed event for an unknown order without side effects', async () => {
    const { body, headers } = provider.buildWebhook({
      type: 'payment.captured',
      orderId: 'order_that_does_not_exist',
    });

    const response = await request(app)
      .post('/api/webhooks/payments')
      .set('content-type', 'application/json')
      .set(headers)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.matched).toBe(false);
    expect(await db.prisma.transaction.count({ where: { status: 'verified' } })).toBe(0);
  });

  it('retains the verified body as evidence', async () => {
    const { transaction } = await paidRoom();
    const { body, headers } = provider.buildWebhook({
      type: 'payment.captured',
      orderId: transaction.providerOrderId!,
      paymentId: 'pay_evidence',
      amountPaise: 100,
    });

    await request(app)
      .post('/api/webhooks/payments')
      .set('content-type', 'application/json')
      .set(headers)
      .send(body);

    const event = await db.prisma.webhookEvent.findFirstOrThrow({
      where: { signatureValid: true },
    });
    expect(event.payload).toBe(body);
    expect(event.processedAt).toBeInstanceOf(Date);

    const tx = await db.prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(tx.verificationPayload).toBe(body);
  });
});
