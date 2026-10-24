/**
 * Server entrypoint.
 */

import { createServer } from 'node:http';

import { PrismaClient } from '@prisma/client';

import { createApp } from './app.js';
import { assertProductionSafety, config } from './config.js';
import { scheduleCleanup } from './jobs/cleanup.js';
import { logger } from './logger.js';
import { resolvePaidHostingGate } from './payments/gate.js';
import { attachRealtime } from './realtime.js';
import { beginShutdown } from './routes/health.js';

/** How long to let in-flight requests and matches finish before forcing exit. */
const DRAIN_TIMEOUT_MS = 20_000;

async function main(): Promise<void> {
  assertProductionSafety();

  const prisma = new PrismaClient({
    log: config.isProduction
      ? [{ emit: 'event', level: 'error' }]
      : [{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }],
  });

  prisma.$on('error' as never, (event: unknown) => {
    logger.error({ prisma: event }, 'prisma error');
  });

  await prisma.$connect();
  logger.info('database connected');

  const app = createApp(prisma);
  const httpServer = createServer(app);
  const io = attachRealtime(httpServer, prisma);
  const stopCleanup = scheduleCleanup(prisma);

  // Report the gate state at boot so the operating mode is never a mystery.
  const gate = await resolvePaidHostingGate(prisma);
  logger.info(
    {
      paidHosting: gate.allowed ? 'ENABLED' : 'DISABLED',
      provider: gate.providerName,
      testMode: gate.testMode,
      blockers: gate.blockers,
    },
    gate.allowed
      ? 'paid hosting is ENABLED'
      : 'paid hosting is DISABLED — free private matches only',
  );

  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.fatal(
        { port: config.port },
        'port already in use — another copy of the server is probably running',
      );
      process.exit(1);
    }
    throw error;
  });

  httpServer.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv },
      'Ludo With Friends — server listening',
    );

    if (!config.isProduction) {
      // Readable summary for a developer watching the terminal.
      console.log(`\n  http://localhost:${config.port}`);
      console.log(
        `  PAID HOSTING: ${gate.allowed ? 'ENABLED' : 'DISABLED'}`,
      );
      if (!gate.allowed) {
        for (const blocker of gate.blockers) console.log(`    - ${blocker}`);
      }
      console.log('');
    }
  });

  // Stray rejection backstop. Route handlers are wrapped and socket handlers
  // catch their own errors, so nothing should reach here — but a server with
  // players mid-match should log loudly rather than vanish.
  //
  // Deliberately NOT catching `uncaughtException`: a synchronous throw that
  // escapes to the top means a genuinely broken process, and serving requests
  // from one is worse than restarting.
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled rejection — staying up');
  });

  // --- graceful shutdown ----------------------------------------------------
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'shutdown started — draining');

    // 1. Fail readiness first, so the load balancer stops sending new traffic
    //    while we are still able to finish what we have.
    beginShutdown();

    // 2. Give the balancer a moment to notice before we start closing things.
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    stopCleanup();

    // 3. Tell connected clients to expect a disconnect, so they can show a
    //    reconnecting state instead of appearing frozen mid-match.
    try {
      io.emit('server:shutdown' as never);
      await io.close();
      logger.info('realtime connections closed');
    } catch (error) {
      logger.warn({ err: error }, 'error closing realtime layer');
    }

    // 4. Stop accepting HTTP, let in-flight requests finish.
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
      setTimeout(resolve, DRAIN_TIMEOUT_MS).unref();
    });
    logger.info('http server closed');

    try {
      await prisma.$disconnect();
      logger.info('database disconnected');
    } catch (error) {
      logger.warn({ err: error }, 'error disconnecting database');
    }

    logger.info('shutdown complete');
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void shutdown(signal));
  }

  // Last resort: if draining hangs, do not leave a zombie holding the port.
  process.on('SIGTERM', () => {
    setTimeout(() => {
      logger.fatal('drain timed out — forcing exit');
      process.exit(1);
    }, DRAIN_TIMEOUT_MS + 10_000).unref();
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'failed to start');
  process.exit(1);
});
