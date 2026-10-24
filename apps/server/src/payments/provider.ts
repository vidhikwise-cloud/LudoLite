/**
 * Payment provider interface.
 *
 * Deliberately narrow. A provider creates an order, verifies a signature,
 * parses its own webhooks, and issues refunds. It does not decide whether a
 * room may be activated — that is the server's job, and it depends on a
 * verified transaction record rather than on anything a provider SDK returns
 * to the browser.
 *
 * NOTE ON PROVIDER CHOICE
 * -----------------------
 * No production adapter is registered. Razorpay in particular is NOT wired
 * up: its published payment terms restrict transactions associated with
 * real-money online gaming, and the instruction for this project is explicit
 * that it must not be used unless Razorpay confirms in writing that this
 * exact activity is permitted under its current terms. Adding an adapter here
 * does not by itself open the gate — see ./gate.ts.
 */

export interface CreateOrderInput {
  readonly amountPaise: number;
  readonly currency: string;
  readonly idempotencyKey: string;
  readonly roomId: string;
  readonly playerId: string;
  /** Free-form notes forwarded to the provider for reconciliation. */
  readonly notes?: Record<string, string>;
}

export interface CreateOrderResult {
  readonly providerOrderId: string;
  /** Public key the client checkout widget needs, if any. */
  readonly providerPublicKey?: string;
}

export interface VerifySignatureInput {
  readonly providerOrderId: string;
  readonly providerPaymentId: string;
  readonly signature: string;
}

export interface WebhookVerification {
  readonly signatureValid: boolean;
  readonly providerEventId: string;
  readonly eventType: string;
  /** Order this event concerns, when the payload identifies one. */
  readonly providerOrderId: string | null;
  readonly providerPaymentId: string | null;
  /** Normalised outcome the server should record. */
  readonly outcome: 'succeeded' | 'failed' | 'refunded' | 'ignored';
  readonly failureReason?: string;
  readonly amountPaise?: number;
}

export interface RefundInput {
  readonly providerPaymentId: string;
  readonly amountPaise: number;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface RefundResult {
  readonly refundId: string;
  readonly status: 'processed' | 'pending';
}

export interface PaymentProvider {
  /** Identifier recorded on every transaction, e.g. 'mock' or 'sandbox:acme'. */
  readonly name: string;
  /** True when this provider never moves real money. */
  readonly testMode: boolean;

  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;

  /**
   * Checks a client-supplied signature. A `true` here is still not enough to
   * activate a room on its own; the server waits for the signed webhook, or
   * re-queries the provider, before treating a payment as settled.
   */
  verifyPaymentSignature(input: VerifySignatureInput): Promise<boolean>;

  /** Validates and normalises a raw webhook delivery. */
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookVerification;

  refund(input: RefundInput): Promise<RefundResult>;
}

/**
 * Used when PAYMENT_PROVIDER=none. Every call throws, which guarantees that a
 * misconfiguration surfaces as a loud server error rather than as a silent
 * free pass that activates a paid room without payment.
 */
export class NoProviderConfiguredError extends Error {
  constructor(operation: string) {
    super(
      `No payment provider is configured, so "${operation}" cannot run. ` +
        'This is the default and expected state until legal review and ' +
        'written provider approval are complete.',
    );
    this.name = 'NoProviderConfiguredError';
  }
}

export const nullProvider: PaymentProvider = {
  name: 'none',
  testMode: true,
  async createOrder() {
    throw new NoProviderConfiguredError('createOrder');
  },
  async verifyPaymentSignature() {
    throw new NoProviderConfiguredError('verifyPaymentSignature');
  },
  verifyWebhook() {
    throw new NoProviderConfiguredError('verifyWebhook');
  },
  async refund() {
    throw new NoProviderConfiguredError('refund');
  },
};
