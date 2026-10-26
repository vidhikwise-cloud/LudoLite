import { useState } from 'react';
import type { PublicConfig } from '@ludolite/shared';

import { BrandBar, TickIcon } from '../components/Brand.js';
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
 *   1. Say what this is and what it costs. The headline carries the price so
 *      nobody discovers the fee late, and "no cash prizes" sits high because
 *      the Act's test turns on whether players can win money -- a product
 *      that never pays out should say so where a reviewer lands first.
 *   2. Get the player into a match in one tap.
 *   3. Show what they have earned, which is what makes the app worth
 *      reopening tomorrow.
 *
 * Progression sits BELOW the play actions on purpose. A home screen that
 * leads with rewards is asking to be farmed; one that leads with "play"
 * treats the rewards as a consequence of playing, which is the honest
 * relationship and the one that survives contact with a bored user.
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

  return (
    <>
      <BrandBar>
        {/* The avatar chip is the profile entry point: a face and a level
            read as "you" far faster than a labelled button would. */}
        <button
          type="button"
          className="profilebtn"
          onClick={onOpenProfile}
          aria-label="Open your profile"
        >
          <span className="profilebtn-face" aria-hidden="true">
            {progress.avatar}
          </span>
          <span className="profilebtn-lvl">Lv {levelProgress(progress.xp).level}</span>
        </button>
        <MuteToggle />
      </BrandBar>

      {/*
        The stage. Four tokens run a lap of the border while the mark floats
        above the headline, so the first thing on screen is motion rather
        than a paragraph. All of it is decorative and hidden from assistive
        tech -- the heading and the buttons are the actual content.
      */}
      <div className="stage">
        <div className="stage-track" aria-hidden="true">
          <span className="stage-tok s0" />
          <span className="stage-tok s1" />
          <span className="stage-tok s2" />
          <span className="stage-tok s3" />
        </div>

        <div className="stage-inner">
          <div className="stage-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>

          <h1>
            Ludo With Friends.
            <br />
            <span className="rupee">₹1</span> per hosted match.
          </h1>
          <p className="sub">
            Create a room, share the code, play. Only the host pays — everyone else joins free.
          </p>

          <div className="stage-chips">
            <span className="stage-chip">🚫 Zero ads</span>
            <span className="stage-chip">🔒 Private rooms</span>
            <span className="stage-chip">🎲 No cash prizes</span>
          </div>
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
            <span className="btn-rich-title">Play Against the Computer</span>
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

      <div className="promises">
        <div className="promise" style={{ color: 'var(--green)' }}>
          <TickIcon />
          <span style={{ color: 'var(--ink-2)' }}>
            <b style={{ color: 'var(--ink)' }}>Zero paid ads.</b> No banners, no forced videos.
          </span>
        </div>
        <div className="promise" style={{ color: 'var(--green)' }}>
          <TickIcon />
          <span style={{ color: 'var(--ink-2)' }}>
            <b style={{ color: 'var(--ink)' }}>Only the host pays.</b> Friends join free.
          </span>
        </div>
        <div className="promise" style={{ color: 'var(--green)' }}>
          <TickIcon />
          <span style={{ color: 'var(--ink-2)' }}>
            <b style={{ color: 'var(--ink)' }}>No cash prizes.</b> Play for bragging rights.
          </span>
        </div>
      </div>

      {config && !config.paidHostingEnabled ? (
        <p className="footnote">
          Free private matches are available while paid hosting is being prepared.
        </p>
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
