/**
 * Background cleanup.
 *
 * Without this, three things grow without bound: abandoned rooms holding
 * invite codes out of circulation, audit rows, and player records for devices
 * that never came back. The invite-code space is ~923k, so leaked codes are
 * the first thing that would actually bite.
 *
 * Deliberately conservative about what it touches:
 *
 *  - A room with a SETTLED PAYMENT is never deleted, regardless of age. That
 *    is financial evidence and it stays until a retention policy says
 *    otherwise. Such rooms are only marked cancelled so their code is freed.
 *  - Transactions, webhook events, and audit logs are never deleted here.
 *  - Nothing is removed while a match is in play.
 */

import type { PrismaClient } from '@prisma/client';

import { audit } from '../audit.js';
import { log } from '../logger.js';

const logger = log('cleanup');

export interface CleanupThresholds {
  /** A lobby nobody started is abandoned after this long. */
  readonly staleLobbyMinutes: number;
  /** A match with no activity is treated as abandoned after this long. */
  readonly stalledMatchMinutes: number;
  /** Finished/cancelled rooms are removed after this long. */
  readonly finishedRoomHours: number;
  /** Players with no rooms and no recent activity are removed after this. */
  readonly idlePlayerDays: number;
}

export const DEFAULT_THRESHOLDS: CleanupThresholds = {
  staleLobbyMinutes: 120,
  stalledMatchMinutes: 180,
  finishedRoomHours: 48,
  idlePlayerDays: 60,
};

export interface CleanupResult {
  readonly lobbiesCancelled: number;
  readonly matchesAbandoned: number;
  readonly roomsDeleted: number;
  readonly playersDeleted: number;
  readonly codesFreed: number;
}

function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60_000);
}

export async function runCleanup(
  prisma: PrismaClient,
  thresholds: CleanupThresholds = DEFAULT_THRESHOLDS,
): Promise<CleanupResult> {
  let lobbiesCancelled = 0;
  let matchesAbandoned = 0;
  let roomsDeleted = 0;
  let playersDeleted = 0;
  let codesFreed = 0;

  // --- 1. Lobbies nobody ever started ---------------------------------------
  const staleLobbies = await prisma.room.findMany({
    where: {
      status: { in: ['active', 'pending_payment'] },
      startedAt: null,
      createdAt: { lt: minutesAgo(thresholds.staleLobbyMinutes) },
    },
    select: { id: true, code: true, funding: true },
  });

  for (const room of staleLobbies) {
    await prisma.room.update({
      where: { id: room.id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        // Free the code immediately; the room row is kept for now.
        code: `${room.code}-expired-${Date.now()}`,
      },
    });
    lobbiesCancelled++;
    codesFreed++;

    await audit(prisma, {
      action: 'room.cancelled',
      actorType: 'system',
      subjectType: 'room',
      subjectId: room.id,
      detail: { reason: 'abandoned lobby', funding: room.funding },
    });
  }

  // --- 2. Matches that stalled mid-play -------------------------------------
  const stalled = await prisma.room.findMany({
    where: {
      status: 'in_play',
      startedAt: { lt: minutesAgo(thresholds.stalledMatchMinutes) },
      endedAt: null,
    },
    select: { id: true, code: true },
  });

  for (const room of stalled) {
    await prisma.room.update({
      where: { id: room.id },
      data: {
        status: 'complete',
        endedAt: new Date(),
        code: `${room.code}-expired-${Date.now()}`,
      },
    });
    matchesAbandoned++;
    codesFreed++;

    await audit(prisma, {
      action: 'match.ended',
      actorType: 'system',
      subjectType: 'room',
      subjectId: room.id,
      detail: { reason: 'stalled, no activity', payoutPaise: 0 },
    });
  }

  // --- 3. Delete old finished rooms, EXCEPT any that took money -------------
  const cutoff = new Date(Date.now() - thresholds.finishedRoomHours * 3_600_000);

  const deletable = await prisma.room.findMany({
    where: {
      status: { in: ['complete', 'cancelled'] },
      OR: [{ endedAt: { lt: cutoff } }, { cancelledAt: { lt: cutoff } }],
      // Never delete a room with a payment that was settled or refunded —
      // that is financial evidence.
      transactions: {
        none: { status: { in: ['verified', 'refunded'] } },
      },
    },
    select: { id: true },
    take: 500, // bounded, so one run cannot hold a long transaction
  });

  if (deletable.length > 0) {
    // Memberships, matches, and match events cascade from the room.
    const result = await prisma.room.deleteMany({
      where: { id: { in: deletable.map((r) => r.id) } },
    });
    roomsDeleted = result.count;
  }

  // --- 4. Players who left nothing behind -----------------------------------
  const idleCutoff = new Date(Date.now() - thresholds.idlePlayerDays * 86_400_000);

  const orphans = await prisma.player.findMany({
    where: {
      lastSeenAt: { lt: idleCutoff },
      memberships: { none: {} },
      transactions: { none: {} },
      hostedRooms: { none: {} },
    },
    select: { id: true },
    take: 500,
  });

  if (orphans.length > 0) {
    const result = await prisma.player.deleteMany({
      where: { id: { in: orphans.map((p) => p.id) } },
    });
    playersDeleted = result.count;
  }

  const summary: CleanupResult = {
    lobbiesCancelled,
    matchesAbandoned,
    roomsDeleted,
    playersDeleted,
    codesFreed,
  };

  const touched =
    lobbiesCancelled + matchesAbandoned + roomsDeleted + playersDeleted;
  if (touched > 0) logger.info(summary, 'cleanup run complete');

  return summary;
}

/**
 * Schedules cleanup on an interval.
 *
 * Returns a stop function. The timer is unref'd so it never keeps the process
 * alive during shutdown.
 */
export function scheduleCleanup(
  prisma: PrismaClient,
  intervalMinutes = 15,
): () => void {
  let running = false;

  const tick = async (): Promise<void> => {
    // Skip rather than overlap if a previous run is still going.
    if (running) return;
    running = true;
    try {
      await runCleanup(prisma);
    } catch (error) {
      logger.error({ err: error }, 'cleanup run failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMinutes * 60_000);
  timer.unref();

  // One run shortly after boot clears anything left by a previous process.
  const initial = setTimeout(() => void tick(), 30_000);
  initial.unref();

  return () => {
    clearInterval(timer);
    clearTimeout(initial);
  };
}
