/**
 * Room invite codes.
 *
 * Four characters from a 31-character alphabet with the look-alikes removed
 * (no 0/O, 1/I/L), because these codes get read aloud and typed by hand.
 * That is ~923k combinations, generated from the CSPRNG and retried on
 * collision against live rooms only.
 */

import { randomInt } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 4;

export function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/**
 * Normalises user input.
 *
 * Trims, uppercases, strips separators, and folds the characters the alphabet
 * deliberately excludes onto their look-alikes — someone who hears "oh" and
 * types O should still reach a room whose code contains 0... except the
 * alphabet has neither, so O/0 and I/1/L are all folded to the nearest glyph
 * that IS in the alphabet. Single pass, so no rule can undo another.
 */
const LOOKALIKE: Record<string, string> = {
  O: 'Q', // O is not in the alphabet; Q is the closest glyph that is
  '0': 'Q',
  I: 'J', // I and L are not in the alphabet; J is the closest that is
  L: 'J',
  '1': 'J',
};

export function normaliseCode(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
  let out = '';
  for (const char of cleaned) {
    out += LOOKALIKE[char] ?? char;
  }
  return out;
}

/**
 * A code is only reserved while its room can still be joined or played.
 * Finished and cancelled rooms release theirs back into circulation.
 */
export async function allocateCode(prisma: PrismaClient, attempts = 12): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const code = generateCode();
    const clash = await prisma.room.findFirst({
      where: {
        code,
        status: { in: ['pending_payment', 'active', 'in_play'] },
      },
      select: { id: true },
    });
    if (!clash) {
      // Free the code from any old finished room still holding it, since the
      // column is globally unique.
      await prisma.room.updateMany({
        where: { code, status: { in: ['complete', 'cancelled'] } },
        data: { code: `${code}-retired-${Date.now()}` },
      });
      return code;
    }
  }
  throw new Error('Could not allocate a unique room code');
}
