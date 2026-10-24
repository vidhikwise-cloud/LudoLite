/**
 * Provider selection.
 *
 * There is intentionally no production adapter here. Adding one is a
 * deliberate, reviewable change — and even then it only takes effect once the
 * gate in ./gate.ts opens.
 */

import { config, type AppConfig } from '../config.js';
import { MockPaymentProvider } from './mock-provider.js';
import { nullProvider, type PaymentProvider } from './provider.js';

let cached: PaymentProvider | null = null;

export function resolveProvider(c: AppConfig = config): PaymentProvider {
  if (cached && cached.name !== 'none') return cached;

  switch (c.paymentProvider) {
    case 'mock': {
      cached = new MockPaymentProvider({
        secret: c.webhookSecret ?? 'mock-webhook-secret',
      });
      return cached;
    }

    case 'sandbox': {
      // A sandbox adapter belongs here once a provider has confirmed in
      // writing that this business model is permitted. Until then there is
      // nothing to point it at, so fall through to the null provider rather
      // than guess at an integration.
      //
      // Whichever provider is eventually chosen, it must be configured with
      // TEST credentials here, and `testMode` must be true so the UI labels
      // every amount as a test payment.
      cached = nullProvider;
      return cached;
    }

    case 'none':
    default:
      cached = nullProvider;
      return cached;
  }
}

/** Test-only: swap the provider instance. */
export function setProviderForTesting(provider: PaymentProvider | null): void {
  cached = provider;
}
