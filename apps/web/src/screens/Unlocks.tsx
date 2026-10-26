import { BrandBar } from '../components/Brand.js';
import {
  CELEBRATIONS,
  FRAMES,
  PAWNS,
  THEMES,
  TITLES,
  levelProgress,
  setCelebration,
  setChosenTitle,
  setFrame,
  setPawn,
  setTheme,
  xpForLevel,
  type Cosmetic,
  type ProgressState,
} from '../lib/progress.js';

/**
 * Unlocks.
 *
 * Every cosmetic in the game, with the exact level it needs and how far
 * away that is. Nothing is hidden and nothing is for sale.
 *
 * Publishing the requirement next to the item is the whole point. A locked
 * item with no stated condition reads as "buy this"; the same item marked
 * "Level 6, 340 XP away" reads as a goal. The second is true here, so it
 * should be what the screen says.
 */
export function Unlocks({
  progress,
  onProgressChange,
  onBack,
}: {
  progress: ProgressState;
  onProgressChange: (next: ProgressState) => void;
  onBack: () => void;
}) {
  const { level } = levelProgress(progress.xp);

  /** XP still needed to reach a level, or null once it is reached. */
  function xpAway(target: number): number | null {
    if (level >= target) return null;
    return Math.max(0, xpForLevel(target) - progress.xp);
  }

  const sections: ReadonlyArray<{
    readonly title: string;
    readonly items: readonly Cosmetic[];
    readonly current: string;
    readonly choose: (id: string) => void;
  }> = [
    {
      title: 'Pawns',
      items: PAWNS,
      current: progress.pawn,
      choose: (id) => onProgressChange(setPawn(progress, id)),
    },
    {
      title: 'Boards',
      // Board themes carry the same shape as a cosmetic, so they list here
      // too rather than living only behind the picker on Home.
      items: THEMES,
      current: progress.theme,
      choose: (id) => onProgressChange(setTheme(progress, id)),
    },
    {
      title: 'Card frames',
      items: FRAMES,
      current: progress.frame,
      choose: (id) => onProgressChange(setFrame(progress, id)),
    },
    {
      title: 'Victory celebrations',
      items: CELEBRATIONS,
      current: progress.celebration,
      choose: (id) => onProgressChange(setCelebration(progress, id)),
    },
    {
      title: 'Titles',
      items: TITLES,
      current: progress.title,
      choose: (id) => onProgressChange(setChosenTitle(progress, id)),
    },
  ];

  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const earned = sections.reduce(
    (n, s) => n + s.items.filter((i) => level >= i.level).length,
    0,
  );

  return (
    <>
      <BrandBar />

      <button type="button" className="backbtn" onClick={onBack} aria-label="Go back">
        <span aria-hidden="true">←</span>
      </button>

      <h2 className="screen-title">Unlocks</h2>

      <div className="panel">
        <div className="profile-row">
          <div className="profile-value">
            <span className="profile-name">
              {earned} of {total} unlocked
            </span>
            <span className="profile-sub">
              Everything here is earned by playing. Nothing is for sale.
            </span>
          </div>
        </div>
      </div>

      {sections.map((section) => (
        <div key={section.title}>
          <div className="section">
            <span className="section-title">{section.title}</span>
            <span className="section-rule" />
          </div>

          <div className="unlocks">
            {section.items.map((item) => {
              const away = xpAway(item.level);
              const locked = away !== null;
              const active = item.id === section.current;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`unlock${active ? ' on' : ''}${locked ? ' locked' : ''}`}
                  disabled={locked}
                  onClick={() => section.choose(item.id)}
                >
                  <span className="unlock-body">
                    <span className="unlock-name">{item.name}</span>
                    <span className="unlock-blurb">{item.blurb}</span>
                  </span>

                  {/* The requirement, stated plainly, right next to the item. */}
                  <span className={`unlock-req${locked ? '' : ' met'}`}>
                    {locked
                      ? `Level ${item.level} · ${away.toLocaleString('en-IN')} XP away`
                      : active
                        ? 'Equipped'
                        : 'Tap to use'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <p className="footnote">
        Levels come from playing matches. Winning earns more than losing, and
        matches against people earn more than matches against the computer.
      </p>
    </>
  );
}
