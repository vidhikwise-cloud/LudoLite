/**
 * In-process fake provider for automated tests and local development.
 *
 * It moves no money. It does, however, implement real HMAC-SHA256 signing so
 * the server's signature-verification path is genuinely exercised rather than
 * stubbed out — a test suite that skips signature checks would not tell us
 * whether the production path is sound.
 *
 * Never reachable in production: `assertProductionSafety` refuses to boot if
 * PAYMENT_PROVIDER=mock while NODE_ENV=production.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type {
  CreateOrderInput,
  CreateOrderResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
  VerifySignatureInput,
  WebhookVerification,
} from './provider.js';

export interface MockProviderOptions {
  readonly secret: string;
  /** Force the next createOrder to throw, to test the failure path. */
  failNextOrder?: boolean;
}

/** Constant-time compare that tolerates length mismatch without throwing. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function signPayload(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** Signature over `orderId|paymentId`, mirroring common provider schemes. */
export function mockPaymentSignature(
  secret: string,
  orderId: string,
  paymentId: string,
): string {
  return signPayload(secret, `${orderId}|${paymentId}`);
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly testMode = true;

  private readonly secret: string;
  private readonly orders = new Map<string, { amountPaise: number; idempotencyKey: string }>();
  /** Lets a test make order creation fail without touching server code. */
  failNextOrder = false;

  constructor(options: MockProviderOptions) {
    this.secret = options.secret;
    this.failNextOrder = options.failNextOrder ?? false;
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    if (this.failNextOrder) {
      this.failNextOrder = false;
      throw new Error('mock provider: order creation failed');
    }
    const providerOrderId = `order_mock_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    this.orders.set(providerOrderId, {
      amountPaise: input.amountPaise,
      idempotencyKey: input.idempotencyKey,
    });
    return { providerOrderId, providerPublicKey: 'mock_public_key' };
  }

  async verifyPaymentSignature(input: VerifySignatureInput): Promise<boolean> {
    const expected = mockPaymentSignature(
      this.secret,
      input.providerOrderId,
      input.providerPaymentId,
    );
    return safeEqual(expected, input.signature);
  }

  verifyWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): WebhookVerification {
    const provided = headers['x-mock-signature'] ?? '';
    const expected = signPayload(this.secret, rawBody);
    const signatureValid = safeEqual(expected, provided);

    let parsed: {
      id?: string;
      type?: string;
      orderId?: string;
      paymentId?: string;
      amountPaise?: number;
      failureReason?: string;
    };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return {
        signatureValid: false,
        providerEventId: 'unparseable',
        eventType: 'unknown',
        providerOrderId: null,
        providerPaymentId: null,
        outcome: 'ignored',
      };
    }

    const outcome: WebhookVerification['outcome'] =
      parsed.type === 'payment.captured'
        ? 'succeeded'
        : parsed.type === 'payment.failed'
          ? 'failed'
          : parsed.type === 'refund.processed'
            ? 'refunded'
            : 'ignored';

    return {
      signatureValid,
      providerEventId: parsed.id ?? randomUUID(),
      eventType: parsed.type ?? 'unknown',
      providerOrderId: parsed.orderId ?? null,
      providerPaymentId: parsed.paymentId ?? null,
      outcome,
      failureReason: parsed.failureReason,
      amountPaise: parsed.amountPaise,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    return {
      refundId: `rfnd_mock_${randomUUID().replace(/-/g, '').slice(0, 18)}`,
      status: 'processed',
    };
  }

  // --- test helpers --------------------------------------------------------

  /** Builds a signed webhook body a test can POST to /api/webhooks/payments. */
  buildWebhook(event: {
    id?: string;
    type: 'payment.captured' | 'payment.failed' | 'refund.processed';
    orderId: string;
    paymentId?: string;
    amountPaise?: number;
    failureReason?: string;
  }): { body: string; headers: Record<string, string> } {
    const body = JSON.stringify({
      id: event.id ?? `evt_mock_${randomUUID().replace(/-/g, '').slice(0, 18)}`,
      type: event.type,
      orderId: event.orderId,
      paymentId: event.paymentId ?? `pay_mock_${randomUUID().replace(/-/g, '').slice(0, 18)}`,
      amountPaise: event.amountPaise,
      failureReason: event.failureReason,
    });
    return {
      body,
      headers: { 'x-mock-signature': signPayload(this.secret, body) },
    };
  }

  knownOrder(orderId: string): boolean {
    return this.orders.has(orderId);
  }
}
