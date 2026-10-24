/**
 * Player sessions.
 *
 * There are no accounts or passwords — a player is a device that has been
 * given a signed token. The token names the player id and is HMAC-signed, so
 * the server can trust "who" on reconnect without a login, and a client
 * cannot promote itself to another player or to host.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import { config } from './config.js';
import { ApiError } from './errors.js';

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

interface TokenPayload {
  readonly playerId: string;
  readonly issuedAt: number;
}

function sign(data: string): string {
  return createHmac('sha256', config.sessionSecret).update(data).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function issuePlayerToken(playerId: string): string {
  const payload: TokenPayload = { playerId, issuedAt: Date.now() };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyPlayerToken(token: string): string {
  const [body, signature] = token.split('.');
  if (!body || !signature) throw new ApiError('UNAUTHORIZED', 'Malformed session token');
  if (!safeEqual(sign(body), signature)) {
    throw new ApiError('UNAUTHORIZED', 'Invalid session token');
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new ApiError('UNAUTHORIZED', 'Malformed session token');
  }

  if (!payload.playerId || typeof payload.issuedAt !== 'number') {
    throw new ApiError('UNAUTHORIZED', 'Malformed session token');
  }
  if (Date.now() - payload.issuedAt > TOKEN_TTL_MS) {
    throw new ApiError('UNAUTHORIZED', 'Session expired, please rejoin');
  }

  return payload.playerId;
}

/**
 * Find or create the player for a device.
 *
 * The device key is how a returning host is recognised as the same person who
 * already paid for a room, which is what keeps reconnection free.
 */
export async function upsertPlayer(
  prisma: PrismaClient,
  opts: { deviceKey?: string; displayName: string },
): Promise<{ id: string; displayName: string; deviceKey: string }> {
  const deviceKey = opts.deviceKey?.trim() || randomUUID();
  const displayName = opts.displayName.trim().slice(0, 24) || 'Player';

  const player = await prisma.player.upsert({
    where: { deviceKey },
    create: { deviceKey, displayName },
    update: { displayName, lastSeenAt: new Date() },
  });

  return { id: player.id, displayName: player.displayName, deviceKey: player.deviceKey };
}
