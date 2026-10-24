/**
 * Realtime connection.
 *
 * Reconnection is handled by Socket.IO's own backoff; on every (re)connect we
 * re-send `room:join` with the stored player token, which is what restores a
 * seat after a dropped connection without any payment step.
 */

import type { ClientToServerEvents, ServerToClientEvents } from '@ludolite/shared';
import { io, type Socket } from 'socket.io-client';

import { API_BASE } from './api.js';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connectToRoom(roomId: string, playerToken: string): GameSocket {
  // Same origin on the web (dev proxy or production rewrite); an absolute URL
  // in the packaged Android app, which has no proxy in front of it.
  const socket: GameSocket = io(API_BASE || undefined, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });

  const rejoin = () => socket.emit('room:join', { roomId, playerToken });
  socket.on('connect', rejoin);

  return socket;
}
