# 03 — Rate Limits and Error Codes

What an integration's client will be refused with, why, and how long to wait — read from the limiters as built, not from the tables other documents copy.

> **Target standard: TypeScript, strict (ADR-038).** Every backend file named here is **JavaScript/CommonJS as built**, described as it behaves today.

Implementation: `backend/index.js:206–254` (the global limiter) · `backend/src/services/rateLimiter.redis.service.js` (every other counter) · `backend/src/constants/rateLimitConstants.js` (the numbers) · `backend/src/services/auth.service.js` (the sign-in throttle).

---

## Read This First

**There are two kinds of limiter, and only one of them is shared between replicas.**

| | Store | Keyed by | Survives a restart? | N replicas |
|---|---|---|---|---|
| the **global** limiter (every request) | `express-rate-limit`'s in-process memory store — `index.js:216` passes no `store` | `req.ip` | **no** | N × the limit |
| **auth failure counters** and **endpoint quotas** | the shared Redis client, one Lua `EVAL` per increment (A-30) | user id, token hash, address, or typed identifier | yes | one shared count |

**Both are only as good as `req.ip`.** On the reference deployment `req.ip` has been seen to be the real client (§ Is `req.ip` The Client). An integration that shares one egress address with other traffic shares every per-address budget with it.

**`authLimiter` and `otpLimiter` are gone (ADR-100, 2026-09-29).** They were defined in `index.js`, never mounted, and per-process. The public endpoints now have **request budgets** (`middlewares/requestBudget.middleware.ts`, `API_ENDPOINTS` in `constants/rateLimitConstants.ts`), which count **every** request — successes included — per client address in the shared store, and answer 429 `{ success: false, status: 429, message, data: null, retryAfter }` with a `Retry-After` header:

| Budget | Routes | Production limit |
|---|---|---|
| `authSignIn` | `POST /auth/login` | 300 / 15 min per address (a hospital signs in from behind one NAT) |
| `mfaSignIn` | `POST /auth/mfa/login` | 60 / 15 min per address |
| `authRegister` | `POST /auth/register` | 10 / hour per address |
| `authOtp` | `POST /auth/send-otp`, `/reset-password` | 20 / hour per address |
| `authOtpRecipient` | `POST /auth/send-otp` | 3 / 15 min per **mailed-to address** (hashed), whoever asks, account or not |
| `ssoStart` | `POST /auth/sso/login`, `/sso/oidc/login` (one shared budget) | 60 / 15 min per address |
| `certificateVerify` / `certificateVerifyToken` | `GET /certificates/verify/:n` (and `/document`) | 60 minimal answers / 300 requests per 15 min per address (A-293) |

Outside production each is multiplied by `RATE_LIMIT_NON_PRODUCTION_FACTOR` (default 100). **Each budget is a FIXED window (ADR-100 Amendment 5):** it opens at the first request and closes at a stored `expiresAt` that no request — admitted or refused — moves, so `Retry-After` is exactly when the next request is admitted again. (The failure throttles below still slide: a failure extends the pause, but a paused attempt is refused before it is counted, so the pause ends when reported.) The budgets sit in front of the failure throttles below, which are unchanged. `../API/00-API-STANDARDS.md`, `../SECURITY/08-API-SECURITY.md` and `../ARCHITECTURE/06-CACHING-ARCHITECTURE.md` still list the two old limiters; trust this section over those tables until they are corrected.

---

## The Global Limiter

`index.js:216–254`, applied to every route.

| | |
|---|---|
| window | 15 minutes |
| limit | `RATE_LIMIT_MAX` if set; else **5,000** when `NODE_ENV=production`, **100,000** otherwise |
| key | `req.ip` (the library's default key generator; IPv6 grouped by /56) |
| headers | `RateLimit-Policy`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (`standardHeaders: true` = IETF draft-6 in `express-rate-limit` 8.7.0); `Retry-After` on a 429 |
| 429 body | `{ "status": "Error", "message": "Too many requests, please try again later" }` — **not** the house envelope; there is no `success` and no `data` |

It is per process. A restart forgets it; three replicas allow three times the budget. It is not the brute-force control — the counters below are.

## Endpoint Quotas

`rateLimiter.redis.service.js#endpointRateLimiter` (`:584`). A request is counted under **each** of: the principal's id (`req.user.id` — for an API key, the key's id), the hash of the whole `Authorization` header, and `req.ip`. Exceeding **any** of them refuses the request.

| Quota | Mounted on | Limit | Counted by |
|---|---|---|---|
| `tenantCreate` | `POST /api/v1/tenants/create` | 10 / min | user, header, address |
| `tenantUpload` | `POST /api/v1/tenants/:tenantId/logo` | 20 / min | user, header, address |
| `iotIngest` | `POST /api/v1/iot/ingest` | 600 / min | **address only** (`iot.route.js:13`) |

A refusal is **429** with `{ "success": false, "status": 429, "message": "Too many requests. <description> limit exceeded.", "retryAfter": <seconds> }` and **no `Retry-After` header**. `X-RateLimit-Limit`, `-Remaining` and `-Reset` are set on requests that pass. `iotIngest` has no entry in `API_ENDPOINTS`, so its message reads "Default endpoint limit exceeded".

The outer `catch` of this middleware calls `next()` — the one fail-open left in the file (`:638–641`). Store failures are handled below it; that catch sees only programming errors, and logs them.

## Authentication Counters

Numbers from `AUTH_ENDPOINTS` (`rateLimitConstants.js:20–144`). Two mechanisms use them.

### The password sign-in throttle (A-185, ADR-059)

`POST /api/v1/auth/login`. Checked **before** the account is looked up (`auth.service.js:457`), keyed by the SHA-256 of the typed identifier (trimmed, lower-cased):

| Counter | Budget | Effect |
|---|---|---|
| identifier **+ address** | 5 failures / 15 min | that pair is paused 15 min; the owner elsewhere is unaffected |
| identifier alone, any address | 100 failures / hour | the identifier is paused everywhere for an hour — the NIST 800-63B ceiling; deliberately triggerable, accepted in ADR-059 |

Every failure without the right password is the same **401** `Invalid credentials` — unknown name, wrong password, locked or suspended account alike. A paused attempt is **429** `Too many failed sign-in attempts. Wait a few minutes, then try again.` **with no `Retry-After` header**: `checkLoginThrottle` computes `retryAfterSeconds` (`rateLimiter.redis.service.js:1072`) but `auth.service.js:458` throws the 429 without it. Sign-in never writes `users.locked_until`; only the MFA step does.

### Failure counters on the other auth endpoints

`authPreCheck(endpoint)` refuses a caller already over budget; the handler, through `auth.controller.js#withAuthOutcome`, counts any 4xx except 429 as a failure (a 5xx never counts) and clears the user and token counters on success.

| Endpoint key | Route | Failures | Window / pause |
|---|---|---|---|
| `register` | `POST /auth/register` | 3 | 1 hour |
| `forgotPassword` | `POST /auth/send-otp` | 3 | 15 min |
| `resetPassword` | `POST /auth/reset-password` | 5 | 5 min |
| `ssoExchange` | `POST /auth/sso/exchange` | 10 | 5 min |
| `refreshToken` | `POST /auth/refresh` | — no entry; falls back to `login`'s 5 / 15 min (`getAuthConfig`) | |
| `mfaLogin` | `POST /auth/mfa/login` | 5 per user | 15 min, writes `users.locked_until` |
| `mfaManage` | `POST /auth/mfa/setup`, `/verify`, `/disable` | 5 per user | 15 min, sign-in unaffected |
| `passwordCheck` | every signed-in check of the caller's own password | 5 per user | 15 min, and the session that failed is signed out (A-260) |

What is counted depends on what the request carries (`recordAuthFailure`, `:393`):

- **per user** — only when a verified access token names one;
- **per token** — revoked after 3 failures, blocked 24 h at twice the budget;
- **per address** — when `rateLimiter.redis.service#countsFailuresByIp()` says so (`noteAuthFailure`), and then it pauses the address for 5 min at **three times** the budget.

**Since ADR-100 the per-address count is ON by default in production** (`AUTH_RATE_LIMIT_BY_IP` unset → on when `NODE_ENV=production`, off elsewhere; `"false"` turns it off, `"true"` on). Before, it was off unless set, and `register`, `send-otp` and `reset-password` counted nothing at all; they now also have the request budgets above. It was already `true` on the reference VM (`MEMORY/records/2026-09-24-dependency-upgrade.md`).

`authPreCheck`'s 429 body carries `lockoutUntil` (ISO) and `retryAfter` (seconds), and since ADR-100 a `Retry-After` header too. The `passwordCheck` 429 **does** send `Retry-After` (`controllerWrapper.util.js:39–42`).

Two further budgets are keyed by the *actor*, not the target: `userIdentityConflict` (a tenant administrator's create or edit that hits an existing username or email, 10 / hour) and `scimIdentityConflict` (the same for a SCIM key, keyed by the key id, 10 / hour).

## When Redis Is Down

`readyRedis()` (`:51`) uses the shared client only while `status === "ready"`. Otherwise, or when a command throws, the counter moves to an in-process `Map`: **never fail open**. The cost, stated in the file: during an outage every replica counts separately (N × the limit) and counts taken then are not merged back. The Map is bounded — `RATE_LIMIT_MEMORY_MAX_KEYS`, default 100,000, oldest evicted first, which under-counts at the cap (W-19, ADR-079).

Verified by `src/tests/services/rateLimiter.redis.path.test.js` and, against a real Redis behind `REDIS_LIVE_TEST=1`, `rateLimiter.redis.live.test.js` (A-30). Neither was run for this document.

## Is `req.ip` The Client? (A-16)

`app.set("trust proxy", TRUST_PROXY_HOPS)` with `TRUST_PROXY_HOPS = 1` (`index.js:105`, `constants/appConstants.js:154`). Express takes the **rightmost** `X-Forwarded-For` entry. That is the client only because every proxy adjacent to the backend writes exactly one entry: nginx overwrites the header with the edge-resolved address, and the Next.js proxy forwards one sanitised address (`frontend/src/lib/clientIp.ts`). The limiter never reads a raw header itself (`clientAddress`, `:68`).

**Status: verified on one deployment, unverified on every other.**

- On the reference VM, a login through Cloudflare → nginx → Next.js recorded the operator's real public address in `sessions.ip_address` and in the `LOGIN` audit row (`MEMORY/records/2026-09-24-dependency-upgrade.md`), and the request log shows the client address (`MEMORY/records/2026-09-25-phase0-batch7.md`).
- Nothing has checked a Helm deployment — no cluster has been reachable — or any deployment whose proxy chain differs from `deploy/compose/nginx/*.conf`. There, `req.ip` may be a proxy's address, and every per-address budget above becomes one bucket shared by every caller. Do not turn on `AUTH_RATE_LIMIT_BY_IP` for such a deployment until its stored session addresses have been looked at.
- The A-16 card's own Definition-of-Done boxes are still unticked, although its row says DONE. The record above is the evidence; it is one login on one host.

---

## Status Codes

The contract is [`../API/00-API-STANDARDS.md`](../API/00-API-STANDARDS.md) § Status Codes. The codes a client has to branch on:

| Code | Means | What a client should do |
|---|---|---|
| 400 | validation failure, including an unknown API-key scope | fix the request; do not retry |
| 401 | no credential, an invalid or expired token or key, a revoked session, or a failed sign-in | re-authenticate; for sign-in, do not distinguish causes — the server does not |
| 403 | permission failure **inside the caller's own tenant**: role, scope, `denyApiKey`, the API-key chokepoint, a suspended tenant; or a body `code` of `PASSWORD_CHANGE_REQUIRED` / `MFA_ENROLMENT_REQUIRED` | do not retry; the `message` (and `code`) says which. The API-key messages are listed in [`02-AUTHENTICATION.md`](./02-AUTHENTICATION.md) § What A Key Sees |
| **404** | not found — **including a row that belongs to another tenant**, and a soft-deleted one | treat as absent. It never means "exists but not yours"; that answer is never given |
| 408 | the 30 s handler timeout | retry once, then treat as a defect; the body is `{ status, message }`, outside the envelope |
| **409** | invalid state transition — the message states the current state ("in `draft`, must be submitted first") | read the message, change state, then retry |
| **429** | a limiter above | wait: `Retry-After` if present, else the body's `retryAfter` or `lockoutUntil`, else `RateLimit-Reset`. Back off; a retry storm extends a sliding window |
| 500 | a defect | in production the body carries only a generic message and the `requestId`; quote `X-Request-Id` |

The envelope for every one of these except the global limiter's 429 and the 408 is `{ success: false, status, message, data: null }` (`utils/response.util.js#error`).

## Related

| For | Read |
|---|---|
| where to start | [`00-INTEGRATION-QUICKSTART.md`](./00-INTEGRATION-QUICKSTART.md) |
| API keys and what they can reach | [`02-AUTHENTICATION.md`](./02-AUTHENTICATION.md) |
| the findings | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-16, A-30, A-67, A-185 · `MEMORY/DECISIONS.md` ADR-059 |
| the abuse controls built on these | [`../SECURITY/10-ABUSE-PREVENTION.md`](../SECURITY/10-ABUSE-PREVENTION.md) |
