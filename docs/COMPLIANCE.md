# Compliance and payment-provider gate

**Status as of 2026-10-24: paid hosting is DISABLED. No legal approval has been
obtained. No payment provider has approved this business model. No real money
can be collected by this system in its current state.**

This document is the operating record for the gate. It is deliberately blunt
about what is and is not true, because the failure mode we are guarding
against is someone reading an optimistic README and flipping a flag.

---

## 1. The business model being assessed

- A room creator pays **₹1 once** to host a single private match.
- Every other player joins that room **free of charge**.
- A four-player match therefore produces **₹1 gross revenue, not ₹4**.
- No subscriptions. No paid ads, sponsored placements, banners, or forced
  videos.
- **No cash prizes, no betting, no withdrawals, no redeemable monetary
  rewards.** Winning a match returns the result and nothing else.
- No paid gameplay advantages. The ₹1 buys hosting access, not an edge.
- The ₹1 is retained by the company as gross revenue before expenses. It is
  **not** a prize pool and is never redistributed to players.

The code enforces the revenue shape: see the test
`a four-player paid match collects ₹1 in total, not ₹4` in
`apps/server/test/payments.test.ts`.

---

## 2. The gate

Paid hosting requires **three independent conditions**, all true at once:

| # | Condition | Where it lives |
|---|-----------|----------------|
| 1 | `PAID_ROOM_HOSTING_ENABLED=true` | environment |
| 2 | `legal_opinion` approval, status `approved`, with an evidence reference | database |
| 3 | `payment_provider` approval, status `approved`, with an evidence reference and a matching provider name | database |

If any one is missing, `POST /api/rooms` with `funding: "paid"` returns
**402 `PAID_HOSTING_UNAVAILABLE`** and no room and no transaction are created.

The env flag alone is deliberately **not sufficient**. Approval is a human act
backed by a written document, and a single misconfigured environment variable
must not be able to start charging real people. The seed script cannot grant
approval either — it only ever writes `not_started`.

Check the live state at any time:

```bash
npm run approvals:status --workspace apps/server
```

---

## 3. Legal review — NOT STARTED

### What is required

A written opinion from a **qualified Indian gaming lawyer** on whether a ₹1
room-hosting fee, for this specific implementation, is permissible under:

- **The Promotion and Regulation of Online Gaming Act, 2025**
- **The Online Gaming Rules, 2026**

That framework distinguishes online *social* games from prohibited online
*money* games, and the assessment considers the payment of fees or stakes, the
possibility of monetary winnings, and the overall revenue model.

### What the opinion must address

- Whether charging **only the creator** changes the classification. **Do not
  assume it does.** This is the central open question and it must not be
  answered by engineers or by analogy.
- Whether a hosting/access fee is distinguishable from a stake, given that it
  is a precondition for a competitive match being played at all.
- Whether the absence of any payout is sufficient to stay outside the "online
  money game" definition.
- State-level variation, where any applies.
- Any registration, disclosure, grievance, or KYC obligations that attach.

### Recording the outcome

Once a written opinion exists, update the row by hand:

```sql
UPDATE "ComplianceApproval"
SET status       = 'approved',       -- or 'denied'
    "approvedBy" = 'Firm name, advocate name',
    "evidenceRef"= 'Document reference / matter number / file location',
    "approvedAt" = NOW(),
    "expiresAt"  = NOW() + INTERVAL '1 year'
WHERE id = 'legal_opinion';
```

An approval with no `evidenceRef` does not open the gate.

---

## 4. Payment provider approval — NOT OBTAINED

### Razorpay

**Razorpay is not wired up, and must not be used unless it confirms in writing
that this exact activity is permitted under its current terms.**

Razorpay's published payment terms restrict transactions associated with
real-money online gaming. Whether a ₹1 hosting fee with no payouts falls
inside or outside that restriction is a question for Razorpay, in writing,
about this specific model — not an inference from the fact that we do not pay
out.

**Do not route transactions through a different provider to work around a
restriction one provider has imposed.** If a provider declines, the answer is
to keep paid hosting disabled, not to find a more permissive processor.

### What any provider must confirm in writing

Before `payment_provider` can be marked approved, get written answers to all
of the following, covering **this** business model by description:

- [ ] Is this exact activity — a ₹1 hosting fee for a private multiplayer
      match with no prizes, no payouts, and no withdrawals — permitted under
      the provider's current terms?
- [ ] Are **₹1 transactions supported at all**?
- [ ] What is the **minimum transaction amount**?
- [ ] What are the **actual processing costs** per transaction, in full
      (percentage, fixed component, and any minimum)?
- [ ] **Merchant onboarding and business-category eligibility** — which
      category does this product onboard under, and is it approved?
- [ ] **Applicable taxes and settlement fees**, and the settlement timeline.
- [ ] **Refund processing**: how refunds are issued, their cost, and the
      timeline to the customer's source account.
- [ ] **Customer support requirements** placed on us as merchant.
- [ ] **Website payment requirements** (domain verification, policy pages,
      disclosures).
- [ ] **Android payment requirements**, including whether in-app collection is
      permitted via this provider at all.
- [ ] Applicable **consumer-protection, privacy, and gaming obligations**.

### ⚠ Unit economics — check this early

On a ₹1 transaction, a typical Indian gateway's **fixed per-transaction
component alone may exceed the revenue**, before the percentage fee, before
tax, and before settlement costs. A refund may cost more than the original
payment collected.

This can make the model unviable on arithmetic regardless of the legal
answer. **Get the fee schedule in writing before building anything further
around the ₹1 price point**, because the outcome may change the price.

### Recording the outcome

```sql
UPDATE "ComplianceApproval"
SET status        = 'approved',
    "approvedBy"  = 'Provider name, contact, date of written confirmation',
    "evidenceRef" = 'Email thread / ticket / contract reference',
    "providerName"= 'sandbox',   -- must match PAYMENT_PROVIDER
    "approvedAt"  = NOW(),
    "expiresAt"   = NOW() + INTERVAL '1 year'
WHERE id = 'payment_provider';
```

`providerName` must match the configured `PAYMENT_PROVIDER`. An approval
obtained for one provider does not carry over to another — swapping providers
requires fresh written approval.

---

## 5. Google Play — NOT REVIEWED

Before the Android build charges anything:

- [ ] Review **current** Google Play policy on paid digital access, and
      whether Play Billing is required for this kind of charge.
- [ ] Review Play's real-money-gaming policy and its India-specific terms, and
      whether this product is classified under them.
- [ ] Complete the Play Console declarations truthfully for this model.
- [ ] Confirm whether a web-based payment is permitted for this content type
      or whether it constitutes a policy violation.

Taking a ₹1 payment inside an Android app is a materially different question
from taking it on the web. Do not assume the web answer transfers.

---

## 6. What ships today

With the gate shut, which is the default:

- Free private rooms, fully playable, created instantly.
- Invite codes and links; friends join free.
- Real-time multiplayer with server-authoritative dice, turns, moves, and
  results.
- Reconnection that restores a seat.
- **No payment UI is rendered anywhere.** Not a fee line, not a price, not a
  disabled "Confirm and Pay" button. A greyed-out payment control still
  implies a payment flow exists, so none is drawn at all. This is asserted by
  `shows no payment button at all, not even disabled` in
  `apps/web/test/create-room.test.tsx`.
- No money is collected, and nothing claims otherwise.

---

## 7. Before flipping the flag

Do not set `PAID_ROOM_HOSTING_ENABLED=true` in production until **every** box
is ticked:

- [ ] Written legal opinion obtained, recorded, and not expired.
- [ ] Written provider approval obtained, recorded, naming this model and the
      configured provider.
- [ ] ₹1 unit economics verified against the written fee schedule.
- [ ] A real provider adapter implemented (there is none today — see
      `apps/server/src/payments/registry.ts`).
- [ ] Sandbox end-to-end tested, including failure, duplicate, and refund.
- [ ] Refund policy published and reachable from the payment screen.
- [ ] Grievance and support contact published and staffed.
- [ ] Privacy policy and terms published.
- [ ] Google Play review completed if Android collects payment.
- [ ] `npm run approvals:status` reports the gate as open for the right
      reasons.

---

## 8. Audit trail

Every gate denial, order, verification, failure, refund, and webhook is
recorded in `AuditLog` with an action name, actor, subject, and structured
detail. Gate denials record the exact blocker list that caused them.

Query what has happened:

```sql
SELECT action, "actorType", "subjectId", detail, at
FROM "AuditLog"
WHERE action LIKE 'payment.%' OR action LIKE 'gate.%' OR action LIKE 'refund.%'
ORDER BY at DESC;
```

Provider secrets, signatures, and unverified webhook bodies are never written
to the audit log.
