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
import { Mascot, MascotSays, mascotLine, type Mood } from '../components/Mascot.js';
import { ReactionBar, XpTally, type TallyLine } from '../components/Progress.js';
import type { ProgressState } from '../lib/progress.js';
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
  onRematch,
  onReact,
  tally,
  progress,
}: {
  room: RoomView;
  state: MatchState;
  mySeat: SeatIndex | null;
  lastDie: number | null;
  onRoll: () => void;
  onMove: (token: TokenIndex, die: number) => void;
  onLeave: () => void;
  onRematch: () => void;
  onReact: (emoji: string) => void;
  tally: { readonly lines: readonly TallyLine[]; readonly total: number } | null;
  progress: ProgressState;
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
    return (
      <MatchOver
        room={room}
        state={state}
        mySeat={mySeat}
        onLeave={onLeave}
        onRematch={onRematch}
        onReact={onReact}
        tally={tally}
        progress={progress}
      />
    );
  }

  const turnPlayer = room.players.find((p) => p.seat === state.turnSeat);
  const turnColour = SEAT_COLOR_BY_INDEX[state.turnSeat];

  /*
   * What Pippo is feeling, derived from the board rather than from events.
   *
   * Deriving it means the mood survives a reconnect and never gets stuck in
   * a stale reaction: whatever the state says is true right now is what he
   * reflects. He never shows a discouraging face on the player's own turn --
   * a mascot that looks disappointed in you is one people turn off.
   */
  const mood: Mood = (() => {
    if (mySeat === null) return 'idle';
    const mine = state.seats.find((s) => s.index === mySeat);
    const myHome = mine?.tokens.filter((t) => t.position.kind === 'finish').length ?? 0;
    const myYard = mine?.tokens.filter((t) => t.position.kind === 'yard').length ?? 0;

    // Someone else is one token from winning.
    const rivalClose = state.seats.some(
      (s) =>
        s.index !== mySeat &&
        s.playerId !== null &&
        s.tokens.filter((t) => t.position.kind === 'finish').length >= 3,
    );

    if (myHome >= 3) return 'cheer';
    if (rivalClose) return 'worried';
    if (!myTurn) return turnPlayer?.isBot ? 'thinking' : 'idle';
    if (myYard === 4) return 'idle';
    return 'happy';
  })();

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

      <Board
        state={state}
        mySeat={mySeat}
        legal={legal}
        onMove={onMove}
        pawn={progress.pawn}
      />

      {/* Pippo sits under the board, where he is visible without competing
          with the pieces for attention. */}
      <MascotSays
        avatar={progress.avatar}
        mood={mood}
        line={mascotLine(mood, state.version)}
        size={58}
      />

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
  onRematch,
  onReact,
  tally,
  progress,
}: {
  room: RoomView;
  state: MatchState;
  mySeat: SeatIndex | null;
  onLeave: () => void;
  onRematch: () => void;
  onReact: (emoji: string) => void;
  tally: { readonly lines: readonly TallyLine[]; readonly total: number } | null;
  progress: ProgressState;
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
      <Confetti active={iWon} style={progress.celebration} />

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

        {/* Pippo reacts to the result before the standings are read. He
            commiserates rather than gloats on a loss. */}
        <div className="victory-fox">
          <Mascot avatar={progress.avatar} mood={iWon ? 'cheer' : 'sad'} size={92} />
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

      {tally ? (
        <XpTally lines={tally.lines} total={tally.total} progress={progress} />
      ) : null}

      {/*
        Rematch is the primary action, not "back to home".

        The moment right after a result is when the appetite for another game
        is highest -- especially after a loss, and most of all after a close
        one. Making the player navigate home and rebuild a room to get there
        spends that appetite on menus.

        For a bot match this restarts immediately. For a room it reuses the
        same room and the same people, so "revenge" is against the player who
        actually beat you rather than a fresh lobby of strangers.
      */}
      <div className="rematch-row">
        <button type="button" className="btn btn-primary" onClick={onRematch}>
          {iWon ? 'Play again' : 'Rematch'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onLeave}>
          Home
        </button>
      </div>

      <div style={{ marginTop: 14 }}>
        <ReactionBar onReact={onReact} />
      </div>
    </>
  );
}
