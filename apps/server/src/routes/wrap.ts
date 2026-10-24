import type { NextFunction, Request, Response } from 'express';

/**
 * Forwards a rejected async handler to the Express error middleware.
 *
 * Express 4 does not await route handlers, so a promise rejection escapes as
 * an unhandled rejection and, under Node's default policy, terminates the
 * process.
 *
 * Every handler in this app is async and several throw `ApiError` as their
 * normal control flow — a paid-room request while the gate is shut throws a
 * 402 by design. Without this wrapper that ordinary refusal would crash the
 * server instead of returning a status code.
 */
export function wrap(
  handler: (req: Request, res: Response) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}
