import { useEffect, useState } from 'react';
import type { PublicConfig } from '@ludolite/shared';

import { AvatarSheet } from '../components/Progress.js';
import { fetchPresence } from '../lib/api.js';
import { ripple } from '../lib/ripple.js';
import {
  ALL_MISSIONS_XP,
  MISSIONS,
  levelProgress,
  setAvatar,
  titleForLevel,
  type ProgressState,
} from '../lib/progress.js';

/**
 * Home, as a dashboard.
 *
 * The previous version was one scrolling column: a hero, three identical
 * full-width buttons, a player card, a missions panel, a stat grid and a row
 * of chips. Everything had equal weight, so "what do I tap" had no answer,
 * and the progression that makes the app worth reopening sat below the fold.
 *
 * This is a dashboard instead. ONE tile dominates -- creating a room is what
 * the app is for -- with the two alternatives beside it at half size. The
 * live strip says the app has people in it. Missions compress into a
 * horizontal rail readable at a glance rather than three stacked rows.
 *
 * Progression still sits BELOW the play actions, for the same reason as
 * before: a home screen that leads with rewards is asking to be farmed.
 *
 * PRICE IS NOT MENTIONED HERE. Paid hosting is gated off (see
 * docs/COMPLIANCE.md) and every match is currently free, so a headline about
 * a fee would advertise something nobody can buy.
 */
export function Home({
  config,
  progress,
  onProgressChange,
  onCreate,
  onJoin,
  onPlayComputer,
}: {
  config: PublicConfig | null;
  progress: ProgressState;
  onProgressChange: (next: ProgressState) => void;
  onCreate: () => void;
  onJoin: () => void;
  onPlayComputer: () => void;
}) {
  const [sheet, setSheet] = useState(false);
  const [online, setOnline] = useState<number | null>(null);

  const { level, into, need } = levelProgress(progress.xp);

  // A real figure from the server, refreshed while the page is open. Null
  // until it arrives, so the chip is absent rather than showing a zero that
  // is really just a slow request.
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchPresence()
        .then((n) => {
          if (alive) setOnline(n);
        })
        .catch(() => {
          // Decorative. A failed poll keeps the last value rather than
          // blanking the chip or surfacing an error for something nobody
          // asked for.
        });
    };
    load();
    const id = window.setInterval(load, 30000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const doneCount = progress.missions.filter((m) => {
    const def = MISSIONS.find((d) => d.id === m.id);
    return def && m.done >= def.target;
  }).length;

  return (
    <>
      {/* The player, not a brand bar. Who you are is more useful at the top
          of a dashboard than the app's own name, which you already know. */}
      <header className="dash-bar an-d">
        <button
          type="button"
          className="dash-me"
          onClick={() => setSheet(true)}
          aria-label="Change your character"
        >
          <span aria-hidden="true">{progress.avatar}</span>
        </button>
        <span className="dash-who an dl1">
          <b>{progress.name}</b>
          <span>
            {progress.winStreak > 1 ? (
              <>
                {progress.winStreak}-match win streak{' '}
                <i className="flame" aria-hidden="true">
                  🔥
                </i>
              </>
            ) : (
              titleForLevel(level)
            )}
          </span>
        </span>
        <span className="dash-lvl an dl2">LV {level}</span>
      </header>

      {/* One dominant action, two alternatives. */}
      <div className="tiles">
        <button type="button" className="tile tile-hero an-f dl2 rp" onClick={onCreate} onPointerDown={ripple}>
          <span className="orb orb-1" aria-hidden="true">
            🎲
          </span>
          <span className="orb orb-2" aria-hidden="true">
            ✨
          </span>
          <span className="orb orb-3" aria-hidden="true">
            🎯
          </span>
          <span className="tile-ic" aria-hidden="true">
            🎲
          </span>
          <span className="tile-k">Start a room</span>
          <span className="tile-s">Invite friends with a 4-letter code</span>
        </button>

        <button type="button" className="tile tile-plain an dl4 rp rp-dark" onClick={onJoin} onPointerDown={ripple}>
          <span className="tile-ic" aria-hidden="true">
            🔑
          </span>
          <span className="tile-k">Join</span>
          <span className="tile-s">Enter a code</span>
        </button>

        {/* Nobody to play with right now is the most common reason someone
            opens and closes a multiplayer game. */}
        <button type="button" className="tile tile-dark an dl5 rp" onClick={onPlayComputer} onPointerDown={ripple}>
          <span className="tile-ic" aria-hidden="true">
            🤖
          </span>
          <span className="tile-k">Vs computer</span>
          <span className="tile-s">No waiting</span>
        </button>
      </div>

      <div className="livestrip">
        {online !== null ? (
          <span className="lchip an dl6">
            <i className="ldot live" aria-hidden="true" />
            <span className="num">{online.toLocaleString('en-IN')}</span>
            {online === 1 ? ' playing now' : ' playing now'}
          </span>
        ) : null}
        {progress.won > 0 ? (
          <span className="lchip an dl7">
            🏆 <span className="num">{progress.won.toLocaleString('en-IN')}</span> wins
          </span>
        ) : null}
        <span className="lchip an dl8">🚫 No ads</span>
        <span className="lchip an dl9">🏅 No cash prizes</span>
      </div>

      {/* Missions as a rail: three steps plus the all-three bonus, read in
          one glance rather than as three stacked rows. */}
      <div className="khead an dl8">
        <b>Today</b>
        <span>
          {doneCount} of {MISSIONS.length} done
        </span>
      </div>

      <div className="steprail an dl9">
        {MISSIONS.map((def) => {
          const mp = progress.missions.find((m) => m.id === def.id);
          const got = mp?.done ?? 0;
          const complete = got >= def.target;
          const current = !complete && got > 0;

          return (
            <div
              key={def.id}
              className={`stepx${complete ? ' done' : current ? ' now' : ''}`}
              title={`${def.label} — ${def.hint}`}
            >
              <span className="bar" aria-hidden="true" />
              <span className="bub" aria-hidden="true">
                {complete ? '✓' : current ? '⚔' : '○'}
              </span>
              <span className="lb">{shortLabel(def.id)}</span>
            </div>
          );
        })}
        <div className={`stepx${doneCount === MISSIONS.length ? ' done' : ''}`}>
          <span className="bub" aria-hidden="true">
            🎁
          </span>
          <span className="lb">+{ALL_MISSIONS_XP}</span>
        </div>
      </div>

      <div className="xpline an dl10">
        <span className="track" aria-hidden="true">
          <i style={{ width: `${Math.round((into / need) * 100)}%` }} />
        </span>
        <b>
          <span className="num">{progress.xp.toLocaleString('en-IN')}</span> XP
        </b>
      </div>

      {config && !config.paidHostingEnabled ? (
        <p className="footnote">Every match is free right now.</p>
      ) : null}

      {sheet ? (
        <AvatarSheet
          current={progress.avatar}
          onPick={(a) => onProgressChange(setAvatar(progress, a))}
          onClose={() => setSheet(false)}
        />
      ) : null}
    </>
  );
}

/** Rail labels have ~60px of width, so the full mission text will not fit. */
function shortLabel(id: string): string {
  if (id === 'play_two') return 'Play 2';
  if (id === 'win_one') return 'Win 1';
  if (id === 'capture_three') return 'Cut 3';
  return id;
}
