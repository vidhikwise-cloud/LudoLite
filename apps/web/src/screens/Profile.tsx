import { useState } from 'react';

import { BrandBar } from '../components/Brand.js';
import {
  AvatarSheet,
  BadgeGrid,
  PlayerCard,
  StatGrid,
  ThemeSheet,
} from '../components/Progress.js';
import {
  ACHIEVEMENTS,
  MAX_NAME,
  THEMES,
  levelProgress,
  randomName,
  setAvatar,
  setName,
  setTheme,
  titleForLevel,
  winRate,
  type ProgressState,
} from '../lib/progress.js';

/**
 * Profile.
 *
 * One place that answers "who am I in this game and what have I done".
 * Identity (name, avatar, board) sits above the record, because the parts a
 * player can change are the reason they come here; the stats are what they
 * stay for.
 *
 * Everything shown is local to this device. There are no accounts, so there
 * is nothing here that could identify a person beyond a nickname they chose,
 * and nothing leaves the phone.
 */
export function Profile({
  progress,
  onProgressChange,
  onBack,
  onReplayTour,
}: {
  progress: ProgressState;
  onProgressChange: (next: ProgressState) => void;
  onBack: () => void;
  onReplayTour: () => void;
}) {
  const [sheet, setSheet] = useState<'avatar' | 'theme' | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState(progress.name);

  const { level, into, need } = levelProgress(progress.xp);
  const unlocked = progress.achievements.length;
  const theme = THEMES.find((t) => t.id === progress.theme);

  function commitName(): void {
    const trimmed = draft.trim();
    // An empty field keeps the existing name rather than leaving the player
    // nameless -- the same reason the field is pre-filled in the first place.
    if (trimmed === '') {
      setDraft(progress.name);
    } else {
      onProgressChange(setName(progress, trimmed));
    }
    setEditingName(false);
  }

  return (
    <>
      <BrandBar />

      <button type="button" className="btn-link" onClick={onBack}>
        ← Back
      </button>

      <h2 className="screen-title">Your profile</h2>

      <PlayerCard progress={progress} onPickAvatar={() => setSheet('avatar')} />

      {/* --- name ----------------------------------------------------------- */}
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Display name</span>
          {!editingName ? (
            <button
              type="button"
              className="linkbtn"
              onClick={() => {
                setDraft(progress.name);
                setEditingName(true);
              }}
            >
              Edit
            </button>
          ) : null}
        </div>

        <div className="profile-row">
          {editingName ? (
            <div className="namerow">
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
                    setEditingName(false);
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
            <div className="profile-value">
              <span className="profile-name">{progress.name}</span>
              <span className="profile-sub">{titleForLevel(level)}</span>
            </div>
          )}
        </div>
      </div>

      {/* --- board ---------------------------------------------------------- */}
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Board theme</span>
          <button type="button" className="linkbtn" onClick={() => setSheet('theme')}>
            Change
          </button>
        </div>
        <div className="profile-row">
          <span className={`themeswatch ${progress.theme}`} aria-hidden="true" />
          <div className="profile-value">
            <span className="profile-name">{theme?.name ?? 'Classic Paper'}</span>
            <span className="profile-sub">
              {progress.themes.length} of {THEMES.length} unlocked
            </span>
          </div>
        </div>
      </div>

      {/* --- record --------------------------------------------------------- */}
      <div className="section">
        <span className="section-title">Record</span>
        <span className="section-rule" />
      </div>

      <StatGrid progress={progress} />

      {/*
        Level progress restated here in words. The bar on the player card
        shows the shape; this says the number, which is what someone
        checking their profile actually wants to know.
      */}
      <div className="panel">
        <div className="profile-row">
          <div className="profile-value">
            <span className="profile-name">
              Level {level} · {winRate(progress)}% win rate
            </span>
            <span className="profile-sub">
              {into} / {need} XP toward level {level + 1}
            </span>
          </div>
        </div>
      </div>

      {/* --- achievements --------------------------------------------------- */}
      <div className="section">
        <span className="section-title">
          Achievements · {unlocked}/{ACHIEVEMENTS.length}
        </span>
        <span className="section-rule" />
      </div>

      <BadgeGrid progress={progress} />

      <button type="button" className="btn btn-ghost" onClick={onReplayTour}>
        Show the welcome tour again
      </button>

      <p className="footnote">
        Everything here is stored on this device only. There is no account, and
        nothing is shared.
      </p>

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
