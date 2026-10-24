/**
 * Seeds the two compliance approval rows.
 *
 * A compiled twin of prisma/seed.ts, so the Docker runtime image — which has
 * no TypeScript and no `tsx` — can run it at startup.
 *
 * Both rows start as `not_started`, which is the honest state: no legal
 * opinion has been obtained and no payment provider has confirmed this
 * business model.
 *
 * This script can NEVER write `approved`. Granting approval is a human act
 * backed by a written document, and a startup script must not be able to do
 * it — otherwise a redeploy could silently open the payment gate.
 */

import { PrismaClient } from '@prisma/client';

const LEGAL_NOTE =
  'Required: written opinion from a qualified Indian gaming lawyer on whether a Rs 1 ' +
  'room-hosting fee for this specific Ludo implementation is permissible under the ' +
  'Promotion and Regulation of Online Gaming Act, 2025 and the Online Gaming Rules, 2026. ' +
  'The opinion must address this exact model and must not assume that charging only the ' +
  'creator is automatically compliant.';

const PROVIDER_NOTE =
  'Required: written confirmation from the selected payment provider that it will approve ' +
  'this exact business model. Must cover Rs 1 transaction support, minimum transaction ' +
  'amount, processing costs, merchant onboarding and business-category eligibility, taxes ' +
  'and settlement fees, refund and support requirements, and website plus Android payment ' +
  'requirements. Razorpay must not be used unless it confirms in writing that this exact ' +
  'activity is permitted under its current terms, which restrict real-money online gaming.';

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    await prisma.complianceApproval.upsert({
      where: { id: 'legal_opinion' },
      create: { id: 'legal_opinion', status: 'not_started', evidenceNote: LEGAL_NOTE },
      // Never downgrade or overwrite a real approval on redeploy.
      update: {},
    });

    await prisma.complianceApproval.upsert({
      where: { id: 'payment_provider' },
      create: { id: 'payment_provider', status: 'not_started', evidenceNote: PROVIDER_NOTE },
      update: {},
    });

    const rows = await prisma.complianceApproval.findMany({ orderBy: { id: 'asc' } });
    for (const row of rows) {
      console.log(`  compliance: ${row.id} = ${row.status}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('compliance seeding failed', error);
  process.exit(1);
});
