/**
 * Health probes.
 *
 * Two endpoints, because they answer different questions:
 *
 *   /health  — liveness. Is the process running? No dependency checks, so a
 *              database blip does not cause the orchestrator to kill a server
 *              that is otherwise fine and holding live match connections.
 *
 *   /ready   — readiness. Can this instance actually serve traffic? Checks
 *              the database. A load balancer uses this to decide whether to
 *              route to us.
 *
 * Neither leaks internal detail: a failing readiness probe says "not ready",
 * not which query failed or what the connection string looks like.
 */

import type { PrismaClient } from '@prisma/client';
import { Router, type Request, type Response } from 'express';

import { config } from '../config.js';
import { log } from '../logger.js';

const logger = log('health');

/** Flipped by main.ts when shutdown begins, so we stop accepting new traffic. */
let shuttingDown = false;

export function beginShutdown(): void {
  shuttingDown = true;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function healthRouter(prisma: PrismaClient): Router {
  const router = Router();
  const startedAt = Date.now();

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      status: shuttingDown ? 'draining' : 'ok',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      version: process.env.APP_VERSION ?? 'dev',
      // Surfaced so an operator can confirm the shipping state at a glance.
      paidHostingFlag: config.paidRoomHostingFlag,
    });
  });

  router.get('/ready', (_req: Request, res: Response) => {
    // During shutdown, report not-ready immediately so the load balancer
    // drains us before connections are closed.
    if (shuttingDown) {
      return res.status(503).json({ ready: false, reason: 'draining' });
    }

    prisma
      .$queryRaw`SELECT 1`
      .then(() => res.json({ ready: true }))
      .catch((error: unknown) => {
        logger.error({ err: error }, 'readiness probe failed');
        res.status(503).json({ ready: false, reason: 'database unavailable' });
      });
  });

  return router;
}
