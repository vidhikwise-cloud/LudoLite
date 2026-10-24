import type { ApiErrorCode } from '@ludolite/shared';

/** HTTP status for each error code. */
const STATUS: Record<ApiErrorCode, number> = {
  PAID_HOSTING_UNAVAILABLE: 402,
  ROOM_NOT_FOUND: 404,
  ROOM_FULL: 409,
  ROOM_NOT_ACTIVE: 409,
  ROOM_ALREADY_STARTED: 409,
  NOT_HOST: 403,
  NOT_A_PLAYER: 403,
  INVALID_CODE: 404,
  PAYMENT_REQUIRED: 402,
  PAYMENT_FAILED: 402,
  PAYMENT_ALREADY_SETTLED: 409,
  CONSENT_REQUIRED: 400,
  REFUND_WINDOW_CLOSED: 409,
  REFUND_NOT_APPLICABLE: 409,
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly detail?: string;

  constructor(code: ApiErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = statusForCode(code);
    this.detail = detail;
  }
}

export function statusForCode(code: ApiErrorCode): number {
  // STATUS covers every ApiErrorCode, but noUncheckedIndexedAccess cannot see
  // that through a Record index, so fall back rather than assert.
  return STATUS[code] ?? 500;
}
