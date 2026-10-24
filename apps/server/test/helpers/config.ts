/**
 * Builds an AppConfig for tests.
 *
 * The services take config as a parameter precisely so tests can vary the
 * gate without mutating process.env or reloading modules.
 */

import type { AppConfig } from '../../src/config.js';

const BASE: AppConfig = {
  nodeEnv: 'test',
  isProduction: false,
  isTest: true,
  port: 4000,
  corsOrigins: ['http://localhost:5173'],
  databaseUrl: undefined,
  sessionSecret: 'test-secret-value-that-is-long-enough',

  paidRoomHostingFlag: false,

  hostingFeePaise: 100,
  currency: 'INR',

  paymentProvider: 'none',
  providerKeyId: undefined,
  providerKeySecret: undefined,
  webhookSecret: 'test-webhook-secret',

  refundWindowMinutes: 60,
};

export function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const merged = { ...BASE, ...overrides };
  return {
    ...merged,
    isProduction: merged.nodeEnv === 'production',
    isTest: merged.nodeEnv === 'test',
  };
}
