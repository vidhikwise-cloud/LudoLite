import { formatPaise, type PublicConfig } from '@ludolite/shared';
import { useState } from 'react';

import { InfoIcon } from '../components/Brand.js';

/**
 * Create a private room.
 *
 * Two states, decided solely by `config.paidHostingEnabled`, which comes from
 * the server:
 *
 *  - Gate shut: a free room. No fee line, no Confirm and Pay button, and no
 *    greyed-out payment control. A disabled payment button still implies a
 *    payment flow exists, so none is rendered at all.
 *  - Gate open: the fee, what it buys, the refund terms, and an explicit
 *    consent checkbox that blocks the button until ticked.
 */
export function CreateRoom({
  config,
  busy,
  error,
  onBack,
  initialName,
  onCreate,
}: {
  config: PublicConfig;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  /** Pre-filled from the player's profile so the field is never empty. */
  initialName: string;
  onCreate: (input: {
    seatCount: 2 | 4;
    displayName: string;
    funding: 'free' | 'paid';
    feeConsent?: {
      acceptedTerms: boolean;
      acknowledgedNoPrize: boolean;
      displayedAmountPaise: number;
    };
  }) => void;
}) {
  const [seatCount, setSeatCount] = useState<2 | 4>(4);
  const [displayName, setDisplayName] = useState(initialName);
  const [consented, setConsented] = useState(false);

  const paid = config.paidHostingEnabled;
  const fee = formatPaise(config.hostingFeePaise);
  const nameOk = displayName.trim().length > 0;
  const canSubmit = nameOk && !busy && (!paid || consented);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    onCreate({
      seatCount,
      displayName: displayName.trim(),
      funding: paid ? 'paid' : 'free',
      ...(paid
        ? {
            feeConsent: {
              acceptedTerms: true,
              acknowledgedNoPrize: true,
              displayedAmountPaise: config.hostingFeePaise,
            },
          }
        : {}),
    });
  }

  return (
    <form onSubmit={submit}>
      <button type="button" className="backbtn" onClick={onBack} aria-label="Go back">
        <span aria-hidden="true">←</span>
      </button>

      <h2 className="screen-title">Create a private room</h2>

      {/* A sandbox payment must never be mistakable for a real one. */}
      {paid && config.paymentsAreTestMode ? (
        <p className="testbanner" style={{ marginBottom: 18 }}>
          Test mode — no real money
        </p>
      ) : null}

      {!paid ? (
        <div className="notice n-off" style={{ marginBottom: 20 }}>
          <InfoIcon />
          <span>Free private matches are available while paid hosting is being prepared.</span>
        </div>
      ) : null}

      <div className="field">
        <label className="lbl" htmlFor="displayName">
          Your name
        </label>
        <input
          id="displayName"
          className="input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="What should friends call you?"
          maxLength={24}
          autoComplete="nickname"
        />
      </div>

      <div className="field">
        <span className="lbl" id="seatcount-label">
          Number of players
        </span>
        <div className="seatpick" role="radiogroup" aria-labelledby="seatcount-label">
          <button
            type="button"
            role="radio"
            aria-checked={seatCount === 2}
            className={`seat${seatCount === 2 ? ' on' : ''}`}
            onClick={() => setSeatCount(2)}
          >
            <span className="n">2</span>
            <span className="t">Head to head</span>
            <span className="tokens">
              <i style={{ background: 'var(--red)' }} />
              <i style={{ background: 'var(--green)' }} />
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={seatCount === 4}
            className={`seat${seatCount === 4 ? ' on' : ''}`}
            onClick={() => setSeatCount(4)}
          >
            <span className="n">4</span>
            <span className="t">Full board</span>
            <span className="tokens">
              <i style={{ background: 'var(--red)' }} />
              <i style={{ background: 'var(--green)' }} />
              <i style={{ background: 'var(--yellow)' }} />
              <i style={{ background: 'var(--blue)' }} />
            </span>
          </button>
        </div>
      </div>

      {paid ? (
        <>
          <div className="receipt">
            <div className="receipt-row">
              <span className="k">Hosting fee — you pay once</span>
              <span className="v">₹{fee}</span>
            </div>
            <div className="receipt-row free">
              <span className="k">
                Your {seatCount - 1} friend{seatCount - 1 === 1 ? '' : 's'} pay
              </span>
              <span className="v">₹0.00</span>
            </div>
            <div className="receipt-row total">
              <span className="k">Total charged today</span>
              <span className="v">₹{fee}</span>
            </div>
          </div>

          <div className="finewrap">
            <b>What ₹{fee} buys</b>
            <ul>
              <li>Access to host this one match. It is not a stake, entry pool, or deposit.</li>
              <li>There is no prize money. Winning returns nothing but the result.</li>
              <li>Rejoin this room any time — you are never charged twice.</li>
              <li>Room unusable or never started? Refunded to source in 5–7 working days.</li>
              <li>
                Cancel before the first move for a full refund, within{' '}
                {config.refundWindowMinutes} minutes of creating the room.
              </li>
            </ul>
          </div>

          <label className="consent">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
            />
            <span>
              I understand I am paying ₹{fee} to host this match, that this is not a bet or a
              prize entry, and I accept the Terms and Refund Policy.
            </span>
          </label>
        </>
      ) : (
        <div className="receipt">
          <div className="receipt-row free">
            <span className="k">Hosting fee</span>
            <span className="v">FREE</span>
          </div>
          <div className="receipt-row free">
            <span className="k">Friends joining</span>
            <span className="v">FREE</span>
          </div>
        </div>
      )}

      {error ? (
        <div className="notice n-danger" style={{ marginBottom: 16 }}>
          <InfoIcon />
          <span>{error}</span>
        </div>
      ) : null}

      <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
        {busy ? 'Working…' : paid ? 'Confirm and Pay' : 'Create Free Room'}
        {paid && !busy ? <span className="sz">₹{fee}</span> : null}
      </button>

      {/* Visible in development only — the server withholds these in production. */}
      {!paid && config.paidHostingBlockers.length > 0 ? (
        <ul className="blockers" style={{ marginTop: 16 }}>
          {config.paidHostingBlockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
