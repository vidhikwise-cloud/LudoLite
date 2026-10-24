import {
  SEAT_COLOR_BY_INDEX,
  legalMoves,
  type MatchState,
  type SeatIndex,
  type TokenIndex,
} from '@ludolite/engine';
import type { RoomView } from '@ludolite/shared';
import { useEffect, useRef, useState } from 'react';

import { Board } from '../components/Board.js';
import { Confetti } from '../components/Confetti.js';
import { Dice, ROLL_MS } from '../components/Dice.js';
import { sfx } from '../lib/feedback.js';

/**
 * The match.
 *
 * Every control sends intent to the server and waits. The client runs the
 * same engine only to decide which tokens to highlight — the server decides
 * what actually happens.
 */
export function Game({
  room,
  state,
  mySeat,
  lastDie,
  onRoll,
  onMove,
  onLeave,
}: {
  room: RoomView;
  state: MatchState;
  mySeat: SeatIndex | null;
  lastDie: number | null;
  onRoll: () => void;
  onMove: (token: TokenIndex, die: number) => void;
  onLeave: () => void;
}) {
  const [rolling, setRolling] = useState(false);
  const wasMyTurn = useRef(false);

  const myTurn = mySeat !== null && state.turnSeat === mySeat && state.phase === 'in-play';
  const legal = myTurn ? legalMoves(state) : [];
  const needsRoll = myTurn && state.pendingDice.length === 0;
  const mustMove = myTurn && state.pendingDice.length > 0 && legal.length > 0;

  // Announce the turn coming round, once per turn.
  useEffect(() => {
    if (myTurn && !wasMyTurn.current && state.phase === 'in-play') {
      sfx.yourTurn();
    }
    wasMyTurn.current = myTurn;
  }, [myTurn, state.phase]);

  // The server has already chosen the value; hold the tumble for a beat so
  // the result lands rather than appears.
  useEffect(() => {
    if (!rolling) return;
    const id = window.setTimeout(() => setRolling(false), ROLL_MS);
    return () => window.clearTimeout(id);
  }, [rolling, lastDie]);

  const handleRoll = (): void => {
    if (!needsRoll || rolling) return;
    setRolling(true);
    sfx.roll();
    onRoll();
  };

  // --- match over -----------------------------------------------------------
  if (state.phase === 'complete') {
    return <MatchOver room={room} state={state} mySeat={mySeat} onLeave={onLeave} />;
  }

  const turnPlayer = room.players.find((p) => p.seat === state.turnSeat);
  const turnColour = SEAT_COLOR_BY_INDEX[state.turnSeat];

  return (
    <>
      <div className={`turnbar${myTurn ? ' mine' : ''}`}>
        <span
          className="turn-tok"
          style={{ background: `var(--${turnColour})` }}
          aria-hidden="true"
        />
        <span className="turn-text">
          <b>
            {myTurn
              ? 'Your turn'
              : turnPlayer?.isBot
                ? `🤖 ${turnPlayer.displayName}`
                : (turnPlayer?.displayName ?? 'Waiting')}
          </b>
          <small>
            {myTurn
              ? needsRoll
                ? 'Roll the dice'
                : mustMove
                  ? 'Tap a glowing token'
                  : 'No moves available'
              : turnPlayer?.isBot
                ? 'is thinking…'
                : 'is playing'}
          </small>
        </span>

        <Dice
          value={lastDie}
          rolling={rolling}
          disabled={!needsRoll}
          onRoll={handleRoll}
        />
      </div>

      <Board state={state} mySeat={mySeat} legal={legal} onMove={onMove} />

      <SeatStrip room={room} state={state} mySeat={mySeat} />

      <button type="button" className="btn-link" onClick={onLeave}>
        Leave match
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------

/** Compact per-seat progress so you can see who is close to winning. */
function SeatStrip({
  room,
  state,
  mySeat,
}: {
  room: RoomView;
  state: MatchState;
  mySeat: SeatIndex | null;
}) {
  return (
    <div className="seatstrip">
      {state.seats
        .filter((seat) => seat.playerId !== null)
        .map((seat) => {
          const player = room.players.find((p) => p.seat === seat.index);
          const home = seat.tokens.filter((t) => t.position.kind === 'finish').length;
          const isTurn = state.turnSeat === seat.index;

          return (
            <div
              key={seat.index}
              className={`seatchip${isTurn ? ' active' : ''}`}
              style={{ ['--seat' as string]: `var(--${SEAT_COLOR_BY_INDEX[seat.index]})` }}
            >
              <span className="seatchip-dot" aria-hidden="true" />
              <span className="seatchip-name">
                {seat.index === mySeat
                  ? 'You'
                  : player?.isBot
                    ? `🤖 ${player.displayName}`
                    : (player?.displayName ?? '—')}
              </span>
              <span className="seatchip-home" title={`${home} of 4 home`}>
                {home}/4
              </span>
            </div>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------

function MatchOver({
  room,
  state,
  mySeat,
  onLeave,
}: {
  room: RoomView;
  state: MatchState;
  mySeat: SeatIndex | null;
  onLeave: () => void;
}) {
  const iWon = mySeat !== null && state.winnerSeat === mySeat;
  const winner = room.players.find((p) => p.seat === state.winnerSeat);
  const played = useRef(false);

  useEffect(() => {
    if (played.current) return;
    played.current = true;
    if (iWon) sfx.win();
    else sfx.lose();
  }, [iWon]);

  // Final standings: finishers in order, then everyone else.
  const standings = [
    ...state.rankings,
    ...state.seats
      .filter((s) => s.playerId !== null && !state.rankings.includes(s.index))
      .map((s) => s.index),
  ];

  return (
    <>
      <Confetti active={iWon} />

      <div className={`victory${iWon ? ' won' : ''}`}>
        <div
          className="victory-crest"
          style={{
            background:
              state.winnerSeat !== null
                ? `var(--${SEAT_COLOR_BY_INDEX[state.winnerSeat]})`
                : 'var(--ink-3)',
          }}
          aria-hidden="true"
        >
          {iWon ? '🏆' : '🎲'}
        </div>

        <h2 className="victory-title">
          {iWon ? 'You won!' : winner ? `${winner.displayName} wins` : 'Match over'}
        </h2>
        <p className="victory-sub">
          {iWon
            ? 'Bragging rights are yours. No prize money — just the win.'
            : 'Good game. There is no prize money in this app, just the result.'}
        </p>
      </div>

      <ol className="standings">
        {standings.map((seatIndex, place) => {
          const player = room.players.find((p) => p.seat === seatIndex);
          const seat = state.seats.find((s) => s.index === seatIndex);
          const home = seat?.tokens.filter((t) => t.position.kind === 'finish').length ?? 0;

          return (
            <li
              key={seatIndex}
              className={`standing${seatIndex === mySeat ? ' me' : ''}`}
              style={{ ['--seat' as string]: `var(--${SEAT_COLOR_BY_INDEX[seatIndex]})` }}
            >
              <span className="standing-place">{place + 1}</span>
              <span className="standing-dot" aria-hidden="true" />
              <span className="standing-name">
                {seatIndex === mySeat ? 'You' : (player?.displayName ?? 'Left the game')}
              </span>
              <span className="standing-home">{home}/4 home</span>
            </li>
          );
        })}
      </ol>

      <button type="button" className="btn btn-primary" onClick={onLeave}>
        Back to home
      </button>
    </>
  );
}
