/**
 * Full-game simulations.
 *
 * Unit tests prove the bot scores individual moves sensibly. Only playing
 * whole games proves the scoring actually works: an early version looked
 * correct move-by-move but stacked every token on its entry square and never
 * finished, because the yard bonus was flat.
 *
 * These run thousands of turns, so they use a seeded generator rather than
 * the crypto RNG and keep the game count modest.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  applyMove,
  applyRoll,
  chooseMove,
  createMatch,
  legalMoves,
  type BotLevel,
  type MatchState,
} from '../src/index.js';

/** Deterministic PRNG so a failure can be reproduced exactly. */
function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    // xorshift32
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    value >>>= 0;
    return value / 0x1_0000_0000;
  };
}

interface GameResult {
  readonly finished: boolean;
  readonly winner: number | null;
  readonly turns: number;
}

function playGame(levels: readonly BotLevel[], random: () => number): GameResult {
  let state: MatchState = createMatch({
    matchId: 'sim',
    seatCount: 4,
    playerIds: ['a', 'b', 'c', 'd'],
  });

  // Generous ceiling: a real Ludo game is a few hundred turns.
  for (let turns = 1; turns <= 4000; turns++) {
    if (state.phase !== 'in-play') {
      return { finished: true, winner: state.winnerSeat, turns };
    }

    const die = 1 + Math.floor(random() * 6);
    try {
      state = applyRoll(state, state.turnSeat, die);
    } catch {
      return { finished: false, winner: null, turns };
    }

    if (state.phase !== 'in-play') {
      return { finished: true, winner: state.winnerSeat, turns };
    }
    if (state.pendingDice.length === 0) continue;

    const level = levels[state.turnSeat] ?? 'normal';
    const choice = chooseMove(state, state.turnSeat, legalMoves(state), level, random);
    if (!choice) continue;

    try {
      state = applyMove(state, {
        seat: state.turnSeat,
        token: choice.token,
        die: choice.die,
      });
    } catch {
      return { finished: false, winner: null, turns };
    }
  }

  return { finished: false, winner: null, turns: 4000 };
}

describe('bot games reach a conclusion', () => {
  it('every level finishes a full four-player game', () => {
    for (const level of ['easy', 'normal', 'hard'] as BotLevel[]) {
      const result = playGame([level, level, level, level], seeded(12345));
      assert.ok(result.finished, `${level} bots failed to finish a game`);
      assert.notEqual(result.winner, null);
    }
  });

  it('finishes consistently across many seeds', () => {
    const levels: BotLevel[] = ['hard', 'hard', 'normal', 'easy'];
    let finished = 0;
    const games = 20;

    for (let seed = 1; seed <= games; seed++) {
      if (playGame(levels, seeded(seed * 7919)).finished) finished++;
    }

    assert.equal(finished, games, `only ${finished}/${games} games finished`);
  });

  it('takes a plausible number of turns', () => {
    // Too few means the bots are not really playing; too many means they are
    // shuffling without progressing.
    const result = playGame(['hard', 'hard', 'hard', 'hard'], seeded(999));

    assert.ok(result.turns > 80, `finished suspiciously fast: ${result.turns} turns`);
    assert.ok(result.turns < 2500, `dragged on: ${result.turns} turns`);
  });
});

describe('difficulty is meaningful', () => {
  it('hard beats easy clearly over many games', () => {
    // Seats 0 and 1 are hard, 2 and 3 are easy. Seat order confers a small
    // first-mover advantage, so compare the hard PAIR against the easy pair
    // rather than individual seats.
    const levels: BotLevel[] = ['hard', 'easy', 'hard', 'easy'];
    let hardWins = 0;
    let easyWins = 0;
    const games = 60;

    for (let seed = 1; seed <= games; seed++) {
      const result = playGame(levels, seeded(seed * 104_729));
      if (result.winner === null) continue;
      if (result.winner === 0 || result.winner === 2) hardWins++;
      else easyWins++;
    }

    assert.ok(
      hardWins > easyWins,
      `hard should win more often: hard ${hardWins}, easy ${easyWins}`,
    );
  });

  it('easy still wins sometimes, so it is not hopeless', () => {
    const levels: BotLevel[] = ['hard', 'easy', 'hard', 'easy'];
    let easyWins = 0;

    for (let seed = 1; seed <= 60; seed++) {
      const result = playGame(levels, seeded(seed * 31_337));
      if (result.winner === 1 || result.winner === 3) easyWins++;
    }

    assert.ok(easyWins > 0, 'easy bots never won a single game');
  });
});

describe('the difficulty curve is playable', () => {
  /** Win rate for seat 0 across `games` simulated matches. */
  function winRate(levels: readonly BotLevel[], games: number): number {
    let wins = 0;
    let finished = 0;

    for (let seed = 1; seed <= games; seed++) {
      const result = playGame(levels, seeded(seed * 2_654_435_761));
      if (!result.finished || result.winner === null) continue;
      finished++;
      if (result.winner === 0) wins++;
    }

    assert.ok(finished > games * 0.9, `only ${finished}/${games} games finished`);
    return wins / finished;
  }

  it('rewards a strong player without guaranteeing the win', () => {
    // Playing well against weak opponents should beat the 25% baseline
    // clearly — but Ludo is a dice game, so it must not approach certainty.
    const rate = winRate(['hard', 'easy', 'easy', 'easy'], 120);

    assert.ok(rate > 0.4, `a strong player only won ${(rate * 100).toFixed(0)}%`);
    assert.ok(rate < 0.8, `too easy: a strong player won ${(rate * 100).toFixed(0)}%`);
  });

  it('punishes careless play without making it hopeless', () => {
    const rate = winRate(['easy', 'hard', 'hard', 'hard'], 120);

    assert.ok(rate < 0.22, `hard bots were too soft: easy won ${(rate * 100).toFixed(0)}%`);
    assert.ok(rate > 0.02, `hard bots were brutal: easy won ${(rate * 100).toFixed(0)}%`);
  });

  it('gives no seat an unfair edge when everyone plays the same', () => {
    const rate = winRate(['normal', 'normal', 'normal', 'normal'], 120);

    // Seat 0 moves first, worth a little. Anything far from 25% would mean a
    // positional bug rather than a strategy difference.
    assert.ok(
      rate > 0.15 && rate < 0.38,
      `seat 0 won ${(rate * 100).toFixed(0)}%, expected roughly 25%`,
    );
  });
});
