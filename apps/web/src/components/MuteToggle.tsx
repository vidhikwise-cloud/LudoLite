import { useState } from 'react';

import { isMuted, setMuted } from '../lib/feedback.js';

/**
 * Sound toggle.
 *
 * People play Ludo in a room together, often late. Muting has to be one tap
 * away and has to stick, or they close the app instead.
 */
export function MuteToggle() {
  const [muted, setLocal] = useState(isMuted);

  const toggle = (): void => {
    const next = !muted;
    setMuted(next);
    setLocal(next);
  };

  return (
    <button
      type="button"
      className="mute"
      onClick={toggle}
      aria-pressed={muted}
      aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
      title={muted ? 'Sound off' : 'Sound on'}
    >
      {muted ? (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            d="M8 3.2 4.6 6H2.4v6h2.2L8 14.8z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
          <path
            d="M11.6 7.2l3.6 3.6M15.2 7.2l-3.6 3.6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            d="M8 3.2 4.6 6H2.4v6h2.2L8 14.8z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
          <path
            d="M11.2 6.6a3.4 3.4 0 0 1 0 4.8M13.4 4.6a6.4 6.4 0 0 1 0 8.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
