import { ripple } from '../lib/ripple.js';

export type Tab = 'play' | 'record' | 'locker' | 'settings';

const TABS: ReadonlyArray<{ id: Tab; icon: string; label: string }> = [
  { id: 'play', icon: '🏠', label: 'Play' },
  { id: 'record', icon: '🏅', label: 'Record' },
  { id: 'locker', icon: '🎨', label: 'Locker' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
];

/**
 * The bottom tab bar.
 *
 * Replaces scrolling as the way to reach everything that is not playing. The
 * old app buried progression, cosmetics and the legal links below the fold
 * of a single long Home screen; four fixed destinations mean none of it is
 * more than one tap away, and the player always knows where they are.
 *
 * It is deliberately NOT rendered during a match or in a room. Mid-turn, a
 * row of navigation at the thumb line is a way to leave a game by accident,
 * and the board needs the full height. See App.tsx.
 */
export function TabBar({ active, onSelect }: { active: Tab; onSelect: (tab: Tab) => void }) {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => {
        const on = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            className={`tabbtn rp rp-dark${on ? ' on' : ''}`}
            onClick={() => onSelect(tab.id)}
            onPointerDown={ripple}
            aria-current={on ? 'page' : undefined}
          >
            <em aria-hidden="true">{tab.icon}</em>
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
