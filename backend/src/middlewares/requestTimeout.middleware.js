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
 */
const { error } = require("../utils/response.util");

/**
 * Express error handler: a `connect-timeout` error becomes a 408 in the
 * envelope; any other error passes on.
 *
 * @param {Error & {timeout?: number}} err
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 * @returns {void}
 */
const requestTimeoutHandler = (err, req, res, next) => {
  if (err && err.timeout && !res.headersSent) {
    error(res, "Request timeout", 408);
    return;
  }
  next(err);
};

module.exports = { requestTimeoutHandler };
