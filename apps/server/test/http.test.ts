/**
 * HTTP-level tests, through the real Express stack.
 *
 * These exist because the service-level tests missed a crash: every route
 * handler is async, Express 4 does not await them, and a thrown ApiError
 * escaped as an unhandled rejection that killed the process. The gate was
 * working perfectly — refusing a paid room — and the refusal took the server
 * down instead of returning 402.
 *
 * Calling services directly cannot catch that class of bug. Going through
 * supertest can.
 */

import type express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { createTestDb, type TestDb } from './helpers/db.js';

let db: TestDb;
let app: express.Express;

const asPrisma = (p: unknown) => p as never;

beforeEach(async () => {
  db = await createTestDb();
  // The real application, not a reconstruction of it — including the actual
  // error middleware, which is half of what these tests are checking.
  app = createApp(asPrisma(db.prisma));
});

afterEach(async () => {
  await db.dispose();
});

describe('a refused paid room returns 402 instead of crashing', () => {
  it('answers 402 and keeps serving', async () => {
    const refused = await request(app)
      .post('/api/rooms')
      .send({
        seatCount: 4,
        displayName: 'Jasmin',
        funding: 'paid',
        deviceKey: 'device-paid',
        feeConsent: {
          acceptedTerms: true,
          acknowledgedNoPrize: true,
          displayedAmountPaise: 100,
        },
      });

    expect(refused.status).toBe(402);
    expect(refused.body.error.code).toBe('PAID_HOSTING_UNAVAILABLE');

    // The real regression: the next request must still be served. Before the
    // async wrapper was added, the process was already dead by this point.
    const after = await request(app).get('/api/config');
    expect(after.status).toBe(200);
    expect(after.body.paidHostingEnabled).toBe(false);
  });
});

describe('error paths all return a status rather than throwing', () => {
  it('404 for a room that does not exist', async () => {
    const response = await request(app).get('/api/rooms/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ROOM_NOT_FOUND');
  });

  it('404 for an unknown join code', async () => {
    const response = await request(app)
      .post('/api/rooms/join')
      .send({ code: 'ZZZZ', displayName: 'Nobody', deviceKey: 'd1' });

    expect(response.status).toBe(404);
  });

  it('400 for a malformed body', async () => {
    const response = await request(app)
      .post('/api/rooms')
      .send({ seatCount: 7, displayName: '', funding: 'free' });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it('401 when starting a match without a token', async () => {
    const response = await request(app).post('/api/rooms/anything/start').send({});
    expect(response.status).toBe(401);
  });

  it('survives a burst of failing requests', async () => {
    // Twenty refusals in a row; the server must answer all of them.
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app).get('/api/rooms/missing-room'),
      ),
    );

    expect(results.every((r) => r.status === 404)).toBe(true);

    const stillAlive = await request(app).get('/api/config');
    expect(stillAlive.status).toBe(200);
  });
});

describe('the happy path still works through HTTP', () => {
  it('creates a free room and lets a friend join', async () => {
    const created = await request(app).post('/api/rooms').send({
      seatCount: 4,
      displayName: 'Jasmin',
      funding: 'free',
      deviceKey: 'device-host',
    });

    expect(created.status).toBe(201);
    expect(created.body.room.status).toBe('active');
    expect(created.body.payment).toBeUndefined();
    expect(created.body.playerToken).toBeTruthy();

    const joined = await request(app).post('/api/rooms/join').send({
      code: created.body.room.code,
      displayName: 'Ravi',
      deviceKey: 'device-friend',
    });

    expect(joined.status).toBe(200);
    expect(joined.body.room.players).toHaveLength(2);

    // Nobody was charged.
    expect(await db.prisma.transaction.count()).toBe(0);
  });

  it('serves config with the gate shut and blockers listed', async () => {
    const response = await request(app).get('/api/config');

    expect(response.status).toBe(200);
    expect(response.body.paidHostingEnabled).toBe(false);
    expect(response.body.hostingFeePaise).toBe(100);
    expect(response.body.paidHostingBlockers.length).toBeGreaterThan(0);
  });
});
