/**
 * Prints the paid-hosting gate state.
 *
 *   npm run approvals:status --workspace apps/server
 *
 * Use this to answer "can we take money yet?" without reading code.
 */

import { PrismaClient } from '@prisma/client';

import { config } from '../config.js';
import { resolvePaidHostingGate } from '../payments/gate.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const gate = await resolvePaidHostingGate(prisma);
  const approvals = await prisma.complianceApproval.findMany({ orderBy: { id: 'asc' } });

  console.log('\n  PAID HOSTING GATE');
  console.log('  ─────────────────────────────────────────────────────────');
  console.log(`  PAID_ROOM_HOSTING_ENABLED : ${config.paidRoomHostingFlag}`);
  console.log(`  PAYMENT_PROVIDER          : ${config.paymentProvider}`);
  console.log(`  Hosting fee               : ${(config.hostingFeePaise / 100).toFixed(2)} ${config.currency}`);
  console.log('');

  for (const row of approvals) {
    console.log(`  ${row.id}`);
    console.log(`    status      : ${row.status}`);
    console.log(`    evidence    : ${row.evidenceRef ?? '(none recorded)'}`);
    console.log(`    approved by : ${row.approvedBy ?? '(none)'}`);
    if (row.providerName) console.log(`    provider    : ${row.providerName}`);
    if (row.expiresAt) console.log(`    expires     : ${row.expiresAt.toISOString()}`);
    console.log('');
  }

  console.log('  ─────────────────────────────────────────────────────────');
  if (gate.allowed) {
    console.log(`  RESULT: paid hosting is ENABLED (testMode=${gate.testMode})`);
  } else {
    console.log('  RESULT: paid hosting is DISABLED. Blocked by:');
    for (const blocker of gate.blockers) console.log(`    - ${blocker}`);
  }
  console.log('');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
