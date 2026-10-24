/**
 * Wire contracts shared by the server, the web client, and the Android
 * client.
 *
 * Both clients import these types, which is how "web and Android use the same
 * room and payment authorization rules" is enforced at compile time rather
 * than by convention.
 */

import type { MatchState, SeatIndex } from '@ludolite/engine';

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

/**
 * Room lifecycle.
 *
 * - `pending_payment` — a paid room awaiting a verified transaction. It is NOT
 *   joinable and NOT playable in this state.
 * - `active`          — joinable. A free room is created straight into this
 *                       state; a paid room only reaches it after the server
 *                       verifies the payment.
 * - `in_play`         — match running.
 * - `complete`        — match finished, result recorded.
 * - `cancelled`       — abandoned or cancelled; refund applies if it was paid.
 */
export type RoomStatus =
  | 'pending_payment'
  | 'active'
  | 'in_play'
  | 'complete'
  | 'cancelled';

/** How this room was funded. Recorded on the room, decided by the server. */
export type RoomFunding = 'free' | 'paid';

export interface RoomPlayerView {
  readonly playerId: string;
  readonly displayName: string;
  readonly seat: SeatIndex;
  readonly isHost: boolean;
  readonly connected: boolean;
  /**
   * True only for a host whose Rs 1 payment is verified and settled. Read
   * from the transaction record, never from a client claim.
   */
  readonly paidHost: boolean;
  /** Computer opponent, played by the server. Never charged anything. */
  readonly isBot: boolean;
  readonly botLevel?: BotDifficulty;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface RoomView {
  readonly roomId: string;
  readonly code: string;
  readonly status: RoomStatus;
  readonly funding: RoomFunding;
  readonly seatCount: 2 | 4;
  readonly players: readonly RoomPlayerView[];
  readonly hostPlayerId: string;
  readonly createdAt: string;
  /** Present once a match has been created for this room. */
  readonly matchId: string | null;
  /** True when the server will accept a start request right now. */
  readonly canStart: boolean;
}

// ---------------------------------------------------------------------------
// Public config
// ---------------------------------------------------------------------------

/**
 * Served by GET /api/config. The client renders from this and never from a
 * bundled constant, so a stale build cannot show a payment UI the server
 * would reject.
 */
export interface PublicConfig {
  /**
   * Whether the server will currently accept a paid room. This is the result
   * of the full gate — feature flag AND legal approval record AND provider
   * approval record — not just the env var.
   */
  readonly paidHostingEnabled: boolean;
  /**
   * True when a payment provider is wired in test/sandbox mode. The UI must
   * label every amount as a test and must not imply real money moved.
   */
  readonly paymentsAreTestMode: boolean;
  readonly hostingFeePaise: number;
  readonly currency: string;
  readonly refundWindowMinutes: number;
  /**
   * Why paid hosting is unavailable, for display to the product owner in
   * development. Empty when paid hosting is available.
   */
  readonly paidHostingBlockers: readonly string[];
}

// ---------------------------------------------------------------------------
// Requests and responses
// ---------------------------------------------------------------------------

export interface CreateRoomRequest {
  readonly seatCount: 2 | 4;
  readonly displayName: string;
  /**
   * Fill the remaining seats with computer opponents and start immediately.
   *
   * A solo game against bots is always free — there is no one to invite, so
   * there is nothing to host. The server refuses `funding: 'paid'` together
   * with bots for that reason.
   */
  readonly bots?: {
    readonly count: number;
    readonly level: BotDifficulty;
  };
  /**
   * What the client believes it is creating. The server treats this as a
   * request, not an instruction: asking for 'paid' when the gate is shut is
   * refused with 402 rather than silently downgraded, so a host is never
   * charged for something different from what they confirmed.
   */
  readonly funding: RoomFunding;
  /**
   * Required when funding is 'paid'. Records that the host saw the fee and
   * the refund terms and accepted them.
   */
  readonly feeConsent?: {
    readonly acceptedTerms: boolean;
    readonly acknowledgedNoPrize: boolean;
    readonly displayedAmountPaise: number;
  };
}

export interface CreateRoomResponse {
  readonly room: RoomView;
  readonly playerToken: string;
  /** Present only for a paid room that still needs payment. */
  readonly payment?: PaymentIntentView;
}

export interface JoinRoomRequest {
  readonly code: string;
  readonly displayName: string;
}

export interface JoinRoomResponse {
  readonly room: RoomView;
  readonly playerToken: string;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export type PaymentStatus =
  | 'created'
  | 'pending'
  | 'verified'
  | 'failed'
  | 'refunded'
  | 'cancelled';

/**
 * What the client needs to open a checkout. Contains no secrets and never the
 * amount the client should charge — the amount is fixed server-side and the
 * client is told it only so it can be displayed.
 */
export interface PaymentIntentView {
  readonly transactionId: string;
  readonly providerOrderId: string;
  readonly provider: string;
  readonly amountPaise: number;
  readonly currency: string;
  readonly status: PaymentStatus;
  /** True when this is a sandbox/test payment. Must be shown in the UI. */
  readonly testMode: boolean;
  /** Public key for the provider checkout widget, when the provider needs one. */
  readonly providerPublicKey?: string;
}

/**
 * Posted by the client after the provider's checkout closes.
 *
 * This is a *hint* that something happened, nothing more. The server
 * re-verifies with the provider and trusts only the signed webhook. A client
 * saying "payment succeeded" never activates a room on its own.
 */
export interface ConfirmPaymentRequest {
  readonly transactionId: string;
  readonly providerPaymentId?: string;
  readonly providerSignature?: string;
}

export interface ConfirmPaymentResponse {
  readonly status: PaymentStatus;
  readonly room: RoomView;
}

export interface RefundRequest {
  readonly roomId: string;
  readonly reason: string;
}

export interface RefundResponse {
  readonly status: PaymentStatus;
  readonly refundId: string | null;
  readonly amountPaise: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  /** Paid hosting is off, or an approval record is missing. */
  | 'PAID_HOSTING_UNAVAILABLE'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_NOT_ACTIVE'
  | 'ROOM_ALREADY_STARTED'
  | 'NOT_HOST'
  | 'NOT_A_PLAYER'
  | 'INVALID_CODE'
  | 'PAYMENT_REQUIRED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_ALREADY_SETTLED'
  | 'CONSENT_REQUIRED'
  | 'REFUND_WINDOW_CLOSED'
  | 'REFUND_NOT_APPLICABLE'
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    /** Safe-to-display detail. Never contains provider secrets. */
    readonly detail?: string;
  };
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

export interface ServerToClientEvents {
  'room:update': (room: RoomView) => void;
  'match:state': (state: MatchState) => void;
  'match:rolled': (payload: { seat: SeatIndex; die: number }) => void;
  'match:ended': (payload: { matchId: string; winnerSeat: SeatIndex | null }) => void;
  'error': (payload: { code: ApiErrorCode; message: string }) => void;
  /**
   * Sent just before the server drains for a deploy or restart. Lets the
   * client show "reconnecting" rather than appearing frozen mid-match.
   */
  'server:shutdown': () => void;
}

export interface ClientToServerEvents {
  'room:join': (payload: { roomId: string; playerToken: string }) => void;
  'room:start': () => void;
  'room:leave': () => void;
  'match:roll': () => void;
  'match:move': (payload: { token: number; die: number }) => void;
}

export const HOSTING_FEE_PAISE_DEFAULT = 100;

/** Formats paise as rupees for display, e.g. 100 -> "1.00". */
export function formatPaise(paise: number): string {
  return (paise / 100).toFixed(2);
}
