/**
 * Connection banner.
 *
 * A multiplayer game that silently stops responding is the worst failure mode
 * — the player cannot tell whether it is their network, the other players, or
 * a bug. This says which, and says that their seat is safe.
 */

export type ConnectionState = 'connected' | 'connecting' | 'offline' | 'restarting';

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  if (state === 'connected') return null;

  const copy: Record<Exclude<ConnectionState, 'connected'>, { title: string; body: string }> = {
    connecting: {
      title: 'Reconnecting',
      body: 'Your seat is held. The match continues as soon as you are back.',
    },
    offline: {
      title: 'You are offline',
      body: 'Check your connection. Your seat is held and nothing is lost.',
    },
    restarting: {
      title: 'Server is restarting',
      body: 'This takes a few seconds. You will rejoin automatically.',
    },
  };

  const { title, body } = copy[state];

  return (
    <div className="notice n-warn" role="status" aria-live="polite">
      <span className="pulse" aria-hidden="true" />
      <span>
        <b>{title}</b>
        {body}
      </span>
    </div>
  );
}
