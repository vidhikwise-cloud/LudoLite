import { useState } from 'react';
import type { PublicConfig } from '@ludolite/shared';

import { isMuted, setMuted } from '../lib/feedback.js';
import { ripple } from '../lib/ripple.js';
import { levelProgress, type ProgressState } from '../lib/progress.js';

/**
 * Settings.
 *
 * A new destination, created because the tab bar needs a home for the
 * controls that used to be scattered: the sound toggle lived in the top bar,
 * the tour replay was buried at the bottom of Profile, and the legal links
 * were a row of small text in the app's footer on every screen.
 *
 * The legal links are NOT optional -- a public service needs them reachable,
 * and Play Store review checks for them -- so gathering them here means they
 * are findable rather than incidental.
 *
 * The paid-hosting state is shown as plain fact, not as an upsell. While the
 * gate is shut this screen says every match is free; it never renders a
 * price, a fee line, or a disabled pay control. See docs/COMPLIANCE.md.
 */
export function Settings({
  config,
  progress,
  onReplayTour,
  onOpenLegal,
}: {
  config: PublicConfig | null;
  progress: ProgressState;
  onReplayTour: () => void;
  onOpenLegal: (page: 'privacy' | 'terms' | 'refund') => void;
}) {
  const [muted, setLocal] = useState(isMuted);
  const { level } = levelProgress(progress.xp);

  function toggleSound(): void {
    const next = !muted;
    setMuted(next);
    setLocal(next);
  }

  return (
    <>
      <header className="dash-bar an-d">
        <span className="dash-me" aria-hidden="true">
          ⚙️
        </span>
        <span className="dash-who an dl1">
          <b>Settings</b>
          <span>Sound, help and the legal bits</span>
        </span>
        <span className="dash-lvl an dl2">LV {level}</span>
      </header>

      <div className="khead an dl3">
        <b>Sound</b>
      </div>
      <button
        type="button"
        className="setrow an dl3 rp rp-dark"
        onClick={toggleSound}
        onPointerDown={ripple}
        aria-pressed={!muted}
      >
        <em aria-hidden="true">{muted ? '🔇' : '🔊'}</em>
        <span className="sm">
          <b>{muted ? 'Sound is off' : 'Sound is on'}</b>
          <span>Dice, moves and arrivals. Tap to {muted ? 'turn on' : 'turn off'}.</span>
        </span>
        <span className="chev" aria-hidden="true">
          {muted ? '○' : '●'}
        </span>
      </button>

      <div className="khead an dl4">
        <b>Help</b>
      </div>
      <button type="button" className="setrow an dl4 rp rp-dark" onClick={onReplayTour} onPointerDown={ripple}>
        <em aria-hidden="true">🧭</em>
        <span className="sm">
          <b>Show the welcome tour</b>
          <span>How rooms, codes and the board work</span>
        </span>
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </button>

      <div className="khead an dl5">
        <b>Legal</b>
      </div>
      <button type="button" className="setrow an dl5 rp rp-dark" onClick={() => onOpenLegal('privacy')} onPointerDown={ripple}>
        <em aria-hidden="true">🔒</em>
        <span className="sm">
          <b>Privacy</b>
          <span>What is stored, and where</span>
        </span>
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </button>
      <button type="button" className="setrow an dl6 rp rp-dark" onClick={() => onOpenLegal('terms')} onPointerDown={ripple}>
        <em aria-hidden="true">📄</em>
        <span className="sm">
          <b>Terms</b>
          <span>The rules of using this app</span>
        </span>
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </button>
      <button type="button" className="setrow an dl7 rp rp-dark" onClick={() => onOpenLegal('refund')} onPointerDown={ripple}>
        <em aria-hidden="true">↩️</em>
        <span className="sm">
          <b>Refunds</b>
          <span>If hosting is ever charged for</span>
        </span>
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </button>

      {/*
        The state of the money gate, as a statement of fact.

        While paid hosting is off this is the whole truth and costs nothing
        to say. It deliberately does not hint at a future price, because a
        "coming soon" for something with no legal approval would be a claim
        the app is not in a position to make.
      */}
      {config && !config.paidHostingEnabled ? (
        <div className="setrow an dl8" style={{ cursor: 'default' }}>
          <em aria-hidden="true">🎁</em>
          <span className="sm">
            <b>Every match is free</b>
            <span>No ads, no subscriptions, and no cash prizes.</span>
          </span>
        </div>
      ) : null}

      <p className="footnote">
        Your name, character and progress live on this device only. There is no
        account to sign in to, and nothing is uploaded.
      </p>
    </>
  );
}
