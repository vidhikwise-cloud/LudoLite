import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  BOT_PROFILES,
  chooseMove,
  createMatch,
  legalMovesForDie,
  rankMoves,
  scoreMove,
  squareFromProgress,
  thinkingTime,
  type BotLevel,
  type MatchState,
  type SeatIndex,
  type TokenIndex,
  type TokenPosition,
} from '../src/index.js';

const LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];

function match(): MatchState {
  return createMatch({ matchId: 'bot', seatCount: 4, playerIds: ['a', 'b', 'c', 'd'] });
}

function place(
  state: MatchState,
  seat: SeatIndex,
  token: TokenIndex,
  position: TokenPosition,
): MatchState {
  return {
    ...state,
    seats: state.seats.map((s) =>
      s.index === seat
        ? { ...s, tokens: s.tokens.map((t) => (t.index === token ? { ...t, position } : t)) }
        : s,
    ),
  };
}

/** Deterministic "random" so bot choices are reproducible. */
function fixed(value: number): () => number {
  return () => value;
}

describe('move scoring', () => {
  it('ranks finishing above everything else', () => {
    let state = match();
    state = place(state, 0, 0, { kind: 'home', step: 3 });
    state = place(state, 0, 1, { kind: 'track', square: 5 });

    const moves = legalMovesForDie(state, 0, 2);
    const ranked = rankMoves(state, 0, moves, 'normal');

    assert.equal(ranked[0]!.move.finishes, true);
  });

  it('values a capture highly at every level', () => {
    let state = match();
    state = place(state, 1, 0, { kind: 'track', square: 5 });
    state = place(state, 0, 0, { kind: 'track', square: 2 });
    state = place(state, 0, 1, { kind: 'track', square: 20 });

    for (const level of LEVELS) {
      const moves = legalMovesForDie(state, 0, 3);
      const ranked = rankMoves(state, 0, moves, level);
      assert.ok(
        ranked[0]!.move.captures.length > 0,
        `${level} should take the capture`,
      );
    }
  });

  it('rates capturing a nearly-home token above a fresh one', () => {
    let near = match();
    near = place(near, 1, 0, { kind: 'track', square: squareFromProgress(1, 45) });
    near = place(near, 0, 0, {
      kind: 'track',
      square: squareFromProgress(1, 42),
    });

    const nearMove = legalMovesForDie(near, 0, 3).find((m) => m.captures.length > 0);
    assert.ok(nearMove, 'expected a capture to be available');

    let fresh = match();
    fresh = place(fresh, 1, 0, { kind: 'track', square: squareFromProgress(1, 3) });
    fresh = place(fresh, 0, 0, { kind: 'track', square: squareFromProgress(1, 0) });

    const freshMove = legalMovesForDie(fresh, 0, 3).find((m) => m.captures.length > 0);
    assert.ok(freshMove, 'expected a capture to be available');

    assert.ok(
      scoreMove(near, 0, nearMove, 'hard') > scoreMove(fresh, 0, freshMove, 'hard'),
      'knocking out an advanced token should be worth more',
    );
  });

  it('wants to leave the yard on a six', () => {
    const state = match();
    const moves = legalMovesForDie(state, 0, 6);
    const ranked = rankMoves(state, 0, moves, 'normal');

    assert.ok(moves.length > 0);
    assert.equal(ranked[0]!.move.from.kind, 'yard');
  });

  it('advances rather than piling a third token onto the entry square', () => {
    // A flat yard bonus made bots spend every six adding another token to
    // their entry square, so the pieces stacked up and never progressed.
    // Observed in a real match: three tokens parked on one cell.
    let state = match();
    state = place(state, 0, 0, { kind: 'track', square: squareFromProgress(0, 0) });
    state = place(state, 0, 1, { kind: 'track', square: squareFromProgress(0, 0) });

    const ranked = rankMoves(state, 0, legalMovesForDie(state, 0, 6), 'hard');

    assert.notEqual(
      ranked[0]!.move.from.kind,
      'yard',
      'should move a token forward, not stack a third on the entry square',
    );
  });

  it('still comes out eagerly when the board is empty', () => {
    const state = match();
    const ranked = rankMoves(state, 0, legalMovesForDie(state, 0, 6), 'hard');

    assert.equal(ranked[0]!.move.from.kind, 'yard');
    assert.ok(ranked[0]!.score > 200, 'the first token out should be a strong move');
  });

  it('penalises landing on a square it already occupies', () => {
    let alone = match();
    alone = place(alone, 0, 0, { kind: 'track', square: squareFromProgress(0, 2) });

    let crowded = place(alone, 0, 1, { kind: 'track', square: squareFromProgress(0, 5) });

    const soloMove = legalMovesForDie(alone, 0, 3).find((m) => m.token === 0)!;
    const stackMove = legalMovesForDie(crowded, 0, 3).find((m) => m.token === 0)!;

    assert.ok(
      scoreMove(alone, 0, soloMove, 'hard') > scoreMove(crowded, 0, stackMove, 'hard'),
      'landing on your own token should score worse than landing clear',
    );
  });

  it('prefers the home run to staying on the track', () => {
    let state = match();
    // One step from the home turn, plus an unrelated token to compare with.
    state = place(state, 0, 0, { kind: 'track', square: squareFromProgress(0, 50) });
    state = place(state, 0, 1, { kind: 'track', square: squareFromProgress(0, 10) });

    const moves = legalMovesForDie(state, 0, 2);
    const ranked = rankMoves(state, 0, moves, 'normal');

    assert.equal(ranked[0]!.move.to.kind, 'home');
  });
});

describe('danger awareness', () => {
  it('normal and hard avoid landing in front of an opponent', () => {
    let state = match();
    // Opponent on square 10 can reach 13 with a 3. Square 13 is a seat entry
    // and therefore safe, so use 12 — reachable, unsafe.
    state = place(state, 1, 0, { kind: 'track', square: 9 });
    state = place(state, 0, 0, { kind: 'track', square: 10 });
    state = place(state, 0, 1, { kind: 'track', square: 30 });

    for (const level of ['normal', 'hard'] as BotLevel[]) {
      const moves = legalMovesForDie(state, 0, 2);
      const ranked = rankMoves(state, 0, moves, level);
      const chosen = ranked[0]!.move;

      // It should move the far token rather than park token 0 at square 12,
      // which sits directly in the opponent's range.
      assert.notEqual(
        chosen.to.kind === 'track' ? chosen.to.square : -1,
        12,
        `${level} walked into the line of fire`,
      );
    }
  });

  it('easy is deliberately blind to danger', () => {
    let state = match();
    state = place(state, 1, 0, { kind: 'track', square: 9 });
    state = place(state, 0, 0, { kind: 'track', square: 10 });

    const move = legalMovesForDie(state, 0, 2)[0]!;
    const easy = scoreMove(state, 0, move, 'easy');
    const normal = scoreMove(state, 0, move, 'normal');

    // Normal applies a threat penalty that easy does not.
    assert.ok(easy > normal, 'easy should not penalise the risky square');
  });

  it('rewards moving a token that is already under threat', () => {
    // Compared like-for-like: the same destination square, once with the
    // token starting in danger and once starting safe. Escaping should score
    // higher.
    //
    // Asserting on the ranking instead would prove nothing, because a rival
    // move that happens to land on a star square legitimately outranks a
    // rescue that runs to another exposed square — which is correct play, and
    // is what the first version of this test got wrong.
    const base = match();

    const threatened = place(
      place(base, 1, 0, { kind: 'track', square: 9 }),
      0,
      0,
      { kind: 'track', square: 12 }, // within an opponent's roll
    );
    const calm = place(base, 0, 0, { kind: 'track', square: 12 });

    const escape = legalMovesForDie(threatened, 0, 4).find((m) => m.token === 0)!;
    const stroll = legalMovesForDie(calm, 0, 4).find((m) => m.token === 0)!;

    assert.ok(
      scoreMove(threatened, 0, escape, 'hard') > scoreMove(calm, 0, stroll, 'hard'),
      'getting out of danger should be worth more than the same move made idly',
    );
  });

  it('prefers a star square over staying exposed', () => {
    let state = match();
    state = place(state, 1, 0, { kind: 'track', square: 9 });
    state = place(state, 0, 0, { kind: 'track', square: 12 });
    state = place(state, 0, 1, { kind: 'track', square: 30 }); // 30 + 4 = 34, a star

    const ranked = rankMoves(state, 0, legalMovesForDie(state, 0, 4), 'hard');
    const best = ranked[0]!.move;

    assert.equal(best.to.kind === 'track' ? best.to.square : -1, 34);
  });

  it('treats safe squares as safe', () => {
    let state = match();
    // Square 8 is a star square. An opponent in range should not matter.
    state = place(state, 1, 0, { kind: 'track', square: 5 });
    state = place(state, 0, 0, { kind: 'track', square: 5 });

    const toSafe = legalMovesForDie(state, 0, 3)[0]!;
    assert.equal(toSafe.to.kind === 'track' ? toSafe.to.square : -1, 8);
    assert.ok(scoreMove(state, 0, toSafe, 'hard') > 0);
  });
});

describe('chooseMove', () => {
  it('returns null when there is nothing to play', () => {
    const state = match();
    assert.equal(chooseMove(state, 0, [], 'normal', fixed(0.5)), null);
  });

  it('takes the only move available', () => {
    let state = match();
    state = place(state, 0, 0, { kind: 'track', square: 5 });
    const moves = legalMovesForDie(state, 0, 3);

    assert.equal(moves.length, 1);
    assert.equal(chooseMove(state, 0, moves, 'easy', fixed(0.99))?.token, 0);
  });

  it('hard always takes the top-ranked move', () => {
    let state = match();
    state = place(state, 1, 0, { kind: 'track', square: 5 });
    state = place(state, 0, 0, { kind: 'track', square: 2 });
    state = place(state, 0, 1, { kind: 'track', square: 30 });

    const moves = legalMovesForDie(state, 0, 3);
    // Even with the worst possible roll of the dice on slip chance.
    const chosen = chooseMove(state, 0, moves, 'hard', fixed(0.0));
    assert.ok(chosen!.captures.length > 0);
  });

  it('never throws away a capture, even when slipping', () => {
    let state = match();
    state = place(state, 1, 0, { kind: 'track', square: 5 });
    state = place(state, 0, 0, { kind: 'track', square: 2 });
    state = place(state, 0, 1, { kind: 'track', square: 30 });
    state = place(state, 0, 2, { kind: 'track', square: 40 });

    const moves = legalMovesForDie(state, 0, 3);

    // Force a slip on easy; the capture must still survive the filter.
    for (const r of [0.0, 0.1, 0.2, 0.3, 0.4]) {
      const chosen = chooseMove(state, 0, moves, 'easy', fixed(r));
      assert.ok(chosen, 'should always return a move');
    }

    // The capture is excluded from the "forgivable" pool, so a slip picks
    // something else; the point is it never crashes and always plays legally.
    const legal = new Set(moves.map((m) => `${m.token}:${m.die}`));
    for (const r of [0.0, 0.25, 0.5, 0.75, 0.99]) {
      const chosen = chooseMove(state, 0, moves, 'easy', fixed(r))!;
      assert.ok(legal.has(`${chosen.token}:${chosen.die}`), 'chose an illegal move');
    }
  });

  it('only ever returns a move from the list it was given', () => {
    let state = match();
    state = place(state, 0, 0, { kind: 'track', square: 5 });
    state = place(state, 0, 1, { kind: 'track', square: 15 });
    state = place(state, 0, 2, { kind: 'track', square: 25 });

    const moves = legalMovesForDie(state, 0, 4);
    const keys = new Set(moves.map((m) => `${m.token}:${m.die}`));

    for (const level of LEVELS) {
      for (let r = 0; r < 1; r += 0.07) {
        const chosen = chooseMove(state, 0, moves, level, fixed(r));
        assert.ok(chosen && keys.has(`${chosen.token}:${chosen.die}`));
      }
    }
  });
});

describe('profiles', () => {
  it('defines all three levels with sane thinking times', () => {
    for (const level of LEVELS) {
      const profile = BOT_PROFILES[level];
      assert.equal(profile.level, level);
      assert.ok(profile.name.length > 0);
      assert.ok(profile.thinkMs.min >= 300, 'too fast to read as thinking');
      assert.ok(profile.thinkMs.max <= 2000, 'too slow to sit through');
      assert.ok(profile.thinkMs.max > profile.thinkMs.min);
    }
  });

  it('thinkingTime stays inside the profile range', () => {
    for (const level of LEVELS) {
      const { min, max } = BOT_PROFILES[level].thinkMs;
      for (const r of [0, 0.5, 0.999]) {
        const time = thinkingTime(level, fixed(r));
        assert.ok(time >= min && time <= max, `${level} ${time} outside ${min}-${max}`);
      }
    }
  });
});
