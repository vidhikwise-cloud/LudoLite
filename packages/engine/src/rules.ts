/**
 * Ludo rules.
 *
 * House rules implemented here (fixed, not configurable, so that client and
 * server can never disagree about them):
 *
 *  - A 6 is required to move a token out of the yard.
 *  - A 6 grants an extra roll. Three sixes in a row forfeits the turn.
 *  - Capturing an opponent grants an extra roll.
 *  - Landing a token on the centre grants an extra roll.
 *  - Seat entry squares and star squares are safe; no captures there.
 *  - A token must reach the centre by exact count; an overshoot is illegal.
 *  - Two tokens of the same seat may share a square (no blocking rule).
 */

import {
  HOME_RUN_LENGTH,
  TOKENS_PER_SEAT,
  TRACK_STEPS_BEFORE_HOME,
  isSafeSquare,
  progressFromSquare,
  seatsForCount,
  squareFromProgress,
} from './board.js';
import type {
  LegalMove,
  MatchState,
  Seat,
  SeatIndex,
  Token,
  TokenIndex,
  TokenPosition,
} from './types.js';

export const MAX_CONSECUTIVE_SIXES = 3;

export function isValidDie(die: number): boolean {
  return Number.isInteger(die) && die >= 1 && die <= 6;
}

function seatAt(state: MatchState, seat: SeatIndex): Seat | undefined {
  return state.seats.find((s) => s.index === seat);
}

/** Seats that are actually part of this match, in turn order. */
export function activeSeats(state: MatchState): readonly SeatIndex[] {
  return seatsForCount(state.seatCount);
}

/**
 * Where a token ends up if moved `die` steps, or null if the move would
 * overshoot the centre.
 */
export function destinationFor(
  seat: SeatIndex,
  from: TokenPosition,
  die: number,
): TokenPosition | null {
  switch (from.kind) {
    case 'finish':
      return null;

    case 'yard':
      // Only a 6 opens the gate, and it places the token on the entry square.
      return die === 6 ? { kind: 'track', square: squareFromProgress(seat, 0) } : null;

    case 'track': {
      const progress = progressFromSquare(seat, from.square);
      const next = progress + die;

      if (next <= TRACK_STEPS_BEFORE_HOME) {
        return { kind: 'track', square: squareFromProgress(seat, next) };
      }

      // Past the loop: step onto the home run. One step beyond the last
      // track square is home step 0.
      const homeStep = next - TRACK_STEPS_BEFORE_HOME - 1;
      if (homeStep < HOME_RUN_LENGTH) return { kind: 'home', step: homeStep };
      if (homeStep === HOME_RUN_LENGTH) return { kind: 'finish' };
      return null; // overshoot
    }

    case 'home': {
      const next = from.step + die;
      if (next < HOME_RUN_LENGTH) return { kind: 'home', step: next };
      if (next === HOME_RUN_LENGTH) return { kind: 'finish' };
      return null; // overshoot
    }
  }
}

/** Opponent tokens that would be captured by landing on `square`. */
function capturesAt(
  state: MatchState,
  movingSeat: SeatIndex,
  destination: TokenPosition,
): { seat: SeatIndex; token: TokenIndex }[] {
  if (destination.kind !== 'track') return [];
  if (isSafeSquare(destination.square)) return [];

  const hits: { seat: SeatIndex; token: TokenIndex }[] = [];
  for (const seat of state.seats) {
    if (seat.index === movingSeat) continue;
    if (seat.playerId === null) continue;
    for (const token of seat.tokens) {
      if (token.position.kind === 'track' && token.position.square === destination.square) {
        hits.push({ seat: seat.index, token: token.index });
      }
    }
  }
  return hits;
}

/** Every move the given seat can legally make with the given die value. */
export function legalMovesForDie(
  state: MatchState,
  seat: SeatIndex,
  die: number,
): LegalMove[] {
  if (!isValidDie(die)) return [];
  const s = seatAt(state, seat);
  if (!s || s.playerId === null) return [];

  const moves: LegalMove[] = [];
  for (const token of s.tokens) {
    const to = destinationFor(seat, token.position, die);
    if (to === null) continue;

    moves.push({
      seat,
      token: token.index,
      die,
      from: token.position,
      to,
      captures: capturesAt(state, seat, to),
      finishes: to.kind === 'finish',
    });
  }
  return moves;
}

/** Every legal move across all dice currently pending for the active seat. */
export function legalMoves(state: MatchState): LegalMove[] {
  if (state.phase !== 'in-play') return [];
  const seen = new Set<string>();
  const out: LegalMove[] = [];

  for (const die of state.pendingDice) {
    for (const move of legalMovesForDie(state, state.turnSeat, die)) {
      // Two identical dice produce identical moves; show each option once.
      const key = `${move.token}:${move.die}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(move);
    }
  }
  return out;
}

export function hasLegalMove(state: MatchState): boolean {
  return legalMoves(state).length > 0;
}

/** True once every token of the seat has reached the centre. */
export function seatHasFinished(seat: Seat): boolean {
  return seat.tokens.every((t) => t.position.kind === 'finish');
}

/** Next seat in turn order that is occupied and not already finished. */
export function nextSeat(state: MatchState, from: SeatIndex): SeatIndex {
  const order = activeSeats(state);
  const at = order.indexOf(from);
  for (let i = 1; i <= order.length; i++) {
    const candidate = order[(at + i) % order.length];
    if (candidate === undefined) continue;
    const seat = seatAt(state, candidate);
    if (seat && seat.playerId !== null && !seat.finished) return candidate;
  }
  return from;
}

export function makeTokens(): Token[] {
  return Array.from({ length: TOKENS_PER_SEAT }, (_, i) => ({
    index: i as TokenIndex,
    position: { kind: 'yard' } as TokenPosition,
  }));
}
