import { useState } from 'react';
import type { PublicConfig } from '@ludolite/shared';

import { LudoMark } from '../components/Brand.js';
import { Mascot, mascotLine } from '../components/Mascot.js';
import { MuteToggle } from '../components/MuteToggle.js';
import {
  AvatarSheet,
  BadgeGrid,
  DailyMissions,
  PlayerCard,
  StatGrid,
  ThemeSheet,
} from '../components/Progress.js';
import { levelProgress, setAvatar, setTheme, type ProgressState } from '../lib/progress.js';

/**
 * Home.
 *
 * The first screen does three jobs, in this order:
 *
 *   1. Say what this is, and show a character doing something, so the first
 *      impression is a game rather than a form.
 *   2. Get the player into a match in one tap.
 *   3. Show what they have earned, which is what makes the app worth
 *      reopening tomorrow.
 *
 * PRICE IS NOT MENTIONED HERE. Paid hosting is gated off (see
 * docs/COMPLIANCE.md) and every match is currently free, so a headline
 * about ₹1 would advertise something nobody can buy. The fee copy belongs
 * on the create-room screen, where it is decided, and only once the gate is
 * actually open.
 *
 * Progression sits BELOW the play actions on purpose. A home screen that
 * leads with rewards is asking to be farmed; one that leads with "play"
 * treats the rewards as a consequence of playing.
 */
export function Home({
  config,
  progress,
  onProgressChange,
  onOpenProfile,
  onCreate,
  onJoin,
  onPlayComputer,
}: {
  config: PublicConfig | null;
  progress: ProgressState;
  onProgressChange: (next: ProgressState) => void;
  onOpenProfile: () => void;
  onCreate: () => void;
  onJoin: () => void;
  onPlayComputer: () => void;
}) {
  const [sheet, setSheet] = useState<'avatar' | 'theme' | null>(null);
  const [showAll, setShowAll] = useState(false);

  const played = progress.played > 0;
  const { level } = levelProgress(progress.xp);

  return (
    <>
      {/*
        Header: brand on the left, controls on the right. The avatar is the
        profile button -- a face reads as "you" faster than any label -- and
        it is the same character that appears throughout the app.
      */}
      <header className="topbar">
        <div className="topbar-brand">
          <LudoMark size={30} />
          <b>LudoLite</b>
        </div>

        <div className="topbar-actions">
          <MuteToggle />
          <button
            type="button"
            className="avatarbtn"
            onClick={onOpenProfile}
            aria-label="Open your profile"
          >
            <span className="avatarbtn-face" aria-hidden="true">
              {progress.avatar}
            </span>
            <span className="avatarbtn-lvl">{level}</span>
          </button>
        </div>
      </header>

      {/*
        The stage. Four tokens run a lap of the border and the player's own
        character waves from the middle, so the first thing on screen is
        something alive. All decorative and hidden from assistive tech.
      */}
      <div className="stage">
        <div className="stage-track" aria-hidden="true">
          <span className="stage-tok s0" />
          <span className="stage-tok s1" />
          <span className="stage-tok s2" />
          <span className="stage-tok s3" />
        </div>

        <div className="stage-inner">
          <div className="stage-buddy">
            <Mascot avatar={progress.avatar} mood="happy" size={96} />
          </div>

          <h1>Roll. Chase. Win.</h1>
          <p className="sub">
            Private Ludo rooms for you and your friends. Create a room, share the
            code, play.
          </p>

          <p className="stage-says">{mascotLine('idle', progress.played)}</p>
        </div>
      </div>

      <div className="btn-stack">
        <button type="button" className="btn btn-primary btn-rich" onClick={onCreate}>
          <span className="btn-rich-icon" aria-hidden="true">
            🎲
          </span>
          <span className="btn-rich-text">
            <span className="btn-rich-title">Create Private Room</span>
            <span className="btn-rich-sub">Invite friends with a code</span>
          </span>
        </button>
        <button type="button" className="btn btn-ghost btn-rich" onClick={onJoin}>
          <span className="btn-rich-icon" aria-hidden="true">
            🔑
          </span>
          <span className="btn-rich-text">
            <span className="btn-rich-title">Join With Room Code</span>
            <span className="btn-rich-sub">Someone sent you a code</span>
          </span>
        </button>
        {/* Nobody to play with right now is the most common reason someone
            opens and closes a multiplayer game. */}
        <button type="button" className="btn btn-ghost btn-rich" onClick={onPlayComputer}>
          <span className="btn-rich-icon" aria-hidden="true">
            🤖
          </span>
          <span className="btn-rich-text">
            <span className="btn-rich-title">Play the Computer</span>
            <span className="btn-rich-sub">Instant match, no waiting</span>
          </span>
        </button>
      </div>

      <PlayerCard progress={progress} onPickAvatar={() => setSheet('avatar')} />

      <DailyMissions progress={progress} onChange={onProgressChange} />

      {/* Stats are only meaningful once there is something in them. An empty
          grid of zeroes on a first run is noise that makes the app look used
          rather than new. */}
      {played ? (
        <>
          <div className="section">
            <span className="section-title">Your record</span>
            <span className="section-rule" />
            <button type="button" className="linkbtn" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Hide badges' : 'Badges'}
            </button>
          </div>
          <StatGrid progress={progress} />
          {showAll ? <BadgeGrid progress={progress} /> : null}
        </>
      ) : null}

      <div className="section">
        <span className="section-title">Board theme</span>
        <span className="section-rule" />
        <button type="button" className="linkbtn" onClick={() => setSheet('theme')}>
          Change
        </button>
      </div>

      {/*
        The three promises, as compact chips rather than a bordered list.
        They are reassurance, not a feature list, so they should read in a
        glance and then get out of the way.
      */}
      <div className="promise-chips">
        <span className="promise-chip">🚫 No ads</span>
        <span className="promise-chip">🔒 Private rooms</span>
        <span className="promise-chip">🏆 No cash prizes</span>
      </div>

      {config && !config.paidHostingEnabled ? (
        <p className="footnote">Every match is free right now.</p>
      ) : null}

      {sheet === 'avatar' ? (
        <AvatarSheet
          current={progress.avatar}
          onPick={(a) => onProgressChange(setAvatar(progress, a))}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'theme' ? (
        <ThemeSheet
          progress={progress}
          onPick={(id) => onProgressChange(setTheme(progress, id))}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </>
  );
}
