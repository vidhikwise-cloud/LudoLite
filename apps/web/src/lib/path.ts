/**
 * Move paths.
 *
 * A token moving 5 squares should visibly travel five squares, pausing on
 * each. Teleporting from start to end is the single biggest reason a digital
 * Ludo board feels dead — you lose the tension of watching a token creep
 * toward a capture.
 *
 * This expands a (from, to) pair into every square in between, matching the
 * engine's own route so the animation can never disagree with the rules.
 */

import {
  HOME_RUN_LENGTH,
  TRACK_STEPS_BEFORE_HOME,
  progressFromSquare,
  squareFromProgress,
  type SeatIndex,
  type TokenPosition,
} from '@ludolite/engine';

/** Milliseconds per square. Slow enough to follow, fast enough not to drag. */
export const HOP_MS = 155;

/** Extra beat when a token lands, so the arrival reads as an arrival. */
export const LAND_MS = 110;

/**
 * Every position a token occupies between `from` and `to`, inclusive of the
 * destination and exclusive of the origin.
 *
 * Leaving the yard is a single hop onto the entry square — a token does not
 * crawl out of its home base.
 */
export function expandPath(
  seat: SeatIndex,
  from: TokenPosition,
  to: TokenPosition,
): TokenPosition[] {
  // Yard -> board, or anything landing on the centre from the yard: one hop.
  if (from.kind === 'yard') return [to];
  if (from.kind === 'finish') return [];

  const steps: TokenPosition[] = [];

  // Where the token starts, measured along this seat's own route.
  const startProgress =
    from.kind === 'track'
      ? progressFromSquare(seat, from.square)
      : TRACK_STEPS_BEFORE_HOME + 1 + from.step;

  const endProgress =
    to.kind === 'track'
      ? progressFromSquare(seat, to.square)
      : to.kind === 'home'
        ? TRACK_STEPS_BEFORE_HOME + 1 + to.step
        : TRACK_STEPS_BEFORE_HOME + 1 + HOME_RUN_LENGTH; // finish

  for (let p = startProgress + 1; p <= endProgress; p++) {
    if (p <= TRACK_STEPS_BEFORE_HOME) {
      steps.push({ kind: 'track', square: squareFromProgress(seat, p) });
      continue;
    }

    const homeStep = p - TRACK_STEPS_BEFORE_HOME - 1;
    if (homeStep < HOME_RUN_LENGTH) {
      steps.push({ kind: 'home', step: homeStep });
    } else {
      steps.push({ kind: 'finish' });
    }
  }

  // Defensive: if anything above disagreed with the engine, still land on the
  // square the server said. The server is always right.
  if (steps.length === 0) steps.push(to);

  return steps;
}

/** Total time a move will take to animate. */
export function pathDuration(steps: number): number {
  return Math.max(1, steps) * HOP_MS + LAND_MS;
}
