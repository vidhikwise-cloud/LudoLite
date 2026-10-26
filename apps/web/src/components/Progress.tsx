/**
 * Progression UI: player card, daily missions, stats, achievements, pickers.
 *
 * These components only ever render what `lib/progress.ts` computes. They
 * hold no progression rules of their own, so there is one place where the
 * reward economy lives and the UI cannot drift from it.
 *
 * On the deliberate absence of a coin balance, and on why streaks are shown
 * as progress rather than as something at risk, see the header of
 * lib/progress.ts.
 */

import { useEffect, useState } from 'react';

import {
  ACHIEVEMENTS,
  AVATARS,
  MISSIONS,
  THEMES,
  TITLES,
  claimMission,
  levelProgress,
  titleForLevel,
  winRate,
  type Mission,
  type MissionId,
  type ProgressState,
} from '../lib/progress.js';

/* -------------------------------------------------------------------------- */
/* Player card                                                                */
/* -------------------------------------------------------------------------- */

export function PlayerCard({
  progress,
  onPickAvatar,
}: {
  progress: ProgressState;
  onPickAvatar: () => void;
}) {
  const { level, into, need, pct } = levelProgress(progress.xp);

  // The bar animates from 0 on mount so the fill is always a movement rather
  // than a static block -- the same reason a progress bar feels rewarding at
  // all. Width is transitioned in CSS; this just supplies the target.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setShown(pct), 60);
    return () => window.clearTimeout(t);
  }, [pct]);

  return (
    <div className="playercard">
      <button
        type="button"
        className={`avatar frame-${progress.frame}`}
        onClick={onPickAvatar}
        aria-label="Change your avatar"
      >
        {progress.avatar}
      </button>
      <div className="playercard-body">
        <div className="playercard-top">
          {/*
            A chosen title replaces the automatic level one. The level title
            says how far you have come; a chosen title says something about
            how you play, and only one of them should be on the card.
          */}
          <span className="playercard-title">
            {TITLES.find((t) => t.id === progress.title && t.id !== 'none')?.name ??
              titleForLevel(level)}
          </span>
          <span className="playercard-level">Level {level}</span>
        </div>
        <div
          className="xpbar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={need}
          aria-valuenow={into}
          aria-label={`${into} of ${need} XP to level ${level + 1}`}
        >
          <div className="xpbar-fill" style={{ width: `${shown}%` }} />
        </div>
        <div className="xpbar-label">
          <span>{progress.xp.toLocaleString('en-IN')} XP</span>
          <span>
            {need - into} to level {level + 1}
          </span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Daily missions                                                             */
/* -------------------------------------------------------------------------- */

export function DailyMissions({
  progress,
  onChange,
}: {
  progress: ProgressState;
  onChange: (next: ProgressState) => void;
}) {
  const done = progress.missions.filter((m) => {
    const def = MISSIONS.find((d) => d.id === m.id);
    return def && m.done >= def.target;
  }).length;

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Today&rsquo;s missions</span>
        {progress.streakDays > 0 ? (
          <span className="streak">
            🔥 {progress.streakDays} day{progress.streakDays === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="panel-title">{done}/3 done</span>
        )}
      </div>

      {MISSIONS.map((def) => {
        const mp = progress.missions.find((m) => m.id === def.id);
        const got = mp?.done ?? 0;
        const complete = got >= def.target;
        return (
          <MissionRow
            key={def.id}
            def={def}
            done={got}
            complete={complete}
            claimed={mp?.claimed === true}
            onClaim={() => onChange(claimMission(progress, def.id))}
          />
        );
      })}

      {/*
        The weekly track fills as days are completed and never empties on a
        missed day. It is a record of what was done, not a countdown.
      */}
      <div className="weektrack" aria-label={`${progress.weekClaimed} of 7 days completed`}>
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className={`weekpip${i < progress.weekClaimed ? ' on' : ''}`} />
        ))}
      </div>
    </div>
  );
}

function MissionRow({
  def,
  done,
  complete,
  claimed,
  onClaim,
}: {
  def: Mission;
  done: number;
  complete: boolean;
  claimed: boolean;
  onClaim: () => void;
}) {
  const pct = Math.min(100, Math.round((done / def.target) * 100));
  return (
    <div className={`mission${complete ? ' done' : ''}`}>
      <span className="mission-check" aria-hidden="true">
        {complete ? '✓' : done}
      </span>
      <div className="mission-body">
        <div className="mission-label">{def.label}</div>
        <div className="mission-track">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      {complete && !claimed ? (
        <button type="button" className="mission-xp" onClick={onClaim}>
          Claim +{def.xp}
        </button>
      ) : (
        <span className={`mission-xp${claimed ? ' claimed' : ''}`}>
          {claimed ? 'Claimed' : `+${def.xp}`}
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stats                                                                      */
/* -------------------------------------------------------------------------- */

export function StatGrid({ progress }: { progress: ProgressState }) {
  const stats: ReadonlyArray<readonly [string, string | number]> = [
    ['Played', progress.played],
    ['Won', progress.won],
    ['Win rate', `${winRate(progress)}%`],
    ['Cuts', progress.captures],
    ['Best streak', progress.bestWinStreak],
    ['Home', progress.finished],
  ];
  return (
    <div className="statgrid">
      {stats.map(([label, value]) => (
        <div className="stat" key={label}>
          <div className="stat-value">{value}</div>
          <div className="stat-label">{label}</div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Achievements                                                               */
/* -------------------------------------------------------------------------- */

export function BadgeGrid({ progress }: { progress: ProgressState }) {
  return (
    <div className="badgegrid">
      {ACHIEVEMENTS.map((a) => {
        const got = progress.achievements.includes(a.id);
        return (
          <div key={a.id} className={`badge ${got ? 'unlocked' : 'locked'}`}>
            <div className="badge-icon" aria-hidden="true">
              {a.icon}
            </div>
            <div className="badge-name">{a.name}</div>
            <div className="badge-blurb">{a.blurb}</div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pickers                                                                    */
/* -------------------------------------------------------------------------- */

export function AvatarSheet({
  current,
  onPick,
  onClose,
}: {
  current: string;
  onPick: (a: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Choose your avatar" onClose={onClose}>
      <div className="avatarpick">
        {AVATARS.map((a) => (
          <button
            key={a}
            type="button"
            className={a === current ? 'on' : ''}
            onClick={() => {
              onPick(a);
              onClose();
            }}
            aria-label={`Avatar ${a}`}
            aria-pressed={a === current}
          >
            {a}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function ThemeSheet({
  progress,
  onPick,
  onClose,
}: {
  progress: ProgressState;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { level } = levelProgress(progress.xp);
  return (
    <Sheet title="Board theme" onClose={onClose}>
      <div className="themelist">
        {THEMES.map((t) => {
          const unlocked = progress.themes.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              className={`themerow${t.id === progress.theme ? ' on' : ''}`}
              disabled={!unlocked}
              onClick={() => {
                onPick(t.id);
                onClose();
              }}
            >
              <span className={`themeswatch ${t.id}`} aria-hidden="true" />
              <span>
                <span className="themename">{t.name}</span>
                <span className="themeblurb">{t.blurb}</span>
              </span>
              {!unlocked ? (
                <span className="themelock">
                  Level {t.level}
                  {level < t.level ? '' : ' ✓'}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {/*
        Stated plainly because it is a compliance property, not a limitation
        to apologise for: cosmetics are earned by playing and are not for
        sale. Selling them in the Android build would engage Play Billing
        policy -- see docs/COMPLIANCE.md.
      */}
      <p className="footnote" style={{ marginTop: 14, paddingTop: 0 }}>
        Themes unlock by playing. Nothing here is for sale.
      </p>
    </Sheet>
  );
}

function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  // Escape closes, matching the backdrop click. A sheet that can only be
  // dismissed by hitting a small target is a trap on desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Reward toasts                                                              */
/* -------------------------------------------------------------------------- */

export interface RewardToast {
  readonly id: string;
  readonly icon: string;
  readonly title: string;
  readonly sub: string;
}

export function RewardToasts({ toasts }: { toasts: readonly RewardToast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="rewards" aria-live="polite">
      {toasts.map((t) => (
        <div className="reward" key={t.id}>
          <span className="reward-icon" aria-hidden="true">
            {t.icon}
          </span>
          <span>
            <span className="reward-title">{t.title}</span>
            <br />
            <span className="reward-sub">{t.sub}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Post-match XP tally                                                        */
/* -------------------------------------------------------------------------- */

export interface TallyLine {
  readonly icon: string;
  readonly label: string;
  readonly amount: number;
}

/**
 * The reward moment at the end of a match.
 *
 * The total counts up from zero and the bar fills behind it, because
 * watching a number climb is most of what makes a reward feel like one --
 * the same figure printed statically reads as a receipt.
 *
 * The count is driven by requestAnimationFrame against elapsed time rather
 * than a fixed per-frame step, so it takes the same ~900ms on a slow device
 * as on a fast one instead of crawling.
 */
export function XpTally({
  lines,
  total,
  progress,
}: {
  lines: readonly TallyLine[];
  total: number;
  progress: ProgressState;
}) {
  const [shownTotal, setShownTotal] = useState(0);
  const [barPct, setBarPct] = useState(0);

  const { level, into, need, pct } = levelProgress(progress.xp);

  useEffect(() => {
    if (total <= 0) {
      setShownTotal(0);
      return;
    }
    const DURATION = 900;
    const START_DELAY = 700; // let the crest land first
    let raf = 0;
    let startedAt = 0;

    const step = (now: number) => {
      if (startedAt === 0) startedAt = now;
      const elapsed = now - startedAt;
      // Ease out: fast at first, settling at the end.
      const t = Math.min(1, elapsed / DURATION);
      const eased = 1 - Math.pow(1 - t, 3);
      setShownTotal(Math.round(total * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };

    const timer = window.setTimeout(() => {
      raf = requestAnimationFrame(step);
      setBarPct(pct);
    }, START_DELAY);

    return () => {
      window.clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [total, pct]);

  return (
    <div className="xptally">
      <div className="xptally-value">+{shownTotal}</div>
      <div className="xptally-label">Experience earned</div>

      <div className="xptally-rows">
        {lines.map((l, i) => (
          <div
            className="xptally-row"
            key={`${l.label}-${i}`}
            /* Each row arrives just after the one above it. */
            style={{ animationDelay: `${0.8 + i * 0.12}s` }}
          >
            <span aria-hidden="true">{l.icon}</span>
            <span>{l.label}</span>
            <span className="amt">+{l.amount}</span>
          </div>
        ))}
      </div>

      <div
        className="xptally-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={need}
        aria-valuenow={into}
      >
        <span style={{ width: `${barPct}%` }} />
      </div>
      <div className="xptally-level">
        Level {level} · {need - into} XP to level {level + 1}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Quick reactions                                                            */
/* -------------------------------------------------------------------------- */

export const REACTIONS = ['😂', '😈', '🔥', '👏', '😮', '🙏'] as const;

/**
 * Reactions are local-only in this build.
 *
 * Broadcasting them needs a server event and moderation thinking (a reaction
 * is user-generated content aimed at another player), so this ships as
 * expressive feedback for the sender rather than pretending to be social.
 * The emoji set is fixed and non-textual, which is what keeps it safe.
 */
export function ReactionBar({ onReact }: { onReact: (emoji: string) => void }) {
  return (
    <div className="reactbar">
      {REACTIONS.map((r) => (
        <button key={r} type="button" onClick={() => onReact(r)} aria-label={`React ${r}`}>
          {r}
        </button>
      ))}
    </div>
  );
}
