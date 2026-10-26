/**
 * Player progression: stats, XP, levels, achievements, missions, streaks.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO COIN BALANCE
 * ---------------------------------------------------------------------------
 *
 * This file deliberately implements XP rather than coins.
 *
 * docs/COMPLIANCE.md commits to "no cash prizes, no betting, no withdrawals,
 * no redeemable monetary rewards". A soft currency called "coins" reads as a
 * wallet even when nothing can be withdrawn: it has a balance, it accrues,
 * and it is spent. Under the Promotion and Regulation of Online Gaming Act,
 * 2025 the presence of an in-app currency is exactly the surface a reviewer
 * probes, and "ours is not redeemable" is a claim that must then be defended
 * rather than a question that never arises.
 *
 * XP carries the same loop -- earn on play, accumulate, unlock cosmetics --
 * with none of the monetary framing. It is a score, not a balance. It cannot
 * be spent, transferred, topped up, or cashed out, and there is no code path
 * that could grow into any of those.
 *
 * If a currency is ever genuinely wanted, that is a compliance decision with
 * a legal opinion behind it, not a refactor of this file.
 *
 * ---------------------------------------------------------------------------
 * WHY STREAKS NEVER PUNISH
 * ---------------------------------------------------------------------------
 *
 * A missed day resets the count to 1 and nothing else. Nothing is taken away,
 * no progress is destroyed, no "streak lost!" screen is shown, and the
 * weekly track keeps whatever it had. Loss-framed streaks manufacture
 * obligation, and obligation is what makes people resent a game they used to
 * enjoy -- the opposite of the goal.
 *
 * ---------------------------------------------------------------------------
 * STORAGE
 * ---------------------------------------------------------------------------
 *
 * Everything is local to the device, in localStorage. There are no accounts,
 * so there is nothing to sync and nothing to leak. Every read is defensive:
 * stored shapes can be from an older build, hand-edited, or absent, and the
 * UI must never crash because of what is in storage. A malformed record is
 * replaced with a fresh one rather than repaired.
 */

const STORAGE_KEY = 'ludolite.progress.v1';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type MissionId = 'play_two' | 'win_one' | 'capture_three';

export interface Mission {
  readonly id: MissionId;
  readonly label: string;
  readonly hint: string;
  readonly target: number;
  readonly xp: number;
}

export interface MissionProgress {
  readonly id: MissionId;
  readonly done: number;
  readonly claimed: boolean;
}

export interface Achievement {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly icon: string;
  readonly xp: number;
}

export interface MatchOutcome {
  /** Did this device's player win. */
  readonly won: boolean;
  /** Tokens this player captured during the match. */
  readonly captures: number;
  /** Tokens this player lost to captures. */
  readonly lost: number;
  /** Tokens this player brought home. */
  readonly finished: number;
  /** Sixes rolled in the match. */
  readonly sixes: number;
  /** Opponents in the match, for the rematch prompt. */
  readonly opponents: number;
  /** True when every opponent was a bot. */
  readonly vsComputer: boolean;
}

export interface ProgressState {
  readonly version: 1;
  /* Lifetime stats. */
  readonly played: number;
  readonly won: number;
  readonly captures: number;
  readonly lost: number;
  readonly finished: number;
  readonly sixes: number;
  readonly bestWinStreak: number;
  readonly winStreak: number;
  /* Progression. */
  readonly xp: number;
  readonly achievements: readonly string[];
  readonly themes: readonly string[];
  readonly avatar: string;
  readonly theme: string;
  /** Generated on first run; the player can change it in their profile. */
  readonly name: string;
  /* Identity cosmetics. All earned by playing; none are for sale. */
  readonly pawn: string;
  readonly frame: string;
  readonly celebration: string;
  readonly title: string;
  /* Daily. */
  readonly day: string;
  readonly missions: readonly MissionProgress[];
  readonly streakDays: number;
  readonly weekClaimed: number;
  readonly lastPlayed: string | null;
}

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                  */
/* -------------------------------------------------------------------------- */

export const MISSIONS: readonly Mission[] = [
  { id: 'play_two', label: 'Play 2 matches', hint: 'Any mode counts', target: 2, xp: 50 },
  { id: 'win_one', label: 'Win 1 match', hint: 'Against anyone', target: 1, xp: 100 },
  {
    id: 'capture_three',
    label: 'Cut 3 opponent tokens',
    hint: 'Across any matches today',
    target: 3,
    xp: 75,
  },
];

/** Bonus for finishing all three. */
export const ALL_MISSIONS_XP = 50;

/**
 * Achievements reward memorable moments and skill, never time served.
 *
 * There is deliberately no "play N days" or "open the app" achievement: those
 * reward attendance rather than anything the player did, and attendance
 * rewards are the ones that curdle into obligation.
 */
export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first_win', name: 'First Blood', blurb: 'Win your first match', icon: '🏆', xp: 100 },
  { id: 'triple_cut', name: 'Triple Threat', blurb: 'Cut 3 tokens in one match', icon: '⚔️', xp: 150 },
  { id: 'flawless', name: 'Untouchable', blurb: 'Win without losing a token', icon: '🛡️', xp: 200 },
  { id: 'six_streak', name: 'Dice Whisperer', blurb: 'Roll 5 sixes in one match', icon: '🎲', xp: 150 },
  { id: 'comeback', name: 'Comeback King', blurb: 'Win after losing 3 tokens', icon: '🔥', xp: 200 },
  { id: 'ten_wins', name: 'Veteran', blurb: 'Win 10 matches', icon: '⭐', xp: 250 },
  { id: 'streak_three', name: 'On a Roll', blurb: 'Win 3 matches in a row', icon: '🚀', xp: 200 },
  { id: 'centurion', name: 'Centurion', blurb: 'Play 100 matches', icon: '💯', xp: 500 },
];

export interface BoardTheme {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly level: number;
}

/**
 * Themes unlock by playing and are never purchasable.
 *
 * Selling cosmetics inside the Android build would engage Play Billing
 * policy, which is a materially different compliance question from the one
 * this project has scoped. See docs/COMPLIANCE.md and capacitor.config.ts.
 */
export const THEMES: readonly BoardTheme[] = [
  { id: 'classic', name: 'Classic Paper', blurb: 'Warm paper and ink', level: 1 },
  { id: 'teak', name: 'Teak Board', blurb: 'Dark polished wood', level: 3 },
  { id: 'marble', name: 'Marble', blurb: 'Cool stone and gold leaf', level: 5 },
  { id: 'midnight', name: 'Midnight', blurb: 'Deep indigo and brass', level: 8 },
  { id: 'festival', name: 'Festival', blurb: 'Rangoli brights', level: 12 },
];

/** `as const` so AVATARS[0] is a known string rather than possibly undefined. */
export const AVATARS = [
  '🦊', '🐯', '🦁', '🐼', '🐸', '🦉', '🐙', '🦄', '🐝', '🦋', '🐢', '🦅',
] as const;

export const DEFAULT_AVATAR = AVATARS[0];

/* -------------------------------------------------------------------------- */
/* Identity cosmetics                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Everything in this section is EARNED BY PLAYING and never purchasable.
 *
 * Selling cosmetics inside the Android build would engage Play Billing
 * policy, which is a materially different compliance question from the one
 * this project has scoped -- and a store would turn XP into a currency,
 * which lib/progress.ts exists to avoid. See the header of this file and
 * docs/COMPLIANCE.md.
 */
export interface Cosmetic {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly level: number;
}

/**
 * Pawn shapes.
 *
 * IMPORTANT: a chosen pawn is drawn for YOUR OWN tokens on YOUR OWN screen
 * only. Opponents always render as the standard counter.
 *
 * Seat colour is how a player finds their pieces mid-match. If every player
 * also had a different silhouette, reading the board would mean scanning
 * for a shape rather than a colour, which is slower and worse exactly when
 * the board is crowded. Restricting shapes to the local player keeps the
 * identity and costs no legibility.
 */
export const PAWNS: readonly Cosmetic[] = [
  { id: 'disc', name: 'Classic Counter', blurb: 'The standard carrom disc', level: 1 },
  { id: 'pawn', name: 'Tall Pawn', blurb: 'Traditional tapered piece', level: 2 },
  { id: 'gem', name: 'Cut Gem', blurb: 'Faceted and sharp', level: 6 },
  { id: 'star', name: 'Star', blurb: 'Five points, no apologies', level: 9 },
  { id: 'crown', name: 'Crown', blurb: 'For the perpetually smug', level: 14 },
];

/** Avatar frames on the player card. */
export const FRAMES: readonly Cosmetic[] = [
  { id: 'plain', name: 'Plain', blurb: 'No frame', level: 1 },
  { id: 'ring', name: 'Ring', blurb: 'A simple band', level: 4 },
  { id: 'laurel', name: 'Laurel', blurb: 'Earned, not given', level: 7 },
  { id: 'flame', name: 'Ember', blurb: 'Warm glow', level: 11 },
  { id: 'aurora', name: 'Aurora', blurb: 'Shifting colour', level: 16 },
];

/** What happens on the victory screen when you win. */
export const CELEBRATIONS: readonly Cosmetic[] = [
  { id: 'confetti', name: 'Confetti', blurb: 'Paper, everywhere', level: 1 },
  { id: 'fireworks', name: 'Fireworks', blurb: 'Bursts above the crest', level: 5 },
  { id: 'petals', name: 'Petals', blurb: 'A gentler shower', level: 8 },
  { id: 'sparks', name: 'Sparks', blurb: 'Gold embers rising', level: 13 },
];

/**
 * Chosen titles, shown under the name.
 *
 * Distinct from the level title (titleForLevel), which is automatic. These
 * are picked, so they say something about how you play rather than how long
 * you have played.
 */
export const TITLES: readonly Cosmetic[] = [
  { id: 'none', name: 'No title', blurb: 'Just your name', level: 1 },
  { id: 'rookie', name: 'The Hopeful', blurb: 'Everyone starts here', level: 2 },
  { id: 'cutter', name: 'The Cutter', blurb: 'Takes it personally', level: 5 },
  { id: 'racer', name: 'The Racer', blurb: 'Straight for home', level: 8 },
  { id: 'wall', name: 'The Wall', blurb: 'Nothing gets past', level: 12 },
  { id: 'legend', name: 'The Legend', blurb: 'Earned the hard way', level: 18 },
];

/** Every cosmetic family, for the generic unlock check. */
export const COSMETIC_SETS = { PAWNS, FRAMES, CELEBRATIONS, TITLES } as const;

/** Is this cosmetic available at the player's level? */
export function cosmeticUnlocked(set: readonly Cosmetic[], id: string, level: number): boolean {
  const item = set.find((c) => c.id === id);
  return item !== undefined && level >= item.level;
}

/**
 * A stored cosmetic id, or the fallback if it is unknown or not yet earned.
 *
 * Used on load so a selection cannot survive the rules that granted it.
 */
function validCosmetic(
  set: readonly Cosmetic[],
  stored: unknown,
  xp: number,
  fallback: string,
): string {
  if (typeof stored !== 'string') return fallback;
  return cosmeticUnlocked(set, stored, levelFromXp(xp)) ? stored : fallback;
}

/* -------------------------------------------------------------------------- */
/* Names                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Word lists for generated names.
 *
 * Asking someone to invent a nickname before they can play is friction at
 * the exact moment they are least invested, and an empty required field is
 * the most common place a new player quits. So a name is generated up front
 * and the field is pre-filled; changing it is one tap, which is the right
 * order of operations.
 *
 * Deliberately gentle and non-aggressive: this is a game people play with
 * family, and "SavageKiller99" is not the register. Nothing here can
 * combine into anything crude -- that is a property of the word lists, and
 * it is the reason they are hand-picked rather than generated.
 */
const NAME_ADJECTIVES = [
  'Swift', 'Lucky', 'Clever', 'Bold', 'Sunny', 'Royal', 'Mighty', 'Gentle',
  'Rapid', 'Bright', 'Noble', 'Cosmic', 'Silent', 'Golden', 'Fearless', 'Witty',
  'Dashing', 'Breezy', 'Mellow', 'Spry',
] as const;

const NAME_NOUNS = [
  'Tiger', 'Falcon', 'Panda', 'Comet', 'Otter', 'Maharaja', 'Rocket', 'Mango',
  'Peacock', 'Dolphin', 'Lotus', 'Phoenix', 'Badger', 'Monsoon', 'Sparrow',
  'Cheetah', 'Walrus', 'Kite', 'Bison', 'Heron',
] as const;

/**
 * A fresh random display name, e.g. "Swift Peacock".
 *
 * A two-digit suffix lands on about a third of names: enough to break ties
 * in a room where two people rolled the same pair, without making every
 * name look auto-generated.
 */
export function randomName(): string {
  const a = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)];
  const n = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)];
  const suffix = Math.random() < 0.34 ? ` ${10 + Math.floor(Math.random() * 90)}` : '';
  return `${a} ${n}${suffix}`;
}

/** The stored name, generating and persisting one on first use. */
export function displayName(state: ProgressState): string {
  return state.name;
}

export function setName(prev: ProgressState, name: string): ProgressState {
  const trimmed = name.trim().slice(0, MAX_NAME);
  if (trimmed === '') return prev;
  const next = { ...prev, name: trimmed };
  saveProgress(next);
  return next;
}

/** Matches the server's own limit, so a name cannot be accepted here and
    rejected there. */
export const MAX_NAME = 24;

/* -------------------------------------------------------------------------- */
/* Levels                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Level curve.
 *
 * Quadratic so early levels arrive quickly and later ones take real play,
 * without ever becoming a wall. Level 1 starts at 0 XP.
 */
export function levelFromXp(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 120)) + 1);
}

export function xpForLevel(level: number): number {
  return Math.pow(Math.max(0, level - 1), 2) * 120;
}

export function levelProgress(xp: number): { level: number; into: number; need: number; pct: number } {
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const need = Math.max(1, next - base);
  const into = Math.max(0, xp - base);
  return { level, into, need, pct: Math.min(100, Math.round((into / need) * 100)) };
}

/**
 * Titles are cosmetic and derived, never stored, so the curve can change
 * without migrating anyone's saved data.
 */
export function titleForLevel(level: number): string {
  if (level >= 25) return 'Grandmaster';
  if (level >= 20) return 'Master';
  if (level >= 15) return 'Strategist';
  if (level >= 10) return 'Veteran';
  if (level >= 6) return 'Challenger';
  if (level >= 3) return 'Contender';
  return 'Newcomer';
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                    */
/* -------------------------------------------------------------------------- */

function today(): string {
  // Local date, not UTC: "today" should mean the player's today.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(a: string, b: string): number {
  const pa = Date.parse(`${a}T00:00:00`);
  const pb = Date.parse(`${b}T00:00:00`);
  if (Number.isNaN(pa) || Number.isNaN(pb)) return 99;
  return Math.round((pb - pa) / 86_400_000);
}

function freshMissions(): MissionProgress[] {
  return MISSIONS.map((m) => ({ id: m.id, done: 0, claimed: false }));
}

function initial(): ProgressState {
  return {
    version: 1,
    played: 0,
    won: 0,
    captures: 0,
    lost: 0,
    finished: 0,
    sixes: 0,
    bestWinStreak: 0,
    winStreak: 0,
    xp: 0,
    achievements: [],
    themes: ['classic'],
    avatar: DEFAULT_AVATAR,
    theme: 'classic',
    name: randomName(),
    pawn: 'disc',
    frame: 'plain',
    celebration: 'confetti',
    title: 'none',
    day: today(),
    missions: freshMissions(),
    streakDays: 0,
    weekClaimed: 0,
    lastPlayed: null,
  };
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Reads stored progress, tolerating anything.
 *
 * Storage can hold a shape from an older build, something hand-edited, or
 * nothing at all. Each field is validated independently so one bad value
 * costs that field rather than the player's whole history.
 */
export function loadProgress(): ProgressState {
  let stored: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return rollDay(initial());
    stored = JSON.parse(raw);
  } catch {
    return rollDay(initial());
  }

  if (typeof stored !== 'object' || stored === null) return rollDay(initial());
  const s = stored as Record<string, unknown>;
  const base = initial();

  const missions = Array.isArray(s.missions)
    ? MISSIONS.map((m) => {
        const found = (s.missions as unknown[]).find(
          (x): x is Record<string, unknown> =>
            typeof x === 'object' && x !== null && (x as Record<string, unknown>).id === m.id,
        );
        return {
          id: m.id,
          done: Math.min(m.target, num(found?.done)),
          claimed: found?.claimed === true,
        };
      })
    : freshMissions();

  const themes = strArray(s.themes);
  const avatar = typeof s.avatar === 'string' && (AVATARS as readonly string[]).includes(s.avatar) ? s.avatar : base.avatar;
  const themeId = typeof s.theme === 'string' && THEMES.some((t) => t.id === s.theme) ? s.theme : 'classic';

  return rollDay({
    version: 1,
    played: num(s.played),
    won: num(s.won),
    captures: num(s.captures),
    lost: num(s.lost),
    finished: num(s.finished),
    sixes: num(s.sixes),
    bestWinStreak: num(s.bestWinStreak),
    winStreak: num(s.winStreak),
    xp: num(s.xp),
    achievements: strArray(s.achievements).filter((id) => ACHIEVEMENTS.some((a) => a.id === id)),
    themes: themes.includes('classic') ? themes : ['classic', ...themes],
    avatar,
    theme: themeId,
    // An absent or blank stored name gets a fresh one rather than leaving
    // the field empty, which is the state this feature exists to avoid.
    name:
      typeof s.name === 'string' && s.name.trim() !== ''
        ? s.name.trim().slice(0, MAX_NAME)
        : randomName(),
    /*
     * Cosmetics are re-validated against the level on every load, not just
     * when chosen. A stored selection can outlive the rules -- an edited
     * file, or a catalogue whose levels changed between builds -- and a
     * cosmetic the player has not earned should quietly fall back to the
     * default rather than persist.
     */
    pawn: validCosmetic(PAWNS, s.pawn, num(s.xp), 'disc'),
    frame: validCosmetic(FRAMES, s.frame, num(s.xp), 'plain'),
    celebration: validCosmetic(CELEBRATIONS, s.celebration, num(s.xp), 'confetti'),
    title: validCosmetic(TITLES, s.title, num(s.xp), 'none'),
    day: typeof s.day === 'string' ? s.day : base.day,
    missions,
    streakDays: num(s.streakDays),
    weekClaimed: num(s.weekClaimed),
    lastPlayed: typeof s.lastPlayed === 'string' ? s.lastPlayed : null,
  });
}

export function saveProgress(state: ProgressState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full or disabled storage must not break the game. Progress is a
    // nice-to-have; the match in front of the player is not.
  }
}

/**
 * Rolls the daily missions over when the date has changed.
 *
 * A missed day resets the streak count to 1 on next play, but takes nothing
 * away: the weekly track and all XP are untouched. See the note at the top.
 */
function rollDay(state: ProgressState): ProgressState {
  const d = today();
  if (state.day === d) return state;
  return { ...state, day: d, missions: freshMissions() };
}

/* -------------------------------------------------------------------------- */
/* Recording a match                                                          */
/* -------------------------------------------------------------------------- */

export interface ProgressDelta {
  readonly state: ProgressState;
  readonly xpGained: number;
  readonly unlocked: readonly Achievement[];
  readonly themesUnlocked: readonly BoardTheme[];
  readonly leveledTo: number | null;
  readonly missionsCompleted: readonly Mission[];
}

/** XP for a finished match, before missions and achievements. */
function matchXp(o: MatchOutcome): number {
  // Playing is worth something; winning is worth more. A loss still pays,
  // because a game that pays nothing for losing teaches people to quit
  // rather than finish.
  let xp = 20;
  if (o.won) xp += 60;
  xp += o.captures * 10;
  xp += o.finished * 5;
  // Bot matches pay less: they are practice, and should not be the fastest
  // route to a cosmetic.
  if (o.vsComputer) xp = Math.round(xp * 0.5);
  return xp;
}

export function recordMatch(prev: ProgressState, o: MatchOutcome): ProgressDelta {
  let state = rollDay(prev);
  const beforeLevel = levelFromXp(state.xp);

  const winStreak = o.won ? state.winStreak + 1 : 0;
  const d = today();

  // Daily streak: consecutive days with at least one match played.
  let streakDays = state.streakDays;
  if (state.lastPlayed !== d) {
    const gap = state.lastPlayed ? daysBetween(state.lastPlayed, d) : 99;
    streakDays = gap === 1 ? state.streakDays + 1 : 1;
  }

  let xpGained = matchXp(o);

  // --- missions -----------------------------------------------------------
  const missionsCompleted: Mission[] = [];
  const missions = state.missions.map((mp) => {
    const def = MISSIONS.find((m) => m.id === mp.id);
    if (!def || mp.done >= def.target) return mp;
    let done = mp.done;
    if (def.id === 'play_two') done += 1;
    if (def.id === 'win_one' && o.won) done += 1;
    if (def.id === 'capture_three') done += o.captures;
    done = Math.min(def.target, done);
    if (done >= def.target && mp.done < def.target) missionsCompleted.push(def);
    return { ...mp, done };
  });

  // --- achievements -------------------------------------------------------
  const have = new Set(state.achievements);
  const unlocked: Achievement[] = [];
  const grant = (id: string) => {
    if (have.has(id)) return;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    have.add(id);
    unlocked.push(a);
    xpGained += a.xp;
  };

  const totalWon = state.won + (o.won ? 1 : 0);
  if (o.won) grant('first_win');
  if (o.captures >= 3) grant('triple_cut');
  if (o.won && o.lost === 0) grant('flawless');
  if (o.sixes >= 5) grant('six_streak');
  if (o.won && o.lost >= 3) grant('comeback');
  if (totalWon >= 10) grant('ten_wins');
  if (winStreak >= 3) grant('streak_three');
  if (state.played + 1 >= 100) grant('centurion');

  const xp = state.xp + xpGained;

  // --- theme unlocks ------------------------------------------------------
  const level = levelFromXp(xp);
  const themesUnlocked = THEMES.filter((t) => t.level <= level && !state.themes.includes(t.id));

  state = {
    ...state,
    played: state.played + 1,
    won: totalWon,
    captures: state.captures + o.captures,
    lost: state.lost + o.lost,
    finished: state.finished + o.finished,
    sixes: state.sixes + o.sixes,
    winStreak,
    bestWinStreak: Math.max(state.bestWinStreak, winStreak),
    xp,
    achievements: [...have],
    themes: [...state.themes, ...themesUnlocked.map((t) => t.id)],
    missions,
    streakDays,
    lastPlayed: d,
  };

  saveProgress(state);

  const afterLevel = levelFromXp(xp);
  return {
    state,
    xpGained,
    unlocked,
    themesUnlocked,
    leveledTo: afterLevel > beforeLevel ? afterLevel : null,
    missionsCompleted,
  };
}

/** Claims a finished mission's XP. Claiming twice is a no-op. */
export function claimMission(prev: ProgressState, id: MissionId): ProgressState {
  const def = MISSIONS.find((m) => m.id === id);
  const mp = prev.missions.find((m) => m.id === id);
  if (!def || !mp || mp.claimed || mp.done < def.target) return prev;

  const missions = prev.missions.map((m) => (m.id === id ? { ...m, claimed: true } : m));
  const allDone = missions.every((m) => m.claimed);
  const bonus = allDone && !prev.missions.every((m) => m.claimed) ? ALL_MISSIONS_XP : 0;

  const next: ProgressState = {
    ...prev,
    missions,
    xp: prev.xp + def.xp + bonus,
    weekClaimed: allDone ? Math.min(7, prev.weekClaimed + 1) : prev.weekClaimed,
  };
  saveProgress(next);
  return next;
}

export function setAvatar(prev: ProgressState, avatar: string): ProgressState {
  if (!(AVATARS as readonly string[]).includes(avatar)) return prev;
  const next = { ...prev, avatar };
  saveProgress(next);
  return next;
}

export function setTheme(prev: ProgressState, theme: string): ProgressState {
  if (!prev.themes.includes(theme)) return prev;
  const next = { ...prev, theme };
  saveProgress(next);
  return next;
}

/**
 * Chooses a cosmetic, refusing anything the player has not reached.
 *
 * The level check lives here rather than only in the picker, so a stale
 * stored value or a hand-edited one cannot grant a cosmetic that was never
 * earned. Refusing returns the previous state unchanged rather than
 * throwing: a locked selection is a no-op, not an error.
 */
function chooseCosmetic(
  prev: ProgressState,
  set: readonly Cosmetic[],
  key: 'pawn' | 'frame' | 'celebration' | 'title',
  id: string,
): ProgressState {
  if (!cosmeticUnlocked(set, id, levelFromXp(prev.xp))) return prev;
  const next = { ...prev, [key]: id };
  saveProgress(next);
  return next;
}

export function setPawn(prev: ProgressState, id: string): ProgressState {
  return chooseCosmetic(prev, PAWNS, 'pawn', id);
}

export function setFrame(prev: ProgressState, id: string): ProgressState {
  return chooseCosmetic(prev, FRAMES, 'frame', id);
}

export function setCelebration(prev: ProgressState, id: string): ProgressState {
  return chooseCosmetic(prev, CELEBRATIONS, 'celebration', id);
}

export function setChosenTitle(prev: ProgressState, id: string): ProgressState {
  return chooseCosmetic(prev, TITLES, 'title', id);
}

export function winRate(s: ProgressState): number {
  return s.played === 0 ? 0 : Math.round((s.won / s.played) * 100);
}
