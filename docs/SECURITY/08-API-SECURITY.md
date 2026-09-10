# 08 — API Security

The controls at the HTTP edge, in the order `backend/index.js` installs them. Order is behaviour, not style.

---

## The Pipeline

```
compression
  → HTTPS redirect         production + FORCE_HTTPS only
  → helmet                 CSP, frame-ancestors none, object-src none
  → hpp                    parameter pollution
  → CORS                   explicit allowlist, credentials true, wildcard never
  → rate limit             global, 15-minute window
  → body parse             10 MB; raw body preserved for the Stripe webhook only
  → timeout 30s            → 408
  → request id             → X-Request-Id
  → accessLog, activityLog
  → static                 /.well-known, /uploads (nosniff + inline), /public
  → globalSanitizer
  → swagger
  ── per route ──
  → auth → tenantContext → dynamicAccess/rbac/abac → validate → handler
  → notFound → errorHandler
```

## Headers

`helmet`, with a deliberately conservative policy:

```
default-src 'self'
script-src  'self' 'unsafe-inline'
style-src   'self' 'unsafe-inline' https:
img-src     'self' data: https:
font-src    'self' data: https:
object-src  'none'
frame-ancestors 'none'
```

`crossOriginResourcePolicy: cross-origin` so the separate-origin frontend can load `/uploads` images. `crossOriginEmbedderPolicy: false`.

### `'unsafe-inline'` is a known weakening

It is there because the bundled swagger-ui injects inline assets. `object-src 'none'` and `frame-ancestors 'none'` still provide meaningful XSS and clickjacking mitigation, but inline script is permitted on the API origin.

**The reasoning does not transfer to the frontend.** The pages that render user-supplied `posts.contentHtml` are served by Next.js on a different origin and should carry a stricter policy. Relaxing one origin for swagger is not a reason to relax the other.

Splitting swagger onto its own path with its own policy, or serving it with a nonce, is the proper fix. Tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

## CORS

```js
origin: (origin, callback) => {
  if (!origin) return callback(null, true);                    // server-to-server
  if (allowedOrigins.includes(origin.trim())) return callback(null, true);
  if (NODE_ENV === "production" && allowedOrigins.length === 0) return callback(new Error(...));
  if (NODE_ENV !== "production") return callback(null, true);   // dev
  return callback(new Error("Not allowed by CORS"));
}
credentials: true
exposedHeaders: ["X-Request-Id"]
```

### The wildcard is deliberately not honoured

The policy runs with `credentials: true`. Reflecting an arbitrary origin back with credentials lets **any** website make authenticated cross-origin requests on behalf of a logged-in user.

`CORS_ORIGIN` must be an explicit comma-separated list. There is no `*` escape hatch, and adding one would be a serious regression.

### In production with no origins configured, it rejects

Fail-closed, with a warning logged naming the rejected origin. The development branch allows everything, and that branch keys on `NODE_ENV` rather than an opt-in flag specifically so it cannot be left on by forgetting to unset something.

## Rate Limiting

| Scope | Window | Limit |
|---|---|---|
| Global | 15 min | **5,000 production / 100,000 otherwise** |
| Auth | 15 min | 20 |
| OTP / reset | 1 hour | 5 |

`RATE_LIMIT_MAX` overrides either way. `standardHeaders: true`, legacy headers off.

Plus Redis-backed per-endpoint limiters that count failures and can lock accounts: login 5/15 min, register 3/hour, forgot-password 3/15 min, reset-password 5/5 min.

### The 100,000 figure

A full browser E2E run — 71 tests, each page load fanning out to several API calls — exhausts a production budget and then fails for reasons that have nothing to do with the code under test.

**It must never reach production.** The branch keys on `NODE_ENV`, which is the right mechanism; an opt-in flag would be one forgotten variable away from an unthrottled API.

### The distinction between the two kinds

An **auth** limiter defends a credential and therefore locks the account. An **API** limiter defends capacity and therefore only throttles. Conflating them turns a capacity control into a denial-of-service tool against known accounts.

## Body Limits and Timeout

| | |
|---|---|
| JSON and urlencoded | 10 MB |
| Request timeout | 30s → **408** |

A 408 in normal operation is a bug signal, not a normal outcome. Anything that could legitimately exceed 30 seconds belongs in a batch job.

## The Raw-Body Exception

```js
express.json({
  limit: "10mb",
  verify: (req, res, buf) => {
    if (req.originalUrl?.startsWith("/api/v1/billing/webhook")) req.rawBody = buf;
  },
})
```

Stripe signature verification needs the unparsed body. `req.rawBody` survives `globalSanitizer`, which rewrites `req.body`, `req.query` and `req.params` only.

**Moving the webhook mount without moving the prefix in that hook silently breaks verification.** The symptom is every webhook rejected, with nothing in the logs pointing at the parser.

## Input Handling

| Layer | Does |
|---|---|
| `globalSanitizer` | sanitises body, query and params before any handler |
| `validate(schema)` | Joi validation → 400 with field detail |
| `validateUuid` | rejects malformed path ids before the database |
| `hpp` | parameter pollution |

### Two validator traps

**1. Passing `schema.validate` directly to Express 500s every request** on that route. Express calls it as `(req, res, next)`; Joi expects a value. Always `validate(schema)`.

**2. Path parameters must reach the validator.** Several endpoints validated `req.body` for an id that only ever arrives in `req.params`, and 400ed every request. The fix merges first: `{ ...req.params, ...req.body }`.

Both shapes recurred across feature flags, tenant lifecycle and data retention — they are not one-off mistakes.

A bad enum value reaching the database always surfaces as a **500 rather than a 400**, which sends the investigation to the wrong layer. That is the signature of a missing validator.

## Error Responses

```json
{ "success": false, "status": 400, "message": "...", "data": null }
```

`details` only outside production.

### The mapper forwards recognised types only

A raw `pg` error message carries SQL. A raw Node error carries a file path. **No amount of care at the call site fixes a mapper that passes unknown errors through** — the call site cannot know what a driver will put in a message.

Unrecognised errors become a generic 500 with the request id, which is what a bug report needs anyway.

## Status Codes That Carry Security Meaning

| Code | Rule |
|---|---|
| **404** | non-existent, soft-deleted, and belonging to another tenant — all identical |
| **403** | permission failure **inside your own tenant**, where existence is not a secret from you |
| **409** | invalid state transition — a conflict, not a validation failure and not a server error |
| **429** | with `X-RateLimit-*` |

Returning 403 for a cross-tenant resource turns id enumeration into a tenant-membership oracle.

## Correlation

Every request gets a `crypto.randomUUID()` on `req.requestId`, returned as `X-Request-Id` and exposed through CORS so a browser client can read it.

It is the one piece of information a user can safely quote in a bug report, and the one thing that ties a client-side symptom to a server-side log line.

## The Public Surface

Every endpoint reachable without a token is listed in [`../API/00-API-STANDARDS.md`](../API/00-API-STANDARDS.md). Adding to that list is a security decision requiring an ADR.

Three deserve particular care:

| Endpoint | Care |
|---|---|
| `GET /certificates/verify/:certificateNumber` | must return an identical shape for "not found" and "signature mismatch" |
| `GET /tenants/public` | branding only — it is read before anyone signs in |
| `POST /billing/webhook` | the signature is the authentication; there is no token |

## What Has No Mechanism

**A new route with no permission gate works for everyone with a token**, and nothing in the system prevents it.

There is no build guard that fails a route lacking `dynamicAccess` or `rbac`. It is caught in review and by tests, which means it will eventually not be caught. That guard is the single highest-value mechanical control not yet built, and it is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).
