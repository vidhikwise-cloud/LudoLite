/**
 * The Ludo board.
 *
 * Renders from MatchState, which is the server's state. Tapping a token emits
 * intent; it does not move anything locally. The server replies with the next
 * state, which is what the board then shows.
 *
 * Tokens TRAVEL. When the state changes, each moved token walks its real
 * route square by square rather than teleporting — that journey is most of
 * what makes a Ludo board feel alive, especially when a token is creeping up
 * behind an opponent.
 *
 * Geometry: the classic 15x15 grid. Track squares are generated from one
 * quadrant rotated four times, so the 52 cells are guaranteed contiguous and
 * matched to the engine's absolute square indices.
 */

import {
  SEAT_COLOR_BY_INDEX,
  isSafeSquare,
  type LegalMove,
  type MatchState,
  type SeatIndex,
  type TokenIndex,
  type TokenPosition,
} from '@ludolite/engine';
import { useEffect, useMemo, useRef, useState } from 'react';

import { sfx } from '../lib/feedback.js';
import { HOP_MS, LAND_MS, expandPath } from '../lib/path.js';

const GRID = 15;

/**
 * Grid coordinates for track squares 0..51, clockwise.
 *
 * Generated rather than hand-written: the loop is one quadrant repeated four
 * times under 90-degree rotation, so deriving it keeps every corner correct
 * and guarantees the 52 cells are contiguous. A hand-typed table of 52 pairs
 * is very easy to get subtly wrong, and a gap in the path would show up as a
 * token teleporting mid-move.
 *
 * Square 0 is seat 0's entry at column 1, row 6.
 */
const TRACK: ReadonlyArray<readonly [number, number]> = buildTrack();

/** Exported so the geometry can be asserted against the engine in tests. */
export const TRACK_CELLS = TRACK;

function buildTrack(): ReadonlyArray<readonly [number, number]> {
  // One quadrant, 13 cells: five along the entry row, six up the arm, then
  // two across the tip. 13 x 4 = the engine's 52-square loop.
  //
  // The step from [5,6] to [6,5] is the diagonal shoulder turn where the
  // entry row meets the arm — the one place the path is not orthogonal.
  // That is the standard board's shape, not an error in the table.
  const quadrant: ReadonlyArray<readonly [number, number]> = [
    [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
    [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
    [7, 0],
    [8, 0],
  ];

  const centre = (GRID - 1) / 2; // 7
  const cells: Array<readonly [number, number]> = [];

  for (let turn = 0; turn < 4; turn++) {
    for (const [x, y] of quadrant) {
      // Rotate (x, y) clockwise about the board centre, `turn` times.
      let px = x - centre;
      let py = y - centre;
      for (let i = 0; i < turn; i++) {
        const nx = -py;
        const ny = px;
        px = nx;
        py = ny;
      }
      cells.push([px + centre, py + centre]);
    }
  }

  return cells;
}

/** Home-run cells for each seat, from the board edge inward. */
const HOME_RUN: Readonly<Record<SeatIndex, ReadonlyArray<readonly [number, number]>>> = {
  0: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  1: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  2: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  3: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
};

/** Yard positions (the four parking spots) for each seat. */
const YARD: Readonly<Record<SeatIndex, ReadonlyArray<readonly [number, number]>>> = {
  0: [[1.6, 1.6], [3.6, 1.6], [1.6, 3.6], [3.6, 3.6]],
  1: [[10.4, 1.6], [12.4, 1.6], [10.4, 3.6], [12.4, 3.6]],
  2: [[10.4, 10.4], [12.4, 10.4], [10.4, 12.4], [12.4, 12.4]],
  3: [[1.6, 10.4], [3.6, 10.4], [1.6, 12.4], [3.6, 12.4]],
};

/** Yard block outlines, drawn behind the tokens. */
const YARD_BLOCK: Readonly<Record<SeatIndex, readonly [number, number]>> = {
  0: [0, 0],
  1: [9, 0],
  2: [9, 9],
  3: [0, 9],
};

function positionFor(
  seat: SeatIndex,
  position: TokenPosition,
  tokenIndex: TokenIndex,
): readonly [number, number] | null {
  switch (position.kind) {
    case 'yard':
      return YARD[seat][tokenIndex] ?? null;
    case 'track':
      return TRACK[position.square] ?? null;
    case 'home':
      return HOME_RUN[seat][position.step] ?? null;
    case 'finish':
      // Finished tokens rest in the centre, fanned slightly so a stack of
      // four is still legible.
      return [7 + (tokenIndex % 2) * 0.34 - 0.17, 7 + Math.floor(tokenIndex / 2) * 0.34 - 0.17];
    default:
      return null;
  }
}

type TokenKey = `${SeatIndex}-${TokenIndex}`;

interface RenderedToken {
  readonly key: TokenKey;
  readonly seat: SeatIndex;
  readonly token: TokenIndex;
  readonly position: TokenPosition;
}

/** Flattens match state into one entry per token on the board. */
function tokensOf(state: MatchState): RenderedToken[] {
  const out: RenderedToken[] = [];
  for (const seat of state.seats) {
    if (seat.playerId === null) continue;
    for (const token of seat.tokens) {
      out.push({
        key: `${seat.index}-${token.index}`,
        seat: seat.index,
        token: token.index,
        position: token.position,
      });
    }
  }
  return out;
}

function samePosition(a: TokenPosition, b: TokenPosition): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'track' && b.kind === 'track') return a.square === b.square;
  if (a.kind === 'home' && b.kind === 'home') return a.step === b.step;
  return true;
}

export function Board({
  state,
  mySeat,
  legal,
  onMove,
}: {
  state: MatchState;
  mySeat: SeatIndex | null;
  legal: readonly LegalMove[];
  onMove: (token: TokenIndex, die: number) => void;
}) {
  /**
   * What is drawn right now. Lags the authoritative state while tokens are
   * walking their route; always catches up to it.
   */
  const [shown, setShown] = useState<RenderedToken[]>(() => tokensOf(state));
  const [capturing, setCapturing] = useState<Set<TokenKey>>(new Set());
  const [landing, setLanding] = useState<TokenKey | null>(null);

  const timers = useRef<number[]>([]);
  const previous = useRef<MatchState>(state);

  useEffect(() => {
    return () => {
      timers.current.forEach(window.clearTimeout);
      timers.current = [];
    };
  }, []);

  useEffect(() => {
    const before = previous.current;
    previous.current = state;

    const beforeTokens = tokensOf(before);
    const afterTokens = tokensOf(state);

    // Which tokens actually changed square?
    const moved = afterTokens.filter((token) => {
      const old = beforeTokens.find((t) => t.key === token.key);
      return old && !samePosition(old.position, token.position);
    });

    if (moved.length === 0) {
      setShown(afterTokens);
      return;
    }

    // A token sent back to its yard was captured — animate that differently
    // from a token advancing.
    const captured = moved.filter((t) => t.position.kind === 'yard');
    const advanced = moved.filter((t) => t.position.kind !== 'yard');

    timers.current.forEach(window.clearTimeout);
    timers.current = [];

    const advancing = advanced[0];
    if (!advancing) {
      setShown(afterTokens);
      return;
    }

    const origin = beforeTokens.find((t) => t.key === advancing.key);
    const route = origin
      ? expandPath(advancing.seat, origin.position, advancing.position)
      : [advancing.position];

    // Walk the moving token through each square in turn.
    route.forEach((step, index) => {
      const id = window.setTimeout(() => {
        setShown((current) =>
          current.map((t) => (t.key === advancing.key ? { ...t, position: step } : t)),
        );

        const isLast = index === route.length - 1;
        if (!isLast) {
          sfx.hop();
          return;
        }

        // Arrival.
        setLanding(advancing.key);
        if (step.kind === 'finish') sfx.home();
        else sfx.land();

        const clearLanding = window.setTimeout(() => setLanding(null), 320);
        timers.current.push(clearLanding);

        // Captures resolve on arrival, not before — the knock happens when
        // the token actually gets there.
        if (captured.length > 0) {
          const keys = new Set(captured.map((t) => t.key));
          setCapturing(keys);
          const isMine = captured.some((t) => t.seat === mySeat);
          if (isMine) sfx.captured();
          else sfx.capture();

          const settle = window.setTimeout(() => {
            setShown(afterTokens);
            setCapturing(new Set());
          }, 420);
          timers.current.push(settle);
        } else {
          const settle = window.setTimeout(() => setShown(afterTokens), LAND_MS);
          timers.current.push(settle);
        }
      }, index * HOP_MS);

      timers.current.push(id);
    });
  }, [state, mySeat]);

  const movable = useMemo(() => {
    const map = new Map<TokenIndex, number>();
    for (const move of legal) map.set(move.token, move.die);
    return map;
  }, [legal]);

  // Stack offset so co-located tokens stay individually visible.
  const occupancy = new Map<string, number>();
  const placed = shown.map((token) => {
    const at = positionFor(token.seat, token.position, token.token);
    if (!at) return null;
    const cellKey = `${at[0]},${at[1]}`;
    const stacked = occupancy.get(cellKey) ?? 0;
    occupancy.set(cellKey, stacked + 1);
    return { token, at, stacked };
  });

  return (
    <div className="board-wrap">
      <svg
        className="board"
        viewBox={`0 0 ${GRID} ${GRID}`}
        role="img"
        aria-label="Ludo board"
      >
        <defs>
          {/* Soft drop shadow gives tokens physical weight. */}
          <filter id="tokenShadow" x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="0" dy="0.08" stdDeviation="0.07" floodOpacity="0.38" />
          </filter>
          {/* Highlight ring that pulses on a playable token. */}
          <radialGradient id="centreGlow">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Yard blocks */}
        {([0, 1, 2, 3] as SeatIndex[]).map((seat) => {
          const [x, y] = YARD_BLOCK[seat];
          const colour = `var(--${SEAT_COLOR_BY_INDEX[seat]})`;
          const isTurn = state.turnSeat === seat && state.phase === 'in-play';
          return (
            <g key={`yard-${seat}`}>
              <rect
                x={x}
                y={y}
                width={6}
                height={6}
                rx={0.6}
                fill={colour}
                opacity={isTurn ? 0.28 : 0.15}
                className="yard-block"
              />
              <rect
                x={x + 0.9}
                y={y + 0.9}
                width={4.2}
                height={4.2}
                rx={0.4}
                fill="var(--card)"
                opacity={0.82}
              />
              <rect
                x={x}
                y={y}
                width={6}
                height={6}
                rx={0.6}
                fill="none"
                stroke={colour}
                strokeWidth={isTurn ? 0.17 : 0.1}
                opacity={isTurn ? 1 : 0.55}
                className={isTurn ? 'yard-active' : undefined}
              />
            </g>
          );
        })}

        {/* Track squares */}
        {TRACK.map(([x, y], square) => {
          const safe = isSafeSquare(square);
          return (
            <g key={`track-${square}`}>
              <rect
                className={`cell${safe ? ' safe' : ''}`}
                x={x}
                y={y}
                width={1}
                height={1}
                rx={0.12}
              />
              {safe ? (
                <path
                  d={starPath(x + 0.5, y + 0.5, 0.3, 0.14)}
                  className="safe-star"
                />
              ) : null}
            </g>
          );
        })}

        {/* Home runs */}
        {([0, 1, 2, 3] as SeatIndex[]).map((seat) =>
          HOME_RUN[seat].map(([x, y], step) => (
            <rect
              key={`home-${seat}-${step}`}
              x={x}
              y={y}
              width={1}
              height={1}
              rx={0.12}
              fill={`var(--${SEAT_COLOR_BY_INDEX[seat]})`}
              opacity={0.3 + step * 0.1}
              stroke="var(--rule)"
              strokeWidth={0.04}
            />
          )),
        )}

        {/* Centre */}
        <g className="centre">
          <polygon points="6,6 9,6 7.5,7.5" fill="var(--green)" />
          <polygon points="9,6 9,9 7.5,7.5" fill="var(--yellow)" />
          <polygon points="9,9 6,9 7.5,7.5" fill="var(--blue)" />
          <polygon points="6,9 6,6 7.5,7.5" fill="var(--red)" />
          <circle cx="7.5" cy="7.5" r="1.5" fill="url(#centreGlow)" />
        </g>

        {/* Tokens */}
        {placed.map((entry) => {
          if (!entry) return null;
          const { token, at, stacked } = entry;
          const die = movable.get(token.token);
          const isMine = token.seat === mySeat;
          const canMove = isMine && die !== undefined && token.position.kind !== 'finish';

          const cx = at[0] + 0.5 + stacked * 0.11;
          const cy = at[1] + 0.5 - stacked * 0.11;
          const colour = `var(--${SEAT_COLOR_BY_INDEX[token.seat]})`;

          const classes = [
            'token',
            canMove ? 'movable' : '',
            capturing.has(token.key) ? 'captured' : '',
            landing === token.key ? 'landed' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <g
              key={token.key}
              className={classes}
              /*
               * The SVG transform attribute, not a CSS transform: inside a
               * viewBox the CSS `px` unit is reinterpreted as user units,
               * which happens to work but is fragile and differs between
               * engines. CSS still animates this attribute via the
               * `transition` on `.token`.
               */
              transform={`translate(${cx} ${cy})`}
              onClick={canMove ? () => onMove(token.token, die) : undefined}
              role={canMove ? 'button' : undefined}
              tabIndex={canMove ? 0 : undefined}
              aria-label={canMove ? `Move token ${token.token + 1} by ${die}` : undefined}
              onKeyDown={
                canMove
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onMove(token.token, die);
                      }
                    }
                  : undefined
              }
            >
              {canMove ? <circle r={0.52} className="token-halo" fill={colour} /> : null}
              <circle className="token-body" r={0.34} fill={colour} filter="url(#tokenShadow)" />
              {/* Rim and gloss read as a rounded, lit piece rather than a flat dot. */}
              <circle
                className="token-rim"
                r={0.34}
                fill="none"
                stroke="rgba(255,255,255,0.5)"
                strokeWidth={0.05}
              />
              <circle
                className="token-gloss"
                cx={-0.09}
                cy={-0.1}
                r={0.1}
                fill="rgba(255,255,255,0.55)"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Five-pointed star, used to mark safe squares. */
function starPath(cx: number, cy: number, outer: number, inner: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`);
  }
  return `M${points.join('L')}Z`;
}
