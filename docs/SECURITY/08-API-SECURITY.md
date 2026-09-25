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

`helmet`, with the directives in [`backend/src/utils/csp.util.js`](../../backend/src/utils/csp.util.js) (P7-08, 2026-09-24):

```
default-src      'self'
script-src       'self'                       ← no 'unsafe-inline' (was: 'self' 'unsafe-inline')
script-src-attr  'none'                       ← no inline event handlers
style-src        'self' 'unsafe-inline' https:
img-src          'self' data: https:
font-src         'self' data: https:
object-src       'none'
base-uri         'self'
form-action      'self'
frame-ancestors  'none'
```

`crossOriginResourcePolicy: cross-origin` so the separate-origin frontend can load `/uploads` images. `crossOriginEmbedderPolicy: false`.

### Swagger has its own policy (P7-08)

The API policy used to allow `'unsafe-inline'` for **scripts** on the whole origin "because the bundled swagger-ui injects inline assets". That premise was wrong for scripts: swagger-ui-express loads `swagger-ui-bundle.js`, `swagger-ui-standalone-preset.js` and `swagger-ui-init.js` as **external** files; only its CSS is inline. So:

- the origin default drops `'unsafe-inline'` for scripts (above);
- `/docs` gets `SWAGGER_CSP_DIRECTIVES` — the same policy plus `connect-src 'self'` for "Try it out" — set by the `swaggerCsp` middleware mounted **only** on `/docs` (`backend/src/docs/swagger.js`);
- both keep `'unsafe-inline'` for **styles**: `/documentation` (`docs/DOCUMENTATION.html`) has a `<style>` block and ~250 `style=` attributes, and Swagger UI's components set inline styles. Inline style is a far smaller risk than inline script; removing it is separate work on those pages.

Test: `backend/src/tests/utils/csp.p708.test.js` — real express + helmet + the real swagger-ui-express page over HTTP: the API response has `script-src 'self'` and `script-src-attr 'none'`; `/docs/` carries the Swagger policy and **every `<script>` it serves has a `src`** (the fact that makes the strict policy safe); other paths keep the default.

### Swagger is not published in production (S-23)

`/docs` and `/docs.json` were mounted unconditionally and unauthenticated, reachable in production only because no nginx location happened to route them. Now `swaggerDocs` mounts them outside production, and **in production only with `SWAGGER_ENABLED=true`** (`SWAGGER_ENABLED=false` turns them off everywhere). Same test file: `NODE_ENV=production` → both 404. Decision: [ADR-066](../../MEMORY/DECISIONS.md) (P7-08/S-23) — *off* rather than *behind a super-admin session*, because the UI is fetched by a browser navigation that carries no bearer token, and a spec gated by a session cookie the API does not issue would be a gate in name only.

### The content origin — a nonce CSP (P7-08, [ADR-071](../../MEMORY/DECISIONS.md))

**The reasoning never transferred to the frontend.** The pages that render user-supplied `posts.contentHtml` (and ticket descriptions) through `dangerouslySetInnerHTML` are served by Next.js. Until 2026-09-25 **that origin sent no Content-Security-Policy at all**. It now sends one, built by [`frontend/src/lib/securityHeaders.ts`](../../frontend/src/lib/securityHeaders.ts). [`frontend/src/proxy.ts`](../../frontend/src/proxy.ts) calls the builder once per page request with a fresh 128-bit nonce. As served by a production build:

```
default-src      'self'
script-src       'self' 'nonce-<per request>' 'strict-dynamic'     ← dev adds 'unsafe-eval'
script-src-attr  'none'
style-src        'self' 'unsafe-inline'                            ← fallback for pre--elem/-attr browsers
style-src-elem   'self' 'nonce-<per request>'                      ← dev: 'unsafe-inline' (HMR)
style-src-attr   'unsafe-inline'
img-src          'self' data: blob: <API origin>
font-src         'self'
connect-src      'self' ws://<Host> wss://<Host> <API origin> <API ws origin>
frame-src        'self' <API origin>
object-src       'none'
base-uri         'self'
form-action      'self'
frame-ancestors  'none'
```

`<API origin>` is `NEXT_PUBLIC_API_BASE_URL`, the origin `lib/socket.ts` connects to. In production it is the public origin itself. `<Host>` is the request's `Host` header, which is left out unless it is a plain host or host and port.

- **How Next gets the nonce.** The proxy sets the policy on the **request** as well as on the response. Next parses the request header while rendering and stamps the nonce on every script it emits. The root layout reads `x-nonce` for `ThemeInitScript`.
- **Every page renders per request.** A prerendered page or static shell has no nonce, so its scripts would be blocked. The root layout reads `headers()` and exports `instant = false`, which makes every route dynamic.
- **Styles.** `<style>` elements need the nonce. `style` attributes stay inline, because React server-renders `style={{…}}` props as attributes and CSP cannot nonce an attribute. Production Tailwind 4 and Next emit no inline `<style>`. The reasoning is in ADR-071.
- **Other page headers** (set in `frontend/next.config.ts`, not on `/api/` or `/uploads/public/`, which relay the backend's own):
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()`
  - `X-Powered-By` is off.
  - nginx adds only HSTS.

**Tests.**
- `frontend/src/lib/securityHeaders.test.ts` — every directive, and Next's own `getScriptNonceFromHeader` reading the nonce back out.
- `frontend/src/proxy.test.ts` § "the page CSP" — the nonce reaches the request (`x-middleware-request-*`) and differs on every request.

**Verified live on 2026-09-25**, on a production build served by the standalone `server.js`:
- Headless Chrome loaded 11 pages with zero violations, and Next booted on each.
- A blog post whose `contentHtml` carried `<script>`, `<script src="data:…">`, `onerror=` and `<style>` had all four blocked. The post bypassed the write-time sanitiser.

That covers P7-08's third Definition-of-Done item (S-43). The fourth, "a test that an inline script in `contentHtml` does not execute", was met by that run, but the run is a one-off and not a suite test. The frontend has no browser runner, and none was added. **Not verified:** the Socket.IO websocket under this policy against a live backend, and a deployment behind nginx.

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
