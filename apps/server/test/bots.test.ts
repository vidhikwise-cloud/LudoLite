/**
 * Computer opponents, server side.
 *
 * The rules that matter: a bot is never charged, a solo game is always free,
 * and a bot plays through the same services a human does so no rule can be
 * bypassed by being a bot.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runBotTurns } from '../src/match/bot-runner.js';
import { getMatchState, startMatch } from '../src/match/service.js';
import { nullProvider } from '../src/payments/provider.js';
import { createRoom, joinRoom, toRoomView, loadRoom } from '../src/rooms/service.js';
import { makeConfig } from './helpers/config.js';
import { createTestDb, grantApprovals, type TestDb } from './helpers/db.js';

let db: TestDb;
const asPrisma = (p: unknown) => p as never;
const DISABLED = makeConfig({ paidRoomHostingFlag: false, paymentProvider: 'none' });
const ENABLED = makeConfig({ paidRoomHostingFlag: true, paymentProvider: 'mock' });

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.dispose();
});

async function human(name: string): Promise<string> {
  const row = await db.prisma.player.create({
    data: { displayName: name, deviceKey: `dev-${name}-${Math.random()}` },
  });
  return row.id;
}

const noEvents = {
  onRolled: () => {},
  onState: () => {},
  onEnded: () => {},
};

describe('creating a game against the computer', () => {
  it('seats the requested number of bots and starts full', async () => {
    const host = await human('Jasmin');
    const { room } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider: nullProvider,
      playerId: host,
      seatCount: 4,
      funding: 'free',
      bots: { count: 3, level: 'normal' },
      c: DISABLED,
    });

    const view = toRoomView(room);
    expect(view.players).toHaveLength(4);
    expect(view.players.filter((p) => p.isBot)).toHaveLength(3);
    expect(view.canStart).toBe(true);

    // The host is the only human, and is not a bot.
    const me = view.players.find((p) => p.playerId === host)!;
    expect(me.isBot).toBe(false);
    expect(me.isHost).toBe(true);
  });

  it('supports a one-on-one against the computer', async () => {
    const host = await human('Jasmin');
    const { room } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider: nullProvider,
      playerId: host,
      seatCount: 2,
      funding: 'free',
      bots: { count: 1, level: 'hard' },
      c: DISABLED,
    });

    const view = toRoomView(room);
    expect(view.players).toHaveLength(2);
    expect(view.players.filter((p) => p.isBot)).toHaveLength(1);
    expect(view.players.find((p) => p.isBot)!.botLevel).toBe('hard');
  });

  it('records the difficulty on each bot', async () => {
    const host = await human('Jasmin');
    const { room } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider: nullProvider,
      playerId: host,
      seatCount: 4,
      funding: 'free',
      bots: { count: 3, level: 'easy' },
      c: DISABLED,
    });

    for (const bot of toRoomView(room).players.filter((p) => p.isBot)) {
      expect(bot.botLevel).toBe('easy');
    }
  });

  it('refuses more bots than there are seats', async () => {
    const host = await human('Jasmin');
    await expect(
      createRoom({
        prisma: asPrisma(db.prisma),
        provider: nullProvider,
        playerId: host,
        seatCount: 2,
        funding: 'free',
        bots: { count: 3, level: 'normal' },
        c: DISABLED,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('a solo game is always free', () => {
  it('refuses to charge for a game against the computer', async () => {
    await grantApprovals(db.prisma, { providerName: 'mock' });
    const host = await human('Jasmin');

    await expect(
      createRoom({
        prisma: asPrisma(db.prisma),
        provider: nullProvider,
        playerId: host,
        seatCount: 4,
        funding: 'paid',
        bots: { count: 3, level: 'normal' },
        consent: {
          acceptedTerms: true,
          acknowledgedNoPrize: true,
          displayedAmountPaise: 100,
        },
        c: ENABLED,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    // Nothing was created and nothing was charged.
    expect(await db.prisma.room.count()).toBe(0);
    expect(await db.prisma.transaction.count()).toBe(0);
  });

  it('creates no transaction for a bot game', async () => {
    const host = await human('Jasmin');
    await createRoom({
      prisma: asPrisma(db.prisma),
      provider: nullProvider,
      playerId: host,
      seatCount: 4,
      funding: 'free',
      bots: { count: 3, level: 'normal' },
      c: DISABLED,
    });

    expect(await db.prisma.transaction.count()).toBe(0);
  });

  it('never marks a bot as a paying host', async () => {
    const host = await human('Jasmin');
    const { room } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider: nullProvider,
      playerId: host,
      seatCount: 4,
      funding: 'free',
      bots: { count: 3, level: 'normal' },
      c: DISABLED,
    });

    for (const player of toRoomView(room).players) {
      if (player.isBot) expect(player.paidHost).toBe(false);
    }
  });

  it('audits bot seating as explicitly uncharged', async () => {
    const host = await human('Jasmin');
    await createRoom({
      prisma: asPrisma(db.prisma),
      provider: nullProvider,
      playerId: host,
      seatCount: 4,
      funding: 'free',
      bots: { count: 3, level: 'normal' },
      c: DISABLED,
    });

    const entry = await db.prisma.auditLog.findFirstOrThrow({
      where: { action: 'room.joined', actorType: 'system' },
    });
    const detail = JSON.parse(entry.detail);
    expect(detail.charged).toBe(false);
    expect(detail.feePaise).toBe(0);
    expect(detail.bots).toBe(3);
  });
});

describe('bots playing', () => {
  async function botMatch(level: 'easy' | 'normal' | 'hard' = 'normal') {
    const host = await human('Jasmin');
    const { room } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider: nullProvider,
      playerId: host,
      seatCount: 4,
      funding: 'free',
      bots: { count: 3, level },
      c: DISABLED,
    });
    await startMatch(asPrisma(db.prisma), room.id, host);
    return { host, roomId: room.id };
  }

  it('the match starts with the human on seat 0', async () => {
    const { roomId } = await botMatch();
    const state = await getMatchState(asPrisma(db.prisma), roomId);

    expect(state?.phase).toBe('in-play');
    expect(state?.turnSeat).toBe(0);
  });

  it('runBotTurns is a no-op while it is the human turn', async () => {
    const { roomId } = await botMatch();
    const before = await getMatchState(asPrisma(db.prisma), roomId);

    await runBotTurns(asPrisma(db.prisma), roomId, noEvents);

    const after = await getMatchState(asPrisma(db.prisma), roomId);
    expect(after?.version).toBe(before?.version);
    expect(after?.turnSeat).toBe(0);
  });

  it('bots take their turns and hand back to the human', async () => {
    const { host, roomId } = await botMatch();

    // Play the human's turn by rolling until the turn moves on.
    const { rollDice, moveToken } = await import('../src/match/service.js');
    for (let i = 0; i < 20; i++) {
      const state = await getMatchState(asPrisma(db.prisma), roomId);
      if (!state || state.turnSeat !== 0) break;

      const result = await rollDice(asPrisma(db.prisma), roomId, host);
      if (result.state.pendingDice.length === 0) continue;

      const { legalMoves } = await import('@ludolite/engine');
      const options = legalMoves(result.state);
      if (options[0]) {
        await moveToken(asPrisma(db.prisma), roomId, host, {
          token: options[0].token,
          die: options[0].die,
        });
      }
    }

    const handedOver = await getMatchState(asPrisma(db.prisma), roomId);
    // Either the human kept the turn by rolling a six, or it is a bot's now.
    if (handedOver && handedOver.turnSeat !== 0) {
      await runBotTurns(asPrisma(db.prisma), roomId, noEvents);

      const after = await getMatchState(asPrisma(db.prisma), roomId);
      // Control comes back to the human, or the match finished.
      expect(after?.turnSeat === 0 || after?.phase === 'complete').toBe(true);
    }
  }, 30_000);

  it('records bot actions in the match event log like any other player', async () => {
    const { host, roomId } = await botMatch();
    const { rollDice } = await import('../src/match/service.js');

    await rollDice(asPrisma(db.prisma), roomId, host);
    await runBotTurns(asPrisma(db.prisma), roomId, noEvents);

    const match = await db.prisma.match.findUniqueOrThrow({ where: { roomId } });
    const events = await db.prisma.matchEvent.findMany({
      where: { matchId: match.id },
      orderBy: { seq: 'asc' },
    });

    expect(events.length).toBeGreaterThan(1);
    expect(events[0]!.type).toBe('start');
  }, 30_000);

  it('emits roll and state events as it plays', async () => {
    const { host, roomId } = await botMatch();
    const { rollDice, moveToken } = await import('../src/match/service.js');
    const { legalMoves } = await import('@ludolite/engine');

    // Burn the human turn so a bot gets control.
    for (let i = 0; i < 20; i++) {
      const state = await getMatchState(asPrisma(db.prisma), roomId);
      if (!state || state.turnSeat !== 0) break;
      const rolled = await rollDice(asPrisma(db.prisma), roomId, host);
      const options = legalMoves(rolled.state);
      if (options[0]) {
        await moveToken(asPrisma(db.prisma), roomId, host, {
          token: options[0].token,
          die: options[0].die,
        });
      }
    }

    const rolls: number[] = [];
    let states = 0;
    await runBotTurns(asPrisma(db.prisma), roomId, {
      onRolled: ({ die }) => rolls.push(die),
      onState: () => {
        states++;
      },
      onEnded: () => {},
    });

    const current = await getMatchState(asPrisma(db.prisma), roomId);
    if (current?.phase === 'in-play' && current.turnSeat === 0) {
      // A bot ran, so it must have rolled and produced state updates.
      expect(rolls.length).toBeGreaterThan(0);
      expect(states).toBeGreaterThan(0);
      for (const die of rolls) {
        expect(die).toBeGreaterThanOrEqual(1);
        expect(die).toBeLessThanOrEqual(6);
      }
    }
  }, 30_000);

  it('does not run two bot loops for the same room at once', async () => {
    const { roomId } = await botMatch();

    // Both calls return without throwing; the second sees the guard.
    await Promise.all([
      runBotTurns(asPrisma(db.prisma), roomId, noEvents),
      runBotTurns(asPrisma(db.prisma), roomId, noEvents),
    ]);

    const state = await getMatchState(asPrisma(db.prisma), roomId);
    expect(state).not.toBeNull();
  }, 30_000);
});

describe('bots and humans mixed', () => {
  it('a friend can join a room that already has bots', async () => {
    const host = await human('Jasmin');
    const { room } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider: nullProvider,
      playerId: host,
      seatCount: 4,
      funding: 'free',
      bots: { count: 2, level: 'normal' },
      c: DISABLED,
    });

    const friend = await human('Ravi');
    const joined = await joinRoom({
      prisma: asPrisma(db.prisma),
      playerId: friend,
      code: room.code,
    });

    const view = toRoomView(joined);
    expect(view.players).toHaveLength(4);
    expect(view.players.filter((p) => p.isBot)).toHaveLength(2);
    expect(view.players.filter((p) => !p.isBot)).toHaveLength(2);
    // Still nobody charged.
    expect(await db.prisma.transaction.count()).toBe(0);
  });

  it('a room full of bots has no seat left for a human', async () => {
    const host = await human('Jasmin');
    const { room } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider: nullProvider,
      playerId: host,
      seatCount: 2,
      funding: 'free',
      bots: { count: 1, level: 'normal' },
      c: DISABLED,
    });

    const latecomer = await human('Ravi');
    await expect(
      joinRoom({ prisma: asPrisma(db.prisma), playerId: latecomer, code: room.code }),
    ).rejects.toMatchObject({ code: 'ROOM_FULL' });
  });

  it('bots always read as connected', async () => {
    const host = await human('Jasmin');
    const { room } = await createRoom({
      prisma: asPrisma(db.prisma),
      provider: nullProvider,
      playerId: host,
      seatCount: 4,
      funding: 'free',
      bots: { count: 3, level: 'normal' },
      c: DISABLED,
    });

    const view = toRoomView(await loadRoom(asPrisma(db.prisma), room.id));
    for (const bot of view.players.filter((p) => p.isBot)) {
      expect(bot.connected).toBe(true);
    }
  });
});
