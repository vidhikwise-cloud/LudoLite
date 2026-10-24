/**
 * Move-path expansion.
 *
 * The animation walks a token through these positions. If the path disagrees
 * with the engine's route, a token visibly travels the wrong way round the
 * board — so these assertions check the path against the engine's own
 * destination calculation rather than against hand-written expectations.
 */

import {
  TRACK_STEPS_BEFORE_HOME,
  destinationFor,
  squareFromProgress,
  type SeatIndex,
  type TokenPosition,
} from '@ludolite/engine';
import { describe, expect, it } from 'vitest';

import { expandPath, pathDuration, HOP_MS } from '../src/lib/path.js';

const SEATS: SeatIndex[] = [0, 1, 2, 3];

describe('expandPath', () => {
  it('leaving the yard is a single hop', () => {
    for (const seat of SEATS) {
      const to = destinationFor(seat, { kind: 'yard' }, 6)!;
      const path = expandPath(seat, { kind: 'yard' }, to);

      expect(path).toHaveLength(1);
      expect(path[0]).toEqual(to);
    }
  });

  it('produces one step per pip, for every seat and die', () => {
    for (const seat of SEATS) {
      for (let die = 1; die <= 6; die++) {
        const from: TokenPosition = { kind: 'track', square: squareFromProgress(seat, 3) };
        const to = destinationFor(seat, from, die);
        if (!to) continue;

        const path = expandPath(seat, from, to);
        expect(path, `seat ${seat} die ${die}`).toHaveLength(die);
      }
    }
  });

  it('ends exactly where the engine says it should', () => {
    for (const seat of SEATS) {
      for (let progress = 0; progress <= TRACK_STEPS_BEFORE_HOME; progress += 7) {
        for (let die = 1; die <= 6; die++) {
          const from: TokenPosition = {
            kind: 'track',
            square: squareFromProgress(seat, progress),
          };
          const to = destinationFor(seat, from, die);
          if (!to) continue;

          const path = expandPath(seat, from, to);
          expect(path[path.length - 1], `seat ${seat} p${progress} d${die}`).toEqual(to);
        }
      }
    }
  });

  it('crosses from the track into the home run without a gap', () => {
    const seat: SeatIndex = 0;
    // One square short of the home turn, rolling a 3: track, then home 0, 1.
    const from: TokenPosition = {
      kind: 'track',
      square: squareFromProgress(seat, TRACK_STEPS_BEFORE_HOME - 1),
    };
    const to = destinationFor(seat, from, 3)!;
    const path = expandPath(seat, from, to);

    expect(path).toHaveLength(3);
    expect(path[0]).toEqual({ kind: 'track', square: squareFromProgress(seat, 51) });
    expect(path[1]).toEqual({ kind: 'home', step: 0 });
    expect(path[2]).toEqual({ kind: 'home', step: 1 });
  });

  it('walks the home run to the centre', () => {
    const from: TokenPosition = { kind: 'home', step: 2 };
    const to = destinationFor(0, from, 3)!;
    const path = expandPath(0, from, to);

    expect(path).toHaveLength(3);
    expect(path[2]).toEqual({ kind: 'finish' });
  });

  it('never moves a finished token', () => {
    expect(expandPath(0, { kind: 'finish' }, { kind: 'finish' })).toEqual([]);
  });

  it('always returns at least one step for a real move', () => {
    // Defensive path: even if the geometry disagreed, the token must still
    // land where the server said.
    const to: TokenPosition = { kind: 'track', square: 10 };
    const path = expandPath(0, { kind: 'track', square: 10 }, to);
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual(to);
  });
});

describe('pathDuration', () => {
  it('scales with the number of hops', () => {
    expect(pathDuration(6)).toBeGreaterThan(pathDuration(1));
  });

  it('keeps a six-square move snappy enough to sit through', () => {
    // Longer than this and players start tapping before the move resolves.
    expect(pathDuration(6)).toBeLessThan(1200);
  });

  it('gives each hop a visible beat', () => {
    expect(HOP_MS).toBeGreaterThanOrEqual(100);
    expect(HOP_MS).toBeLessThanOrEqual(220);
  });
});
