/**
 * The landing hero.
 *
 * A big arcade-style title, a tilted board with bouncing pawns and a
 * tumbling die, a feature row, and one large call to action.
 *
 * Built in the project's LIGHT palette rather than the dark navy of the
 * reference art. The app is light-only by decision (see the header of
 * styles.css), and one dark screen in a light app reads as a bug. The
 * structure, the energy and the 3D title are the parts worth copying; the
 * background is not.
 *
 * Everything decorative is aria-hidden. A screen reader gets the heading,
 * the feature names and the button -- which is the whole content.
 */

import { useEffect, useState } from 'react';

import { fetchPresence } from '../lib/api.js';

/** One letter of the LUDO wordmark. */
function Letter({ char, seat, delay }: { char: string; seat: string; delay: number }) {
  return (
    <span
      className="hero-letter"
      style={{
        ['--seat' as string]: `var(--${seat})`,
        animationDelay: `${delay}s`,
      }}
    >
      {char}
    </span>
  );
}

/**
 * A Ludo pawn, drawn rather than imported.
 *
 * The real board's tokens are flat counters, which is right on a board and
 * wrong in a hero -- this is the classic tapered pawn silhouette, which
 * reads as "Ludo" at a glance even at thumbnail size.
 */
function Pawn({ seat, delay }: { seat: string; delay: number }) {
  return (
    <svg
      className="hero-pawn"
      viewBox="0 0 48 60"
      style={{ ['--seat' as string]: `var(--${seat})`, animationDelay: `${delay}s` }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`pawn-${seat}`} cx="36%" cy="26%" r="76%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.72" />
          <stop offset="46%" stopColor="#fff" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.3" />
        </radialGradient>
      </defs>
      <ellipse cx="24" cy="56" rx="15" ry="3.4" fill="#2a211d" opacity="0.16" />
      {/* Base, waist and head as one silhouette. */}
      <path
        d="M8 54c0-7 6-9 9-13 2.4-2.4 2-5 .6-7A11 11 0 1 1 30.4 34c-1.4 2-1.8 4.6.6 7 3 4 9 6 9 13z"
        fill="var(--seat)"
      />
      <path
        d="M8 54c0-7 6-9 9-13 2.4-2.4 2-5 .6-7A11 11 0 1 1 30.4 34c-1.4 2-1.8 4.6.6 7 3 4 9 6 9 13z"
        fill={`url(#pawn-${seat})`}
      />
      {/* Eyes: the reference's pawns have faces, and a face is most of why
          they read as friendly rather than as game pieces. */}
      <circle cx="20" cy="20" r="3.4" fill="#fff" />
      <circle cx="28" cy="20" r="3.4" fill="#fff" />
      <circle cx="20.8" cy="20.6" r="1.7" fill="#2a211d" />
      <circle cx="28.8" cy="20.6" r="1.7" fill="#2a211d" />
      <path
        d="M20 27q4 3.4 8 0"
        stroke="#2a211d"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The large hero die. Shows a six, which is the roll everyone wants. */
function HeroDie() {
  const pips = [
    [30, 30],
    [30, 70],
    [50, 30],
    [50, 70],
    [70, 30],
    [70, 70],
  ] as const;

  return (
    <svg className="hero-die" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="dieFace" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fffdf8" />
          <stop offset="55%" stopColor="#f7f0e2" />
          <stop offset="100%" stopColor="#e6d9c2" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="88" height="88" rx="20" fill="var(--wood-2)" opacity="0.5" />
      <rect x="6" y="3" width="88" height="88" rx="20" fill="url(#dieFace)" stroke="var(--rule)" />
      {pips.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy - 3} r="7.5" fill="#2a211d" />
      ))}
    </svg>
  );
}

const FEATURES = [
  { icon: '👥', label: 'Play with\nFriends', seat: 'blue' },
  { icon: '⚡', label: 'Quick\n& Easy', seat: 'green' },
  { icon: '🔒', label: 'Private\n& Safe', seat: 'red' },
  /*
   * "Earn XP", not "Win Rewards".
   *
   * docs/COMPLIANCE.md commits to "no cash prizes... winning a match
   * returns the result and nothing else". A trophy labelled "Win Rewards"
   * on the first screen is precisely the claim that reads as a prize
   * offer, whatever the small print says later. XP is what is actually
   * earned, and saying so costs nothing.
   */
  { icon: '⭐', label: 'Earn\nXP', seat: 'yellow' },
] as const;

export function Hero({ onPlay }: { onPlay: () => void }) {
  const [online, setOnline] = useState<number | null>(null);

  // Real count from the server, refreshed while the page is open. Null
  // until it arrives, so the indicator is absent rather than showing a
  // zero that might just be a slow request.
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchPresence()
        .then((n) => {
          if (alive) setOnline(n);
        })
        .catch(() => {
          // A failed poll leaves the last known value rather than blanking
          // the indicator; this is decorative and must never shout.
        });
    };
    load();
    const id = window.setInterval(load, 30000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <section className="hero">
      {/* Drifting dice and pawns behind the content. */}
      <div className="hero-sky" aria-hidden="true">
        <span className="hero-float f1">🎲</span>
        <span className="hero-float f2">🎯</span>
        <span className="hero-float f3">🎲</span>
        <span className="hero-float f4">✨</span>
      </div>

      {online !== null ? (
        <div className="hero-online">
          <span className="hero-dot" aria-hidden="true" />
          {online === 1 ? '1 player online' : `${online.toLocaleString('en-IN')} players online`}
        </div>
      ) : null}

      <div className="hero-crown" aria-hidden="true">
        👑
      </div>

      <h1 className="hero-title">
        <span className="sr-only">LudoLite</span>
        <span aria-hidden="true" className="hero-word">
          <Letter char="L" seat="red" delay={0} />
          <Letter char="U" seat="yellow" delay={0.12} />
          <Letter char="D" seat="green" delay={0.24} />
          <Letter char="O" seat="blue" delay={0.36} />
        </span>
      </h1>

      <p className="hero-kicker" aria-hidden="true">
        <span>Play</span>
        <i />
        <span>Roll</span>
        <i />
        <span className="win">Win</span>
      </p>

      <p className="hero-tag">Classic game. Endless fun. Challenge your friends.</p>

      {/* The board: a tilted plate with four quadrants, pawns and a die. */}
      <div className="hero-stage" aria-hidden="true">
        <div className="hero-board">
          <span className="q q-red" />
          <span className="q q-green" />
          <span className="q q-blue" />
          <span className="q q-yellow" />
          <span className="hero-cross" />
        </div>

        <div className="hero-pawns">
          <Pawn seat="red" delay={0} />
          <Pawn seat="green" delay={0.2} />
          <Pawn seat="blue" delay={0.4} />
          <Pawn seat="yellow" delay={0.6} />
        </div>

        <div className="hero-diewrap">
          <HeroDie />
        </div>
      </div>

      <ul className="hero-features">
        {FEATURES.map((f) => (
          <li key={f.label}>
            <span
              className="hero-feature-icon"
              style={{ ['--seat' as string]: `var(--${f.seat})` }}
              aria-hidden="true"
            >
              {f.icon}
            </span>
            <span className="hero-feature-label">{f.label}</span>
          </li>
        ))}
      </ul>

      <button type="button" className="hero-cta" onClick={onPlay}>
        <span aria-hidden="true">🎮</span>
        Play Now
        <span className="hero-cta-arrow" aria-hidden="true">
          →
        </span>
      </button>
    </section>
  );
}
