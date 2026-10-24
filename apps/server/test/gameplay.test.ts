/**
 * Server-authoritative play and reconnection.
 *
 * Proves that dice, turns, and results are decided by the server, that a
 * reconnecting player resumes their seat, and that every action is logged
 * well enough to replay the match.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getMatchState, moveToken, rollDice, startMatch } from '../src/match/service.js';
import { nullProvider } from '../src/payments/provider.js';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  markConnected,
  toRoomView,
  loadRoom,
} from '../src/rooms/service.js';
import { makeConfig } from './helpers/config.js';
import { createTestDb, type TestDb } from './helpers/db.js';

let db: TestDb;
const asPrisma = (p: unknown) => p as never;
const DISABLED = makeConfig({ paidRoomHostingFlag: false, paymentProvider: 'none' });

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.dispose();
});

async function makePlayer(name: string, key: string): Promise<string> {
  const player = await db.prisma.player.create({ data: { displayName: name, deviceKey: key } });
  return player.id;
}

/** Player id sitting on a given seat of a room. */
async function readySeatOwner(roomId: string, seat: number): Promise<string> {
  const membership = await db.prisma.roomMembership.findFirstOrThrow({
    where: { roomId, seat, leftAt: null },
  });
  return membership.playerId;
}

/** A free two-player room with both seats filled. */
async function readyRoom() {
  const host = await makePlayer('Jasmin', 'device-host');
  const { room } = await createRoom({
    prisma: asPrisma(db.prisma),
    provider: nullProvider,
    playerId: host,
    seatCount: 2,
    funding: 'free',
    c: DISABLED,
  });
  const guest = await makePlayer('Ravi', 'device-guest');
  await joinRoom({ prisma: asPrisma(db.prisma), playerId: guest, code: room.code });
  return { host, guest, roomId: room.id, code: room.code };
}

describe('starting a match', () => {
  it('only the host may start', async () => {
    const { guest, roomId } = await readyRoom();

    await expect(startMatch(asPrisma(db.prisma), roomId, guest)).rejects.toMatchObject({
      code: 'NOT_HOST',
    });
  });

  it('refuses to start before the room is full', async () => {
    const host = await makePlayer('Jasmin', 'device-host');
    const { room } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider: nullProvider,
      playerId: host,
      seatCount: 4,
      funding: 'free',
      c: DISABLED,
    });

    await expect(startMatch(asPrisma(db.prisma), room.id, host)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('creates a match and moves the room to in_play', async () => {
    const { host, roomId } = await readyRoom();
    const state = await startMatch(asPrisma(db.prisma), roomId, host);

    expect(state.phase).toBe('in-play');
    expect(state.seats).toHaveLength(2);

    const room = await db.prisma.room.findUniqueOrThrow({ where: { id: roomId } });
    expect(room.status).toBe('in_play');
    expect(room.startedAt).toBeInstanceOf(Date);
  });

  it('is idempotent — starting twice returns the same match', async () => {
    const { host, roomId } = await readyRoom();
    const first = await startMatch(asPrisma(db.prisma), roomId, host);
    const second = await startMatch(asPrisma(db.prisma), roomId, host);

    expect(second.matchId).toBe(first.matchId);
    expect(await db.prisma.match.count({ where: { roomId } })).toBe(1);
  });
});

describe('server-authoritative dice', () => {
  it('produces a value in range that the client never supplies', async () => {
    const { host, roomId } = await readyRoom();
    await startMatch(asPrisma(db.prisma), roomId, host);

    const { die, seat } = await rollDice(asPrisma(db.prisma), roomId, host);

    expect(die).toBeGreaterThanOrEqual(1);
    expect(die).toBeLessThanOrEqual(6);
    expect(seat).toBe(0);
  });

  it('refuses a roll from the player who is not on turn', async () => {
    const { host, guest, roomId } = await readyRoom();
    await startMatch(asPrisma(db.prisma), roomId, host);

    // Seat 0 (the host) always moves first, so the guest is out of turn
    // before anyone has rolled. Asserted before any roll happens, since a
    // non-six with every token in the yard would pass the turn along.
    await expect(rollDice(asPrisma(db.prisma), roomId, guest)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('rejects a move for a die that was never rolled', async () => {
    const { host, roomId } = await readyRoom();
    await startMatch(asPrisma(db.prisma), roomId, host);

    // Roll until the host actually holds a die: any non-six with all tokens
    // in the yard is unplayable and passes the turn straight back.
    let holder = host;
    for (let attempt = 0; attempt < 60; attempt++) {
      const { state, die } = await rollDice(asPrisma(db.prisma), roomId, holder);
      if (state.pendingDice.length > 0) break;
      // Turn passed; whoever is on seat 0 or 1 now rolls next.
      holder = state.turnSeat === 0 ? host : (await readySeatOwner(roomId, state.turnSeat));
      void die;
    }

    // 99 is not a value the server ever produces, so it cannot be pending.
    await expect(
      moveToken(asPrisma(db.prisma), roomId, holder, { token: 0, die: 99 }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('logs every action so the match can be replayed', async () => {
    const { host, roomId } = await readyRoom();
    await startMatch(asPrisma(db.prisma), roomId, host);
    await rollDice(asPrisma(db.prisma), roomId, host);

    const match = await db.prisma.match.findUniqueOrThrow({ where: { roomId } });
    const events = await db.prisma.matchEvent.findMany({
      where: { matchId: match.id },
      orderBy: { seq: 'asc' },
    });

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!.type).toBe('start');
    expect(events.some((e) => e.type === 'roll')).toBe(true);

    // The recorded roll carries the value the server chose.
    const roll = events.find((e) => e.type === 'roll')!;
    const payload = JSON.parse(roll.payload);
    expect(payload.die).toBeGreaterThanOrEqual(1);
    expect(payload.die).toBeLessThanOrEqual(6);
  });
});

describe('reconnection', () => {
  it('restores a seat without creating a duplicate membership', async () => {
    const { host, roomId, code } = await readyRoom();

    await markConnected(asPrisma(db.prisma), roomId, host, false);
    await joinRoom({ prisma: asPrisma(db.prisma), playerId: host, code });

    const memberships = await db.prisma.roomMembership.findMany({
      where: { roomId, playerId: host },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.seat).toBe(0);
    expect(memberships[0]!.isHost).toBe(true);
  });

  it('restores the live match state on return', async () => {
    const { host, roomId } = await readyRoom();
    const started = await startMatch(asPrisma(db.prisma), roomId, host);
    await rollDice(asPrisma(db.prisma), roomId, host);

    const restored = await getMatchState(asPrisma(db.prisma), roomId);

    expect(restored).not.toBeNull();
    expect(restored!.matchId).toBe(started.matchId);
    // Version advanced past the initial state, so the roll was persisted.
    expect(restored!.version).toBeGreaterThan(started.version);
  });

  it('a player who left can rejoin an unstarted room', async () => {
    const { guest, roomId, code } = await readyRoom();

    await leaveRoom(asPrisma(db.prisma), roomId, guest);
    let view = toRoomView(await loadRoom(asPrisma(db.prisma), roomId));
    expect(view.players).toHaveLength(1);

    await joinRoom({ prisma: asPrisma(db.prisma), playerId: guest, code });
    view = toRoomView(await loadRoom(asPrisma(db.prisma), roomId));
    expect(view.players).toHaveLength(2);
  });

  it('a disconnect does not forfeit the seat', async () => {
    const { host, guest, roomId } = await readyRoom();
    await startMatch(asPrisma(db.prisma), roomId, host);

    await markConnected(asPrisma(db.prisma), roomId, guest, false);

    const view = toRoomView(await loadRoom(asPrisma(db.prisma), roomId));
    const seat = view.players.find((p) => p.playerId === guest)!;
    expect(seat.connected).toBe(false);
    // Still seated — a dropped connection is not a forfeit.
    expect(view.players).toHaveLength(2);

    const state = await getMatchState(asPrisma(db.prisma), roomId);
    expect(state!.phase).toBe('in-play');
  });
});

describe('room capacity', () => {
  it('refuses a fifth player in a four-seat room', async () => {
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
      const p = await makePlayer(name, `device-${i}`);
      await joinRoom({ prisma: asPrisma(db.prisma), playerId: p, code: room.code });
    }

    const extra = await makePlayer('Latecomer', 'device-extra');
    await expect(
      joinRoom({ prisma: asPrisma(db.prisma), playerId: extra, code: room.code }),
    ).rejects.toMatchObject({ code: 'ROOM_FULL' });
  });

  it('refuses a join once the match is under way', async () => {
    const { host, roomId, code } = await readyRoom();
    await startMatch(asPrisma(db.prisma), roomId, host);

    const late = await makePlayer('Latecomer', 'device-late');
    await expect(
      joinRoom({ prisma: asPrisma(db.prisma), playerId: late, code }),
    ).rejects.toMatchObject({ code: 'ROOM_ALREADY_STARTED' });
  });

  it('refuses an unknown room code', async () => {
    const player = await makePlayer('Someone', 'device-x');
    await expect(
      joinRoom({ prisma: asPrisma(db.prisma), playerId: player, code: 'ZZZZ' }),
    ).rejects.toMatchObject({ code: 'ROOM_NOT_FOUND' });
  });
});
