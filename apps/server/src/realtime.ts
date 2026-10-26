/**
 * Realtime multiplayer.
 *
 * The socket layer carries intent in and state out. It never decides
 * anything: every handler calls the same services the HTTP API uses, so a
 * rule cannot hold over REST but leak over websockets.
 *
 * Reconnection: a client re-emits `room:join` with its signed player token.
 * The server restores the seat from the membership row. No payment is taken,
 * checked, or re-requested on this path — a host returning to a room they
 * already funded simply resumes.
 */

import type { ClientToServerEvents, ServerToClientEvents } from '@ludolite/shared';
import type { PrismaClient } from '@prisma/client';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';

import { verifyPlayerToken } from './auth.js';
import { config } from './config.js';
import { ApiError } from './errors.js';
import { log } from './logger.js';
import { runBotTurns } from './match/bot-runner.js';
import {
  presenceConnected,
  presenceDisconnected,
  presenceIdentified,
  presenceLeft,
} from './presence.js';
import { forfeit, getMatchState, moveToken, rollDice, startMatch } from './match/service.js';
import { loadRoom, markConnected, toRoomView } from './rooms/service.js';

const logger = log('realtime');

/**
 * Per-socket action budget.
 *
 * A client that spams `match:roll` would otherwise hammer the database with
 * one transaction per message. The HTTP rate limiter does not see socket
 * traffic, so the limit has to live here.
 */
const ACTION_WINDOW_MS = 10_000;
const ACTION_LIMIT = 40;

interface SocketData {
  playerId: string | null;
  roomId: string | null;
  actionCount: number;
  windowStartedAt: number;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

export function attachRealtime(httpServer: HttpServer, prisma: PrismaClient): Server {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, never, SocketData>(
    httpServer,
    {
      cors: {
        // Same-origin only when nothing is configured — see the matching
        // note in app.ts. A websocket is not protected by the same-origin
        // policy, so an over-permissive setting here is worse than for HTTP.
        origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
        credentials: true,
      },
      // Give a dropped phone a generous window to come back before the seat
      // is treated as disconnected.
      pingTimeout: 25_000,
      pingInterval: 10_000,
      // A game message is a few hundred bytes; anything larger is abuse.
      maxHttpBufferSize: 16_384,
      connectionStateRecovery: {
        maxDisconnectionDuration: 60_000,
        skipMiddlewares: false,
      },
    },
  );

  async function broadcastRoom(roomId: string): Promise<void> {
    const room = await loadRoom(prisma, roomId);
    io.to(roomId).emit('room:update', toRoomView(room));
  }

  /**
   * Hand control to the computer if the next seat is a bot.
   *
   * Fire-and-forget: the bot loop paces itself with real pauses, and the
   * socket handler that triggered it must not block waiting for a bot to
   * finish thinking.
   */
  function handOffToBots(roomId: string): void {
    void runBotTurns(prisma, roomId, {
      onRolled: ({ seat, die }) => io.to(roomId).emit('match:rolled', { seat, die }),
      onState: (state) => io.to(roomId).emit('match:state', state),
      onEnded: (state) => {
        io.to(roomId).emit('match:ended', {
          matchId: state.matchId,
          winnerSeat: state.winnerSeat,
        });
        void broadcastRoom(roomId);
      },
    }).catch((error) => {
      logger.error({ err: error, roomId }, 'bot turn loop failed');
    });
  }

  function fail(socket: GameSocket, error: unknown, action: string): void {
    if (error instanceof ApiError) {
      socket.emit('error', { code: error.code, message: error.message });
      return;
    }
    logger.error(
      { err: error, action, playerId: socket.data.playerId, roomId: socket.data.roomId },
      'unhandled socket error',
    );
    socket.emit('error', {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    });
  }

  /** Returns false and notifies the client when the socket is over budget. */
  function withinBudget(socket: GameSocket): boolean {
    const now = Date.now();
    if (now - socket.data.windowStartedAt > ACTION_WINDOW_MS) {
      socket.data.windowStartedAt = now;
      socket.data.actionCount = 0;
    }
    socket.data.actionCount += 1;

    if (socket.data.actionCount > ACTION_LIMIT) {
      socket.emit('error', {
        code: 'RATE_LIMITED',
        message: 'Too many actions. Please slow down.',
      });
      return false;
    }
    return true;
  }

  /** A handler may only run once the socket has authenticated into a room. */
  function authed(
    socket: GameSocket,
  ): { roomId: string; playerId: string } | null {
    const { roomId, playerId } = socket.data;
    if (!roomId || !playerId) {
      socket.emit('error', {
        code: 'UNAUTHORIZED',
        message: 'Join the room before sending actions.',
      });
      return null;
    }
    return { roomId, playerId };
  }

  io.on('connection', (socket: GameSocket) => {
    presenceConnected();
    socket.data.playerId = null;
    socket.data.roomId = null;
    socket.data.actionCount = 0;
    socket.data.windowStartedAt = Date.now();

    socket.on('room:join', async ({ roomId, playerToken }) => {
      if (!withinBudget(socket)) return;
      try {
        if (typeof roomId !== 'string' || typeof playerToken !== 'string') {
          throw new ApiError('INVALID_REQUEST', 'Malformed join request.');
        }

        const playerId = verifyPlayerToken(playerToken);

        const membership = await prisma.roomMembership.findFirst({
          where: { roomId, playerId, leftAt: null },
        });
        if (!membership) {
          throw new ApiError('NOT_A_PLAYER', 'You are not a member of this room.');
        }

        // A socket belongs to one room. Leaving the previous one prevents a
        // client from accumulating subscriptions to rooms it has left.
        if (socket.data.roomId && socket.data.roomId !== roomId) {
          await socket.leave(socket.data.roomId);
        }

        // Count this socket against the player rather than as anonymous.
        // Guarded: room:join can arrive twice on a flaky connection, and
        // identifying twice would count one person as two.
        if (socket.data.playerId !== playerId) {
          if (socket.data.playerId) presenceLeft(socket.data.playerId);
          presenceIdentified(playerId);
        }

        socket.data.playerId = playerId;
        socket.data.roomId = roomId;
        await socket.join(roomId);
        await markConnected(prisma, roomId, playerId, true);

        await broadcastRoom(roomId);

        // Reconnecting mid-match: send the current state straight away so the
        // board is correct before the next action.
        const state = await getMatchState(prisma, roomId);
        if (state) socket.emit('match:state', state);
      } catch (error) {
        fail(socket, error, 'room:join');
      }
    });

    socket.on('room:start', async () => {
      if (!withinBudget(socket)) return;
      const session = authed(socket);
      if (!session) return;
      try {
        const state = await startMatch(prisma, session.roomId, session.playerId);
        await broadcastRoom(session.roomId);
        io.to(session.roomId).emit('match:state', state);
        // Seat 0 is always a human (the host), so the first bot turn comes
        // later — but a 2-player bot game can hand over immediately.
        handOffToBots(session.roomId);
      } catch (error) {
        fail(socket, error, 'room:start');
      }
    });

    socket.on('match:roll', async () => {
      if (!withinBudget(socket)) return;
      const session = authed(socket);
      if (!session) return;
      try {
        const { state, die, seat } = await rollDice(
          prisma,
          session.roomId,
          session.playerId,
        );
        io.to(session.roomId).emit('match:rolled', { seat, die });
        io.to(session.roomId).emit('match:state', state);
        // An unplayable roll passes the turn, possibly to a bot.
        handOffToBots(session.roomId);
      } catch (error) {
        fail(socket, error, 'match:roll');
      }
    });

    socket.on('match:move', async (payload) => {
      if (!withinBudget(socket)) return;
      const session = authed(socket);
      if (!session) return;
      try {
        const token = Number(payload?.token);
        const die = Number(payload?.die);
        if (!Number.isInteger(token) || !Number.isInteger(die)) {
          throw new ApiError('INVALID_REQUEST', 'Malformed move.');
        }

        const state = await moveToken(prisma, session.roomId, session.playerId, {
          token,
          die,
        });
        io.to(session.roomId).emit('match:state', state);

        if (state.phase === 'complete') {
          io.to(session.roomId).emit('match:ended', {
            matchId: state.matchId,
            winnerSeat: state.winnerSeat,
          });
          await broadcastRoom(session.roomId);
        } else {
          handOffToBots(session.roomId);
        }
      } catch (error) {
        fail(socket, error, 'match:move');
      }
    });

    socket.on('room:leave', async () => {
      if (!withinBudget(socket)) return;
      const session = authed(socket);
      if (!session) return;
      try {
        const state = await forfeit(prisma, session.roomId, session.playerId);
        await markConnected(prisma, session.roomId, session.playerId, false);
        await socket.leave(session.roomId);
        socket.data.roomId = null;

        if (state) io.to(session.roomId).emit('match:state', state);
        await broadcastRoom(session.roomId);
      } catch (error) {
        fail(socket, error, 'room:leave');
      }
    });

    socket.on('disconnect', async (reason) => {
      const { roomId, playerId } = socket.data;

      // Presence first, and unconditionally: a socket that never joined a
      // room still counted as anonymous and must be released, or the count
      // only ever climbs.
      if (playerId) presenceLeft(playerId);
      else presenceDisconnected();

      if (!roomId || !playerId) return;
      try {
        // Mark disconnected but do NOT forfeit. A dropped connection is
        // usually a tunnel or a lift, and the player should get their seat
        // back when they return.
        await markConnected(prisma, roomId, playerId, false);
        await broadcastRoom(roomId);
      } catch (error) {
        logger.warn({ err: error, reason, roomId }, 'disconnect cleanup failed');
      }
    });
  });

  return io;
}
