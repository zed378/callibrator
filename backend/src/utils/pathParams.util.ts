/**
 * A-273 — the path names the resource; the body may not name a different one.
 *
 * Four controllers validated `{ ...req.params, ...req.body }`: the BODY won.
 * On `PUT /tenants/:tenantId/policy` the route gate checked the path
 * `tenantId` while the service acted on a body one, so a caller authorised
 * for one tenant could change another by repeating the id in the body
 * (dataRetention ×4, featureFlag, tenantLifecycle, tenant#updateTenant).
 *
 * `withPathParams(req.params, req.body)` is the one merge those sites use:
 *  - every path parameter wins over the same key in the input;
 *  - an input that repeats a path parameter with a DIFFERENT value is a 400
 *    naming the key — a silent override would hide which resource the caller
 *    meant, and a request that names two tenants is a client error;
 *  - the same value repeated is accepted (clients that echo the id still work).
 *
 * Comparison is by string form, so a numeric id sent as a number matches its
 * path segment.
 */
import { AppError } from "./appError.util";

type Input = Record<string, unknown> | null | undefined;

/**
 * @param params - `req.params` (strings, as Express gives them)
 * @param input - `req.body` or `req.query`
 * @returns the input with every path parameter set from the path
 * @throws AppError 400 when the input names a path parameter with another value
 */
export const withPathParams = (params: Readonly<Record<string, string>>, input: Input): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...(input ?? {}) };
  for (const [key, value] of Object.entries(params)) {
    const given = merged[key];
    if (given === undefined || given === null) {
      merged[key] = value;
      continue;
    }
    // A string or a number is compared by its text; anything else (an object,
    // an array, a boolean) can never name the path's resource.
    const text = typeof given === "string" || typeof given === "number" ? String(given) : JSON.stringify(given);
    if (text !== value) {
      throw new AppError(
        400,
        `"${key}" in the request (${text}) does not match the path (${value}). ` +
          "The path names the resource; omit it from the request or send the same value.",
      );
    }
    merged[key] = value;
  }
  return merged;
};
