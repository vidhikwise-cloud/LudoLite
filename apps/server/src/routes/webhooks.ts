/**
 * Payment webhooks.
 *
 * This is the authoritative path for settling a payment. The client's
 * confirm call is a convenience that lets the UI move on promptly; this
 * handler is what the system actually relies on.
 *
 * Properties that matter:
 *
 *  - Signature is verified against the RAW body, before parsing. An invalid
 *    signature is recorded and rejected; it never reaches settlement.
 *  - Deliveries are deduplicated on (provider, providerEventId), so a
 *    provider retrying a delivery settles the payment exactly once.
 *  - The endpoint always answers 200 for a well-formed, validly signed event,
 *    including a replay, so the provider stops retrying.
 */

import type { PrismaClient } from '@prisma/client';
import { Router, type Request, type Response } from 'express';

import { audit } from '../audit.js';
import { toDbJson } from '../db/json.js';
import { markPaymentFailed, settleVerifiedPayment } from '../payments/service.js';
import { resolveProvider } from '../payments/registry.js';
import { wrap } from './wrap.js';

export function webhookRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.post('/payments', wrap(async (req: Request, res: Response) => {
    const provider = resolveProvider();

    // express.raw() put a Buffer here; verification must use these exact bytes.
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body ?? {});

    let verification;
    try {
      verification = provider.verifyWebhook(
        rawBody,
        req.headers as Record<string, string | undefined>,
      );
    } catch (error) {
      await audit(prisma, {
        action: 'webhook.rejected',
        actorType: 'provider',
        detail: { reason: 'verification threw', provider: provider.name },
      });
      // 400 so the provider surfaces the misconfiguration rather than
      // retrying forever against an endpoint that cannot process it.
      return res.status(400).json({ received: false });
    }

    if (!verification.signatureValid) {
      await prisma.webhookEvent.create({
        data: {
          provider: provider.name,
          providerEventId: `invalid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          eventType: verification.eventType,
          signatureValid: false,
          payload: toDbJson({ note: 'signature invalid; body not retained' }),
        },
      });
      await audit(prisma, {
        action: 'webhook.rejected',
        actorType: 'provider',
        detail: { reason: 'invalid signature', provider: provider.name },
      });
      return res.status(401).json({ received: false });
    }

    // Dedupe. The unique constraint is the real guard; this read just lets us
    // answer fast on the common replay.
    const existing = await prisma.webhookEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: provider.name,
          providerEventId: verification.providerEventId,
        },
      },
    });

    if (existing?.processedAt) {
      await audit(prisma, {
        action: 'webhook.replayed',
        actorType: 'provider',
        subjectType: 'transaction',
        subjectId: existing.transactionId,
        detail: { eventId: verification.providerEventId, eventType: verification.eventType },
      });
      return res.json({ received: true, duplicate: true });
    }

    const transaction = verification.providerOrderId
      ? await prisma.transaction.findUnique({
          where: { providerOrderId: verification.providerOrderId },
        })
      : null;

    let event;
    try {
      event = await prisma.webhookEvent.create({
        data: {
          provider: provider.name,
          providerEventId: verification.providerEventId,
          eventType: verification.eventType,
          signatureValid: true,
          // Store the body verbatim as received — it is the evidence that
          // this payment was verified, so it must not be re-serialized.
          payload: rawBody,
          transactionId: transaction?.id ?? null,
        },
      });
    } catch {
      // Unique violation: a concurrent delivery won the race and is
      // processing it. Acknowledge so the provider stops retrying.
      return res.json({ received: true, duplicate: true });
    }

    await audit(prisma, {
      action: 'webhook.received',
      actorType: 'provider',
      subjectType: transaction ? 'transaction' : null,
      subjectId: transaction?.id ?? null,
      detail: {
        eventType: verification.eventType,
        outcome: verification.outcome,
        provider: provider.name,
      },
    });

    if (!transaction) {
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
      return res.json({ received: true, matched: false });
    }

    switch (verification.outcome) {
      case 'succeeded': {
        // Guard against a tampered or mismatched amount: settle only when the
        // provider reports the amount we actually asked for.
        if (
          typeof verification.amountPaise === 'number' &&
          verification.amountPaise !== transaction.amountPaise
        ) {
          await markPaymentFailed({
            prisma,
            transactionId: transaction.id,
            reason: `amount mismatch: expected ${transaction.amountPaise}, provider reported ${verification.amountPaise}`,
          });
          break;
        }

        const result = await settleVerifiedPayment({
          prisma,
          transactionId: transaction.id,
          providerPaymentId: verification.providerPaymentId,
          verificationPayload: rawBody,
          actorType: 'provider',
        });

        await audit(prisma, {
          action: result.alreadySettled ? 'payment.duplicate_blocked' : 'payment.verified',
          actorType: 'provider',
          subjectType: 'transaction',
          subjectId: transaction.id,
          detail: { via: 'webhook', roomId: transaction.roomId },
        });
        break;
      }

      case 'failed':
        await markPaymentFailed({
          prisma,
          transactionId: transaction.id,
          reason: verification.failureReason ?? 'provider reported failure',
        });
        break;

      case 'refunded':
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: 'refunded', refundedAt: new Date() },
        });
        break;

      case 'ignored':
      default:
        break;
    }

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date() },
    });

    res.json({ received: true });
  }));

  return router;
}
