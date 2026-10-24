import type { BotDifficulty } from '@ludolite/shared';
import { useState } from 'react';

import { InfoIcon, TickIcon } from '../components/Brand.js';

/**
 * Set up a game against the computer.
 *
 * Always free, and the screen says so plainly — there is nobody to invite, so
 * there is nothing to host. The server refuses a paid bot game outright, and
 * this copy makes sure nobody expects otherwise.
 */

const LEVELS: ReadonlyArray<{
  value: BotDifficulty;
  label: string;
  blurb: string;
}> = [
  {
    value: 'easy',
    label: 'Easy',
    blurb: 'Goes for captures, misses danger. Good for a first game.',
  },
  {
    value: 'normal',
    label: 'Normal',
    blurb: 'Avoids obvious traps and takes its chances. A fair match.',
  },
  {
    value: 'hard',
    label: 'Hard',
    blurb: 'Plays the odds, protects its lead, punishes mistakes.',
  },
];

export function PlayComputer({
  busy,
  error,
  onBack,
  onStart,
}: {
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onStart: (input: {
    seatCount: 2 | 4;
    displayName: string;
    bots: { count: number; level: BotDifficulty };
  }) => void;
}) {
  const [seatCount, setSeatCount] = useState<2 | 4>(4);
  const [level, setLevel] = useState<BotDifficulty>('normal');
  const [displayName, setDisplayName] = useState('');

  const opponents = seatCount - 1;
  const canSubmit = displayName.trim().length > 0 && !busy;

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (!canSubmit) return;
    onStart({
      seatCount,
      displayName: displayName.trim(),
      bots: { count: opponents, level },
    });
  }

  return (
    <form onSubmit={submit}>
      <button type="button" className="btn-link" onClick={onBack}>
        ← Back
      </button>

      <h2 className="screen-title">Play against the computer</h2>

      <div className="notice n-ok" style={{ marginBottom: 20 }}>
        <TickIcon />
        <span>
          <b>Always free</b>
          There is nobody to invite, so there is nothing to host and nothing to pay.
        </span>
      </div>

      <div className="field">
        <label className="lbl" htmlFor="soloName">
          Your name
        </label>
        <input
          id="soloName"
          className="input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="What should we call you?"
          maxLength={24}
          autoComplete="nickname"
        />
      </div>

      <div className="field">
        <span className="lbl" id="solo-seats">
          Players
        </span>
        <div className="seatpick" role="radiogroup" aria-labelledby="solo-seats">
          <button
            type="button"
            role="radio"
            aria-checked={seatCount === 2}
            className={`seat${seatCount === 2 ? ' on' : ''}`}
            onClick={() => setSeatCount(2)}
          >
            <span className="n">2</span>
            <span className="t">You + 1 bot</span>
            <span className="tokens">
              <i style={{ background: 'var(--red)' }} />
              <i style={{ background: 'var(--yellow)' }} />
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={seatCount === 4}
            className={`seat${seatCount === 4 ? ' on' : ''}`}
            onClick={() => setSeatCount(4)}
          >
            <span className="n">4</span>
            <span className="t">You + 3 bots</span>
            <span className="tokens">
              <i style={{ background: 'var(--red)' }} />
              <i style={{ background: 'var(--green)' }} />
              <i style={{ background: 'var(--yellow)' }} />
              <i style={{ background: 'var(--blue)' }} />
            </span>
          </button>
        </div>
      </div>

      <div className="field">
        <span className="lbl" id="solo-level">
          Difficulty
        </span>
        <div className="levels" role="radiogroup" aria-labelledby="solo-level">
          {LEVELS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={level === option.value}
              className={`level${level === option.value ? ' on' : ''}`}
              onClick={() => setLevel(option.value)}
            >
              <span className="level-label">{option.label}</span>
              <span className="level-blurb">{option.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="notice n-danger" style={{ marginBottom: 16 }}>
          <InfoIcon />
          <span>{error}</span>
        </div>
      ) : null}

      <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
        {busy ? 'Setting up…' : `Play ${opponents} ${opponents === 1 ? 'bot' : 'bots'}`}
      </button>
    </form>
  );
}
