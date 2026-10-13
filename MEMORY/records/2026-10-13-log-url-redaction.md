# Every logged URL loses its query tokens (access log, activity log, any URL field)

**Date:** 2026-10-13 · **Card:** line A card 2 (ADR-138 Am. 2 § 3's open item) · **ADR:** ADR-138 Amendment 5 · **Status:** DONE.

## The defect

Am. 2 § 3 hashed the public device token in the access log's path and left the query string as it arrived. The access log therefore wrote, in clear:

- `?token=` of the IPM and certificate verification links, invitations, activations and signed attachment URLs;
- `?t=` of the printed verification pages;
- the same tokens in the **Referer** of every request made by a page opened from such a link.

The activity log redacted sensitive query keys in its request line, but not `?t=` or a token under an innocuous key. Nothing redacted the `url` field that the error handler (`errorHandlers.middleware`) and the access refusals (`abac`, `dynamicAccess`) log through winston.

## What was built

| | |
|---|---|
| `utils/logUrl.util.ts` (new) | `redactUrlForLog`: the path token hashed (publicDevicePath.util); a query value `[REDACTED]` when its key is sensitive (the log's key list, `code`/`pin`, `state`, `t`, `k`, `sig`, `signature`, `hmac`, `nonce`, `ticket`, `key`, `auth`, `jwt`) or when its value looks like a token (24+ base64url/hex characters with a letter and a digit, not a UUID). Also the shared `SENSITIVE_KEY`, `CODE_KEY`, `REDACTED`, `normaliseKey`, `isSensitiveKey` (moved from the activity log, unchanged). Depends on `crypto` only |
| `middlewares/accessLog.middleware.ts` | `:safe-url` → `redactUrlForLog`; new `:safe-referrer` (absent → `-`) replaces `:referrer` |
| `middlewares/activityLog.middleware.ts` | `sanitizeUrl` = the util + the e-mail mask. `redactFormat` sanitises every field named `url`, `originalUrl`, `referer` or `referrer` |
| `utils/publicDevicePath.util.ts` | A segment already redacted (`~…`) is not hashed again, so a URL sanitised twice keeps its prefix |

## Tests (named)

- `utils/logUrl.util` (new, 4 tests): every link's token, by key; token-looking values (UUIDs, dates, words and short values kept); the path hash; a malformed escape; the shape rules. Expectations are written by hand.
- `middlewares/accessLog.redaction.am5` (new, 3 tests): the format uses `:safe-url` / `:safe-referrer`, never `:url` / `:referrer`; the verification link; the Referer (single, list, absent).
- `middlewares/activityLog.redaction.am5` (new, 3 tests): `sanitizeUrl`; a winston record's `url` / `originalUrl` / `referer` redacted while other fields are untouched; idempotence.
- `src/tests/middlewares` (all): 789 passed. The existing `activityLog.test`, `activityLog.redaction.a228` and `accessLog.test` are unchanged and green.
- Coverage: `logUrl.util.ts`, `accessLog.middleware.ts`, `activityLog.middleware.ts`, `publicDevicePath.util.ts` are at 100 / 100 / 100 / 100.
- `--findRelatedTests` over the four files: 664 suites, 12,310 tests. It includes `services/clamAv.service` (S-04), which needs a real clamd: it failed 3 tests without one, then passed 53/53 with `CLAMAV_LIVE_PORT=13317` (`a3-clamd`, clamav/clamav:1.4).
- Guards, `utils/rawSql*` and `unboundedFindAll`: 335 passed.
- Gates: `npm run typecheck` 0 errors; `npm run ratchet` 695, at the floor; `load:check` OK in both modes; ESLint ratchet 0, baseline 0. No route changed, so there is no OpenAPI change.

## Left for later

- nginx's own access log still writes query strings. Am. 3 § 2 redacts only its two public-device paths, and a `map` over every query parameter is a separate change.
- A long alphanumeric search term (24 or more letters and digits) is redacted in logs (the bad implication in Am. 5).

## Files

- `backend/src/utils/logUrl.util.ts` (new), `backend/src/utils/publicDevicePath.util.ts`
- `backend/src/middlewares/accessLog.middleware.ts`, `backend/src/middlewares/activityLog.middleware.ts`
- tests (new): `backend/src/tests/utils/logUrl.util.test.ts`, `backend/src/tests/middlewares/accessLog.redaction.am5.test.ts`, `backend/src/tests/middlewares/activityLog.redaction.am5.test.ts`
- docs and boards: `MEMORY/DECISIONS.md` (ADR-138 Am. 5), `docs/OBSERVABILITY/01-LOGGING.md`, this record, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`
