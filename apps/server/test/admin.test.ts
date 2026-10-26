/**
 * Admin dashboard access control.
 *
 * This is the only surface that exposes one player's activity to somebody
 * else, so the tests here are about who is refused rather than about what
 * the reports contain. A reporting bug shows a wrong number; an auth bug
 * publishes player activity to the internet.
 *
 * `config` is read at module load, so each test re-imports the app with a
 * fresh environment rather than mutating a cached config object.
 */

import type express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDb, type TestDb } from './helpers/db.js';

const TOKEN = 'test-admin-token-long-enough-to-pass';

let db: TestDb;
const asPrisma = (p: unknown) => p as never;

/** Builds the app with ADMIN_TOKEN set (or deliberately unset). */
async function appWith(token: string | undefined): Promise<express.Express> {
  vi.resetModules();
  if (token === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = token;

  const { createApp } = await import('../src/app.js');
  return createApp(asPrisma(db.prisma));
}

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  delete process.env.ADMIN_TOKEN;
  vi.resetModules();
  await db.dispose();
});

describe('admin routes without ADMIN_TOKEN configured', () => {
  it('404s rather than 401, so the endpoint is not advertised', async () => {
    const app = await appWith(undefined);
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(404);
  });

  it('404s even when a caller guesses a token', async () => {
    const app = await appWith(undefined);
    const res = await request(app)
      .get('/api/admin/players')
      .set('authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
  });
});

describe('admin routes with ADMIN_TOKEN configured', () => {
  it('refuses a request with no token', async () => {
    const app = await appWith(TOKEN);
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(401);
  });

  it('refuses a wrong token', async () => {
    const app = await appWith(TOKEN);
    const res = await request(app)
      .get('/api/admin/stats')
      .set('authorization', 'Bearer not-the-right-token-at-all-here');
    expect(res.status).toBe(401);
  });

  it('refuses a token that is a prefix of the real one', async () => {
    const app = await appWith(TOKEN);
    const res = await request(app)
      .get('/api/admin/stats')
      .set('authorization', `Bearer ${TOKEN.slice(0, -1)}`);
    expect(res.status).toBe(401);
  });

  it('accepts the correct token as a bearer header', async () => {
    const app = await appWith(TOKEN);
    const res = await request(app)
      .get('/api/admin/stats')
      .set('authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('players');
    expect(res.body).toHaveProperty('matchesAbandoned');
  });

  it('never returns a raw device key', async () => {
    // Device keys are stable identifiers that follow a person between
    // rooms. The dashboard must be able to tell devices apart without
    // being able to identify or impersonate one.
    const player = await db.prisma.player.create({
      data: { displayName: 'Tester', deviceKey: 'super-secret-device-key-xyz' },
    });

    const app = await appWith(TOKEN);
    const res = await request(app)
      .get('/api/admin/players')
      .set('authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('super-secret-device-key-xyz');

    const row = res.body.players.find((p: { id: string }) => p.id === player.id);
    expect(row).toBeDefined();
    // A short, stable, non-reversible label.
    expect(row.device).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is read-only: POST is not routed', async () => {
    const app = await appWith(TOKEN);
    const res = await request(app)
      .post('/api/admin/players')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({ displayName: 'hacked' });
    expect(res.status).not.toBe(200);
  });
});
