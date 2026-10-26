/**
 * Live presence.
 *
 * How many distinct people are connected right now, for the landing page's
 * "players online" indicator.
 *
 * Counted by DISTINCT PLAYER ID, not by socket. One person with the game
 * open in two tabs, or reconnecting after a dropped connection, is one
 * player -- counting sockets would inflate the number exactly when the
 * network is bad and reconnects are most frequent.
 *
 * Deliberately in memory rather than in the database:
 *
 *   * it is true only for this instant, so persisting it is meaningless
 *   * it must survive no restart; a restart drops every socket anyway, so
 *     an empty map after one is the correct answer
 *   * the landing page polls it, and a database round trip per poll is a
 *     real cost on a free-tier Postgres for a decorative number
 *
 * This DOES mean the count is per-process. With more than one instance
 * each would report only its own share, which would need Redis or similar
 * to fix. Noted rather than solved, because this app runs as a single
 * instance (see render.yaml) and a wrong fix here would be worse than a
 * documented limit.
 */

/** playerId -> number of live sockets for that player. */
const live = new Map<string, number>();

/** Anonymous sockets: connected but not yet joined to a room. */
let anonymous = 0;

export function presenceConnected(): void {
  anonymous += 1;
}

export function presenceDisconnected(): void {
  anonymous = Math.max(0, anonymous - 1);
}

/**
 * Records a socket as belonging to a player.
 *
 * Called on room:join, which is the first point the server knows who a
 * socket is. The socket stops counting as anonymous at the same moment, so
 * it is never counted twice.
 */
export function presenceIdentified(playerId: string): void {
  anonymous = Math.max(0, anonymous - 1);
  live.set(playerId, (live.get(playerId) ?? 0) + 1);
}

export function presenceLeft(playerId: string): void {
  const count = live.get(playerId);
  if (count === undefined) return;
  if (count <= 1) live.delete(playerId);
  else live.set(playerId, count - 1);
}

/**
 * People online now: distinct identified players, plus sockets that have
 * connected but not yet identified. Someone staring at the landing page is
 * genuinely online even though the server does not know their name yet.
 */
export function presenceCount(): number {
  return live.size + anonymous;
}

/** Test seam. */
export function presenceReset(): void {
  live.clear();
  anonymous = 0;
}
