/**
 * Live presence counting.
 *
 * The failure mode worth guarding is a count that only ever climbs: a
 * socket that connects, is never released on disconnect, and leaves a
 * phantom player online forever. That looks like success (a big number)
 * which is exactly why it needs a test.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  presenceConnected,
  presenceCount,
  presenceDisconnected,
  presenceIdentified,
  presenceLeft,
  presenceReset,
} from '../src/presence.js';

beforeEach(() => {
  presenceReset();
});

describe('presence', () => {
  it('starts at zero', () => {
    expect(presenceCount()).toBe(0);
  });

  it('counts an anonymous socket', () => {
    presenceConnected();
    expect(presenceCount()).toBe(1);
  });

  it('releases an anonymous socket on disconnect', () => {
    presenceConnected();
    presenceDisconnected();
    expect(presenceCount()).toBe(0);
  });

  it('counts an identified player once, not twice', () => {
    // The socket was already counted as anonymous; identifying it must
    // move it rather than add to it.
    presenceConnected();
    presenceIdentified('player_a');
    expect(presenceCount()).toBe(1);
  });

  it('counts one person with two tabs as one player', () => {
    presenceConnected();
    presenceIdentified('player_a');
    presenceConnected();
    presenceIdentified('player_a');
    expect(presenceCount()).toBe(1);
  });

  it('keeps the player online until their last socket goes', () => {
    presenceConnected();
    presenceIdentified('player_a');
    presenceConnected();
    presenceIdentified('player_a');

    presenceLeft('player_a');
    expect(presenceCount()).toBe(1);

    presenceLeft('player_a');
    expect(presenceCount()).toBe(0);
  });

  it('counts distinct players separately', () => {
    presenceConnected();
    presenceIdentified('player_a');
    presenceConnected();
    presenceIdentified('player_b');
    expect(presenceCount()).toBe(2);
  });

  it('never goes negative when disconnects outnumber connects', () => {
    // Can happen after a restart, where sockets disconnect that this
    // process never saw connect.
    presenceDisconnected();
    presenceDisconnected();
    expect(presenceCount()).toBe(0);

    presenceConnected();
    expect(presenceCount()).toBe(1);
  });

  it('ignores a leave for a player who was never counted', () => {
    presenceLeft('ghost');
    expect(presenceCount()).toBe(0);
  });

  it('does not leak when a player disconnects without identifying', () => {
    for (let i = 0; i < 50; i++) {
      presenceConnected();
      presenceDisconnected();
    }
    expect(presenceCount()).toBe(0);
  });
});
