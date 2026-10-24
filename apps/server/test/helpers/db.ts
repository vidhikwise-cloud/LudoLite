/**
 * Test database harness.
 *
 * Spins up a throwaway SQLite file per test file, pushes the test schema into
 * it, and hands back a real PrismaClient. Real SQL, real transactions, real
 * unique constraints — the "host is charged at most once" invariant is
 * enforced by a UNIQUE index, and a mocked database would not prove it holds.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '../../node_modules/.prisma/test-client/index.js';
import { TEST_SCHEMA_SQL } from './schema-sql.js';

export interface TestDb {
  readonly prisma: PrismaClient;
  readonly dispose: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), 'ludolite-test-'));
  const file = join(dir, 'test.db');
  const url = `file:${file}`;

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();

  // Create the schema with raw DDL rather than shelling out to the Prisma
  // CLI: Node on Windows refuses to spawn .cmd files (EINVAL), and this is
  // substantially faster per test file anyway. The DDL is kept in step with
  // schema.test.prisma by a drift test in schema-drift.test.ts.
  for (const statement of TEST_SCHEMA_SQL) {
    await prisma.$executeRawUnsafe(statement);
  }

  // Seed the compliance rows in their real, honest default state: nothing
  // approved. A test that wants the gate open must open it explicitly.
  await prisma.complianceApproval.createMany({
    data: [
      { id: 'legal_opinion', status: 'not_started' },
      { id: 'payment_provider', status: 'not_started' },
    ],
  });

  return {
    prisma,
    dispose: async () => {
      await prisma.$disconnect();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows sometimes holds the file briefly; a leftover temp dir is
        // harmless and must not fail the suite.
      }
    },
  };
}

/**
 * Record both approvals as granted, the way a product owner would once
 * written evidence exists. Used only by tests that need the gate open.
 */
export async function grantApprovals(
  prisma: PrismaClient,
  opts: { providerName?: string } = {},
): Promise<void> {
  await prisma.complianceApproval.update({
    where: { id: 'legal_opinion' },
    data: {
      status: 'approved',
      approvedBy: 'Test Counsel',
      evidenceRef: 'TEST-LEGAL-001',
      approvedAt: new Date(),
    },
  });
  await prisma.complianceApproval.update({
    where: { id: 'payment_provider' },
    data: {
      status: 'approved',
      approvedBy: 'Test Provider',
      evidenceRef: 'TEST-PROVIDER-001',
      providerName: opts.providerName ?? 'mock',
      approvedAt: new Date(),
    },
  });
}
