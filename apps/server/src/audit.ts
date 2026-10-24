/**
 * Audit logging.
 *
 * Append-only by convention: nothing in the application updates or deletes
 * AuditLog rows. Writes are best-effort and must never break a request — a
 * failed audit write is logged to stderr and swallowed, because dropping a
 * player's game to record a log line would be the worse outcome.
 *
 * Never pass provider secrets, signatures, or raw webhook bodies in `detail`.
 */

import type { PrismaClient } from '@prisma/client';

import { toDbJson } from './db/json.js';
import { log } from './logger.js';

const logger = log('audit');

export type AuditAction =
  | 'room.created'
  | 'room.joined'
  | 'room.activated'
  | 'room.started'
  | 'room.cancelled'
  | 'room.completed'
  | 'room.reconnected'
  | 'gate.denied'
  | 'gate.allowed'
  | 'payment.order_created'
  | 'payment.order_reused'
  | 'payment.signature_checked'
  | 'payment.verified'
  | 'payment.failed'
  | 'payment.duplicate_blocked'
  | 'webhook.received'
  | 'webhook.rejected'
  | 'webhook.replayed'
  | 'refund.requested'
  | 'refund.issued'
  | 'refund.denied'
  | 'match.ended';

export interface AuditEntry {
  readonly action: AuditAction;
  readonly actorType: 'player' | 'system' | 'admin' | 'provider';
  readonly actorId?: string | null;
  readonly subjectType?: 'room' | 'transaction' | 'match' | null;
  readonly subjectId?: string | null;
  readonly detail?: unknown;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export async function audit(prisma: PrismaClient, entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        subjectType: entry.subjectType ?? null,
        subjectId: entry.subjectId ?? null,
        detail: toDbJson(entry.detail ?? {}),
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch (error) {
    // A failed audit write must never break a request — dropping a player's
    // game to record a log line would be the worse outcome. But a payment
    // audit that did not persist is serious, so log it at error level.
    logger.error({ err: error, action: entry.action }, 'failed to write audit entry');
  }
}
