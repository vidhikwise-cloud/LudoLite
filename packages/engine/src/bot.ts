/**
 * Computer opponents.
 *
 * Pure like the rest of the engine: given a state and a list of legal moves,
 * return which one to play. No randomness is generated here — the caller
 * supplies it, so a bot's decisions can be replayed exactly in a test.
 *
 * The scoring is deliberately legible rather than clever. A Ludo bot that
 * plays perfectly is not fun; one that visibly goes for captures, races for
 * home, and occasionally leaves a piece hanging feels like a person.
 */

import {
  HOME_RUN_LENGTH,
  TRACK_STEPS_BEFORE_HOME,
  isSafeSquare,
  progressFromSquare,
  squareFromProgress,
} from './board.js';
import type { LegalMove, MatchState, SeatIndex, TokenPosition } from './types.js';

export type BotLevel = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  readonly level: BotLevel;
  /** Display name shown in the lobby and on the board. */
  readonly name: string;
  /** Seconds the bot appears to "think" before acting. */
  readonly thinkMs: { readonly min: number; readonly max: number };
}

export const BOT_PROFILES: Readonly<Record<BotLevel, BotProfile>> = {
  easy: { level: 'easy', name: 'Easy Bot', thinkMs: { min: 700, max: 1200 } },
  normal: { level: 'normal', name: 'Bot', thinkMs: { min: 600, max: 1100 } },
  hard: { level: 'hard', name: 'Hard Bot', thinkMs: { min: 500, max: 900 } },
};

/**
 * How far along its own route a position sits, 0 at the yard and rising to
 * the centre. Used to compare "which of my tokens is furthest ahead".
 */
function routeProgress(seat: SeatIndex, position: TokenPosition): number {
  switch (position.kind) {
    case 'yard':
      return -1;
    case 'track':
      return progressFromSquare(seat, position.square);
    case 'home':
      return TRACK_STEPS_BEFORE_HOME + 1 + position.step;
    case 'finish':
      return TRACK_STEPS_BEFORE_HOME + 1 + HOME_RUN_LENGTH;
  }
}

/**
 * How exposed a square is: the number of opponent tokens that could reach it
 * with a single roll of 1..6.
 *
 * This is the one piece of real lookahead. It is what stops the bot from
 * parking a token directly in front of an opponent, which is the mistake that
 * makes a bot feel stupid.
 */
function threatCount(state: MatchState, movingSeat: SeatIndex, target: TokenPosition): number {
  if (target.kind !== 'track') return 0;
  if (isSafeSquare(target.square)) return 0;

  let threats = 0;

  for (const seat of state.seats) {
    if (seat.index === movingSeat || seat.playerId === null) continue;

    for (const token of seat.tokens) {
      if (token.position.kind !== 'track') continue;

      const from = progressFromSquare(seat.index, token.position.square);
      for (let die = 1; die <= 6; die++) {
        const next = from + die;
        // An opponent past the loop turns into its own home run and can no
        // longer reach anything on the shared track.
        if (next > TRACK_STEPS_BEFORE_HOME) break;
        if (squareFromProgress(seat.index, next) === target.square) {
          threats++;
          break;
        }
      }
    }
  }

  return threats;
}

/** True when this move leaves the token on a square nobody can reach. */
function landsSafe(move: LegalMove): boolean {
  if (move.to.kind === 'home' || move.to.kind === 'finish') return true;
  if (move.to.kind === 'track') return isSafeSquare(move.to.square);
  return false;
}

export interface ScoredMove {
  readonly move: LegalMove;
  readonly score: number;
}

/**
 * Score a single move. Higher is better.
 *
 * The weights are tuned so the obvious human priorities come out on top:
 * finish a token, capture someone, get out of danger, make progress.
 */
export function scoreMove(
  state: MatchState,
  seat: SeatIndex,
  move: LegalMove,
  level: BotLevel,
): number {
  let score = 0;

  // Reaching the centre is worth more than anything else.
  if (move.finishes) score += 1000;

  // Capturing sends an opponent all the way back and grants another roll.
  if (move.captures.length > 0) {
    score += 400 * move.captures.length;
    // Knocking out a token that was nearly home is worth far more.
    for (const capture of move.captures) {
      const victim = state.seats
        .find((s) => s.index === capture.seat)
        ?.tokens.find((t) => t.index === capture.token);
      if (victim) score += routeProgress(capture.seat, victim.position) * 4;
    }
  }

  // Entering the home run: safe forever, and close to done.
  if (move.to.kind === 'home') score += 220 + move.to.step * 12;

  // Getting a token out of the yard is strong EARLY — more tokens on the
  // board means more options every turn. The bonus shrinks sharply as pieces
  // come out, because a flat bonus makes the bot spend every six adding
  // another token to its entry square instead of advancing: the pieces pile
  // up on one cell and the bot never makes progress.
  if (move.from.kind === 'yard') {
    const onBoard =
      state.seats
        .find((s) => s.index === seat)
        ?.tokens.filter((t) => t.position.kind === 'track' || t.position.kind === 'home')
        .length ?? 0;
    score += onBoard === 0 ? 240 : onBoard === 1 ? 150 : onBoard === 2 ? 60 : 20;
  }

  // Raw forward progress, so the bot does not shuffle aimlessly.
  const gained = routeProgress(seat, move.to) - routeProgress(seat, move.from);
  score += gained * 6;

  // Reward absolute distance travelled, not just this move's gain, so a token
  // that is already underway keeps going rather than being abandoned.
  score += routeProgress(seat, move.to) * 2;

  // Piling tokens onto one square wastes them: they advance together, block
  // nothing (same-seat tokens may share a cell), and a single bad roll leaves
  // the whole stack stranded.
  if (move.to.kind === 'track') {
    const destination = move.to.square;
    const sameSquare =
      state.seats
        .find((s) => s.index === seat)
        ?.tokens.filter(
          (t) =>
            t.index !== move.token &&
            t.position.kind === 'track' &&
            t.position.square === destination,
        ).length ?? 0;
    score -= sameSquare * 110;
  }

  if (level === 'easy') {
    // Easy stops here: it sees captures and finishes, but is blind to
    // danger. That is what makes it beatable without feeling broken.
    return score;
  }

  // --- danger awareness, normal and hard ----------------------------------

  const threatsAfter = threatCount(state, seat, move.to);
  const threatsBefore = threatCount(state, seat, move.from);

  if (landsSafe(move)) {
    score += 90;
  } else {
    // Landing in front of an opponent is the classic blunder.
    score -= threatsAfter * 70;
  }

  // Moving a token that was already under threat is worth doing.
  if (threatsBefore > 0) score += threatsBefore * 55;

  if (level === 'normal') return score;

  // --- hard only -----------------------------------------------------------

  // Prefer advancing the token that is furthest along: concentrating effort
  // finishes tokens rather than dragging four of them around together.
  score += routeProgress(seat, move.from) * 1.5;

  // Near the end of its route, push hard for the home turn.
  const toProgress = routeProgress(seat, move.to);
  if (toProgress > TRACK_STEPS_BEFORE_HOME - 6) score += 60;

  // Keep a token back if leaving the yard would strand it on a hot square.
  if (move.from.kind === 'yard' && threatsAfter > 1) score -= 120;

  return score;
}

/** Every legal move, scored and sorted best-first. */
export function rankMoves(
  state: MatchState,
  seat: SeatIndex,
  moves: readonly LegalMove[],
  level: BotLevel,
): ScoredMove[] {
  return moves
    .map((move) => ({ move, score: scoreMove(state, seat, move, level) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Pick a move.
 *
 * `random` must return a float in [0, 1). The caller owns randomness so bot
 * behaviour is reproducible in tests.
 *
 * Easy and normal deliberately misplay sometimes. A bot that always takes the
 * best move available is both frustrating and obviously mechanical; a bot
 * that occasionally takes the second-best choice reads as a person being
 * careless, which is much more pleasant to play against.
 */
export function chooseMove(
  state: MatchState,
  seat: SeatIndex,
  moves: readonly LegalMove[],
  level: BotLevel,
  random: () => number,
): LegalMove | null {
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0] ?? null;

  const ranked = rankMoves(state, seat, moves, level);
  const best = ranked[0];
  if (!best) return null;

  // Chance of NOT taking the top-ranked move.
  const slipChance = level === 'easy' ? 0.45 : level === 'normal' ? 0.15 : 0;

  if (random() < slipChance) {
    // Never throw away a win or a capture, even when slipping — a bot that
    // ignores an obvious capture looks broken rather than careless.
    const forgivable = ranked.filter(
      (entry) => !entry.move.finishes && entry.move.captures.length === 0,
    );
    const pool = forgivable.length > 0 ? forgivable : ranked;
    const pick = pool[Math.floor(random() * pool.length)];
    return pick?.move ?? best.move;
  }

  return best.move;
}

/** How long the bot should pause before acting, so it feels considered. */
export function thinkingTime(level: BotLevel, random: () => number): number {
  const { min, max } = BOT_PROFILES[level].thinkMs;
  return Math.round(min + random() * (max - min));
}
