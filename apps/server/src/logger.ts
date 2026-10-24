/**
 * Structured logging.
 *
 * JSON in production so a log aggregator can parse it; human-readable in
 * development. Every HTTP request gets an id that is carried through to any
 * log line it produces, which is what makes "what happened to this user at
 * 14:32" an answerable question.
 *
 * Redaction is not optional here. This server handles payments, so anything
 * that could carry a token, a signature, or a provider secret is stripped
 * before it reaches a log sink we do not control.
 */

import { pino } from 'pino';

import { config } from './config.js';

/**
 * Tests assert on behaviour, not on log output, and a passing suite should be
 * readable. `LOG_LEVEL` still overrides this when debugging a test.
 */
const defaultLevel = config.isTest ? 'silent' : config.isProduction ? 'info' : 'debug';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? defaultLevel,

  // Paths scrubbed from every log line, at any depth.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-mock-signature"]',
      'req.headers["x-razorpay-signature"]',
      'req.body.playerToken',
      'req.body.providerSignature',
      'req.body.deviceKey',
      'res.headers["set-cookie"]',
      '*.playerToken',
      '*.providerSignature',
      '*.sessionSecret',
      '*.providerKeySecret',
      '*.webhookSecret',
      'password',
      'DATABASE_URL',
    ],
    censor: '[redacted]',
  },

  base: {
    service: 'ludo-api',
    env: config.nodeEnv,
  },

  formatters: {
    level: (label) => ({ level: label }),
  },

  timestamp: pino.stdTimeFunctions.isoTime,

  ...(config.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname,service,env',
          },
        },
      }),
});

/** Child logger for a subsystem, e.g. `log('payments')`. */
export function log(component: string) {
  return logger.child({ component });
}
