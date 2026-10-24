# Q-53: the global limiter's 429 is the house envelope — DONE

**Date:** 2026-10-24 · **Item:** BACKLOG Q-53 · **Status:** DONE (status reconciled; no code changed) · **Spec refs:** ADR-109 §6, ADR-100, `docs/ENGINEERING/06-ERROR-RESPONSE-STANDARDS.md`

## Hook

BACKLOG Q-53 carried a working decision — the global limiter's 429 answers the house envelope —
with "Not yet implemented". It is implemented: the middleware, the wiring, and the test all exist.
The backlog row was never updated when the work landed. A backlog that says "not yet" for DONE
work sends the next agent to rebuild what exists.

## What was verified (no code changed)

| | |
|---|---|
| `backend/src/middlewares/globalRateLimit.middleware.ts` | `globalLimitBody(req, res)`: `{ success: false, status: 429, message, data: null, retryAfter }`; `retryAfter` repeats the `Retry-After` header express-rate-limit sets, null when absent |
| `backend/index.ts` | `defaultLimiter` uses `message: globalLimitBody` with `standardHeaders: true`, `legacyHeaders: false` |
| `backend/src/tests/middlewares/globalRateLimit.q53.test.ts` | 3/3: index.js configures the limiter with the body and standard headers; the refused request gets the envelope + `Retry-After` + matching `retryAfter`; null when no header |

## Why this shape

The 429 was the one error body outside the envelope. The fix keeps the message text and adds the
envelope plus `retryAfter`, the same shape as the per-route request budgets (ADR-100). No client
in the repository matched the old shape.

## Tests

- `globalRateLimit.q53.test.ts`: 3/3 (2026-10-24).

- **Not run:** the full suite — this card changes no code.

## Definition of Done

- [x] the limiter answers the envelope with `Retry-After` and matching `retryAfter`
- [x] the backlog row marked DONE with this record
- [x] no real upstream value in any file (this item predates the upstream group)

## Files

- `TASKS/BACKLOG.md` (Q-53 row)
- This record
