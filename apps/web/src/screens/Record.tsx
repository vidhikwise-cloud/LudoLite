import { BadgeGrid } from '../components/Progress.js';
import {
  ACHIEVEMENTS,
  levelProgress,
  titleForLevel,
  winRate,
  type ProgressState,
} from '../lib/progress.js';

/**
 * Record.
 *
 * Everything the player has actually done, as a dashboard rather than a
 * list. The old Profile screen mixed identity (name, avatar, board) with
 * achievement; those are different questions, so identity now lives in the
 * Locker and this screen answers only "how am I doing".
 *
 * The numbers lead at a size you can read across a table, because a record
 * is for looking at, not for reading. Below them sits recent form, then the
 * badges.
 *
 * Nothing here is shared or uploaded. There are no accounts, so these
 * figures exist on this device and nowhere else.
 */
export function Record({ progress }: { progress: ProgressState }) {
  const { level, into, need } = levelProgress(progress.xp);
  const unlocked = progress.achievements.length;
  const played = progress.played > 0;

  return (
    <>
      <header className="dash-bar an-d">
        <span className="dash-me" aria-hidden="true">
          {progress.avatar}
        </span>
        <span className="dash-who an dl1">
          <b>Your record</b>
          <span>
            Level {level} · {titleForLevel(level)}
          </span>
        </span>
        <span className="dash-lvl an dl2">LV {level}</span>
      </header>

      {!played ? (
        /* An empty record is worse than no record: a grid of zeroes makes a
           new app look abandoned rather than new. */
        <div className="tile tile-plain an dl3" style={{ cursor: 'default', minHeight: 120 }}>
          <span className="tile-ic" aria-hidden="true">
            🎲
          </span>
          <span className="tile-k">No matches yet</span>
          <span className="tile-s">Play one and your record starts here.</span>
        </div>
      ) : (
        <>
          <div className="bigstat">
            <div className="cell an dl3">
              <i aria-hidden="true">🎲</i>
              <b className="num">{progress.played.toLocaleString('en-IN')}</b>
              <span>Played</span>
            </div>
            <div className="cell an dl4">
              <i aria-hidden="true">🏆</i>
              <b className="num">{progress.won.toLocaleString('en-IN')}</b>
              <span>Won</span>
            </div>
            <div className="cell an dl5">
              <i aria-hidden="true">📈</i>
              <b className="num">{winRate(progress)}%</b>
              <span>Win rate</span>
            </div>
            <div className="cell an dl6">
              <i aria-hidden="true">🔥</i>
              <b className="num">{progress.bestWinStreak}</b>
              <span>Best streak</span>
            </div>

            {/*
              Recent form.

              The stored state carries totals, not a match log, so there is
              no honest per-match history to draw. What IS true is the
              current streak, so the bar chart shows exactly that: the last
              `winStreak` matches as wins, padded with neutral bars. It is
              labelled as the streak rather than as "last 8 matches", which
              would be a claim the data cannot support.
            */}
            <div className="cell wide an dl7">
              <span>Current streak</span>
              <b className="num">
                {progress.winStreak} {progress.winStreak === 1 ? 'win' : 'wins'} in a row
              </b>
              <div className="formrow" aria-hidden="true">
                {Array.from({ length: 8 }, (_, i) => {
                  // Newest on the right, so the streak fills from that end.
                  const isWin = i >= 8 - Math.min(progress.winStreak, 8);
                  return (
                    <i
                      key={i}
                      className={isWin ? 'w' : 'l'}
                      style={{
                        // Pixels, not percentages. A percentage height needs
                        // a definite height on the flex line to resolve
                        // against, and `align-items: flex-end` removes it --
                        // so percentages collapse every bar to zero.
                        height: isWin ? 34 + (i % 3) * 4 : 15,
                        animationDelay: `${0.3 + i * 0.05}s`,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <div className="khead an dl8">
            <b>Totals</b>
          </div>
          <div className="bigstat">
            <div className="cell an dl8">
              <b className="num">{progress.captures.toLocaleString('en-IN')}</b>
              <span>Tokens cut</span>
            </div>
            <div className="cell an dl9">
              <b className="num">{progress.finished.toLocaleString('en-IN')}</b>
              <span>Brought home</span>
            </div>
          </div>
        </>
      )}

      <div className="khead an dl9">
        <b>Badges</b>
        <span>
          {unlocked} of {ACHIEVEMENTS.length}
        </span>
      </div>
      <BadgeGrid progress={progress} />

      <div className="xpline an dl10">
        <span className="track" aria-hidden="true">
          <i style={{ width: `${Math.round((into / need) * 100)}%` }} />
        </span>
        <b>
          <span className="num">{into.toLocaleString('en-IN')}</span> /{' '}
          {need.toLocaleString('en-IN')} to LV {level + 1}
        </b>
      </div>

      <p className="footnote">
        Stored on this device only. There is no account, and nothing is shared.
      </p>
    </>
  );
}
