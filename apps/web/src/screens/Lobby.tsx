import type { RoomView } from '@ludolite/shared';
import { SEAT_COLOR_BY_INDEX } from '@ludolite/engine';
import { useEffect, useRef, useState } from 'react';

import { InfoIcon, TickIcon } from '../components/Brand.js';
import { MascotSays } from '../components/Mascot.js';
import { sfx } from '../lib/feedback.js';

/**
 * Room lobby.
 *
 * The waiting room is where a group either gets excited or gets bored, so the
 * code is huge and readable aloud, seats fill with a visible animation, and
 * an arrival makes a sound.
 *
 * The "Host · paid" badge comes from `room.players[].paidHost`, which the
 * server computes from the verified transaction record — never from anything
 * this client knows or could assert.
 */
export function Lobby({
  room,
  isHost,
  busy,
  error,
  onStart,
  onLeave,
  avatar,
  onCancelAndRefund,
}: {
  room: RoomView;
  isHost: boolean;
  busy: boolean;
  error: string | null;
  onStart: () => void;
  onLeave: () => void;
  /** The player's chosen character, shown waiting with them. */
  avatar: string;
  onCancelAndRefund?: () => void;
}) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const previousCount = useRef(room.players.length);

  // Somebody joined — make it audible, so the host does not have to watch.
  useEffect(() => {
    if (room.players.length > previousCount.current) sfx.join();
    previousCount.current = room.players.length;
  }, [room.players.length]);

  const seats = room.seatCount === 2 ? [0, 2] : [0, 1, 2, 3];
  const waiting = room.seatCount - room.players.length;
  const full = waiting <= 0;

  async function copy(what: 'code' | 'link'): Promise<void> {
    const text =
      what === 'code' ? room.code : `${window.location.origin}/?code=${room.code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      // Clipboard can be blocked; the code is on screen regardless.
    }
  }

  async function share(): Promise<void> {
    const url = `${window.location.origin}/?code=${room.code}`;
    const text = `Join my Ludo game. Room code ${room.code}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: 'LudoLite', text, url });
        return;
      } catch {
        // User dismissed the sheet; fall through to copying.
      }
    }
    void copy('link');
  }

  return (
    <>
      <div className="notice n-ok">
        <TickIcon />
        <span>
          <b>Room is ready</b>
          Share the code. Joining is free for everyone you invite.
        </span>
      </div>

      <div className="codecard">
        <p className="cap">Room code</p>
        <button
          type="button"
          className="code code-button"
          onClick={() => void copy('code')}
          title="Tap to copy"
        >
          {room.code.split('').map((char, i) => (
            <span key={i} className="code-char" style={{ animationDelay: `${i * 60}ms` }}>
              {char}
            </span>
          ))}
        </button>
        <p className="hint">{copied === 'code' ? 'Code copied' : 'Tap the code to copy it'}</p>
      </div>

      <div className="players">
        {seats.map((seat, index) => {
          const player = room.players.find((p) => p.seat === seat);
          const colour = SEAT_COLOR_BY_INDEX[seat as 0 | 1 | 2 | 3];

          if (!player) {
            return (
              <div className="player empty" key={seat}>
                <span className="avatar empty-avatar" aria-hidden="true">
                  <span className="avatar-wait" />
                </span>
                <span className="nm">Waiting for a friend…</span>
                <span className="role">Seat {index + 1}</span>
              </div>
            );
          }

          return (
            <div
              className="player filled"
              key={seat}
              style={{ ['--seat' as string]: `var(--${colour})` }}
            >
              <span className="avatar" aria-hidden="true">
                {player.isBot ? '🤖' : player.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="nm">
                {player.displayName}
                {!player.isBot ? (
                  <span
                    className={`presence${player.connected ? '' : ' away'}`}
                    title={player.connected ? 'Connected' : 'Reconnecting'}
                  />
                ) : null}
              </span>
              <span
                className={`role${player.isHost ? ' host' : ''}${player.isBot ? ' bot' : ''}`}
              >
                {player.isBot
                  ? 'Computer'
                  : player.isHost
                    ? player.paidHost
                      ? 'Host · paid'
                      : 'Host'
                    : 'Joined free'}
              </span>
            </div>
          );
        })}
      </div>

      {error ? (
        <div className="notice n-danger">
          <InfoIcon />
          <span>{error}</span>
        </div>
      ) : null}

      {/*
        The wait is the weakest moment in the whole flow: nothing is
        happening and the people you invited have not arrived yet. Pippo
        fills it -- asleep while the room is empty, awake and expectant once
        someone joins, which also makes an arrival visible without a banner.
      */}
      <MascotSays
        avatar={avatar}
        mood={full ? 'cheer' : room.players.length > 1 ? 'happy' : 'sleeping'}
        line={
          full
            ? 'Everyone is here. Start whenever.'
            : room.players.length > 1
              ? `${waiting} more and we can begin.`
              : 'Nobody yet. Send them the code.'
        }
        size={56}
      />

      <div className="btn-stack">
        {isHost ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onStart}
            disabled={!room.canStart || busy}
          >
            {room.canStart
              ? busy
                ? 'Starting…'
                : 'Start Match'
              : `Waiting for ${waiting} more`}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled>
            {full ? 'Waiting for the host to start' : `Waiting for ${waiting} more`}
          </button>
        )}

        <button type="button" className="btn btn-ghost" onClick={() => void share()}>
          {copied === 'link' ? 'Link copied' : 'Invite friends'}
        </button>
      </div>

      {/* Cancellation is offered only where a refund is actually possible. */}
      {isHost && room.funding === 'paid' && onCancelAndRefund ? (
        <button type="button" className="btn-link" onClick={onCancelAndRefund}>
          Cancel this room and request a refund
        </button>
      ) : (
        <button type="button" className="btn-link" onClick={onLeave}>
          Leave room
        </button>
      )}
    </>
  );
}
