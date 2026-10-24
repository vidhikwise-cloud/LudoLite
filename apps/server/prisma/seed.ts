/**
 * Seeds the two compliance approval rows.
 *
 * Both start as `not_started`, which is the honest state: no legal opinion
 * has been obtained and no payment provider has confirmed this business
 * model. The gate stays shut until a human updates these rows with evidence.
 *
 * Deliberately does NOT upsert to `approved` under any circumstance. Granting
 * approval is a human act backed by a written document; a seed script must
 * never be able to do it.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.complianceApproval.upsert({
    where: { id: 'legal_opinion' },
    create: {
      id: 'legal_opinion',
      status: 'not_started',
      evidenceNote:
        'Required: written opinion from a qualified Indian gaming lawyer on whether a Rs 1 ' +
        'room-hosting fee for this specific Ludo implementation is permissible under the ' +
        'Promotion and Regulation of Online Gaming Act, 2025 and the Online Gaming Rules, 2026. ' +
        'The opinion must address this exact model and must not assume that charging only the ' +
        'creator is automatically compliant.',
    },
    // Never downgrade or overwrite a real approval on re-seed.
    update: {},
  });

  await prisma.complianceApproval.upsert({
    where: { id: 'payment_provider' },
    create: {
      id: 'payment_provider',
      status: 'not_started',
      evidenceNote:
        'Required: written confirmation from the selected payment provider that it will approve ' +
        'this exact business model. Must cover Rs 1 transaction support, minimum transaction ' +
        'amount, processing costs, merchant onboarding and business-category eligibility, taxes ' +
        'and settlement fees, refund and support requirements, and website plus Android payment ' +
        'requirements. Razorpay must not be used unless it confirms in writing that this exact ' +
        'activity is permitted under its current terms, which restrict real-money online gaming.',
    },
    update: {},
  });

  const rows = await prisma.complianceApproval.findMany();
  console.log('Compliance approvals seeded:');
  for (const row of rows) {
    console.log(`  ${row.id}: ${row.status}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
