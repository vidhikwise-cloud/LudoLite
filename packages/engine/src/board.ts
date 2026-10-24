/**
 * Board geometry.
 *
 * The shared loop is 52 squares, indexed 0..51 clockwise. Each seat enters at
 * its own start square and leaves the loop after travelling 51 squares, at
 * which point it turns into its private 5-square home run.
 *
 * Keeping track squares absolute (rather than relative to each seat) means a
 * capture check is `a.square === b.square` with no coordinate conversion, which
 * is the single most common comparison in the engine.
 */

import type { SeatColor, SeatIndex } from './types.js';

export const TRACK_LENGTH = 52;
export const HOME_RUN_LENGTH = 5;
export const TOKENS_PER_SEAT = 4;

/** Squares a token travels on the shared loop before entering the home run. */
export const TRACK_STEPS_BEFORE_HOME = 51;

/** Entry square on the shared loop for each seat, by seat index. */
export const SEAT_START_SQUARE: Readonly<Record<SeatIndex, number>> = {
  0: 0,
  1: 13,
  2: 26,
  3: 39,
};

export const SEAT_COLOR_BY_INDEX: Readonly<Record<SeatIndex, SeatColor>> = {
  0: 'red',
  1: 'green',
  2: 'yellow',
  3: 'blue',
};

/**
 * Safe squares, where tokens cannot be captured.
 *
 * These are the four seat entry squares plus the four star squares eight
 * steps along from each entry — the standard Indian Ludo layout.
 */
export const SAFE_SQUARES: ReadonlySet<number> = new Set([
  0, 8, 13, 21, 26, 34, 39, 47,
]);

/**
 * In a 2-player match the seats sit opposite each other rather than adjacent,
 * so neither player starts with a positional advantage.
 */
export const TWO_PLAYER_SEATS: readonly SeatIndex[] = [0, 2];
export const FOUR_PLAYER_SEATS: readonly SeatIndex[] = [0, 1, 2, 3];

export function seatsForCount(seatCount: 2 | 4): readonly SeatIndex[] {
  return seatCount === 2 ? TWO_PLAYER_SEATS : FOUR_PLAYER_SEATS;
}

export function isSafeSquare(square: number): boolean {
  return SAFE_SQUARES.has(square);
}

/**
 * How many steps along its own route this seat has travelled, given an
 * absolute track square. Returns 0..51.
 */
export function progressFromSquare(seat: SeatIndex, square: number): number {
  const start = SEAT_START_SQUARE[seat];
  return (square - start + TRACK_LENGTH) % TRACK_LENGTH;
}

/** Absolute track square for a seat at a given progress along its route. */
export function squareFromProgress(seat: SeatIndex, progress: number): number {
  const start = SEAT_START_SQUARE[seat];
  return (start + progress) % TRACK_LENGTH;
}
