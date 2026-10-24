/**
 * Cleanup job.
 *
 * The property that matters most: a room that took money is NEVER deleted,
 * however old it is. Everything else is housekeeping; that one is evidence.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCleanup, DEFAULT_THRESHOLDS } from '../src/jobs/cleanup.js';
import { createTestDb, type TestDb } from './helpers/db.js';

let db: TestDb;
const asPrisma = (p: unknown) => p as never;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.dispose();
});

async function player(name: string): Promise<string> {
  const row = await db.prisma.player.create({
    data: { displayName: name, deviceKey: `dev-${name}-${Math.random()}` },
  });
  return row.id;
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 3_600_000);
}

describe('abandoned lobbies', () => {
  it('cancels a lobby nobody started and frees its code', async () => {
    const host = await player('host');
    const room = await db.prisma.room.create({
      data: {
        code: 'OLD1',
        status: 'active',
        funding: 'free',
        seatCount: 4,
        hostPlayerId: host,
        createdAt: hoursAgo(5),
      },
    });

    const result = await runCleanup(asPrisma(db.prisma));

    expect(result.lobbiesCancelled).toBe(1);
    const after = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.status).toBe('cancelled');
    // The code is released so a new room can take it.
    expect(after.code).not.toBe('OLD1');

    // Another room may now claim the freed code.
    await expect(
      db.prisma.room.create({
        data: {
          code: 'OLD1',
          status: 'active',
          funding: 'free',
          seatCount: 2,
          hostPlayerId: host,
        },
      }),
    ).resolves.toBeDefined();
  });

  it('leaves a fresh lobby alone', async () => {
    const host = await player('host');
    await db.prisma.room.create({
      data: {
        code: 'NEW1',
        status: 'active',
        funding: 'free',
        seatCount: 4,
        hostPlayerId: host,
      },
    });

    const result = await runCleanup(asPrisma(db.prisma));
    expect(result.lobbiesCancelled).toBe(0);
  });
});

describe('stalled matches', () => {
  it('ends a match with no activity and records no payout', async () => {
    const host = await player('host');
    const room = await db.prisma.room.create({
      data: {
        code: 'STAL',
        status: 'in_play',
        funding: 'free',
        seatCount: 2,
        hostPlayerId: host,
        createdAt: hoursAgo(6),
        startedAt: hoursAgo(5),
      },
    });

    const result = await runCleanup(asPrisma(db.prisma));

    expect(result.matchesAbandoned).toBe(1);
    const after = await db.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.status).toBe('complete');

    const entry = await db.prisma.auditLog.findFirstOrThrow({
      where: { action: 'match.ended', subjectId: room.id },
    });
    expect(JSON.parse(entry.detail).payoutPaise).toBe(0);
  });
});

describe('paid rooms are never deleted', () => {
  it('keeps an old room that carries a verified payment', async () => {
    const host = await player('payer');
    const room = await db.prisma.room.create({
      data: {
        code: 'PAID',
        status: 'complete',
        funding: 'paid',
        seatCount: 4,
        hostPlayerId: host,
        quotedFeePaise: 100,
        createdAt: hoursAgo(500),
        endedAt: hoursAgo(480),
      },
    });
    await db.prisma.transaction.create({
      data: {
        roomId: room.id,
        playerId: host,
        status: 'verified',
        amountPaise: 100,
        currency: 'INR',
        provider: 'mock',
        testMode: true,
        idempotencyKey: `host_fee:${room.id}:${host}`,
      },
    });

    await runCleanup(asPrisma(db.prisma));

    // Still there. Financial records outlive housekeeping.
    const survivor = await db.prisma.room.findUnique({ where: { id: room.id } });
    expect(survivor).not.toBeNull();
    expect(await db.prisma.transaction.count({ where: { roomId: room.id } })).toBe(1);
  });

  it('keeps a refunded room too', async () => {
    const host = await player('refunded');
    const room = await db.prisma.room.create({
      data: {
        code: 'RFND',
        status: 'cancelled',
        funding: 'paid',
        seatCount: 4,
        hostPlayerId: host,
        createdAt: hoursAgo(500),
        cancelledAt: hoursAgo(480),
      },
    });
    await db.prisma.transaction.create({
      data: {
        roomId: room.id,
        playerId: host,
        status: 'refunded',
        amountPaise: 100,
        currency: 'INR',
        provider: 'mock',
        testMode: true,
        idempotencyKey: `host_fee:${room.id}:${host}`,
      },
    });

    await runCleanup(asPrisma(db.prisma));
    expect(await db.prisma.room.findUnique({ where: { id: room.id } })).not.toBeNull();
  });

  it('does delete an old free room', async () => {
    const host = await player('free');
    const room = await db.prisma.room.create({
      data: {
        code: 'FREE',
        status: 'complete',
        funding: 'free',
        seatCount: 2,
        hostPlayerId: host,
        createdAt: hoursAgo(500),
        endedAt: hoursAgo(480),
      },
    });

    const result = await runCleanup(asPrisma(db.prisma));

    expect(result.roomsDeleted).toBe(1);
    expect(await db.prisma.room.findUnique({ where: { id: room.id } })).toBeNull();
  });
});

describe('idle players', () => {
  it('removes a player with no rooms and no transactions', async () => {
    await db.prisma.player.create({
      data: {
        displayName: 'Ghost',
        deviceKey: 'ghost-device',
        lastSeenAt: new Date(Date.now() - 90 * 86_400_000),
      },
    });

    const result = await runCleanup(asPrisma(db.prisma));
    expect(result.playersDeleted).toBe(1);
  });

  it('keeps a player who still has a room', async () => {
    const host = await player('active');
    await db.prisma.player.update({
      where: { id: host },
      data: { lastSeenAt: new Date(Date.now() - 90 * 86_400_000) },
    });
    await db.prisma.room.create({
      data: {
        code: 'KEEP',
        status: 'active',
        funding: 'free',
        seatCount: 2,
        hostPlayerId: host,
      },
    });

    const result = await runCleanup(asPrisma(db.prisma));
    expect(result.playersDeleted).toBe(0);
    expect(await db.prisma.player.findUnique({ where: { id: host } })).not.toBeNull();
  });
});

describe('safety', () => {
  it('is a no-op on an empty database', async () => {
    const result = await runCleanup(asPrisma(db.prisma));
    expect(result).toEqual({
      lobbiesCancelled: 0,
      matchesAbandoned: 0,
      roomsDeleted: 0,
      playersDeleted: 0,
      codesFreed: 0,
    });
  });

  it('is safe to run twice in a row', async () => {
    const host = await player('host');
    await db.prisma.room.create({
      data: {
        code: 'TWCE',
        status: 'active',
        funding: 'free',
        seatCount: 4,
        hostPlayerId: host,
        createdAt: hoursAgo(5),
      },
    });

    const first = await runCleanup(asPrisma(db.prisma));
    const second = await runCleanup(asPrisma(db.prisma));

    expect(first.lobbiesCancelled).toBe(1);
    expect(second.lobbiesCancelled).toBe(0);
  });

  it('uses thresholds that leave normal play untouched', () => {
    // A two-hour lobby window must not cut short a game people are setting up.
    expect(DEFAULT_THRESHOLDS.staleLobbyMinutes).toBeGreaterThanOrEqual(60);
    expect(DEFAULT_THRESHOLDS.stalledMatchMinutes).toBeGreaterThanOrEqual(
      DEFAULT_THRESHOLDS.staleLobbyMinutes,
    );
  });
});
