# 02 — Trust Boundaries

Where data crosses from something less trusted into something more trusted. Every one of these is a place validation must happen and cannot be assumed to have happened upstream.

---

## The Map

```
                        ── B1 ──
  internet ─────────────────────────▶ nginx (TLS termination)
                                          │
                        ── B2 ──          │
  ────────────────────────────────────────┼─────────────▶ Next.js
                                          │                  │
                        ── B3 ──          │                  │ B4
  ────────────────────────────────────────┴──────────────────┴──▶ Express API
                                                                    │
        ┌──────────── B5 ────────────┬────────── B6 ────────────┐   │
        ▼                            ▼                          ▼   ▼
    database                    Redis / RabbitMQ            object storage
                                                                 
        ── B7 ──▶ outbound: Stripe, SMTP, ACME, LLM, tenant webhooks, tenant buckets
        ── B8 ──▶ inbound machine: IoT devices, SCIM clients, API keys, OIDC RPs
        ── B9 ──▶ the tenant boundary  (inside the API, not at its edge)
```

## B1 — Internet to nginx

**Least trusted.** Everything arriving here is hostile until proven otherwise.

| Control | Where |
|---|---|
| TLS termination | nginx |
| HTTPS redirect | `FORCE_HTTPS` in production |
| Rate limiting | global limiter behind |

## B2 — Internet to Next.js

Public routes: `/`, `/login`, `/register`, `/blog`, `/news`, `/verify/[certificateNumber]`.

`/verify` is the one public route that is **functionally load-bearing** rather than marketing. It must work without a session, without heavy client dependencies, and on whatever browser an auditor happens to have.

The frontend is **not a trust boundary for authorization**. It renders the sidebar from a server-resolved menu tree, which makes an unauthorised surface absent rather than hidden — but every backend route enforces independently regardless.

## B3 — Internet to Express API

The main boundary. The full pipeline order is in [`../ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md`](../ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md).

```
helmet → hpp → CORS → rate limit → body parse (10 MB) → timeout 30s
  → request id → logging → globalSanitizer
  → auth → tenantContext → dynamicAccess/rbac/abac → validate → handler
```

Everything in `req.body`, `req.query`, `req.params` and every header is attacker-controlled.

### The endpoints that cross B3 without a token

```
GET  /health, /
GET  /oidc/.well-known/openid-configuration, /oidc/.well-known/jwks.json
GET  /api/v1/certificates/verify/:certificateNumber
GET  /api/v1/content/posts/public, /posts/public/:slug, /categories/public
GET  /api/v1/tenants/public
POST /api/v1/auth/login, /register, /send-otp, /reset-password
GET  /api/v1/auth/activation
POST /api/v1/billing/webhook          signature-authenticated
POST /api/v1/iot/ingest               device-token authenticated
```

Adding to this list is a security decision that needs an ADR.

`GET /api/v1/tenants/public` must expose **branding only** — name, logo, primary colour. It is read before anyone has signed in; anything else there is a pre-auth disclosure.

## B4 — Next.js server to Express API

Server-to-server, no `Origin` header, and CORS therefore allows it.

Two paths exist: the browser calling the API origin directly with a Bearer token, and the browser calling a same-origin path that `src/app/api/v1/[...path]` proxies. The proxy is useful where a strict CSP or a corporate proxy makes a cross-origin call awkward.

**The proxy must not become an authorization bypass.** It forwards the caller's credentials; it does not add its own.

## B5 — API to database

The application connects as a single role. Two properties follow:

- **The application can alter its own schema** — necessary, because migrations run at boot from the same process.
- **`REVOKE` protections must be tested as the application role, not the owner.** As the owner the test passes whether the grant exists or not, producing a green tick for an absent control.

Queries are parameterised through Sequelize. Raw SQL bypasses both parameterisation defaults **and** the tenant hooks, so every raw query carries both responsibilities explicitly.

TLS: `DB_SSL`, `DB_SSL_CA`, `DB_SSL_REJECT_UNAUTHORIZED`.

## B6 — API to Redis and RabbitMQ

Not a cache-only boundary. Redis holds **state**:

| Purpose | Loss on failure |
|---|---|
| Rate-limit and brute-force counters | protection weakens — **security** |
| WebAuthn challenges | ceremonies fail |
| Worker idempotency claims | **duplicates become possible** |
| Read cache | slower, correct |

An outage window is a window in which duplicate emails, duplicate webhook deliveries and unthrottled login attempts were possible. Redis coming back is not the end of that incident.

Neither service should be reachable from outside the deployment network. In the production compose file their ports are not published.

## B7 — Outbound

The platform makes requests **from its own network position** to addresses that are, in several cases, chosen by a tenant.

| Destination | Chosen by | SSRF-checked |
|---|---|---|
| Stripe | operator | n/a |
| SMTP | operator | n/a |
| ACME directory | operator | n/a — **defaults to Let's Encrypt staging** |
| LLM endpoint | operator, or **per tenant** | tenant-supplied must be |
| Tenant webhook URL | **tenant** | **yes** |
| Tenant S3 endpoint | **tenant** | **yes** |
| Operator S3 endpoint | operator | **deliberately not** — `http://minio:9000` is normal |

The operator/tenant asymmetry is the whole point. The operator is trusted to name an internal host; a tenant is not. Any refactor that unifies the two paths must keep the tenant side checked.

## B8 — Inbound machine

| Client | Credential | Notes |
|---|---|---|
| IoT device | `calibration_devices.iotDeviceToken` | must never appear in a list response |
| API consumer | API key — hash stored, prefix displayed | `expiresAt` should always be set |
| SCIM client | its own auth | responses use the **SCIM envelope**, not the platform one |
| OIDC relying party | client credentials | discovery served at the issuer root |

## B9 — The tenant boundary

**The most important boundary in the system, and it is entirely inside the API process.**

It is not enforced by network topology, by separate databases, or by separate deployments. It is enforced by `AsyncLocalStorage` plus global Sequelize hooks, deny-by-default.

Full treatment in [`05-MULTI-TENANCY-SECURITY.md`](./05-MULTI-TENANCY-SECURITY.md), which is mandatory reading.

The four sanctioned crossings:

| Crossing | Condition |
|---|---|
| `skipTenantScope` | explicit, greppable, needs a comment |
| `isSystemTask` | background work; scope it as narrowly as possible |
| `isSuperAdmin` | by design; audited |
| no CLS context | pre-auth, public, migrations, schedulers |

Everything else denies.

## What Is Not a Boundary

Naming these explicitly, because treating a non-boundary as a boundary produces false confidence:

| Not a boundary | Why |
|---|---|
| The frontend | authorization is enforced server-side, always |
| The API proxy route | forwards credentials, adds none |
| The menu tree | navigation, not enforcement |
| Tenant hierarchy | a parent does not automatically see child data |
| `STORAGE_S3_PREFIX` | a convenience for sharing a bucket, not isolation |
| The admin surface | role-gated inside the same app, not a separate deployment |
