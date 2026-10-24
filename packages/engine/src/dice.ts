/**
 * Dice.
 *
 * Deliberately separate from the engine so it is obvious where randomness
 * enters the system. The server uses `cryptoDice`; tests use `scriptedDice`
 * to make matches reproducible. Clients never roll — they display the value
 * the server sends.
 */

export interface DiceSource {
  roll(): number;
}

/**
 * Uniform 1..6 from the platform CSPRNG.
 *
 * Rejection sampling rather than a modulo of 256: 256 is not divisible by 6,
 * so a plain modulo would make 1..4 very slightly likelier than 5..6. The
 * bias is tiny but there is no reason to accept it in a game people pay for.
 */
export function cryptoDice(getRandomBytes: (n: number) => Uint8Array): DiceSource {
  return {
    roll(): number {
      // 252 is the largest multiple of 6 below 256.
      const limit = 252;
      for (;;) {
        const byte = getRandomBytes(1)[0];
        if (byte === undefined) continue;
        if (byte < limit) return (byte % 6) + 1;
      }
    },
  };
}

/** Replays a fixed sequence, looping. For tests and replays only. */
export function scriptedDice(sequence: readonly number[]): DiceSource {
  if (sequence.length === 0) throw new Error('scriptedDice requires at least one value');
  let i = 0;
  return {
    roll(): number {
      const value = sequence[i % sequence.length];
      i += 1;
      return value ?? 1;
    },
  };
}
