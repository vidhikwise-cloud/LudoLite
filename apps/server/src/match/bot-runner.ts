/**
 * Drives computer opponents.
 *
 * A bot is a real seat in a real room; the server simply plays it. That means
 * bots go through exactly the same `rollDice` and `moveToken` services a
 * human does, so every rule — turn order, legal moves, three sixes, captures
 * — applies identically. There is no separate bot code path that could drift
 * from the real one.
 *
 * Bots pause before acting. An opponent that answers instantly feels like a
 * script; one that takes a beat feels like a player.
 */

import { randomInt } from 'node:crypto';

import {
  chooseMove,
  legalMoves,
  thinkingTime,
  type BotLevel,
  type MatchState,
  type SeatIndex,
} from '@ludolite/engine';
import type { PrismaClient } from '@prisma/client';

import { log } from '../logger.js';
import { getMatchState, moveToken, rollDice } from './service.js';

const logger = log('bot');

/** Crypto-backed float in [0, 1), so bot choices are not predictable. */
function random(): number {
  return randomInt(0, 1_000_000) / 1_000_000;
}

function isBotLevel(value: string | null): value is BotLevel {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

export interface BotTurnEvents {
  /** Called after the bot rolls, so the roll can be broadcast. */
  onRolled(payload: { seat: SeatIndex; die: number; state: MatchState }): void;
  /** Called after each state change. */
  onState(state: MatchState): void;
  /** Called once the match ends. */
  onEnded(state: MatchState): void;
}

/** Rooms with a bot turn already in flight, so two never run at once. */
const running = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Play out bot turns until it is a human's turn again, or the match ends.
 *
 * Loops rather than handling one turn: a bot that rolls a six, or captures,
 * earns another roll, and consecutive bot seats must each take their turn
 * before the humans see the board again.
 */
export async function runBotTurns(
  prisma: PrismaClient,
  roomId: string,
  events: BotTurnEvents,
): Promise<void> {
  if (running.has(roomId)) return;
  running.add(roomId);

  try {
    // Bounded so a bug in turn handling cannot spin forever.
    for (let guard = 0; guard < 200; guard++) {
      const state = await getMatchState(prisma, roomId);
      if (!state || state.phase !== 'in-play') return;

      const membership = await prisma.roomMembership.findFirst({
        where: { roomId, seat: state.turnSeat, leftAt: null },
      });

      // Not a bot's turn — hand control back to the humans.
      if (!membership?.isBot) return;

      const level: BotLevel = isBotLevel(membership.botLevel)
        ? membership.botLevel
        : 'normal';

      // Early on, most rolls are unplayable: with every token still in the
      // yard only a six does anything, so the bot rolls and immediately
      // passes. Pausing a full second to watch that happen is tedious, so
      // think briefly when there is unlikely to be a decision to make.
      const hasTokensInPlay = state.seats
        .find((s) => s.index === state.turnSeat)
        ?.tokens.some((t) => t.position.kind !== 'yard' && t.position.kind !== 'finish');

      await sleep(hasTokensInPlay ? thinkingTime(level, random) : 320);

      // --- roll ------------------------------------------------------------
      let afterRoll: MatchState;
      try {
        const result = await rollDice(prisma, roomId, membership.playerId);
        afterRoll = result.state;
        events.onRolled({ seat: result.seat, die: result.die, state: result.state });
        events.onState(result.state);
      } catch (error) {
        logger.warn({ err: error, roomId, seat: state.turnSeat }, 'bot roll failed');
        return;
      }

      // An unplayable roll passes the turn automatically inside the engine.
      if (afterRoll.pendingDice.length === 0) {
        if (afterRoll.phase === 'complete') {
          events.onEnded(afterRoll);
          return;
        }
        continue;
      }

      // --- move ------------------------------------------------------------
      const options = legalMoves(afterRoll);
      const choice = chooseMove(
        afterRoll,
        afterRoll.turnSeat,
        options,
        level,
        random,
      );

      if (!choice) {
        logger.warn({ roomId, seat: afterRoll.turnSeat }, 'bot had dice but no move');
        return;
      }

      // A short second pause so the roll is readable before the token moves.
      // Skipped when there was only one legal move — there was no decision to
      // make, so pretending to deliberate just wastes the player's time.
      if (options.length > 1) await sleep(260);

      try {
        const next = await moveToken(prisma, roomId, membership.playerId, {
          token: choice.token,
          die: choice.die,
        });
        events.onState(next);

        if (next.phase === 'complete') {
          events.onEnded(next);
          return;
        }
      } catch (error) {
        logger.warn({ err: error, roomId }, 'bot move failed');
        return;
      }
    }

    logger.error({ roomId }, 'bot turn loop hit its guard limit');
  } finally {
    running.delete(roomId);
  }
}

/** True when the seat currently on turn is played by the computer. */
export async function isBotTurn(
  prisma: PrismaClient,
  roomId: string,
): Promise<boolean> {
  const state = await getMatchState(prisma, roomId);
  if (!state || state.phase !== 'in-play') return false;

  const membership = await prisma.roomMembership.findFirst({
    where: { roomId, seat: state.turnSeat, leftAt: null },
    select: { isBot: true },
  });

  return Boolean(membership?.isBot);
}
