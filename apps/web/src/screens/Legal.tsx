/**
 * Privacy, Terms, and Refund pages.
 *
 * DRAFTS. Written to be accurate about what this specific build actually
 * does — it collects a display name and a device key, stores no payment
 * data, and pays out nothing — so a lawyer reviews real text rather than a
 * generic template.
 *
 * They are NOT legal advice and must be reviewed before public launch. The
 * banner on each page says so, and stays until someone removes it
 * deliberately.
 */

export type LegalPage = 'privacy' | 'terms' | 'refund';

const LAST_UPDATED = '24 October 2026';

/** Fill these in before launch; they are required for a public service. */
const CONTACT = {
  company: '[Company name]',
  address: '[Registered address]',
  email: '[support@yourdomain.in]',
  grievanceOfficer: '[Officer name]',
  grievanceEmail: '[grievance@yourdomain.in]',
};

function DraftBanner() {
  return (
    <div className="draft">
      <b>Draft — not yet reviewed by a lawyer</b>
      This text was prepared as a starting point and must be checked by a
      qualified Indian lawyer before this app is offered to the public.
      Placeholders in square brackets need completing.
    </div>
  );
}

export function Legal({ page, onBack }: { page: LegalPage; onBack: () => void }) {
  return (
    <div className="legal">
      <button type="button" className="btn-link" onClick={onBack}>
        ← Back
      </button>

      {page === 'privacy' ? <Privacy /> : null}
      {page === 'terms' ? <Terms /> : null}
      {page === 'refund' ? <Refund /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Privacy() {
  return (
    <>
      <h2>Privacy Policy</h2>
      <p className="updated">Last updated {LAST_UPDATED}</p>
      <DraftBanner />

      <h3>What we collect</h3>
      <p>We deliberately collect as little as possible. To run a match we store:</p>
      <ul>
        <li>
          <strong>The display name you type.</strong> Pick anything; it does not
          have to be your real name.
        </li>
        <li>
          <strong>A device identifier.</strong> A random code generated in your
          browser so we can give you your seat back if you disconnect. It is not
          linked to your identity and does not follow you to other sites.
        </li>
        <li>
          <strong>Match data.</strong> Rooms you joined, dice rolls, moves, and
          results — needed to run the game and settle any dispute about a roll.
        </li>
        <li>
          <strong>Technical logs.</strong> IP address, browser type, and request
          times, kept for security and troubleshooting.
        </li>
      </ul>

      <h3>What we do not collect</h3>
      <ul>
        <li>No email address, phone number, or password. There are no accounts.</li>
        <li>No contacts, photos, location, or device storage.</li>
        <li>
          <strong>No payment or card details.</strong> This app currently takes no
          payments at all. If paid hosting is enabled in future, card details
          would be handled by a licensed payment provider and never stored by us.
        </li>
        <li>No advertising identifiers. We run no ads and no ad tracking.</li>
      </ul>

      <h3>Why we are allowed to hold it</h3>
      <p>
        We process this data to provide the game you asked us to provide, and to
        keep the service secure. We do not profile you and we do not make
        automated decisions about you.
      </p>

      <h3>Who we share it with</h3>
      <p>
        Nobody, for marketing. We use service providers to host the app and its
        database, and they process data only on our instructions. We disclose
        data to authorities only where the law requires it.
      </p>

      <h3>How long we keep it</h3>
      <ul>
        <li>Abandoned rooms are cleared automatically within a few hours.</li>
        <li>Finished matches are deleted after about 48 hours.</li>
        <li>
          Devices that stop playing are removed after about 60 days of inactivity.
        </li>
        <li>
          Security and audit logs are kept longer where we are required to retain
          them.
        </li>
      </ul>

      <h3>Children</h3>
      <p>
        This service is not directed at children under 13. [Confirm the correct
        age threshold and any verifiable parental consent obligations with your
        lawyer — this is a specific requirement under Indian data protection
        rules.]
      </p>

      <h3>Your rights</h3>
      <p>
        You can ask us what we hold about you, ask for it to be corrected, or ask
        us to delete it. Because there are no accounts, you will need to give us
        a room code or device identifier so we can find the right records. Write
        to {CONTACT.email}.
      </p>

      <h3>Grievance Officer</h3>
      <p>
        As required under Indian law: {CONTACT.grievanceOfficer},{' '}
        {CONTACT.grievanceEmail}. We aim to acknowledge complaints within 24
        hours and resolve them within 15 days.
      </p>

      <h3>Contact</h3>
      <p>
        {CONTACT.company}, {CONTACT.address}. Email {CONTACT.email}.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------

function Terms() {
  return (
    <>
      <h2>Terms of Use</h2>
      <p className="updated">Last updated {LAST_UPDATED}</p>
      <DraftBanner />

      <h3>What this is</h3>
      <p>
        Ludo With Friends lets you create a private room and play Ludo with people
        you invite. It is a social game played for entertainment.
      </p>

      <h3>No money is won or lost</h3>
      <ul>
        <li>
          <strong>There are no cash prizes.</strong> Winning a match returns the
          result and nothing else.
        </li>
        <li>
          <strong>There is no betting, staking, or wagering</strong> between
          players, and no prize pool.
        </li>
        <li>
          <strong>There is nothing to withdraw.</strong> No wallet, no balance,
          no redeemable rewards of any kind.
        </li>
        <li>
          <strong>You cannot buy an advantage.</strong> Dice and turn order are
          decided by our server and are the same for everyone.
        </li>
      </ul>

      <h3>Fees</h3>
      <p>
        <strong>This app is currently free.</strong> No payment is collected from
        anyone.
      </p>
      <p>
        We intend to charge the person who creates a room a one-time hosting fee
        of ₹1 per match, with everyone they invite joining at no charge. That fee
        is a charge for access to host a match. It is not a stake, an entry into
        a prize draw, or a deposit. It will not be enabled until the necessary
        legal and payment-provider approvals are in place, and the price and
        terms will be shown to you before you are asked to pay anything.
      </p>

      <h3>Fair play</h3>
      <p>You agree not to:</p>
      <ul>
        <li>Use bots, scripts, or modified clients.</li>
        <li>Interfere with the service or try to access other people's data.</li>
        <li>Harass other players or use an offensive display name.</li>
      </ul>
      <p>We may remove access where these rules are broken.</p>

      <h3>Availability</h3>
      <p>
        We try to keep the service running but cannot guarantee it is always
        available. Matches may be interrupted by maintenance or technical
        problems. Since no money is at stake, an interrupted match has no
        financial consequence.
      </p>

      <h3>Liability</h3>
      <p>
        [To be completed with your lawyer. Note that Indian consumer protection
        law limits how far liability can be excluded, so a standard
        exclude-everything clause is unlikely to be enforceable.]
      </p>

      <h3>Changes</h3>
      <p>
        We may update these terms. If we start charging for anything, we will tell
        you clearly before any payment is taken.
      </p>

      <h3>Governing law</h3>
      <p>
        These terms are governed by the laws of India. [Confirm jurisdiction
        wording with your lawyer.]
      </p>

      <h3>Contact</h3>
      <p>
        {CONTACT.company}, {CONTACT.address}. Email {CONTACT.email}.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------

function Refund() {
  return (
    <>
      <h2>Cancellation and Refund Policy</h2>
      <p className="updated">Last updated {LAST_UPDATED}</p>
      <DraftBanner />

      <h3>Nothing is being charged today</h3>
      <p>
        <strong>
          This app currently takes no payments, so there is nothing to refund.
        </strong>{' '}
        This policy describes what will apply if and when paid room hosting is
        switched on.
      </p>

      <h3>What the fee would be</h3>
      <p>
        A one-time ₹1 charge to the person creating a room, for hosting that one
        match. Invited players are never charged. A four-player match is charged
        once, not four times.
      </p>

      <h3>When you would get a refund</h3>
      <ul>
        <li>
          <strong>You cancel before the match starts.</strong> Full refund.
        </li>
        <li>
          <strong>The room could not be used</strong> because of a fault on our
          side. Full refund, whether or not the match had started.
        </li>
        <li>
          <strong>You were charged twice for the same room.</strong> The duplicate
          is refunded in full. Our system is built to make this impossible, but
          if it happens we will fix it.
        </li>
        <li>
          <strong>Payment was taken but the room never activated.</strong> Full
          refund, issued automatically.
        </li>
      </ul>

      <h3>When you would not</h3>
      <ul>
        <li>
          The match started and was played. The hosting you paid for was
          delivered.
        </li>
        <li>
          Your friends did not join, but the room was available for you to use.
          [Confirm this position with your lawyer — a consumer forum may view it
          differently.]
        </li>
        <li>You lost the match. The fee is for hosting, not for winning.</li>
      </ul>

      <h3>How to ask</h3>
      <p>
        Email {CONTACT.email} with the room code. We aim to respond within 2
        working days and to process approved refunds within 5–7 working days, to
        the original payment method.
      </p>

      <h3>If you are unhappy with the outcome</h3>
      <p>
        Contact our Grievance Officer: {CONTACT.grievanceOfficer},{' '}
        {CONTACT.grievanceEmail}. You also retain your rights under the Consumer
        Protection Act, 2019.
      </p>
    </>
  );
}
