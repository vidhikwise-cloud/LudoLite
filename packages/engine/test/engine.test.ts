import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  applyForfeit,
  applyMove,
  applyRoll,
  createMatch,
  destinationFor,
  isSafeSquare,
  legalMoves,
  LudoRuleError,
  progressFromSquare,
  scriptedDice,
  squareFromProgress,
  type MatchState,
  type SeatIndex,
  type TokenIndex,
  type TokenPosition,
} from '../src/index.js';

function fourPlayer(): MatchState {
  return createMatch({
    matchId: 'm1',
    seatCount: 4,
    playerIds: ['p0', 'p1', 'p2', 'p3'],
  });
}

/** Force a token onto a specific position, bypassing play. Test helper only. */
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

describe('board geometry', () => {
  it('round-trips progress and square for every seat', () => {
    for (const seat of [0, 1, 2, 3] as SeatIndex[]) {
      for (let p = 0; p < 52; p++) {
        assert.equal(progressFromSquare(seat, squareFromProgress(seat, p)), p);
      }
    }
  });

  it('marks the four entry squares safe', () => {
    for (const square of [0, 13, 26, 39]) {
      assert.ok(isSafeSquare(square), `square ${square} should be safe`);
    }
  });
});

describe('destinationFor', () => {
  it('requires a six to leave the yard', () => {
    for (let die = 1; die <= 5; die++) {
      assert.equal(destinationFor(0, { kind: 'yard' }, die), null);
    }
    assert.deepEqual(destinationFor(0, { kind: 'yard' }, 6), { kind: 'track', square: 0 });
  });

  it('enters the home run after 51 track steps', () => {
    // Seat 0 at progress 51 is the last track square; +1 enters home step 0.
    const last = { kind: 'track', square: squareFromProgress(0, 51) } as const;
    assert.deepEqual(destinationFor(0, last, 1), { kind: 'home', step: 0 });
  });

  it('reaches the centre by exact count and rejects an overshoot', () => {
    assert.deepEqual(destinationFor(0, { kind: 'home', step: 3 }, 2), { kind: 'finish' });
    assert.equal(destinationFor(0, { kind: 'home', step: 3 }, 3), null);
    assert.equal(destinationFor(0, { kind: 'home', step: 4 }, 6), null);
  });

  it('never moves a finished token', () => {
    for (let die = 1; die <= 6; die++) {
      assert.equal(destinationFor(0, { kind: 'finish' }, die), null);
    }
  });
});

describe('turn flow', () => {
  it('passes the turn when a roll has no legal move', () => {
    const state = fourPlayer();
    // All tokens are in the yard, so anything but a 6 is unplayable.
    const next = applyRoll(state, 0, 3);
    assert.equal(next.turnSeat, 1);
    assert.deepEqual(next.pendingDice, []);
  });

  it('keeps the turn after a six and lets the token out', () => {
    let state = fourPlayer();
    state = applyRoll(state, 0, 6);
    assert.equal(state.turnSeat, 0);
    assert.deepEqual(state.pendingDice, [6]);

    const moves = legalMoves(state);
    assert.equal(moves.length, 4, 'all four yard tokens may come out on a six');

    state = applyMove(state, { seat: 0, token: 0, die: 6 });
    // A six earns another roll, so seat 0 still holds the turn.
    assert.equal(state.turnSeat, 0);
    assert.deepEqual(state.pendingDice, []);
  });

  it('forfeits the turn on three consecutive sixes', () => {
    let state = fourPlayer();
    state = applyRoll(state, 0, 6);
    state = applyMove(state, { seat: 0, token: 0, die: 6 });
    assert.equal(state.consecutiveSixes, 1);

    state = applyRoll(state, 0, 6);
    state = applyMove(state, { seat: 0, token: 1, die: 6 });
    assert.equal(state.consecutiveSixes, 2);

    state = applyRoll(state, 0, 6);
    assert.equal(state.turnSeat, 1, 'third six burns the turn');
    assert.deepEqual(state.pendingDice, []);
    assert.equal(state.consecutiveSixes, 0);
  });

  it('rejects a move from a seat that is not on turn', () => {
    let state = fourPlayer();
    state = applyRoll(state, 0, 6);
    assert.throws(() => applyMove(state, { seat: 1, token: 0, die: 6 }), /NOT_YOUR_TURN/);
  });

  it('rejects a die that was never rolled', () => {
    let state = fourPlayer();
    state = applyRoll(state, 0, 6);
    assert.throws(
      () => applyMove(state, { seat: 0, token: 0, die: 5 }),
      (error: unknown) => error instanceof LudoRuleError && error.code === 'ILLEGAL_MOVE',
    );
  });

  it('rejects rolling twice before playing the die', () => {
    let state = fourPlayer();
    state = applyRoll(state, 0, 6);
    assert.throws(() => applyRoll(state, 0, 4), /DICE_ALREADY_PENDING/);
  });

  it('rejects an out-of-range die value', () => {
    const state = fourPlayer();
    assert.throws(() => applyRoll(state, 0, 7), /INVALID_DIE/);
    assert.throws(() => applyRoll(state, 0, 0), /INVALID_DIE/);
  });
});

describe('captures', () => {
  it('sends an opponent on an unsafe square back to the yard', () => {
    let state = fourPlayer();
    // Seat 1 sits on square 5 (unsafe); seat 0 is three steps behind it.
    state = place(state, 1, 0, { kind: 'track', square: 5 });
    state = place(state, 0, 0, { kind: 'track', square: 2 });

    state = applyRoll(state, 0, 3);
    state = applyMove(state, { seat: 0, token: 0, die: 3 });

    const victim = state.seats.find((s) => s.index === 1)!.tokens[0]!;
    assert.equal(victim.position.kind, 'yard');
    // A capture earns an extra roll, so seat 0 keeps the turn.
    assert.equal(state.turnSeat, 0);
  });

  it('does not capture on a safe square', () => {
    let state = fourPlayer();
    // Square 8 is a star square.
    state = place(state, 1, 0, { kind: 'track', square: 8 });
    state = place(state, 0, 0, { kind: 'track', square: 5 });

    state = applyRoll(state, 0, 3);
    state = applyMove(state, { seat: 0, token: 0, die: 3 });

    const survivor = state.seats.find((s) => s.index === 1)!.tokens[0]!;
    assert.deepEqual(survivor.position, { kind: 'track', square: 8 });
    // No capture and not a six, so the turn passes on.
    assert.equal(state.turnSeat, 1);
  });

  it('leaves a same-seat token alone when sharing a square', () => {
    let state = fourPlayer();
    state = place(state, 0, 1, { kind: 'track', square: 5 });
    state = place(state, 0, 0, { kind: 'track', square: 2 });

    state = applyRoll(state, 0, 3);
    state = applyMove(state, { seat: 0, token: 0, die: 3 });

    const seat0 = state.seats.find((s) => s.index === 0)!;
    assert.deepEqual(seat0.tokens[0]!.position, { kind: 'track', square: 5 });
    assert.deepEqual(seat0.tokens[1]!.position, { kind: 'track', square: 5 });
  });
});

describe('finishing', () => {
  it('declares a winner when a seat brings all four tokens home', () => {
    let state = fourPlayer();
    for (const token of [0, 1, 2] as TokenIndex[]) {
      state = place(state, 0, token, { kind: 'finish' });
    }
    state = place(state, 0, 3, { kind: 'home', step: 3 });

    state = applyRoll(state, 0, 2);
    state = applyMove(state, { seat: 0, token: 3, die: 2 });

    assert.equal(state.seats.find((s) => s.index === 0)!.finished, true);
    assert.deepEqual(state.rankings, [0]);
  });

  it('completes the match when only one player remains unfinished', () => {
    let state = createMatch({ matchId: 'm2', seatCount: 2, playerIds: ['a', 'b'] });
    for (const token of [0, 1, 2] as TokenIndex[]) {
      state = place(state, 0, token, { kind: 'finish' });
    }
    state = place(state, 0, 3, { kind: 'home', step: 4 });

    state = applyRoll(state, 0, 1);
    state = applyMove(state, { seat: 0, token: 3, die: 1 });

    assert.equal(state.phase, 'complete');
    assert.equal(state.winnerSeat, 0);
  });
});

describe('forfeit', () => {
  it('vacates the seat and moves the turn along', () => {
    let state = fourPlayer();
    state = applyForfeit(state, 0);
    assert.equal(state.seats.find((s) => s.index === 0)!.playerId, null);
    assert.equal(state.turnSeat, 1);
  });

  it('ends a two-player match when one side leaves', () => {
    let state = createMatch({ matchId: 'm3', seatCount: 2, playerIds: ['a', 'b'] });
    state = applyForfeit(state, 0);
    assert.equal(state.phase, 'complete');
    assert.equal(state.winnerSeat, 2, 'the remaining seat wins');
  });
});

describe('immutability and versioning', () => {
  it('does not mutate the input state', () => {
    const state = fourPlayer();
    const snapshot = JSON.stringify(state);
    applyRoll(state, 0, 6);
    assert.equal(JSON.stringify(state), snapshot);
  });

  it('advances the version on every applied action', () => {
    let state = fourPlayer();
    const before = state.version;
    state = applyRoll(state, 0, 6);
    assert.ok(state.version > before);
  });
});

describe('scriptedDice', () => {
  it('replays its sequence and loops', () => {
    const dice = scriptedDice([6, 3]);
    assert.deepEqual([dice.roll(), dice.roll(), dice.roll()], [6, 3, 6]);
  });
});
