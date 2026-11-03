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

      {/* The code as a single utility bar: the two things you do with a
          code sit on it, rather than below a card. */}
      <div className="codebar an dl1">
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="codebar-l">Room code</span>
          <span className="codebar-c">
            {room.code.split('').map((char, i) => (
              <span key={i} style={{ animationDelay: `${0.12 + i * 0.07}s` }}>
                {char}
              </span>
            ))}
          </span>
        </span>
        <button type="button" className="c-copy" onClick={() => void copy('code')}>
          {copied === 'code' ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="c-share" onClick={() => void share()}>
          {copied === 'link' ? 'Sent' : 'Share'}
        </button>
      </div>

      {/*
        The table.

        Seats sit AROUND a board rather than in a list, because an empty seat
        should read as a gap at a table that wants filling -- which is what
        it actually is -- instead of as a greyed-out row. The open seat is a
        button: tapping it shares the code, since inviting someone is the
        only thing you can usefully do about an empty chair.
      */}
      <div className="ptable an dl3">
        {seats.map((seat, index) => {
          const player = room.players.find((p) => p.seat === seat);
          const colour = SEAT_COLOR_BY_INDEX[seat as 0 | 1 | 2 | 3];
          const delay = `${0.26 + index * 0.07}s`;

          if (!player) {
            return (
              <button
                type="button"
                className="pslot open"
                key={seat}
                onClick={() => void share()}
                aria-label="Invite a friend to this seat"
              >
                <span className="av" style={{ animationDelay: delay }} aria-hidden="true">
                  +
                </span>
                <span className="nm">Open seat</span>
                <span className="st">TAP TO INVITE</span>
              </button>
            );
          }

          return (
            <div
              className={`pslot${player.isHost ? ' host' : ''}`}
              key={seat}
              style={{ ['--seat' as string]: `var(--${colour})` }}
            >
              <span
                className="av"
                style={{
                  animationDelay: delay,
                  background: `var(--${colour}-sf)`,
                  borderColor: `var(--${colour})`,
                }}
                aria-hidden="true"
              >
                {/*
                  The initial, not a character.

                  RoomPlayerView carries no avatar -- the server never sees
                  one, because characters are local to a device -- so the
                  only honest options are an initial or a generic silhouette.
                  Showing OUR avatar on every seat would put the same face on
                  four different people.
                */}
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
              <span className="st">
                {player.isBot
                  ? 'COMPUTER'
                  : player.isHost
                    ? player.paidHost
                      ? 'HOST · PAID'
                      : `HOST · ${colour.toUpperCase()}`
                    : colour.toUpperCase()}
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
        {/* Sharing used to live here as well. It is on the ticket stub now,
            which is where someone looks when they want to pass the code on. */}
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
