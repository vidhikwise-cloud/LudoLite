/**
 * Core Ludo types.
 *
 * The engine is pure: no clocks, no randomness, no I/O. Every state
 * transition is a function of (state, move). Dice values are supplied by the
 * caller, which lets the server be the sole source of randomness while the
 * client runs the identical code to predict and validate what it is shown.
 */

export const SEAT_COLORS = ['red', 'green', 'yellow', 'blue'] as const;
export type SeatColor = (typeof SEAT_COLORS)[number];

/** Seat index around the board, 0..3, in play order. */
export type SeatIndex = 0 | 1 | 2 | 3;

/** Token index within a seat, 0..3. */
export type TokenIndex = 0 | 1 | 2 | 3;

/**
 * Where a token physically is.
 *
 * - `yard`   — not yet entered; needs a 6 to come out.
 * - `track`  — on the 52-square shared loop. `square` is an absolute index
 *              0..51 so collisions between seats are a plain equality check.
 * - `home`   — on this seat's private 5-square run-in. `step` is 0..4.
 * - `finish` — reached the centre. Terminal; never moves again.
 */
export type TokenPosition =
  | { kind: 'yard' }
  | { kind: 'track'; square: number }
  | { kind: 'home'; step: number }
  | { kind: 'finish' };

export interface Token {
  readonly index: TokenIndex;
  readonly position: TokenPosition;
}

export interface Seat {
  readonly index: SeatIndex;
  readonly color: SeatColor;
  /** Stable player id occupying this seat, or null if the seat is open. */
  readonly playerId: string | null;
  readonly tokens: readonly Token[];
  /** True once all four tokens reached the centre. */
  readonly finished: boolean;
}

export type MatchPhase = 'awaiting-players' | 'in-play' | 'complete';

export interface MatchState {
  readonly matchId: string;
  readonly seatCount: 2 | 4;
  readonly seats: readonly Seat[];
  readonly phase: MatchPhase;
  /** Whose turn it is. Meaningless unless phase is 'in-play'. */
  readonly turnSeat: SeatIndex;
  /**
   * Dice already rolled this turn and not yet consumed by a move.
   * A 6 grants another roll, so this can hold more than one value.
   */
  readonly pendingDice: readonly number[];
  /** Consecutive sixes this turn; three in a row forfeits the turn. */
  readonly consecutiveSixes: number;
  /** Seat order of players who have finished, first to last. */
  readonly rankings: readonly SeatIndex[];
  readonly winnerSeat: SeatIndex | null;
  /** Monotonic counter; every applied action increments it exactly once. */
  readonly version: number;
}

/** A legal move the current seat may play with a specific die value. */
export interface LegalMove {
  readonly seat: SeatIndex;
  readonly token: TokenIndex;
  readonly die: number;
  readonly from: TokenPosition;
  readonly to: TokenPosition;
  /** Seat/token pairs sent back to the yard by this move. */
  readonly captures: readonly { seat: SeatIndex; token: TokenIndex }[];
  /** True when the move lands a token on the centre. */
  readonly finishes: boolean;
}

export type EngineError =
  | 'NOT_IN_PLAY'
  | 'NOT_YOUR_TURN'
  | 'NO_PENDING_DICE'
  | 'DICE_ALREADY_PENDING'
  | 'ILLEGAL_MOVE'
  | 'INVALID_DIE'
  | 'SEAT_NOT_OCCUPIED';

export class LudoRuleError extends Error {
  readonly code: EngineError;
  constructor(code: EngineError, message?: string) {
    super(message ?? code);
    this.name = 'LudoRuleError';
    this.code = code;
  }
}
