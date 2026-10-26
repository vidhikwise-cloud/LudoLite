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
  pawn = 'disc',
}: {
  state: MatchState;
  mySeat: SeatIndex | null;
  legal: readonly LegalMove[];
  onMove: (token: TokenIndex, die: number) => void;
  /**
   * The local player's chosen pawn shape.
   *
   * Applies to THIS player's tokens only; opponents always render as the
   * standard counter. Seat colour is how anyone finds their pieces in a
   * crowded match, and giving every player a different silhouette would
   * mean reading the board by shape instead -- slower, and worst exactly
   * when the board is busiest. See PAWNS in lib/progress.ts.
   */
  pawn?: string;
}) {
  /**
   * What is drawn right now. Lags the authoritative state while tokens are
   * walking their route; always catches up to it.
   */
  const [shown, setShown] = useState<RenderedToken[]>(() => tokensOf(state));
  const [capturing, setCapturing] = useState<Set<TokenKey>>(new Set());
  const [landing, setLanding] = useState<TokenKey | null>(null);

  /**
   * True for the first moment of a match, which plays the deal-in.
   *
   * Keyed on matchId so it runs once per match rather than on every mount:
   * a reconnect mid-game re-mounts the board, and replaying the opening
   * there would look like the match restarting.
   */
  const [dealing, setDealing] = useState(true);
  const dealtFor = useRef<string | null>(null);

  useEffect(() => {
    if (dealtFor.current === state.matchId) return;
    dealtFor.current = state.matchId;
    setDealing(true);
    const id = window.setTimeout(() => setDealing(false), 1150);
    return () => window.clearTimeout(id);
  }, [state.matchId]);

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
        className={`board${dealing ? ' dealing' : ''}`}
        viewBox={`0 0 ${GRID} ${GRID}`}
        role="img"
        aria-label="Ludo board"
      >
        <defs>
          {/*
           * Everything here exists to make the board read as a physical
           * object under a single light source, up and slightly left.
           *
           * A flat fill with a drop shadow reads as a dot on paper; the same
           * circle with a rim, a specular highlight and a contact shadow
           * reads as a counter sitting ON something. That difference is most
           * of what separates "an app showing a board" from "a game".
           *
           * All of it is SVG gradients and one blur filter -- no images, no
           * extra bytes, and it scales to any screen.
           */}

          {/* Contact shadow: tight and offset down, so a token looks like it
              is resting on the square rather than floating over it. */}
          <filter id="tokenShadow" x="-70%" y="-70%" width="240%" height="240%">
            <feDropShadow dx="0.02" dy="0.1" stdDeviation="0.055" floodOpacity="0.45" />
          </filter>

          {/* A playable token lifts: a larger, softer shadow sells the height. */}
          <filter id="tokenShadowLift" x="-90%" y="-90%" width="280%" height="280%">
            <feDropShadow dx="0.03" dy="0.17" stdDeviation="0.1" floodOpacity="0.4" />
          </filter>

          {/* Panels and the board slab get a broad ambient shadow. */}
          <filter id="slabShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0.12" stdDeviation="0.16" floodOpacity="0.2" />
          </filter>

          <radialGradient id="centreGlow">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>

          {/*
           * Token body shading. The light is up-left, so the highlight sits
           * at 32%/28% and the colour deepens toward the lower right. Pure
           * white at the centre would look like plastic wrap; a partial
           * white over the seat colour keeps the hue and still domes.
           */}
          <radialGradient id="tokenDome" cx="34%" cy="28%" r="78%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="42%" stopColor="#fff" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.3" />
          </radialGradient>

          {/* The specular dot: small, bright, up-left. This is the single
              most effective pixel on the whole board for "it is a 3D thing". */}
          <radialGradient id="tokenSpec" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="60%" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>

          {/*
           * Board slab: a lit top-left corner falling away to a shaded
           * bottom-right.
           *
           * Kept weak on purpose. This paints OVER the squares, so a strong
           * white stop washes the whole playfield out -- very visible in
           * dark mode, where a 10% white veil turns near-black squares grey
           * and the board loses its contrast.
           */}
          <linearGradient id="slab" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.045" />
            <stop offset="45%" stopColor="#fff" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.05" />
          </linearGradient>

          {/* Yard wells read as recessed: dark at the top edge where the
              rim would cast inward, lighter at the bottom. Inverse of the
              token, which is what makes one dome and the other dish. */}
          <linearGradient id="well" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#000" stopOpacity="0.16" />
            <stop offset="45%" stopColor="#000" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0.07" />
          </linearGradient>

          {/* Home-column squares get a subtle lengthwise sheen. */}
          <linearGradient id="laneSheen" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/*
         * The slab the game is played on.
         *
         * Without this the squares float on the page background and the
         * board has no edge. With it there is a table, and everything else
         * sits on top of something.
         */}
        <rect
          x={-0.15}
          y={-0.15}
          width={GRID + 0.3}
          height={GRID + 0.3}
          rx={0.9}
          className="board-slab"
          filter="url(#slabShadow)"
        />
        <rect
          x={-0.15}
          y={-0.15}
          width={GRID + 0.3}
          height={GRID + 0.3}
          rx={0.9}
          fill="url(#slab)"
        />

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
                fill="var(--board-well, var(--card))"
                opacity={0.82}
              />
              {/* Inset shading: dark along the top inner edge, light along
                  the bottom. The token uses the opposite ramp, so one dishes
                  and the other domes under the same light. */}
              <rect
                x={x + 0.9}
                y={y + 0.9}
                width={4.2}
                height={4.2}
                rx={0.4}
                fill="url(#well)"
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
              stroke="var(--board-line, var(--rule))"
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
              data-seat={token.seat}
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
              {/* A ring just outside the token's edge (r 0.34), not a disc
                  around the whole square. `color` feeds the stroke so the
                  ring takes the seat colour. */}
              {canMove ? (
                <circle r={0.43} className="token-halo" style={{ color: colour }} />
              ) : null}

              {/*
               * A carrom-style counter, built in layers from the table up:
               *
               *   base    the dark footprint the piece sits on, offset down
               *           so there is a visible edge of "side wall"
               *   body    the seat colour, carrying the contact shadow
               *   dome    light from the upper left, dark to the lower right
               *   rim     bright along the top arc only, where a real rounded
               *           edge would catch the light
               *   spec    the small bright highlight
               *   pip     a centre dot, which is what makes it look like a
               *           game piece rather than a bead
               *
               * Six cheap shapes. No images, and it scales to any screen.
               */}
              <circle cx={0} cy={0.055} r={0.335} fill="#000" opacity={0.3} />
              <circle
                className="token-body"
                r={0.34}
                fill={colour}
                filter={canMove ? 'url(#tokenShadowLift)' : 'url(#tokenShadow)'}
              />
              <circle className="token-dome" r={0.34} fill="url(#tokenDome)" />
              {/* Top arc only: a full ring reads as a sticker, an arc as a bevel. */}
              <path
                className="token-rim"
                d="M -0.3 -0.12 A 0.325 0.325 0 0 1 0.3 -0.12"
                fill="none"
                stroke="rgba(255,255,255,0.65)"
                strokeWidth={0.05}
                strokeLinecap="round"
              />
              <circle
                className="token-gloss"
                cx={-0.105}
                cy={-0.115}
                r={0.105}
                fill="url(#tokenSpec)"
              />
              {/*
                The centre mark. For the local player this becomes their
                chosen pawn shape; everyone else keeps the plain pip, so the
                board still reads by colour. Drawn ON TOP of the finished
                counter rather than replacing it, which keeps the lighting
                and the contact shadow identical for every piece.
              */}
              <PawnMark shape={isMine ? pawn : 'disc'} colour={colour} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * The centre mark that distinguishes a chosen pawn.
 *
 * Deliberately small and inside the counter's edge. A shape that changed
 * the piece's silhouette would alter how much of a square it covers and how
 * two adjacent pieces read -- the counter stays the counter, and the mark
 * is what says "this one is mine".
 */
function PawnMark({ shape, colour }: { shape: string; colour: string }): JSX.Element {
  // A recessed well under every mark, so it reads as stamped rather than
  // printed on.
  const well = <circle cx={0} cy={0} r={0.115} fill="#000" opacity={0.17} />;

  switch (shape) {
    case 'pawn':
      return (
        <>
          {well}
          <path
            d="M -0.055 0.075 q 0 -0.055 0.028 -0.08 q 0.022 -0.02 0.005 -0.042 a 0.045 0.045 0 1 1 0.044 0 q -0.017 0.022 0.005 0.042 q 0.028 0.025 0.028 0.08 z"
            fill={colour}
            opacity={0.95}
          />
        </>
      );
    case 'gem':
      return (
        <>
          {well}
          <path d="M 0 -0.085 L 0.075 0 L 0 0.085 L -0.075 0 Z" fill={colour} opacity={0.95} />
          <path d="M 0 -0.085 L 0.075 0 L 0 0 Z" fill="#fff" opacity={0.35} />
        </>
      );
    case 'star':
      return (
        <>
          {well}
          <path d={starPath(0, 0, 0.095, 0.042)} fill={colour} opacity={0.95} />
        </>
      );
    case 'crown':
      return (
        <>
          {well}
          <path
            d="M -0.08 0.055 L -0.08 -0.03 L -0.04 0.012 L 0 -0.06 L 0.04 0.012 L 0.08 -0.03 L 0.08 0.055 Z"
            fill={colour}
            opacity={0.95}
          />
        </>
      );
    case 'disc':
    default:
      return (
        <>
          <circle cx={0} cy={0} r={0.1} fill="#000" opacity={0.17} />
          <circle cx={0} cy={-0.012} r={0.085} fill={colour} opacity={0.92} />
        </>
      );
  }
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
