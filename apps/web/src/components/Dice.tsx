/**
 * The die.
 *
 * Shows pips, not a digit. Tumbles through random faces while "rolling", then
 * settles on the value the server chose — the suspense is the point, and a
 * number that simply appears has none.
 *
 * The server decides the value before the animation starts; this only hides
 * it for a beat. Nothing here can change the outcome.
 */

import { useEffect, useRef, useState } from 'react';

/** Pip layout per face, on a 3x3 grid indexed 0-8. */
const PIPS: Record<number, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export const ROLL_MS = 560;

export function Dice({
  value,
  rolling,
  disabled,
  onRoll,
}: {
  value: number | null;
  rolling: boolean;
  disabled: boolean;
  onRoll: () => void;
}) {
  // Face shown while tumbling; replaced by `value` once settled.
  const [face, setFace] = useState(value ?? 6);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!rolling) {
      if (value !== null) setFace(value);
      return;
    }

    // Cycle faces quickly, never repeating the same one twice in a row so the
    // tumble reads as motion rather than a flicker.
    const tick = () => {
      setFace((current) => {
        let next = current;
        while (next === current) next = 1 + Math.floor(Math.random() * 6);
        return next;
      });
    };

    const id = window.setInterval(tick, 70);
    timer.current = id;
    return () => window.clearInterval(id);
  }, [rolling, value]);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, []);

  const pips = PIPS[face] ?? PIPS[6]!;

  return (
    <button
      type="button"
      className={`dice${rolling ? ' rolling' : ''}${disabled ? ' idle' : ''}`}
      onClick={onRoll}
      disabled={disabled || rolling}
      aria-label={
        rolling ? 'Rolling the dice' : value ? `Dice shows ${value}` : 'Roll the dice'
      }
    >
      <span className="dice-face" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} className={pips.includes(i) ? 'pip on' : 'pip'} />
        ))}
      </span>
    </button>
  );
}
