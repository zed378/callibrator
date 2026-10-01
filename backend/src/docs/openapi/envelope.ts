/**
 * P9-25 (ADR-103) — the response envelope and the standard error responses
 * the OpenAPI document is generated from.
 *
 * The envelope is the one `utils/response.util.ts` writes, and CLAUDE.md § The
 * Response Envelope states: rows in `data`, pagination in a TOP-LEVEL `meta`
 * that is a sibling of `data` — never `data.rows`, never `data.meta`. These
 * schemas describe that shape and nothing else; a route whose handler answers
 * differently must not be documented with them.
 *
 * P9-22 (ADR-097 Amendment 1): the Zod schemas are defined ONCE, in
 * `@callibrator/contracts/envelope`, and re-exported here unchanged (the same
 * objects, so their `.meta({ id })` components and backend/openapi.json are
 * unchanged). This module keeps what is OpenAPI-only: the standard error
 * response components.
 */
import {
  ErrorEnvelope,
  PaginationMeta,
  RateLimitBody,
  emptyEnvelope,
  envelope,
  listEnvelope,
} from "@callibrator/contracts/envelope";

export { ErrorEnvelope, PaginationMeta, RateLimitBody, emptyEnvelope, envelope, listEnvelope };

const errorExample = (code: number, message: string): Record<string, unknown> => ({
  success: false,
  status: code,
  message,
  data: null,
});

const errorContent = (code: number, message: string) => ({
  "application/json": {
    schema: ErrorEnvelope,
    example: errorExample(code, message),
  },
});

/** The standard error responses, registered once as components and referenced. */
export const errorResponses = {
  400: {
    id: "ValidationError",
    description: "The request failed validation. `details` names each field (outside production).",
    content: errorContent(400, "Validation Error"),
  },
  401: {
    id: "Unauthenticated",
    description: "No valid bearer token (or API key) was presented.",
    content: errorContent(401, "Unauthorized"),
  },
  403: {
    id: "Forbidden",
    description: "Authenticated, but the caller's role lacks this permission INSIDE its own tenant.",
    content: errorContent(403, "Forbidden: Insufficient permissions"),
  },
  404: {
    id: "NotFound",
    description:
      "Not found. A record that does not exist, is soft-deleted, or belongs to ANOTHER tenant answers " +
      "exactly this — never 403 — so an id cannot be used to probe another tenant.",
    content: errorContent(404, "Resource not found"),
  },
  409: {
    id: "Conflict",
    description: "The record's current state does not allow this action; `message` says which state and why.",
    content: errorContent(409, "This record is in a state that does not allow this action"),
  },
  429: {
    id: "RateLimited",
    description:
      "The global limiter refused the request. `RateLimit-*` headers (IETF draft) state the budget and " +
      "`Retry-After` when to try again; the body is the envelope with `retryAfter` (Q-53).",
    content: { "application/json": { schema: RateLimitBody } },
  },
} as const;

/** A status this module has a standard response for. */
export type ErrorStatus = keyof typeof errorResponses;
