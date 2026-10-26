/**
 * Server API client.
 *
 * The client renders payment UI strictly from GET /api/config. It never
 * decides for itself that payments are available, and it never treats a
 * provider checkout callback as proof of anything — the server decides, and
 * the client reflects what the server says.
 */

import type {
  ApiErrorBody,
  ApiErrorCode,
  BotDifficulty,
  ConfirmPaymentResponse,
  CreateRoomResponse,
  JoinRoomResponse,
  PublicConfig,
  RoomFunding,
  RoomView,
} from '@ludolite/shared';
import type { MatchState } from '@ludolite/engine';

const DEVICE_KEY_STORAGE = 'ludolite.deviceKey';
const TOKEN_STORAGE = 'ludolite.playerToken';

/**
 * Where the API lives.
 *
 * On the web this is empty, so requests go to the same origin and the dev
 * proxy (or the production rewrite) handles them. The packaged Android app
 * has no proxy and must call an absolute URL, supplied at build time:
 *
 *   VITE_API_BASE_URL=https://api.yourdomain.in npm run build
 *
 * Trailing slashes are trimmed so callers can always write `${BASE}/api/...`.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;
  readonly detail?: string;
  readonly status: number;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.code;
    this.detail = body.detail;
  }
}

/**
 * A stable per-device identifier.
 *
 * This is what lets the server recognise a returning host as the person who
 * already paid, so reconnecting never costs anything.
 */
export function deviceKey(): string {
  let key = localStorage.getItem(DEVICE_KEY_STORAGE);
  if (!key) {
    key = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY_STORAGE, key);
  }
  return key;
}

export function storedToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE);
}

/**
 * Which player this device is.
 *
 * The session token is `base64url(JSON).signature`, and the payload carries
 * the player id the server issued it for. Reading it is how the client
 * knows which seat in a room is its own.
 *
 * This is a READ, never a claim. The signature is not checked here and the
 * value is used only to decide what to highlight; every action still goes
 * to the server with the token attached, and the server decides whether it
 * is allowed. Forging this would change which token glows on one screen and
 * nothing else.
 */
export function storedPlayerId(): string | null {
  const token = storedToken();
  if (!token) return null;

  const body = token.split('.')[0];
  if (!body) return null;

  try {
    // atob wants standard base64; the token uses base64url.
    const normalised = body.replace(/-/g, '+').replace(/_/g, '/');
    const payload: unknown = JSON.parse(atob(normalised));
    if (typeof payload === 'object' && payload !== null) {
      const id = (payload as Record<string, unknown>).playerId;
      if (typeof id === 'string' && id !== '') return id;
    }
    return null;
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE, token);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = storedToken();
  const response = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let body: ApiErrorBody;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      throw new ApiRequestError(response.status, {
        code: 'INTERNAL_ERROR',
        message: 'The server could not be reached. Please try again.',
      });
    }
    throw new ApiRequestError(response.status, body.error);
  }

  return (await response.json()) as T;
}

export function fetchConfig(): Promise<PublicConfig> {
  return request<PublicConfig>('/config');
}

export async function createRoom(input: {
  seatCount: 2 | 4;
  displayName: string;
  funding: RoomFunding;
  feeConsent?: {
    acceptedTerms: boolean;
    acknowledgedNoPrize: boolean;
    displayedAmountPaise: number;
  };
  /** Fill the remaining seats with computer opponents. Always free. */
  bots?: { count: number; level: BotDifficulty };
}): Promise<CreateRoomResponse & { deviceKey: string }> {
  const result = await request<CreateRoomResponse & { deviceKey: string }>('/rooms', {
    method: 'POST',
    body: JSON.stringify({ ...input, deviceKey: deviceKey() }),
  });
  storeToken(result.playerToken);
  return result;
}

export async function joinRoom(input: {
  code: string;
  displayName: string;
}): Promise<JoinRoomResponse> {
  const result = await request<JoinRoomResponse>('/rooms/join', {
    method: 'POST',
    body: JSON.stringify({ ...input, deviceKey: deviceKey() }),
  });
  storeToken(result.playerToken);
  return result;
}

export function fetchRoom(roomId: string): Promise<{ room: RoomView }> {
  return request<{ room: RoomView }>(`/rooms/${roomId}`);
}

export function startMatch(roomId: string): Promise<{ room: RoomView; state: MatchState }> {
  return request(`/rooms/${roomId}/start`, { method: 'POST' });
}

/**
 * Resume or begin payment for a room this device hosts.
 *
 * Safe to call repeatedly — the server returns the existing transaction
 * rather than creating a second charge.
 */
export function resumePayment(roomId: string): Promise<{
  payment: {
    transactionId: string;
    providerOrderId: string;
    provider: string;
    amountPaise: number;
    currency: string;
    status: string;
    testMode: boolean;
    providerPublicKey?: string;
  };
  alreadySettled: boolean;
}> {
  return request(`/rooms/${roomId}/payment`, { method: 'POST' });
}

export function confirmPayment(input: {
  transactionId: string;
  providerPaymentId?: string;
  providerSignature?: string;
}): Promise<ConfirmPaymentResponse> {
  return request('/payments/confirm', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function requestRefund(roomId: string, reason: string): Promise<{
  status: string;
  refundId: string | null;
  amountPaise: number;
}> {
  return request('/payments/refund', {
    method: 'POST',
    body: JSON.stringify({ roomId, reason }),
  });
}
