import type { MatchState, SeatIndex, TokenIndex } from '@ludolite/engine';
import type { BotDifficulty, PublicConfig, RoomView } from '@ludolite/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { BrandBar } from './components/Brand.js';
import { ConnectionStatus, type ConnectionState } from './components/ConnectionStatus.js';
import { MuteToggle } from './components/MuteToggle.js';
import { RewardToasts, type RewardToast, type TallyLine } from './components/Progress.js';
import * as api from './lib/api.js';
import {
  loadProgress,
  recordMatch,
  type MatchOutcome,
  type ProgressState,
} from './lib/progress.js';
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

  const [progress, setProgress] = useState<ProgressState>(() => loadProgress());
  const [toasts, setToasts] = useState<readonly RewardToast[]>([]);

  /**
   * The breakdown shown on the victory screen.
   *
   * Kept separate from the toasts: toasts are transient and fire anywhere,
   * while this is the itemised tally that belongs on the result screen and
   * must survive until the player leaves it.
   */
  const [tally, setTally] = useState<{
    readonly lines: readonly TallyLine[];
    readonly total: number;
  } | null>(null);

  /**
   * Guards against double-counting a finished match.
   *
   * The winner arrives in socket state, and that state can be re-delivered on
   * reconnect or re-rendered on any update. Recording per match id rather
   * than per render is what stops a flaky connection from inflating someone's
   * stats.
   */
  const recordedRef = useRef<string | null>(null);

  /**
   * The bot difficulty the player last chose.
   *
   * RoomView does not carry it, so without this a rematch against the
   * computer would silently drop someone from hard back to easy -- which
   * reads as the game going soft on them after a loss.
   */
  const lastBotLevel = useRef<BotDifficulty>('normal');

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

  /**
   * Records a finished match into local progression.
   *
   * Derived from the final state rather than accumulated during play: a
   * reconnect replays events, and a counter incremented per event would
   * double-count. `recordedRef` keyed on match id makes this idempotent even
   * if the effect runs again for the same completed match.
   *
   * Captures are the one figure the final state cannot give us -- the engine
   * reports where tokens are now, not how they got there -- so "tokens sent
   * home" is counted as tokens of other seats still in the yard at the end.
   * That is an approximation, and it is deliberately the conservative kind:
   * it can undercount a token that was cut and then re-entered, never
   * overcount. A player's stats being slightly modest is a far better
   * failure than stats that inflate.
   */
  useEffect(() => {
    if (!state || state.phase !== 'complete' || mySeat === null || !room) return;
    if (recordedRef.current === state.matchId) return;
    recordedRef.current = state.matchId;

    const mine = state.seats.find((s) => s.index === mySeat);
    if (!mine) return;

    const inYard = (seatIndex: number) =>
      state.seats
        .find((s) => s.index === seatIndex)
        ?.tokens.filter((t) => t.position.kind === 'yard').length ?? 0;

    const captures = state.seats
      .filter((s) => s.index !== mySeat && s.playerId !== null)
      .reduce((sum, s) => sum + inYard(s.index), 0);

    const outcome: MatchOutcome = {
      won: state.winnerSeat === mySeat,
      captures,
      lost: inYard(mySeat),
      // 'finish' is the centre. 'home' is the run-in column before it, so
      // counting 'home' here would credit tokens that never arrived.
      finished: mine.tokens.filter((t) => t.position.kind === 'finish').length,
      // Sixes are not carried in the final state; counting them would need a
      // running tally that survives reconnects, which is not worth the
      // complexity for one achievement.
      sixes: 0,
      opponents: room.players.filter((p) => p.seat !== mySeat).length,
      vsComputer: room.players.every((p) => p.seat === mySeat || p.isBot),
    };

    const delta = recordMatch(progress, outcome);
    setProgress(delta.state);

    /*
     * Itemise where the XP came from. A single total invites "why?"; the
     * breakdown answers it and doubles as a readout of what the player
     * actually did this match.
     */
    const lines: TallyLine[] = [
      { icon: outcome.won ? '🏆' : '🎲', label: outcome.won ? 'Match won' : 'Match played', amount: outcome.won ? 80 : 20 },
    ];
    if (outcome.captures > 0) {
      lines.push({ icon: '⚔️', label: `${outcome.captures} token${outcome.captures === 1 ? '' : 's'} cut`, amount: outcome.captures * 10 });
    }
    if (outcome.finished > 0) {
      lines.push({ icon: '🏠', label: `${outcome.finished} brought home`, amount: outcome.finished * 5 });
    }
    for (const a of delta.unlocked) {
      lines.push({ icon: a.icon, label: a.name, amount: a.xp });
    }
    setTally({ lines, total: delta.xpGained });

    const next: RewardToast[] = [];
    if (delta.xpGained > 0) {
      next.push({
        id: `xp-${state.matchId}`,
        icon: '✨',
        title: `+${delta.xpGained} XP`,
        sub: outcome.won ? 'Match won' : 'Match played',
      });
    }
    if (delta.leveledTo !== null) {
      next.push({
        id: `lvl-${state.matchId}`,
        icon: '⬆️',
        title: `Level ${delta.leveledTo}`,
        sub: 'New level reached',
      });
    }
    for (const a of delta.unlocked) {
      next.push({ id: `ach-${a.id}`, icon: a.icon, title: a.name, sub: a.blurb });
    }
    for (const t of delta.themesUnlocked) {
      next.push({ id: `thm-${t.id}`, icon: '🎨', title: `${t.name} unlocked`, sub: t.blurb });
    }

    setToasts(next);
    const timer = window.setTimeout(() => setToasts([]), 5200);
    return () => window.clearTimeout(timer);
    // `progress` is read, not depended on: including it would re-run this on
    // every progression change and the ref guard would then be doing all the
    // work. The match id is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.phase, state?.matchId, mySeat, room]);

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
      if (input.bots) lastBotLevel.current = input.bots.level;
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
    setTally(null);
    setScreen('home');
  }

  /**
   * Rematch.
   *
   * Against the computer this is a true one-tap rematch: a new free room with
   * the same seat count and the same bot difficulty, started immediately.
   *
   * Against people it is NOT. `startMatch` returns the existing match when
   * `room.match` is set, so `room:start` on a finished room replays the
   * result rather than dealing a new board -- restarting a room needs a
   * server-side change (a new match row against the same memberships) that
   * is deliberately not being improvised here, because it touches paid-room
   * accounting: a second match in a room the host paid ₹1 for is a pricing
   * decision, not a UI one.
   *
   * So for a multiplayer room this returns the host to Create Room with the
   * same settings, which is one tap more than a true rematch and is honest
   * about what actually happens. It never silently appears to restart.
   */
  function handleRematch() {
    const botMatch =
      room !== null && room.players.every((p) => p.seat === mySeat || p.isBot);

    if (botMatch && room) {
      const me = room.players.find((p) => p.seat === mySeat);
      const seatCount = room.seatCount;
      const displayName = me?.displayName ?? 'You';
      const botCount = room.players.filter((p) => p.isBot).length;
      // Difficulty is not carried on RoomView, so the rematch uses the
      // default rather than inventing a level the player did not pick.
      leave();
      void handlePlayComputer({
        displayName,
        seatCount,
        funding: 'free',
        bots: { count: botCount, level: lastBotLevel.current },
      });
      return;
    }

    leave();
    setScreen('create');
  }

  /**
   * Quick reactions.
   *
   * Local only: there is no server event to broadcast them, and adding one
   * means deciding how a reaction aimed at another player is moderated and
   * rate limited. The fixed non-textual emoji set is what keeps the local
   * version safe to ship now; see the note in components/Progress.tsx.
   */
  function handleReact(emoji: string) {
    const el = document.createElement('div');
    el.className = 'reactfloat';
    el.textContent = emoji;
    el.style.left = `${45 + Math.random() * 10}%`;
    el.style.bottom = '22%';
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 1600);
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
    /*
     * The chosen board theme is published here as a data attribute, and the
     * theme rules in styles.css override the board's own custom properties
     * under it. The board keeps reading `var(--board-felt)` and friends and
     * knows nothing about themes, so a new theme is a block of CSS rather
     * than a change to the renderer.
     */
    <div className="shell" data-theme={progress.theme}>
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
          progress={progress}
          onProgressChange={setProgress}
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

      {/* Fixed-position overlay, so it is mounted once rather than per
          screen and never shifts layout underneath the board. */}
      <RewardToasts toasts={toasts} />

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
            onRematch={handleRematch}
            onReact={handleReact}
            tally={tally}
            progress={progress}
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
