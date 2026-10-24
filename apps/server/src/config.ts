/**
 * Server configuration.
 *
 * The paid-hosting flag is read here exactly once and exposed as a plain
 * boolean. Nothing else in the codebase reads process.env for it, so there is
 * a single place to audit.
 */

import { z } from 'zod';

const booleanish = z
  .string()
  .optional()
  .transform((v) => v?.trim().toLowerCase() === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().min(16).default('dev-only-secret-change-me-now'),

  PAID_ROOM_HOSTING_ENABLED: booleanish,
  HOSTING_FEE_PAISE: z.coerce.number().int().nonnegative().default(100),
  CURRENCY: z.string().default('INR'),

  PAYMENT_PROVIDER: z.enum(['none', 'mock', 'sandbox']).default('none'),
  PAYMENT_PROVIDER_KEY_ID: z.string().optional(),
  PAYMENT_PROVIDER_KEY_SECRET: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),

  REFUND_WINDOW_MINUTES: z.coerce.number().int().positive().default(60),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid server configuration:\n${issues}`);
}

const env = parsed.data;

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  corsOrigins: env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  databaseUrl: env.DATABASE_URL,
  sessionSecret: env.SESSION_SECRET,

  /**
   * The env flag only. This is NOT sufficient to collect money — see
   * `resolvePaidHostingGate` in ./payments/gate.ts, which additionally
   * requires approval records in the database.
   */
  paidRoomHostingFlag: env.PAID_ROOM_HOSTING_ENABLED,

  hostingFeePaise: env.HOSTING_FEE_PAISE,
  currency: env.CURRENCY,

  paymentProvider: env.PAYMENT_PROVIDER,
  providerKeyId: env.PAYMENT_PROVIDER_KEY_ID,
  providerKeySecret: env.PAYMENT_PROVIDER_KEY_SECRET,
  webhookSecret: env.PAYMENT_WEBHOOK_SECRET,

  refundWindowMinutes: env.REFUND_WINDOW_MINUTES,
} as const;

export type AppConfig = typeof config;

/**
 * A production deployment must not run with the development defaults. Fail
 * loudly at boot rather than quietly accepting a guessable session secret.
 */
export function assertProductionSafety(c: AppConfig = config): void {
  if (!c.isProduction) return;

  const problems: string[] = [];
  if (c.sessionSecret === 'dev-only-secret-change-me-now') {
    problems.push('SESSION_SECRET is still the development default');
  }
  if (!c.databaseUrl) {
    problems.push('DATABASE_URL is not set');
  }
  if (c.paidRoomHostingFlag && c.paymentProvider === 'none') {
    problems.push(
      'PAID_ROOM_HOSTING_ENABLED is true but PAYMENT_PROVIDER is "none"',
    );
  }
  if (c.paidRoomHostingFlag && c.paymentProvider === 'mock') {
    problems.push(
      'PAYMENT_PROVIDER is "mock" in production — the mock provider must never handle real users',
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
}
