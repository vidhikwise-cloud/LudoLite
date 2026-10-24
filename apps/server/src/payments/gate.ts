/**
 * The paid-hosting gate.
 *
 * This is the only place in the codebase that may conclude "yes, we can take
 * money". Everything else asks this module.
 *
 * Three independent conditions must ALL hold:
 *
 *   1. PAID_ROOM_HOSTING_ENABLED=true          (deployment intent)
 *   2. A `legal_opinion` approval, approved    (Indian gaming law sign-off)
 *   3. A `payment_provider` approval, approved (written provider confirmation)
 *
 * Conditions 2 and 3 live in the database and carry an evidence reference,
 * because the instruction is explicit that approval must be *written* and
 * must name this exact business model. A boolean in an env file cannot
 * represent that, and an engineer flipping one env var must not be able to
 * start charging real people by accident.
 *
 * The provider approval is additionally checked against the provider actually
 * configured, so an approval obtained for one provider cannot be silently
 * reused after swapping PAYMENT_PROVIDER to another.
 */

import type { PrismaClient } from '@prisma/client';

import { config, type AppConfig } from '../config.js';

export interface PaidHostingGate {
  /** True only when every condition is satisfied. */
  readonly allowed: boolean;
  /**
   * True when a provider is wired in test/sandbox mode. When this is true the
   * UI must label amounts as test payments and must not imply real money.
   */
  readonly testMode: boolean;
  /** Human-readable reasons the gate is shut. Empty when `allowed`. */
  readonly blockers: readonly string[];
  readonly providerName: string;
}

/**
 * The mock provider exists for automated tests. It must never be reachable by
 * a real user, so it is treated as test mode and refused in production by
 * `assertProductionSafety`.
 */
function isTestModeProvider(provider: AppConfig['paymentProvider']): boolean {
  return provider === 'mock' || provider === 'sandbox';
}

export async function resolvePaidHostingGate(
  prisma: PrismaClient,
  c: AppConfig = config,
): Promise<PaidHostingGate> {
  const blockers: string[] = [];

  if (!c.paidRoomHostingFlag) {
    blockers.push('PAID_ROOM_HOSTING_ENABLED is false');
  }

  if (c.paymentProvider === 'none') {
    blockers.push('No payment provider is configured (PAYMENT_PROVIDER=none)');
  }

  const approvals = await prisma.complianceApproval.findMany({
    where: { id: { in: ['legal_opinion', 'payment_provider'] } },
  });

  const legal = approvals.find((a) => a.id === 'legal_opinion');
  const provider = approvals.find((a) => a.id === 'payment_provider');

  // --- Legal opinion -------------------------------------------------------
  if (!legal || legal.status !== 'approved') {
    blockers.push(
      `Legal review is "${legal?.status ?? 'not recorded'}" — a written opinion from a qualified Indian gaming lawyer on this exact model is required`,
    );
  } else if (!legal.evidenceRef) {
    blockers.push('Legal approval has no evidence reference recorded');
  } else if (legal.expiresAt && legal.expiresAt.getTime() < Date.now()) {
    blockers.push('Legal approval has expired and needs re-confirmation');
  }

  // --- Payment provider ----------------------------------------------------
  if (!provider || provider.status !== 'approved') {
    blockers.push(
      `Payment provider approval is "${provider?.status ?? 'not recorded'}" — written confirmation that the provider permits this exact business model is required`,
    );
  } else if (!provider.evidenceRef) {
    blockers.push('Provider approval has no evidence reference recorded');
  } else if (provider.expiresAt && provider.expiresAt.getTime() < Date.now()) {
    blockers.push('Provider approval has expired and needs re-confirmation');
  } else if (
    provider.providerName &&
    !c.paymentProvider.includes(provider.providerName.toLowerCase()) &&
    provider.providerName.toLowerCase() !== c.paymentProvider
  ) {
    // An approval names the provider it covers. Swapping providers requires a
    // fresh approval rather than inheriting the old one.
    blockers.push(
      `Provider approval covers "${provider.providerName}" but PAYMENT_PROVIDER is "${c.paymentProvider}"`,
    );
  }

  return {
    allowed: blockers.length === 0,
    testMode: isTestModeProvider(c.paymentProvider),
    blockers,
    providerName: c.paymentProvider,
  };
}

/**
 * Gate state for the public config endpoint.
 *
 * In production the blocker list is withheld: it is internal compliance
 * detail and says nothing a player needs. In development it is returned so
 * the product owner can see exactly what is still outstanding.
 */
export function publicGateView(
  gate: PaidHostingGate,
  c: AppConfig = config,
): { paidHostingEnabled: boolean; paymentsAreTestMode: boolean; blockers: string[] } {
  return {
    paidHostingEnabled: gate.allowed,
    paymentsAreTestMode: gate.allowed && gate.testMode,
    blockers: c.isProduction ? [] : [...gate.blockers],
  };
}
