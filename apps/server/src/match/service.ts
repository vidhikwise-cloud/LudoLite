/**
 * Server-authoritative match play.
 *
 * Dice, turn order, token moves, and the final result are all decided here.
 * Clients send intent ("roll", "move token 2 with the 5") and receive state.
 * A client cannot choose a dice value, move out of turn, or declare a winner.
 *
 * Every applied action is appended to MatchEvent, so a completed match can be
 * replayed from its log — which is what makes a dispute about a roll
 * answerable rather than a matter of trust.
 */

import { randomBytes } from 'node:crypto';

import {
  applyForfeit,
  applyMove,
  applyRoll,
  createMatch,
  cryptoDice,
  LudoRuleError,
  type EngineError,
  type MatchState,
  type SeatIndex,
  type TokenIndex,
} from '@ludolite/engine';
import type { ApiErrorCode } from '@ludolite/shared';
import type { PrismaClient } from '@prisma/client';

import { audit } from '../audit.js';
import { fromDbJson, toDbJson } from '../db/json.js';
import { ApiError } from '../errors.js';
import { assertRoomPlayable, loadRoom } from '../rooms/service.js';

const dice = cryptoDice((n: number) => new Uint8Array(randomBytes(n)));

function parseState(raw: unknown): MatchState {
  return fromDbJson<MatchState>(raw);
}

function toJson(state: MatchState): string {
  return toDbJson(state);
}

/**
 * Start the match for a room.
 *
 * Re-checks that a paid room carries a verified payment. This is the last
 * gate before play, and it does not consult anything the client sent.
 */
export async function startMatch(
  prisma: PrismaClient,
  roomId: string,
  requestingPlayerId: string,
): Promise<MatchState> {
  const room = await assertRoomPlayable(prisma, roomId);

  if (room.hostPlayerId !== requestingPlayerId) {
    throw new ApiError('NOT_HOST', 'Only the host can start the match.');
  }
  if (room.match) {
    return parseState(room.match.state);
  }
  if (room.status === 'in_play') {
    throw new ApiError('ROOM_ALREADY_STARTED', 'That match has already started.');
  }

  const seated = room.memberships
    .filter((m) => m.leftAt === null)
    .sort((a, b) => a.seat - b.seat);

  if (seated.length !== room.seatCount) {
    throw new ApiError(
      'INVALID_REQUEST',
      `This room needs ${room.seatCount} players to start. ${seated.length} are ready.`,
    );
  }

  const state = createMatch({
    matchId: `match_${room.id}`,
    seatCount: room.seatCount as 2 | 4,
    playerIds: seated.map((m) => m.playerId),
  });

  await prisma.$transaction(async (tx) => {
    const match = await tx.match.create({
      data: {
        roomId: room.id,
        seatCount: room.seatCount,
        state: toJson(state),
        version: state.version,
      },
    });
    await tx.matchEvent.create({
      data: {
        matchId: match.id,
        seq: 0,
        type: 'start',
        payload: toDbJson({ playerIds: seated.map((m) => m.playerId) }),
      },
    });
    await tx.room.update({
      where: { id: room.id },
      data: { status: 'in_play', startedAt: new Date() },
    });
  });

  await audit(prisma, {
    action: 'room.started',
    actorType: 'player',
    actorId: requestingPlayerId,
    subjectType: 'room',
    subjectId: room.id,
    detail: { seatCount: room.seatCount, funding: room.funding },
  });

  return state;
}

/** Seat a player occupies in this match, or throw. */
async function seatForPlayer(
  prisma: PrismaClient,
  roomId: string,
  playerId: string,
): Promise<SeatIndex> {
  const membership = await prisma.roomMembership.findFirst({
    where: { roomId, playerId, leftAt: null },
  });
  if (!membership) throw new ApiError('NOT_A_PLAYER', 'You are not in this room.');
  return membership.seat as SeatIndex;
}

async function persist(
  prisma: PrismaClient,
  matchId: string,
  next: MatchState,
  event: { type: string; payload: object },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.match.findUnique({
      where: { id: matchId },
      select: { version: true },
    });
    const seq = (current?.version ?? 0) + 1;

    await tx.match.update({
      where: { id: matchId },
      data: {
        state: toJson(next),
        version: next.version,
        ...(next.phase === 'complete'
          ? { winnerSeat: next.winnerSeat, endedAt: new Date() }
          : {}),
      },
    });

    await tx.matchEvent.create({
      data: { matchId, seq, type: event.type, payload: toDbJson(event.payload) },
    });

    if (next.phase === 'complete') {
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: { roomId: true },
      });
      if (match) {
        await tx.room.update({
          where: { id: match.roomId },
          data: { status: 'complete', endedAt: new Date() },
        });
      }
    }
  });
}

/** Translates an engine rule violation into the API error vocabulary. */
const ENGINE_ERROR_MAP: Record<EngineError, ApiErrorCode> = {
  NOT_YOUR_TURN: 'INVALID_REQUEST',
  NOT_IN_PLAY: 'ROOM_NOT_ACTIVE',
  ILLEGAL_MOVE: 'INVALID_REQUEST',
  INVALID_DIE: 'INVALID_REQUEST',
  NO_PENDING_DICE: 'INVALID_REQUEST',
  DICE_ALREADY_PENDING: 'INVALID_REQUEST',
  SEAT_NOT_OCCUPIED: 'INVALID_REQUEST',
};

function rethrow(error: unknown): never {
  if (error instanceof LudoRuleError) {
    throw new ApiError(ENGINE_ERROR_MAP[error.code] ?? 'INVALID_REQUEST', error.message);
  }
  throw error;
}

/** Roll for the requesting player. The server picks the value. */
export async function rollDice(
  prisma: PrismaClient,
  roomId: string,
  playerId: string,
): Promise<{ state: MatchState; die: number; seat: SeatIndex }> {
  const room = await loadRoom(prisma, roomId);
  if (!room.match) throw new ApiError('ROOM_NOT_ACTIVE', 'That match has not started.');

  const seat = await seatForPlayer(prisma, roomId, playerId);
  const state = parseState(room.match.state);

  // The only place a dice value is produced. Never from the client.
  const die = dice.roll();

  let next: MatchState;
  try {
    next = applyRoll(state, seat, die);
  } catch (error) {
    rethrow(error);
  }

  await persist(prisma, room.match.id, next, { type: 'roll', payload: { seat, die } });
  return { state: next, die, seat };
}

export async function moveToken(
  prisma: PrismaClient,
  roomId: string,
  playerId: string,
  request: { token: number; die: number },
): Promise<MatchState> {
  const room = await loadRoom(prisma, roomId);
  if (!room.match) throw new ApiError('ROOM_NOT_ACTIVE', 'That match has not started.');

  const seat = await seatForPlayer(prisma, roomId, playerId);
  const state = parseState(room.match.state);

  let next: MatchState;
  try {
    next = applyMove(state, {
      seat,
      token: request.token as TokenIndex,
      die: request.die,
    });
  } catch (error) {
    rethrow(error);
  }

  await persist(prisma, room.match.id, next, {
    type: 'move',
    payload: { seat, token: request.token, die: request.die },
  });

  if (next.phase === 'complete') {
    await recordResult(prisma, room.match.id, next);
  }

  return next;
}

export async function forfeit(
  prisma: PrismaClient,
  roomId: string,
  playerId: string,
): Promise<MatchState | null> {
  const room = await loadRoom(prisma, roomId);
  if (!room.match) return null;

  const seat = await seatForPlayer(prisma, roomId, playerId);
  const state = parseState(room.match.state);
  if (state.phase === 'complete') return state;

  const next = applyForfeit(state, seat);
  await persist(prisma, room.match.id, next, { type: 'forfeit', payload: { seat } });

  if (next.phase === 'complete') {
    await recordResult(prisma, room.match.id, next);
  }
  return next;
}

/**
 * Record the result.
 *
 * Deliberately records a winning SEAT and PLAYER and nothing else. There is
 * no payout, no prize pool, and no balance to credit — winning returns the
 * result and nothing more.
 */
async function recordResult(
  prisma: PrismaClient,
  matchId: string,
  state: MatchState,
): Promise<void> {
  const winnerSeat = state.winnerSeat;
  const winner = state.seats.find((s) => s.index === winnerSeat);

  await prisma.match.update({
    where: { id: matchId },
    data: {
      winnerSeat: winnerSeat ?? null,
      winnerPlayerId: winner?.playerId ?? null,
      endedAt: new Date(),
    },
  });

  await audit(prisma, {
    action: 'match.ended',
    actorType: 'system',
    subjectType: 'match',
    subjectId: matchId,
    detail: {
      winnerSeat: winnerSeat ?? null,
      winnerPlayerId: winner?.playerId ?? null,
      rankings: [...state.rankings],
      // Stated explicitly in the audit trail: nothing was paid out.
      payoutPaise: 0,
    },
  });
}

export async function getMatchState(
  prisma: PrismaClient,
  roomId: string,
): Promise<MatchState | null> {
  const match = await prisma.match.findUnique({ where: { roomId } });
  return match ? parseState(match.state) : null;
}
