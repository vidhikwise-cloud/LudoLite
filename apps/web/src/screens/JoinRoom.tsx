import { useState } from 'react';

import { InfoIcon, TickIcon } from '../components/Brand.js';

/**
 * Join by code.
 *
 * Says plainly that joining is free, so an invitee never sits waiting for a
 * payment prompt that is not coming.
 */
export function JoinRoom({
  busy,
  error,
  initialCode,
  onBack,
  initialName,
  onJoin,
}: {
  busy: boolean;
  error: string | null;
  initialCode?: string;
  onBack: () => void;
  /** Pre-filled from the player's profile so the field is never empty. */
  initialName: string;
  onJoin: (input: { code: string; displayName: string }) => void;
}) {
  const [code, setCode] = useState(initialCode ?? '');
  const [displayName, setDisplayName] = useState(initialName);

  const canSubmit = code.trim().length >= 3 && displayName.trim().length > 0 && !busy;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onJoin({ code: code.trim(), displayName: displayName.trim() });
  }

  return (
    <form onSubmit={submit}>
      <button type="button" className="btn-link" onClick={onBack}>
        ← Back
      </button>

      <h2 className="screen-title">Join a room</h2>

      <div className="notice n-ok" style={{ marginBottom: 20 }}>
        <TickIcon />
        <span>Joining is free. Only the person who created the room pays anything.</span>
      </div>

      <div className="field">
        <label className="lbl" htmlFor="code">
          Room code
        </label>
        <input
          id="code"
          className="input input-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="7X2K"
          maxLength={8}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
        />
      </div>

      <div className="field">
        <label className="lbl" htmlFor="joinName">
          Your name
        </label>
        <input
          id="joinName"
          className="input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="What should friends call you?"
          maxLength={24}
          autoComplete="nickname"
        />
      </div>

      {error ? (
        <div className="notice n-danger" style={{ marginBottom: 16 }}>
          <InfoIcon />
          <span>{error}</span>
        </div>
      ) : null}

      <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
        {busy ? 'Joining…' : 'Join Room'}
      </button>
    </form>
  );
}
