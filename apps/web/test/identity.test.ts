/**
 * Who this device is.
 *
 * The seat-matching bug this covers was invisible on the host's phone --
 * the host happened to be the first player in the list, so the wrong
 * lookup returned the right answer for them and the wrong one for everyone
 * who joined. Tests here assert the identity itself rather than the UI, so
 * a regression shows up without needing two phones.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { storedPlayerId } from '../src/lib/api.js';

/** Builds a token in the server's format: base64url(JSON) + "." + sig. */
function token(payload: unknown, signature = 'sig'): string {
  const json = JSON.stringify(payload);
  const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.${signature}`;
}

beforeEach(() => {
  localStorage.clear();
});

describe('storedPlayerId', () => {
  it('reads the player id out of a stored token', () => {
    localStorage.setItem(
      'ludolite.playerToken',
      token({ playerId: 'player_abc', issuedAt: 1 }),
    );
    expect(storedPlayerId()).toBe('player_abc');
  });

  it('returns null when there is no token', () => {
    expect(storedPlayerId()).toBeNull();
  });

  it('returns null for a malformed token rather than throwing', () => {
    localStorage.setItem('ludolite.playerToken', 'not-a-token');
    expect(storedPlayerId()).toBeNull();
  });

  it('returns null when the payload is not JSON', () => {
    localStorage.setItem('ludolite.playerToken', `${btoa('nonsense{')}.sig`);
    expect(storedPlayerId()).toBeNull();
  });

  it('returns null when the payload has no playerId', () => {
    localStorage.setItem('ludolite.playerToken', token({ issuedAt: 1 }));
    expect(storedPlayerId()).toBeNull();
  });

  it('returns null for an empty playerId', () => {
    localStorage.setItem('ludolite.playerToken', token({ playerId: '', issuedAt: 1 }));
    expect(storedPlayerId()).toBeNull();
  });

  it('handles base64url payloads containing - and _', () => {
    // A player id whose JSON encodes to characters that differ between
    // base64 and base64url; decoding without normalising would fail.
    const id = 'player_??>>~~ok';
    localStorage.setItem('ludolite.playerToken', token({ playerId: id, issuedAt: 1 }));
    expect(storedPlayerId()).toBe(id);
  });

  it('distinguishes two different players', () => {
    localStorage.setItem('ludolite.playerToken', token({ playerId: 'host_1', issuedAt: 1 }));
    const host = storedPlayerId();
    localStorage.setItem('ludolite.playerToken', token({ playerId: 'joiner_2', issuedAt: 2 }));
    const joiner = storedPlayerId();

    // The whole point: a joiner must not resolve to the host.
    expect(host).toBe('host_1');
    expect(joiner).toBe('joiner_2');
    expect(host).not.toBe(joiner);
  });
});
