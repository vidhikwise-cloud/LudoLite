import { useState } from 'react';

import { ripple } from '../lib/ripple.js';
import {
  AVATARS,
  CELEBRATIONS,
  FRAMES,
  MAX_NAME,
  PAWNS,
  THEMES,
  TITLES,
  levelProgress,
  randomName,
  setAvatar,
  setCelebration,
  setChosenTitle,
  setFrame,
  setName,
  setPawn,
  setTheme,
  xpForLevel,
  type Cosmetic,
  type ProgressState,
} from '../lib/progress.js';

/**
 * Locker.
 *
 * Identity in one place: the name, the character, and every cosmetic in the
 * game. This replaces the old Unlocks screen, which listed items as text
 * rows -- a poor fit for things whose whole point is how they look.
 *
 * Items are a grid of cards instead, and a locked card STATES ITS PRICE IN
 * LEVELS right on its face. That is the most important detail on the screen:
 * a locked item with no stated condition reads as "buy this", while the same
 * item marked "LV 6" reads as a goal. The second is the true one here --
 * nothing in this app is purchasable -- so it is what the card says.
 */
export function Locker({
  progress,
  onProgressChange,
}: {
  progress: ProgressState;
  onProgressChange: (next: ProgressState) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(progress.name);

  const { level } = levelProgress(progress.xp);

  function commitName(): void {
    const trimmed = draft.trim();
    // An empty field keeps the existing name rather than leaving the player
    // nameless -- the same reason the field is pre-filled in the first place.
    if (trimmed === '') setDraft(progress.name);
    else onProgressChange(setName(progress, trimmed));
    setEditing(false);
  }

  const sections: ReadonlyArray<{
    readonly title: string;
    readonly items: readonly Cosmetic[];
    readonly current: string;
    readonly choose: (id: string) => void;
  }> = [
    { title: 'Pawns', items: PAWNS, current: progress.pawn, choose: (id) => onProgressChange(setPawn(progress, id)) },
    { title: 'Boards', items: THEMES, current: progress.theme, choose: (id) => onProgressChange(setTheme(progress, id)) },
    { title: 'Card frames', items: FRAMES, current: progress.frame, choose: (id) => onProgressChange(setFrame(progress, id)) },
    { title: 'Celebrations', items: CELEBRATIONS, current: progress.celebration, choose: (id) => onProgressChange(setCelebration(progress, id)) },
    { title: 'Titles', items: TITLES, current: progress.title, choose: (id) => onProgressChange(setChosenTitle(progress, id)) },
  ];

  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const earned = sections.reduce((n, s) => n + s.items.filter((i) => level >= i.level).length, 0);

  return (
    <>
      <header className="dash-bar an-d">
        <span className="dash-me" aria-hidden="true">
          {progress.avatar}
        </span>
        <span className="dash-who an dl1">
          <b>Locker</b>
          <span>
            {earned} of {total} unlocked
          </span>
        </span>
        <span className="dash-lvl an dl2">LV {level}</span>
      </header>

      {/* --- name ---------------------------------------------------------- */}
      <div className="khead an dl3">
        <b>Your name</b>
      </div>
      {editing ? (
        <div className="namerow an dl3">
          <input
            className="input"
            value={draft}
            maxLength={MAX_NAME}
            autoFocus
            aria-label="Display name"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') {
                setDraft(progress.name);
                setEditing(false);
              }
            }}
          />
          {/* Rerolling is the fastest route to a name someone likes:
              picking from suggestions beats inventing one. */}
          <button
            type="button"
            className="btn btn-ghost namedice"
            onClick={() => setDraft(randomName())}
            aria-label="Suggest another name"
          >
            🎲
          </button>
          <button type="button" className="btn btn-primary namesave" onClick={commitName}>
            Save
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="setrow an dl3"
          onClick={() => {
            setDraft(progress.name);
            setEditing(true);
          }}
        >
          <em aria-hidden="true">✏️</em>
          <span className="sm">
            <b>{progress.name}</b>
            <span>Tap to rename</span>
          </span>
          <span className="chev" aria-hidden="true">
            ›
          </span>
        </button>
      )}

      {/* --- character ----------------------------------------------------- */}
      <div className="khead an dl4">
        <b>Character</b>
      </div>
      <div className="lockgrid">
        {AVATARS.map((a, i) => (
          <button
            key={a}
            type="button"
            className={`lockcard rp rp-dark${a === progress.avatar ? ' equipped' : ''}`}
            style={{ animationDelay: `${0.22 + i * 0.03}s` }}
            onClick={() => onProgressChange(setAvatar(progress, a))}
            onPointerDown={ripple}
          >
            <em aria-hidden="true">{a}</em>
            <span className="lr">{a === progress.avatar ? 'Equipped' : 'Tap to use'}</span>
          </button>
        ))}
      </div>

      {/* --- cosmetics ----------------------------------------------------- */}
      {sections.map((section) => (
        <div key={section.title}>
          <div className="khead an dl5">
            <b>{section.title}</b>
            <span>{section.items.filter((i) => level >= i.level).length} of {section.items.length}</span>
          </div>

          <div className="lockgrid">
            {section.items.map((item, i) => {
              const locked = level < item.level;
              const active = item.id === section.current;
              const away = locked ? Math.max(0, xpForLevel(item.level) - progress.xp) : 0;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`lockcard rp rp-dark${active ? ' equipped' : ''}`}
                  style={{ animationDelay: `${0.24 + i * 0.03}s` }}
                  disabled={locked}
                  onClick={() => section.choose(item.id)}
                  onPointerDown={ripple}
                  title={locked ? `${item.blurb} — ${away.toLocaleString('en-IN')} XP away` : item.blurb}
                >
                  <em aria-hidden="true">{locked ? '🔒' : iconFor(section.title)}</em>
                  <span className="ln">{item.name}</span>
                  {/* The requirement, on the face of the card. */}
                  <span className="lr">{locked ? `LV ${item.level}` : active ? 'Equipped' : 'Tap'}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <p className="footnote">
        Everything here is earned by playing. Nothing is for sale, and winning
        a match returns the result and nothing else.
      </p>
    </>
  );
}

/** A face for each family, so a locked grid still reads as its category. */
function iconFor(title: string): string {
  if (title === 'Pawns') return '♟️';
  if (title === 'Boards') return '🎨';
  if (title === 'Card frames') return '🖼️';
  if (title === 'Celebrations') return '🎉';
  return '🏷️';
}
