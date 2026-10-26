/**
 * Admin read-only reporting.
 *
 * Answers "who played, on what, how did it go, and did they finish" from
 * data the server already records. No schema change was needed: memberships
 * carry joinedAt/leftAt and seats, matches carry the winner and endedAt,
 * and players carry a display name and a device key.
 *
 * ---------------------------------------------------------------------------
 * PRIVACY
 * ---------------------------------------------------------------------------
 *
 * This is the only surface in the system that exposes one player's activity
 * to somebody else, so it is deliberately narrow:
 *
 *   * READ ONLY. There is no admin write path. Nothing here can change a
 *     match, refund a payment, or alter an approval -- those stay manual
 *     and audited.
 *   * Device keys are HASHED, never returned raw. A device key is a stable
 *     identifier that can follow a person across rooms; the dashboard needs
 *     to tell devices apart, which a short hash does, and does not need to
 *     be able to identify or impersonate one, which the raw key would allow.
 *   * No payment identifiers, no tokens, no IP addresses.
 *   * Display names are user-supplied text. They are rendered as text by
 *     the dashboard and never as markup.
 *
 * Access needs ADMIN_TOKEN set in the environment. If it is unset, every
 * route here returns 404 and the dashboard does not exist -- failing closed
 * matters more than a helpful error, because the failure mode is exposing
 * player activity to the internet.
 */

import type { PrismaClient } from '@prisma/client';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';

import { config } from '../config.js';
import { wrap } from './wrap.js';

/**
 * A short, stable, non-reversible label for a device.
 *
 * Salted with SESSION_SECRET so the same device produces the same label
 * within one deployment and a different one elsewhere -- the hash cannot be
 * correlated across environments or reversed with a rainbow table.
 */
function deviceLabel(deviceKey: string): string {
  return createHash('sha256')
    .update(`${config.sessionSecret}:${deviceKey}`)
    .digest('hex')
    .slice(0, 8);
}

/** Constant-time compare so the token cannot be guessed a byte at a time. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const expected = config.adminToken;

  // Not configured: the dashboard does not exist. 404 rather than 401, so
  // the absence of a token is not advertised.
  if (!expected) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    return;
  }

  const header = req.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const provided = bearer || (typeof req.query.token === 'string' ? req.query.token : '');

  if (!provided || !tokenMatches(provided, expected)) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Admin token required' } });
    return;
  }

  next();
}

export function adminRoutes(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireAdmin);

  /** Headline counts. */
  router.get(
    '/stats',
    wrap(async (_req: Request, res: Response) => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [players, rooms, matches, finished, active, newToday] = await Promise.all([
        prisma.player.count(),
        prisma.room.count(),
        prisma.match.count(),
        prisma.match.count({ where: { endedAt: { not: null } } }),
        prisma.room.count({ where: { status: 'in_play' } }),
        prisma.player.count({ where: { createdAt: { gte: since } } }),
      ]);

      res.json({
        players,
        newPlayersToday: newToday,
        rooms,
        matches,
        matchesFinished: finished,
        // Matches that started and never reached an end state. This is the
        // "played half and left" number.
        matchesAbandoned: matches - finished,
        roomsInPlay: active,
      });
    }),
  );

  /** Recent players, most recently seen first. */
  router.get(
    '/players',
    wrap(async (req: Request, res: Response) => {
      const take = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));

      const players = await prisma.player.findMany({
        orderBy: { lastSeenAt: 'desc' },
        take,
        include: {
          memberships: {
            select: { id: true, leftAt: true, isHost: true, room: { select: { status: true } } },
          },
        },
      });

      res.json({
        players: players.map((p) => {
          const played = p.memberships.length;
          const hosted = p.memberships.filter((m) => m.isHost).length;
          // Left before the room reached a terminal state.
          const quit = p.memberships.filter(
            (m) => m.leftAt !== null && m.room.status !== 'complete',
          ).length;

          return {
            id: p.id,
            displayName: p.displayName,
            device: deviceLabel(p.deviceKey),
            firstSeen: p.createdAt,
            lastSeen: p.lastSeenAt,
            roomsJoined: played,
            roomsHosted: hosted,
            leftEarly: quit,
          };
        }),
      });
    }),
  );

  /** Recent matches with their participants and outcome. */
  router.get(
    '/matches',
    wrap(async (req: Request, res: Response) => {
      const take = Math.min(100, Math.max(1, Number(req.query.limit ?? 30) || 30));

      const matches = await prisma.match.findMany({
        orderBy: { startedAt: 'desc' },
        take,
        include: {
          room: {
            select: {
              id: true,
              status: true,
              funding: true,
              seatCount: true,
              memberships: {
                select: {
                  seat: true,
                  isHost: true,
                  isBot: true,
                  botLevel: true,
                  joinedAt: true,
                  leftAt: true,
                  player: { select: { id: true, displayName: true, deviceKey: true } },
                },
                orderBy: { seat: 'asc' },
              },
            },
          },
        },
      });

      res.json({
        matches: matches.map((m) => {
          const finished = m.endedAt !== null;
          const durationMs = finished ? m.endedAt!.getTime() - m.startedAt.getTime() : null;

          return {
            id: m.id,
            roomId: m.roomId,
            seatCount: m.seatCount,
            funding: m.room.funding,
            roomStatus: m.room.status,
            startedAt: m.startedAt,
            endedAt: m.endedAt,
            durationMs,
            // A match with no end state is one people walked away from.
            completed: finished,
            winnerSeat: m.winnerSeat,
            winnerPlayerId: m.winnerPlayerId,
            // Turns taken, as a rough measure of how far it actually got.
            moves: m.version,
            players: m.room.memberships.map((ms) => ({
              seat: ms.seat,
              name: ms.isBot ? `Computer (${ms.botLevel ?? 'normal'})` : ms.player.displayName,
              isBot: ms.isBot,
              isHost: ms.isHost,
              device: ms.isBot ? null : deviceLabel(ms.player.deviceKey),
              joinedAt: ms.joinedAt,
              leftAt: ms.leftAt,
              // Left while the match was still going.
              walkedOut: ms.leftAt !== null && !finished,
              won: m.winnerSeat === ms.seat,
            })),
          };
        }),
      });
    }),
  );

  return router;
}
