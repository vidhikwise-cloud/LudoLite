/**
 * Match state transitions.
 *
 * Every exported function is pure: it returns a new state and never mutates
 * the one it was given. The server owns the only live copy; clients apply the
 * same transitions to stay in step and are corrected by server snapshots.
 */

import { SEAT_COLOR_BY_INDEX, seatsForCount } from './board.js';
import {
  MAX_CONSECUTIVE_SIXES,
  hasLegalMove,
  isValidDie,
  legalMovesForDie,
  makeTokens,
  nextSeat,
  seatHasFinished,
} from './rules.js';
import {
  LudoRuleError,
  type LegalMove,
  type MatchState,
  type Seat,
  type SeatIndex,
  type Token,
  type TokenIndex,
} from './types.js';

export interface CreateMatchOptions {
  readonly matchId: string;
  readonly seatCount: 2 | 4;
  /** Player ids in seat order. Length must equal seatCount. */
  readonly playerIds: readonly string[];
}

export function createMatch(options: CreateMatchOptions): MatchState {
  const { matchId, seatCount, playerIds } = options;
  if (playerIds.length !== seatCount) {
    throw new LudoRuleError(
      'SEAT_NOT_OCCUPIED',
      `expected ${seatCount} players, received ${playerIds.length}`,
    );
  }

  const order = seatsForCount(seatCount);
  const seats: Seat[] = order.map((seatIndex, i) => ({
    index: seatIndex,
    color: SEAT_COLOR_BY_INDEX[seatIndex],
    playerId: playerIds[i] ?? null,
    tokens: makeTokens(),
    finished: false,
  }));

  const first = order[0];
  if (first === undefined) throw new LudoRuleError('SEAT_NOT_OCCUPIED', 'no seats');

  return {
    matchId,
    seatCount,
    seats,
    phase: 'in-play',
    turnSeat: first,
    pendingDice: [],
    consecutiveSixes: 0,
    rankings: [],
    winnerSeat: null,
    version: 0,
  };
}

function replaceSeat(state: MatchState, updated: Seat): Seat[] {
  return state.seats.map((s) => (s.index === updated.index ? updated : s));
}

function replaceToken(seat: Seat, updated: Token): Seat {
  return { ...seat, tokens: seat.tokens.map((t) => (t.index === updated.index ? updated : t)) };
}

function requireSeat(state: MatchState, index: SeatIndex): Seat {
  const seat = state.seats.find((s) => s.index === index);
  if (!seat) throw new LudoRuleError('SEAT_NOT_OCCUPIED', `seat ${index} not in match`);
  return seat;
}

/**
 * Record a die roll for the seat whose turn it is.
 *
 * The caller supplies the value — the engine never generates randomness, so
 * the server remains the only place a dice value can originate.
 */
export function applyRoll(state: MatchState, seat: SeatIndex, die: number): MatchState {
  if (state.phase !== 'in-play') throw new LudoRuleError('NOT_IN_PLAY');
  if (seat !== state.turnSeat) throw new LudoRuleError('NOT_YOUR_TURN');
  if (!isValidDie(die)) throw new LudoRuleError('INVALID_DIE');
  if (state.pendingDice.length > 0) throw new LudoRuleError('DICE_ALREADY_PENDING');

  const consecutiveSixes = die === 6 ? state.consecutiveSixes + 1 : 0;

  // Three sixes in a row burns the turn and the dice with it.
  if (consecutiveSixes >= MAX_CONSECUTIVE_SIXES) {
    return {
      ...state,
      pendingDice: [],
      consecutiveSixes: 0,
      turnSeat: nextSeat(state, seat),
      version: state.version + 1,
    };
  }

  const next: MatchState = {
    ...state,
    pendingDice: [die],
    consecutiveSixes,
    version: state.version + 1,
  };

  // Nothing playable: pass immediately rather than stranding the player on a
  // screen with no legal action.
  if (!hasLegalMove(next)) {
    return {
      ...next,
      pendingDice: [],
      consecutiveSixes: 0,
      turnSeat: nextSeat(next, seat),
      version: next.version + 1,
    };
  }

  return next;
}

export interface MoveRequest {
  readonly seat: SeatIndex;
  readonly token: TokenIndex;
  readonly die: number;
}

function findMove(state: MatchState, request: MoveRequest): LegalMove {
  if (!state.pendingDice.includes(request.die)) {
    throw new LudoRuleError('ILLEGAL_MOVE', `die ${request.die} is not pending`);
  }
  const move = legalMovesForDie(state, request.seat, request.die).find(
    (m) => m.token === request.token,
  );
  if (!move) throw new LudoRuleError('ILLEGAL_MOVE');
  return move;
}

/** Apply a move the current seat has chosen. */
export function applyMove(state: MatchState, request: MoveRequest): MatchState {
  if (state.phase !== 'in-play') throw new LudoRuleError('NOT_IN_PLAY');
  if (request.seat !== state.turnSeat) throw new LudoRuleError('NOT_YOUR_TURN');
  if (state.pendingDice.length === 0) throw new LudoRuleError('NO_PENDING_DICE');

  const move = findMove(state, request);

  // 1. Move the token.
  let movingSeat = requireSeat(state, move.seat);
  movingSeat = replaceToken(movingSeat, { index: move.token, position: move.to });
  let seats = replaceSeat(state, movingSeat);

  // 2. Send captured tokens back to their yards.
  for (const capture of move.captures) {
    const victim = seats.find((s) => s.index === capture.seat);
    if (!victim) continue;
    const reset = replaceToken(victim, {
      index: capture.token,
      position: { kind: 'yard' },
    });
    seats = seats.map((s) => (s.index === reset.index ? reset : s));
  }

  // 3. Consume exactly one die of the played value.
  const pending = [...state.pendingDice];
  pending.splice(pending.indexOf(move.die), 1);

  // 4. Mark newly finished seats and record their rank.
  const rankings = [...state.rankings];
  seats = seats.map((seat) => {
    if (seat.finished || seat.playerId === null) return seat;
    if (!seatHasFinished(seat)) return seat;
    rankings.push(seat.index);
    return { ...seat, finished: true };
  });

  let next: MatchState = {
    ...state,
    seats,
    pendingDice: pending,
    rankings,
    version: state.version + 1,
  };

  // 5. The match ends when only one unfinished player is left standing.
  const stillPlaying = next.seats.filter((s) => s.playerId !== null && !s.finished);
  if (stillPlaying.length <= 1) {
    const winner = rankings[0] ?? null;
    return {
      ...next,
      phase: 'complete',
      pendingDice: [],
      consecutiveSixes: 0,
      winnerSeat: winner,
      version: next.version + 1,
    };
  }

  // 6. An extra roll is earned by a six, a capture, or reaching the centre.
  const earnsExtraRoll = move.die === 6 || move.captures.length > 0 || move.finishes;

  if (pending.length > 0) {
    // Still holding dice; the same seat must play them out.
    return next;
  }

  if (earnsExtraRoll && !requireSeat(next, move.seat).finished) {
    // Keep the turn. consecutiveSixes carries so the three-six rule holds.
    return { ...next, consecutiveSixes: move.die === 6 ? next.consecutiveSixes : 0 };
  }

  return {
    ...next,
    consecutiveSixes: 0,
    turnSeat: nextSeat(next, move.seat),
    version: next.version + 1,
  };
}

/**
 * Drop a player out of the match — used when someone leaves permanently.
 * Their tokens come off the board and the turn moves on if it was theirs.
 */
export function applyForfeit(state: MatchState, seat: SeatIndex): MatchState {
  if (state.phase === 'complete') return state;
  const target = requireSeat(state, seat);
  if (target.playerId === null) return state;

  const vacated: Seat = {
    ...target,
    playerId: null,
    tokens: makeTokens(),
    finished: false,
  };
  let seats = replaceSeat(state, vacated);

  let next: MatchState = { ...state, seats, version: state.version + 1 };

  const remaining = next.seats.filter((s) => s.playerId !== null && !s.finished);
  if (remaining.length <= 1) {
    const survivor = remaining[0];
    const winner = next.rankings[0] ?? survivor?.index ?? null;
    return {
      ...next,
      phase: 'complete',
      pendingDice: [],
      consecutiveSixes: 0,
      winnerSeat: winner,
      version: next.version + 1,
    };
  }

  if (next.turnSeat === seat) {
    return {
      ...next,
      pendingDice: [],
      consecutiveSixes: 0,
      turnSeat: nextSeat(next, seat),
      version: next.version + 1,
    };
  }

  return next;
}
