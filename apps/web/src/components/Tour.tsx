import { useEffect, useState } from 'react';

/**
 * First-run tour.
 *
 * Four cards explaining what this is, shown once. Ludo itself needs no
 * teaching -- everybody in India already knows the rules -- so the tour
 * deliberately does NOT explain how to play. What is genuinely unfamiliar is
 * the shape of this particular product: that rooms are private, that only
 * the host ever pays, that there is no prize money, and that progress is
 * cosmetic. Those are the four cards.
 *
 * Skippable from the first frame and never shown again once dismissed. A
 * tour that cannot be skipped is a toll gate, and the people most likely to
 * want out are the ones who already know what they are doing.
 */

const SEEN_KEY = 'ludolite.tour.v1';

export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === 'true';
  } catch {
    // Private mode: treat as seen rather than showing the tour on every
    // single launch, which would be far more annoying than missing it.
    return true;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, 'true');
  } catch {
    // Nothing to do; the tour simply may reappear next launch.
  }
}

interface Card {
  readonly art: string;
  readonly title: string;
  readonly body: string;
  readonly tint: string;
}

const CARDS: readonly Card[] = [
  {
    art: '🎲',
    title: 'Ludo, with your people',
    body: 'Create a private room and share the code. No strangers, no matchmaking queue — just the people you invite.',
    tint: 'var(--red)',
  },
  {
    art: '🤝',
    title: 'Only the host pays',
    body: 'Hosting a match costs ₹1, once. Everyone who joins plays free, however many of them there are.',
    tint: 'var(--blue)',
  },
  {
    art: '🏆',
    title: 'Play for bragging rights',
    body: 'There are no cash prizes and no betting. You win the match, the story, and the right to bring it up at dinner.',
    tint: 'var(--green)',
  },
  {
    art: '🎨',
    title: 'Earn as you play',
    body: 'Matches earn XP toward levels, badges and new boards. All of it is cosmetic, and none of it is for sale.',
    tint: 'var(--yellow)',
  },
];

export function Tour({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const card = CARDS[index];
  const last = index === CARDS.length - 1;

  function finish(): void {
    markSeen();
    onDone();
  }

  // Escape skips, matching the skip button. A modal that traps the user is
  // the thing this component is most at risk of becoming.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!card) return null;

  return (
    <div className="tour-backdrop" role="dialog" aria-modal="true" aria-label="Welcome">
      <div className="tour">
        <button type="button" className="tour-skip" onClick={finish}>
          Skip
        </button>

        {/* Keyed on index so the art remounts and replays its entrance on
            every card rather than only the first. */}
        <div className="tour-art" key={index} style={{ ['--tint' as string]: card.tint }}>
          <span aria-hidden="true">{card.art}</span>
        </div>

        <h2 className="tour-title">{card.title}</h2>
        <p className="tour-body">{card.body}</p>

        <div className="tour-dots" aria-hidden="true">
          {CARDS.map((_, i) => (
            <span key={i} className={`tour-dot${i === index ? ' on' : ''}`} />
          ))}
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => (last ? finish() : setIndex(index + 1))}
        >
          {last ? "Let's play" : 'Next'}
        </button>
      </div>
    </div>
  );
}
