# 08 — Deployment Architecture

Operational procedure is in [`../DEVOPS/`](../DEVOPS/00-ENVIRONMENTS.md). Artefacts are in [`../../deploy/`](../../deploy/README.md). This document is the shape and the trade-offs.

---

## Two Paths

| Path | Status | Use when |
|---|---|---|
| **Docker Compose** | primary, in production use | single host, on-premise hospital, staging |
| **Helm / Kubernetes** | available, **renders but not cluster-validated** | horizontal scale, existing Kubernetes estate |

Compose is the default (ADR-032). Most deployments are single-tenant-facing installations inside a hospital network where Kubernetes is not present and would not be welcome.

The Helm charts exist as the escape route from the single-host risk (PR-12), written while it was still cheap. Their honest status: **the manifests are known to render; they are not known to be accepted by a cluster**, because no cluster has been reachable to validate against. That distinction should not be smoothed over in a status report.

## The Compose Stack

```
                          ┌───────────┐
                    :443  │   nginx   │  TLS, routing, ACME challenge passthrough
                          └─────┬─────┘
                    ┌───────────┴───────────┐
                    ▼                       ▼
            ┌──────────────┐        ┌──────────────┐
            │  frontend    │        │   backend    │
            │  Next binary │───────▶│  Express bin │
            │  :3000       │        │  :3000       │
            └──────────────┘        └──────┬───────┘
                                           │
     ┌────────────┬────────────┬───────────┼──────────┬──────────┐
     ▼            ▼            ▼           ▼          ▼          ▼
┌─────────┐  ┌────────┐  ┌──────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│postgres │  │ redis  │  │ rabbitmq │ │ clamav │ │ minio  │ │pgadmin │
│pgvector │  │        │  │  + mgmt  │ │        │ │(opt)   │ │ (dev)  │
└─────────┘  └────────┘  └──────────┘ └────────┘ └────────┘ └────────┘
```

Layered files in `deploy/compose/`:

| File | Adds |
|---|---|
| `docker-compose.yml` | the base stack; names the **pulled** images `zed378/calibration-{be,fe,backup}` (Docker Hub, ADR-123) and builds nothing |
| `docker-compose.build.yml` | the only file that builds, from source, as `callibrator/*:local` — beneath dev and the E2E stack (ADR-123) |
| `docker-compose.dev.yml` | pgadmin, MinIO, exposed ports, relaxed limits (with the build overlay) |
| `docker-compose.staging.yml` | staging images and resource caps |
| `docker-compose.prod.yml` | production images, restart policies, no exposed database ports |
| `docker-compose.vm.yml` | the single-host VM: pulled images, plain HTTP on 19080, the 19xxx port block |
| `docker-compose.e2e.yml` | the disposable E2E / browser stack (with the build overlay) |

### Startup ordering

Ordering is `depends_on` with **conditions**, not bare service names, because the backend runs `db.sync()` and migrations at boot:

| Dependency | Condition | Why |
|---|---|---|
| postgres | `service_healthy` | `pg_isready` — accepting connections, not merely started |
| redis | `service_healthy` | connected at boot |
| rabbitmq | `service_healthy` | AMQP listener check, not `ping` |
| clamav | `service_started` | first-run `freshclam` takes minutes; scanning is optional |

Requiring ClamAV to be *healthy* would block the entire stack on an optional component for several minutes on every cold start. Requiring Postgres to be merely *started* would produce a crash loop that looks like a code fault.

### Image choices that are not incidental

| Service | Image | Why not the obvious one |
|---|---|---|
| postgres | `pgvector/pgvector:pg18` | plain `postgres:18-alpine` lacks the `vector` extension; migration `0018` fails |
| rabbitmq | `3.13-management-alpine` | the management UI is worth the size in an on-premise install with no other observability |
| redis | `8.6-alpine` | — |
| clamav | `clamav/clamav:latest` | — |

## Container Images

### Backend — two stages, two base images

```
builder: node:26-alpine   → npm ci, swagger:generate, build:dist, pkg (node26) → /app/backend
runtime: debian:bookworm-slim
```

The runtime is Debian rather than Alpine; that was chosen when it needed **Chromium** for certificate PDF rendering. Since ADR-095 (2026-09-29) certificate PDFs are rendered by the frontend and the backend image has no browser.

Three details in that Dockerfile that will look strange:

1. **`PUPPETEER_SKIP_DOWNLOAD=true` at build.** No browser is downloaded; since ADR-095 there is no runtime Chromium and no `PUPPETEER_EXECUTABLE_PATH`.
2. **apt is pointed at HTTPS, and `ca-certificates` is bootstrapped with peer verification disabled for that one step.** Plain HTTP to the Debian mirrors is blocked in the deployment subnet, and `bookworm-slim` ships no CA bundle yet. Verification is back on for everything after.
3. **Runtime assets are copied explicitly** — `swagger.json`, `src/templates`, `docs/`. They are read from disk next to the binary via `appPath()`, not from the embedded snapshot. Omitting the copy produces an API that starts fine and then fails on the first PDF or the first email.

Runs as a non-root `app` user. Persistent directories (`/app/backup`, `/app/log`, `/app/uploads`) are created and chowned at build.

### Frontend — bun build, alpine runtime

```
builder: oven/bun:1-alpine  → bun install --frozen-lockfile, bun run build:docker → /app/server
runtime: alpine:3.22        → libstdc++, libc6-compat, wget
```

No Node runtime in the final image. `HEALTHCHECK` hits `http://localhost:3000`.

## Reverse Proxy

nginx terminates TLS and routes:

| Path | Upstream |
|---|---|
| `/api/*` | backend |
| `/socket.io/*` | backend, with WebSocket upgrade headers |
| `/oidc/*` | backend — discovery lives at the issuer root, not under `/api/v1` |
| `/.well-known/*` | backend — ACME HTTP-01 challenges |
| everything else | frontend |

Two of these are easy to miss and both fail confusingly:

- **`/socket.io/*` needs the upgrade headers.** Without them realtime silently falls back to long-polling, which works well enough that nobody notices until connection counts matter.
- **`/oidc/*` is at the root, not under `/api/v1`.** The discovery document advertises its endpoints at `<issuer>/oidc/...`, so relying parties fetch them there. The backend mounts the OIDC router twice for this reason.

## Health Checks

| Endpoint | Meaning |
|---|---|
| `GET /live` | liveness — 200 `OK`, dependency-free. The Helm liveness probe |
| `GET /ready` | readiness — 200 `READY` / **503** `NOT READY` (plain text) |
| `GET /health` | readiness — 200 `{"status":"ok"}` / **503** `{"status":"unavailable"}`, verdict only. The Helm readiness and startup probes and the compose healthcheck |
| `GET /api/v1/health` | the per-dependency breakdown — super admin only (`auth` + `denyApiKey` + `superAdminOnly`); `/jobs` and `/metrics` (bearer `METRICS_TOKEN`, 404 until set) beside it (P7-02) |
| `GET /` | 200 `{"status":"Success",...}` — not a probe |

`/ready` and `/health` are genuine readiness probes — they fail when PostgreSQL, Redis or RabbitMQ is unreachable. A container returning 503 here is correctly kept out of rotation, and using either as a liveness probe would restart a healthy process during a datastore blip. The public probes disclose no runtime detail and name no dependency; the probe paths are exempt from `FORCE_HTTPS` (S-09, ADR-081). *(Corrected, ADR-088: this table used to show uptime, memory, pid and `database: "connected"`, and `GET /` as liveness — the pre-A-06/A-15 handler.)* Details: [`../DEVOPS/05-MONITORING.md`](../DEVOPS/05-MONITORING.md#health-endpoints).

## Scaling

The current architecture scales **vertically**. Horizontal scaling has three hard prerequisites, in order:

| Prerequisite | Why |
|---|---|
| 1. Object storage off local disk (`s3` or `nfs`) | replica A writes, replica B cannot serve — [`05-STORAGE-ARCHITECTURE.md`](./05-STORAGE-ARCHITECTURE.md) |
| 2. Exactly one replica running the schedulers | otherwise every backup and purge runs once per replica |
| 3. Socket.IO Redis adapter | otherwise a notification reaches only the replica holding that connection |

None is optional and none is difficult. They simply have to happen before replica count goes above one, not after somebody notices duplicated backups.

## Persistence

| Volume | Holds |
|---|---|
| `./data/postgres` | the database |
| `./data/redis` | rate-limit counters, WebAuthn challenges, OIDC state, the registration lock, caches |
| `./data/rabbitmq` | queued messages |
| `./data/clamav` | virus signature database |
| `./uploads` | attachments, when `STORAGE_DRIVER=local` |
| `./backup` | tenant backups |
| `./log` | application logs |

Losing `./data/redis` interrupts sign-ins in progress (passkey challenges, OIDC authorisations) and resets lockout counters. Earlier versions of this document said it also held worker idempotency claims; none exists.

## Secrets

Compose reads `.env` (`env_file`). Kubernetes uses Secrets, optionally external via a secrets operator.

Three secrets are **required** and the application exits rather than starting without them:

```
CERT_SIGNING_SECRET     HMAC for certificate QR verification
ENCRYPT_KEY             e-signature private keys and tenant storage credentials at rest
ATTACHMENT_URL_SECRET   HMAC for signed attachment download URLs
```

Failing fast is right. Starting with a missing signing secret produces certificates that cannot be verified and attachments whose URLs cannot be validated — failures that appear far from their cause.

See [`../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md`](../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md).
