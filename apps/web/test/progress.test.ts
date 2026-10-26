/**
 * Progression rules.
 *
 * The parts worth testing here are the ones a player would notice being
 * wrong: a name that comes back empty, XP that double-counts, a streak that
 * punishes, or a claim that pays twice.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  ACHIEVEMENTS,
  MAX_NAME,
  claimMission,
  levelFromXp,
  levelProgress,
  loadProgress,
  randomName,
  recordMatch,
  setName,
  titleForLevel,
  winRate,
  xpForLevel,
  type MatchOutcome,
} from '../src/lib/progress.js';

const MATCH: MatchOutcome = {
  won: true,
  captures: 2,
  lost: 0,
  finished: 4,
  sixes: 1,
  opponents: 3,
  vsComputer: false,
};

beforeEach(() => {
  localStorage.clear();
});

describe('generated names', () => {
  it('never produces an empty name', () => {
    for (let i = 0; i < 200; i++) {
      expect(randomName().trim()).not.toBe('');
    }
  });

  it('stays within the length the server accepts', () => {
    // The server rejects anything over 24 characters, so a generated name
    // that exceeded it would be created here and refused on submit.
    for (let i = 0; i < 400; i++) {
      expect(randomName().length).toBeLessThanOrEqual(MAX_NAME);
    }
  });

  it('produces more than one name', () => {
    const seen = new Set(Array.from({ length: 60 }, () => randomName()));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('gives a fresh player a name without being asked', () => {
    expect(loadProgress().name.trim()).not.toBe('');
  });
});

describe('setName', () => {
  it('trims and keeps a real name', () => {
    const next = setName(loadProgress(), '  Vidhi  ');
    expect(next.name).toBe('Vidhi');
  });

  it('refuses a blank name rather than leaving the player nameless', () => {
    const before = loadProgress();
    expect(setName(before, '   ').name).toBe(before.name);
  });

  it('truncates to the server limit', () => {
    const next = setName(loadProgress(), 'x'.repeat(80));
    expect(next.name.length).toBe(MAX_NAME);
  });
});

describe('levels', () => {
  it('starts at level 1 with no XP', () => {
    expect(levelFromXp(0)).toBe(1);
  });

  it('never goes below level 1, even on a corrupt negative value', () => {
    expect(levelFromXp(-5000)).toBe(1);
  });

  it('is consistent with xpForLevel', () => {
    for (let level = 1; level <= 30; level++) {
      expect(levelFromXp(xpForLevel(level))).toBe(level);
    }
  });

  it('reports progress within the current level', () => {
    const p = levelProgress(xpForLevel(4));
    expect(p.level).toBe(4);
    expect(p.into).toBe(0);
    expect(p.pct).toBe(0);
  });

  it('gives every level a title', () => {
    for (let level = 1; level <= 40; level++) {
      expect(titleForLevel(level)).not.toBe('');
    }
  });
});

describe('recording a match', () => {
  it('counts a win and awards XP', () => {
    const delta = recordMatch(loadProgress(), MATCH);
    expect(delta.state.played).toBe(1);
    expect(delta.state.won).toBe(1);
    expect(delta.xpGained).toBeGreaterThan(0);
  });

  it('pays less for a match against bots than against people', () => {
    // Practice should not be the fastest route to a cosmetic.
    const human = recordMatch(loadProgress(), MATCH).xpGained;
    localStorage.clear();
    const bots = recordMatch(loadProgress(), { ...MATCH, vsComputer: true }).xpGained;
    expect(bots).toBeLessThan(human);
  });

  it('still pays something for a loss', () => {
    // A loss worth nothing teaches people to quit rather than finish.
    const delta = recordMatch(loadProgress(), { ...MATCH, won: false });
    expect(delta.xpGained).toBeGreaterThan(0);
  });

  it('unlocks the first-win achievement exactly once', () => {
    const first = recordMatch(loadProgress(), MATCH);
    expect(first.unlocked.map((a) => a.id)).toContain('first_win');
    const second = recordMatch(first.state, MATCH);
    expect(second.unlocked.map((a) => a.id)).not.toContain('first_win');
  });

  it('keeps a win streak and records the best one', () => {
    let state = loadProgress();
    for (let i = 0; i < 3; i++) state = recordMatch(state, MATCH).state;
    expect(state.winStreak).toBe(3);
    state = recordMatch(state, { ...MATCH, won: false }).state;
    expect(state.winStreak).toBe(0);
    expect(state.bestWinStreak).toBe(3);
  });

  it('never awards an achievement that is not in the catalogue', () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    const delta = recordMatch(loadProgress(), MATCH);
    for (const id of delta.state.achievements) expect(ids.has(id)).toBe(true);
  });
});

describe('missions', () => {
  it('pays a completed mission once', () => {
    // Two matches completes "play 2 matches".
    let state = recordMatch(loadProgress(), MATCH).state;
    state = recordMatch(state, MATCH).state;

    const before = state.xp;
    const claimed = claimMission(state, 'play_two');
    expect(claimed.xp).toBeGreaterThan(before);

    // Claiming again must not pay a second time.
    const again = claimMission(claimed, 'play_two');
    expect(again.xp).toBe(claimed.xp);
  });

  it('will not pay a mission that is not finished', () => {
    const state = loadProgress();
    expect(claimMission(state, 'capture_three').xp).toBe(state.xp);
  });
});

describe('corrupt storage', () => {
  it('survives junk and still returns a usable profile', () => {
    localStorage.setItem('ludolite.progress.v1', '{ not json');
    const state = loadProgress();
    expect(state.name.trim()).not.toBe('');
    expect(state.played).toBe(0);
  });

  it('survives a stored object with wrong types', () => {
    localStorage.setItem(
      'ludolite.progress.v1',
      JSON.stringify({ played: 'lots', xp: null, achievements: 'nope', avatar: 42 }),
    );
    const state = loadProgress();
    expect(state.played).toBe(0);
    expect(state.xp).toBe(0);
    expect(state.achievements).toEqual([]);
    expect(state.name.trim()).not.toBe('');
  });

  it('discards achievement ids that no longer exist', () => {
    localStorage.setItem(
      'ludolite.progress.v1',
      JSON.stringify({ achievements: ['first_win', 'deleted_one'] }),
    );
    expect(loadProgress().achievements).toEqual(['first_win']);
  });
});

describe('win rate', () => {
  it('is zero before any match rather than NaN', () => {
    expect(winRate(loadProgress())).toBe(0);
  });
});
