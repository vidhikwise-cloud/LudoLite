/**
 * Express application assembly.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ApiErrorBody } from '@ludolite/shared';
import type { PrismaClient } from '@prisma/client';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { ZodError } from 'zod';

import { config } from './config.js';
import { ApiError } from './errors.js';
import { logger } from './logger.js';
import { adminRoutes } from './routes/admin.js';
import { apiRouter } from './routes/api.js';
import { healthRouter } from './routes/health.js';
import { webhookRouter } from './routes/webhooks.js';

export function createApp(prisma: PrismaClient): express.Express {
  const app = express();

  // Render, Fly, and most PaaS front us with exactly one proxy. Setting this
  // to a number rather than `true` keeps req.ip trustworthy — `true` would
  // let a client spoof X-Forwarded-For and defeat the rate limiter.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // The client is a bundled SPA: its own scripts and styles only.
          // Vite emits a small inline style block, so 'unsafe-inline' is
          // needed for styles but deliberately NOT for scripts.
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          // Same-origin API and websockets.
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          manifestSrc: ["'self'"],
          workerSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: config.isProduction ? [] : null,
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
    }),
  );

  app.use(
    cors({
      /*
       * No configured origins means same-origin only, which is the shape of
       * the production deploy: one service serves both the app and the API.
       *
       * `false` here rejects cross-origin requests rather than reflecting
       * whatever Origin header arrives. Reflecting it with
       * `credentials: true` would let any site on the internet make
       * authenticated calls on a user's behalf.
       *
       * In development the Vite dev server is a genuinely different origin,
       * so CORS_ORIGINS lists it explicitly.
       */
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
      credentials: true,
      maxAge: 86_400,
    }),
  );

  // Request logging with a correlation id. The id is echoed back so a user
  // reporting a problem can quote it and we can find the exact request.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const existing = req.headers['x-request-id'];
        const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // Health checks every few seconds would otherwise drown the log.
      autoLogging: {
        ignore: (req) => req.url === '/health' || req.url === '/ready',
      },
      /*
       * Keep the admin slug out of the logs.
       *
       * pino-http records req.url, so without this every visit to the
       * dashboard would write the secret path into Render's log stream --
       * where it is readable by anyone with dashboard access and retained
       * long after the fact. The request is still logged; only the secret
       * part of the path is replaced.
       */
      customAttributeKeys: { req: 'req' },
      serializers: {
        req: (req: { url?: string; method?: string; id?: unknown }) => ({
          id: req.id,
          method: req.method,
          url:
            typeof req.url === 'string' && req.url.startsWith(`/admin/${config.adminSlug}`)
              ? '/admin/[redacted]'
              : req.url,
        }),
      },
    }),
  );

  // Health probes come before the body parsers and rate limiters so a
  // struggling server can still report its own state.
  app.use(healthRouter(prisma));

  // Webhooks are mounted BEFORE the JSON parser and take the raw body, since
  // signature verification must run over the exact bytes the provider signed.
  app.use(
    '/api/webhooks',
    express.raw({ type: '*/*', limit: '256kb' }),
    webhookRouter(prisma),
  );

  app.use(express.json({ limit: '64kb' }));

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      const body: ApiErrorBody = {
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
      };
      res.status(429).json(body);
    },
  });

  // Room creation is the expensive path; keep it tighter than the general cap.
  const createLimiter = rateLimit({
    windowMs: 60_000,
    limit: 12,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      const body: ApiErrorBody = {
        error: {
          code: 'RATE_LIMITED',
          message: 'You are creating rooms very quickly. Please wait a moment.',
        },
      };
      res.status(429).json(body);
    },
  });

  // Joining is guessable by brute force (a 4-character code), so cap attempts
  // harder than ordinary reads.
  const joinLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      const body: ApiErrorBody = {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many join attempts. Please wait a moment and try again.',
        },
      };
      res.status(429).json(body);
    },
  });

  app.use('/api', limiter);
  app.use('/api/rooms', (req, res, next) =>
    req.method === 'POST' && req.path === '/' ? createLimiter(req, res, next) : next(),
  );
  app.use('/api/rooms/join', joinLimiter);

  app.use('/api', apiRouter(prisma));

  /*
   * Admin reporting. Read-only, and 404s entirely unless ADMIN_TOKEN is
   * set -- see routes/admin.ts. Rate limited with the rest of /api above.
   */
  app.use('/api/admin', adminRoutes(prisma));

  /*
   * The admin dashboard page.
   *
   * Mounted BEFORE the SPA fallback below, which would otherwise answer
   * /admin with the game's index.html. The page itself is public and holds
   * no data -- it is a login box until a token is entered, and every call
   * it makes is authenticated by routes/admin.ts. Served only when
   * ADMIN_TOKEN is configured, so an unconfigured deploy has no admin
   * surface at all.
   *
   * noindex because an internal tool has no business in a search index.
   */
  if (config.adminToken) {
    // One level up from dist/, not two: this file runs as
    // apps/server/dist/app.js, so ../public is apps/server/public.
    const adminPage = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../public/admin.html',
    );
    if (existsSync(adminPage)) {
      const send = (_req: Request, res: Response): void => {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        res.setHeader('Cache-Control', 'no-store');
        // The page must not leak its own URL to anywhere it links or
        // fetches. Without this the slug travels in the Referer header.
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.sendFile(adminPage);
      };

      // The real entry point: /admin/<slug>.
      app.get(`/admin/${config.adminSlug}`, send);

      /*
       * The page's script, served from its own path.
       *
       * It cannot be inline: the app sends script-src 'self' with no
       * 'unsafe-inline', so an inline block is refused by the browser and
       * the page renders with no behaviour at all. Weakening the policy
       * for one internal page would weaken it for the whole game.
       *
       * Served from a path NOT under /admin/<slug>, because the slug is
       * meant to stay out of logs and a script URL is logged like any
       * other. The file holds no secrets -- it is the same fetch-and-
       * render code whoever asks for it -- so a public path costs nothing.
       */
      const adminScript = resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../public/admin.js',
      );
      app.get('/admin-assets/admin.js', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(adminScript);
      });

      /*
       * Bare /admin 404s rather than serving the login box.
       *
       * The slug's only job is to keep crawlers and idle visitors from
       * finding the page at a guessable address; answering /admin would
       * defeat that entirely. It is not access control -- the password
       * below is -- so this costs nothing and removes the obvious guess.
       */
      app.get('/admin', (_req: Request, res: Response) => {
        res.status(404).json({ error: { code: 'ROOM_NOT_FOUND', message: 'Not found.' } });
      });

      // Logged without the slug: this line goes to Render's log stream,
      // which is exactly where a secret path should not be written.
      logger.info('admin dashboard enabled');
    }
  }

  /*
   * Serve the built web client from this same service when it is present.
   *
   * One origin for the app and the API means no CORS, no proxy, and no
   * cross-service hostname to configure — which is one fewer thing that can
   * be wrong in production. In development the client runs under Vite
   * instead and this directory does not exist, so the block is skipped.
   */
  const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');

  if (existsSync(join(webDist, 'index.html'))) {
    app.use(
      express.static(webDist, {
        // Hashed asset filenames can be cached hard; index.html and the
        // service worker must not be, or users get stuck on an old build.
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          } else if (filePath.includes('/assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );

    /*
     * SPA fallback for client-side routes. Mounted after the API so it can
     * never swallow an API path, and GET-only so a mistyped POST still
     * 404s rather than silently returning the app shell.
     *
     * `/admin` is excluded as well as `/api`. Without that exclusion a
     * WRONG slug fell through to here and was answered with the game's
     * index.html -- HTTP 200 -- which tells someone probing for the
     * dashboard that /admin/<something> is a live namespace. A 404 tells
     * them nothing.
     */
    app.get(/^(?!\/(api|admin|admin-assets)(\/|$)).*/, (_req: Request, res: Response) => {
      res.sendFile(join(webDist, 'index.html'));
    });

    logger.info({ webDist }, 'serving web client');
  }

  app.use((_req: Request, res: Response) => {
    const body: ApiErrorBody = {
      error: { code: 'ROOM_NOT_FOUND', message: 'Not found.' },
    };
    res.status(404).json(body);
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      const body: ApiErrorBody = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.detail ? { detail: error.detail } : {}),
        },
      };
      return res.status(error.status).json(body);
    }

    if (error instanceof ZodError) {
      const body: ApiErrorBody = {
        error: {
          code: 'INVALID_REQUEST',
          message: 'That request was not valid.',
          detail: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
      };
      return res.status(400).json(body);
    }

    // Unexpected. Log it with the request id, and tell the user that id so a
    // support conversation can start from something concrete.
    req.log?.error({ err: error }, 'unhandled error');
    const body: ApiErrorBody = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side. Please try again.',
        ...(req.id ? { detail: `Reference: ${req.id}` } : {}),
      },
    };
    res.status(500).json(body);
  });

  return app;
}
