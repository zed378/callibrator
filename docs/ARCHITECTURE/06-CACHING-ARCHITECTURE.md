# 06 — Caching Architecture

Redis. `REDIS_URL`, or `REDIS_HOST` plus `REDIS_PORT`.

---

## What Redis Holds

Redis is used for four distinct purposes, and they have different consequences when it is unavailable:

| Purpose | Loss on Redis failure | Severity |
|---|---|---|
| Rate limiting and brute-force counters | limits stop being enforced | **security** |
| WebAuthn challenge store | passkey registration and login fail | functional |
| Idempotency claims for workers | duplicate side effects become possible | **correctness** |
| Read caching | slower, correct | performance |

Only the last of those is a cache in the ordinary sense. The first three are state, and treating Redis as "just a cache we can lose" is wrong for them.

## Rate Limiting

Two layers.

**Express-level limiters** in `backend/index.js`:

| Limiter | Window | Max |
|---|---|---|
| global | 15 min | 5,000 production / 100,000 otherwise, overridable with `RATE_LIMIT_MAX` |
| auth | 15 min | 20 |
| OTP / password reset | 1 hour | 5 |

The non-production figure is high on purpose: a full browser E2E run — 71 tests, each page load fanning out to several API calls — exhausts a production budget and then fails for reasons that have nothing to do with the code under test. It must never leak into a production deployment, which is why the branch keys on `NODE_ENV` rather than on an opt-in flag.

**Redis-backed endpoint limiters** from `constants/rateLimitConstants.js`, which track failures and can lock accounts:

| Endpoint | Attempts | Window | Lockout |
|---|---|---|---|
| login | 5 | 15 min | 15 min |
| register | 3 | 1 hour | 1 hour |
| forgotPassword | 3 | 15 min | 15 min |
| resetPassword | 5 | 5 min | 5 min |

Plus request-quota limiters (429 with `X-RateLimit-*` headers, no account lock) for operations such as tenant creation and uploads.

The distinction is real: an auth limiter defends a credential and therefore locks; an API limiter defends capacity and therefore only throttles.

## WebAuthn Challenges

A WebAuthn ceremony issues a challenge, and the response must be verified against **that** challenge. Storing it in Redis rather than in process memory is what allows more than one backend replica: without it, a challenge issued by replica A cannot be verified by replica B.

Short TTL, single use. A challenge that can be replayed is not a challenge.

## Idempotency Claims

The worker uses Redis to make "has this job already been handled" a single atomic operation.

**Check-then-mark is racy.** Two consumers can both pass the check before either marks, and a payment gets credited twice or an email sent twice. The correct primitive is `SET NX` — claim and check in one operation.

Equally important: **a failed attempt must release its claim.** Otherwise "retry three times" silently becomes "try once, no-op twice", and the logs look identical to three successful attempts.

## Session Storage

Sessions live in the **database** (`sessions` table), not in Redis (ADR-034).

That is deliberate. A session in this system is not a performance optimisation — it is an audit record. It answers "which sessions were live on 14 March" and "revoke this person now", and both questions need durability that a cache does not offer.

Redis may cache session lookups in front of the table; the table remains the source of truth.

## Read Caching

Applied selectively, to data that is expensive to compute and tolerant of brief staleness:

| Cached | Why | Invalidated by |
|---|---|---|
| Resolved menu tree per role | computed on every page load, changes rarely | role or permission change |
| Tenant branding | fetched pre-auth on every login page view | tenant update |
| Dashboard aggregates | expensive, refreshed periodically | TTL |
| Feature flag state | read on many paths | flag change |

**Not cached:** anything tenant-scoped whose staleness could show one tenant another tenant data. A cache key missing the tenant id is a cross-tenant leak with a very long tail, because it persists after the bug is fixed until the key expires.

Every cache key in tenant-scoped territory must include the tenant id. This is the single rule that matters in this document.

## Invalidation

Write-through on mutation, TTL as a backstop. TTL alone is not enough for permissions: a revoked permission that remains effective for five minutes is a five-minute authorization bypass.

## Failure Behaviour

| Subsystem | Redis down |
|---|---|
| Express rate limiters | keep working — in-memory store |
| Redis endpoint limiters | **degrade** — brute-force protection weakens |
| WebAuthn | fails — ceremonies cannot complete |
| Worker idempotency | **duplicates become possible** |
| Read cache | falls through to the database |
| Sessions | unaffected — they are in the database |

The two lines in bold are why Redis is a required dependency in the compose stack with a health check, not an optional one. A deployment that treats it as optional has quietly turned off brute-force protection and duplicate suppression.

## Operational

```yaml
redis:
  image: redis:8.6-alpine
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    retries: 10
    start_period: 10s
```

The backend waits for `service_healthy`, not `service_started` — it connects at boot, and starting against a Redis that is not yet serving produces a crash loop that looks like a code fault.

Persistence is on (`./data/redis:/data`), which matters for the idempotency keys: losing them on restart reopens the duplicate window for anything in flight.
