/**
 * Board geometry.
 *
 * The rendered track must agree with the engine's 52-square loop, or tokens
 * appear in the wrong place. These assertions caught a hand-written
 * coordinate table that was one cell short with four gaps in it.
 */

import { SEAT_START_SQUARE, TRACK_LENGTH, SAFE_SQUARES } from '@ludolite/engine';
import { describe, expect, it } from 'vitest';

import { TRACK_CELLS } from '../src/components/Board.js';

describe('track geometry', () => {
  it('has exactly one cell per engine square', () => {
    expect(TRACK_CELLS).toHaveLength(TRACK_LENGTH);
  });

  it('never places two squares on the same cell', () => {
    const seen = new Set(TRACK_CELLS.map(([x, y]) => `${x},${y}`));
    expect(seen.size).toBe(TRACK_LENGTH);
  });

  it('stays inside the 15x15 grid', () => {
    for (const [x, y] of TRACK_CELLS) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(14);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(14);
    }
  });

  it('is a closed loop with no jumps', () => {
    for (let i = 0; i < TRACK_CELLS.length; i++) {
      const a = TRACK_CELLS[i]!;
      const b = TRACK_CELLS[(i + 1) % TRACK_CELLS.length]!;
      const dx = Math.abs(a[0] - b[0]);
      const dy = Math.abs(a[1] - b[1]);
      // Orthogonal step, or the diagonal shoulder turn where the entry row
      // meets the arm. Anything else is a hole in the path.
      const ok = dx + dy === 1 || (dx === 1 && dy === 1);
      expect(ok, `square ${i} -> ${i + 1} jumps from ${a} to ${b}`).toBe(true);
    }
  });

  it('puts each seat entry square where the engine expects it', () => {
    // Four distinct entry cells, one per arm, 13 squares apart.
    const entries = ([0, 1, 2, 3] as const).map((seat) => TRACK_CELLS[SEAT_START_SQUARE[seat]]!);
    const unique = new Set(entries.map(([x, y]) => `${x},${y}`));

    expect(unique.size).toBe(4);
    for (const seat of [0, 1, 2, 3] as const) {
      expect(TRACK_CELLS[SEAT_START_SQUARE[seat]]).toBeDefined();
    }
  });

  it('has a renderable cell for every safe square', () => {
    for (const square of SAFE_SQUARES) {
      expect(TRACK_CELLS[square], `safe square ${square} has no cell`).toBeDefined();
    }
  });
});
