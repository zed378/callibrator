/**
 * The answer to a request that outran `connect-timeout`'s budget (index.js,
 * `app.use(timeout("30s"))`).
 *
 * F-14 (ADR-074): this was an inline handler that answered
 * `{ status: "Error", message: "Request timeout" }` — outside the house
 * envelope, so a client reading `success` and `status` found neither. It now
 * answers through `response.util`'s `error`, like every other failure.
 *
 * A response already on its way (headers sent) is left alone: Express's own
 * handler closes it.
 *
 * P9-19 (ADR-087): converted from requestTimeout.middleware.js with no
 * behaviour change. `error` is captured at load, as the .js destructured it.
 */
import type { NextFunction, Request, Response } from "express";
import { error as responseError } from "../utils/response.util";

const error = responseError;

/** What a `connect-timeout` error carries; any other value may reach an error handler. */
type TimeoutError = { timeout?: unknown } | null | undefined;

/**
 * Express error handler: a `connect-timeout` error becomes a 408 in the
 * envelope; any other error passes on.
 */
const requestTimeoutHandler = (
  err: TimeoutError,
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `err && err.timeout`
  if (err && err.timeout && !res.headersSent) {
    error(res, "Request timeout", 408);
    return;
  }
  next(err);
};

export { requestTimeoutHandler };
