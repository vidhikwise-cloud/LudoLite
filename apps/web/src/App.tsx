import type { MatchState, SeatIndex, TokenIndex } from '@ludolite/engine';
import type { PublicConfig, RoomView } from '@ludolite/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { BrandBar } from './components/Brand.js';
import { ConnectionStatus, type ConnectionState } from './components/ConnectionStatus.js';
import { MuteToggle } from './components/MuteToggle.js';
import * as api from './lib/api.js';
import { connectToRoom, type GameSocket } from './lib/socket.js';
import { CreateRoom } from './screens/CreateRoom.js';
import { Game } from './screens/Game.js';
import { Home } from './screens/Home.js';
import { JoinRoom } from './screens/JoinRoom.js';
import { Legal } from './screens/Legal.js';
import { Lobby } from './screens/Lobby.js';
import { PlayComputer } from './screens/PlayComputer.js';

type Screen =
  | 'home'
  | 'create'
  | 'join'
  | 'computer'
  | 'room'
  | 'privacy'
  | 'terms'
  | 'refund';

const LEGAL_SCREENS = ['privacy', 'terms', 'refund'] as const;
type LegalScreen = (typeof LEGAL_SCREENS)[number];

function isLegal(screen: Screen): screen is LegalScreen {
  return (LEGAL_SCREENS as readonly string[]).includes(screen);
}

const ROOM_STORAGE = 'ludolite.roomId';

export function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [room, setRoom] = useState<RoomView | null>(null);
  const [state, setState] = useState<MatchState | null>(null);
  const [lastDie, setLastDie] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connected');
  /** Set when a bot game was just created, so it starts without a lobby. */
  const [autoStart, setAutoStart] = useState(false);

  const socketRef = useRef<GameSocket | null>(null);

  // Browser-level connectivity. Distinct from socket state: the user being
  // offline and the server restarting need different messages.
  useEffect(() => {
    const online = () => setConnection((c) => (c === 'offline' ? 'connecting' : c));
    const offline = () => setConnection('offline');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    if (!navigator.onLine) setConnection('offline');
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  // Config drives every payment decision in the UI, so it is fetched before
  // anything renders and never cached across reloads.
  useEffect(() => {
    api
      .fetchConfig()
      .then(setConfig)
      .catch(() =>
        setError('Could not reach the server. Check your connection and reload.'),
      );
  }, []);

  // A code in the URL (from an invite link) opens the join screen prefilled.
  const inviteCode = new URLSearchParams(window.location.search).get('code') ?? undefined;
  useEffect(() => {
    if (inviteCode) setScreen('join');
  }, [inviteCode]);

  // Resume a room this device was already in, so a refresh mid-match does not
  // lose the seat. No payment step is involved on this path.
  useEffect(() => {
    const saved = localStorage.getItem(ROOM_STORAGE);
    if (!saved || room) return;

    api
      .fetchRoom(saved)
      .then(({ room: resumed }) => {
        if (resumed.status === 'complete' || resumed.status === 'cancelled') {
          localStorage.removeItem(ROOM_STORAGE);
          return;
        }
        setRoom(resumed);
        setScreen('room');
      })
      .catch(() => localStorage.removeItem(ROOM_STORAGE));
  }, [room]);

  const connect = useCallback((roomId: string) => {
    const token = api.storedToken();
    if (!token) return;

    socketRef.current?.close();
    const socket = connectToRoom(roomId, token);
    socketRef.current = socket;

    socket.on('room:update', setRoom);
    socket.on('match:state', setState);
    socket.on('match:rolled', ({ die }) => setLastDie(die));
    socket.on('match:ended', () => setLastDie(null));
    socket.on('error', ({ message }) => setError(message));

    socket.on('connect', () => setConnection('connected'));
    socket.on('disconnect', () =>
      setConnection(navigator.onLine ? 'connecting' : 'offline'),
    );
    socket.io.on('reconnect_attempt', () =>
      setConnection(navigator.onLine ? 'connecting' : 'offline'),
    );
    // The server announces a deploy before it drains, so the banner can say
    // "restarting" rather than the vaguer "reconnecting".
    socket.on('server:shutdown', () => setConnection('restarting'));
  }, []);

  useEffect(() => {
    if (room && screen === 'room') {
      localStorage.setItem(ROOM_STORAGE, room.roomId);
      connect(room.roomId);
    }
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [room?.roomId, screen, connect]);

  // A room created against bots is already full, so start it as soon as the
  // socket is connected rather than parking the player in a lobby of bots.
  useEffect(() => {
    if (!autoStart || !room || screen !== 'room') return;
    if (!room.canStart || state) return;

    const socket = socketRef.current;
    if (!socket?.connected) return;

    setAutoStart(false);
    socket.emit('room:start');
  }, [autoStart, room, screen, state, connection]);

  const mySeat: SeatIndex | null = (() => {
    if (!room || !state) return null;
    // The seat whose player id matches one of ours. The server told us the
    // room; we never assert a seat ourselves.
    const mine = room.players.find((p) =>
      state.seats.some((s) => s.playerId === p.playerId && s.index === p.seat),
    );
    return mine ? mine.seat : null;
  })();

  const isHost = Boolean(
    room && state === null
      ? room.players.find((p) => p.isHost && p.playerId === room.hostPlayerId)
      : room && room.hostPlayerId,
  );

  async function handleCreate(input: Parameters<typeof api.createRoom>[0]) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createRoom(input);

      // A paid room comes back pending. Checkout would open here; until a
      // provider is approved and wired up, this branch is unreachable because
      // the server refuses `funding: 'paid'` outright.
      if (result.payment) {
        setError(
          'This room needs payment before it becomes active. Payment is not available yet.',
        );
      }

      setRoom(result.room);
      setScreen('room');
    } catch (cause) {
      setError(
        cause instanceof api.ApiRequestError
          ? cause.message
          : 'Could not create the room. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Start a game against the computer.
   *
   * The room comes back already full, so there is nothing to wait for — go
   * straight into the match rather than showing a lobby of bots.
   */
  async function handlePlayComputer(input: Parameters<typeof api.createRoom>[0]) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createRoom(input);
      setRoom(result.room);
      setScreen('room');
      setAutoStart(true);
    } catch (cause) {
      setError(
        cause instanceof api.ApiRequestError
          ? cause.message
          : 'Could not set up the game. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(input: { code: string; displayName: string }) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.joinRoom(input);
      setRoom(result.room);
      setScreen('room');
    } catch (cause) {
      setError(
        cause instanceof api.ApiRequestError
          ? cause.message
          : 'Could not join that room. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  function leave() {
    socketRef.current?.emit('room:leave');
    socketRef.current?.close();
    socketRef.current = null;
    localStorage.removeItem(ROOM_STORAGE);
    setRoom(null);
    setState(null);
    setLastDie(null);
    setError(null);
    setScreen('home');
  }

  async function cancelAndRefund() {
    if (!room) return;
    setBusy(true);
    try {
      await api.requestRefund(room.roomId, 'Host cancelled the room');
      leave();
    } catch (cause) {
      setError(
        cause instanceof api.ApiRequestError
          ? cause.message
          : 'Could not cancel the room. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!config) {
    return (
      <div className="shell">
        <BrandBar />
        <div className="spinner" role="status" aria-label="Loading" />
        {error ? <p className="footnote">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="shell">
      {/* Sound matters most in a room, so the control lives there and on
          home. Home renders its own inside the brand bar. */}
      {screen === 'room' ? (
        <div className="toolbar">
          <MuteToggle />
        </div>
      ) : null}

      {screen === 'home' ? (
        <Home
          config={config}
          onCreate={() => {
            setError(null);
            setScreen('create');
          }}
          onJoin={() => {
            setError(null);
            setScreen('join');
          }}
          onPlayComputer={() => {
            setError(null);
            setScreen('computer');
          }}
        />
      ) : null}

      {screen === 'computer' ? (
        <PlayComputer
          busy={busy}
          error={error}
          onBack={() => setScreen('home')}
          onStart={(input) =>
            void handlePlayComputer({ ...input, funding: 'free' })
          }
        />
      ) : null}

      {screen === 'create' ? (
        <CreateRoom
          config={config}
          busy={busy}
          error={error}
          onBack={() => setScreen('home')}
          onCreate={handleCreate}
        />
      ) : null}

      {screen === 'join' ? (
        <JoinRoom
          busy={busy}
          error={error}
          initialCode={inviteCode}
          onBack={() => setScreen('home')}
          onJoin={handleJoin}
        />
      ) : null}

      {screen === 'room' ? <ConnectionStatus state={connection} /> : null}

      {screen === 'room' && room ? (
        state && state.phase !== 'awaiting-players' ? (
          <Game
            room={room}
            state={state}
            mySeat={mySeat}
            lastDie={lastDie}
            onRoll={() => socketRef.current?.emit('match:roll')}
            onMove={(token: TokenIndex, die: number) =>
              socketRef.current?.emit('match:move', { token, die })
            }
            onLeave={leave}
          />
        ) : (
          <Lobby
            room={room}
            isHost={isHost}
            busy={busy}
            error={error}
            onStart={() => socketRef.current?.emit('room:start')}
            onLeave={leave}
            onCancelAndRefund={room.funding === 'paid' ? cancelAndRefund : undefined}
          />
        )
      ) : null}

      {isLegal(screen) ? (
        <Legal page={screen} onBack={() => setScreen('home')} />
      ) : null}

      {/* Required for a public service, and for Play Store review. Hidden
          during a match so it cannot be tapped by mistake mid-turn. */}
      {screen !== 'room' ? (
        <nav className="footer-links" aria-label="Legal">
          <button type="button" onClick={() => setScreen('privacy')}>
            Privacy
          </button>
          <button type="button" onClick={() => setScreen('terms')}>
            Terms
          </button>
          <button type="button" onClick={() => setScreen('refund')}>
            Refunds
          </button>
        </nav>
      ) : null}
    </div>
  );
}
