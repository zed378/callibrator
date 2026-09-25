# deploy/

Deployment artefacts. Operational procedure lives in [`../docs/DEVOPS/`](../docs/DEVOPS/00-ENVIRONMENTS.md); architecture in [`../docs/ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md`](../docs/ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md).

```
deploy/
├── compose/                     the primary deployment path
│   ├── docker-compose.yml       base — NOT deployable alone
│   ├── docker-compose.dev.yml   ports, pgadmin, MinIO, relaxed settings
│   ├── docker-compose.staging.yml
│   ├── docker-compose.prod.yml  no published database ports, pinned tags
│   ├── docker-compose.vm.yml    single host, plain HTTP, images built locally
│   ├── .env.example
│   └── nginx/
│       ├── default.conf         TLS
│       └── vm-http.conf         plain HTTP on a high port
└── helm/callibrator/            the escape route from a single host
    ├── Chart.yaml  values.yaml  values-staging.yaml  values-prod.yaml
    ├── templates/               configmap · secret · ingress · guards · NOTES
    └── charts/{backend,frontend}/
```

## Two Paths, and Their Honest Status

| Path | Status |
|---|---|
| **Docker Compose** | **primary, in production use** (ADR-032) |
| **Helm / Kubernetes** | **renders; not cluster-validated** |

`helm lint` and `helm template` pass. `kubectl apply --dry-run=server` has **not** been run, because no cluster has been reachable.

The charts exist as the escape route from the single-host risk (PR-12), written while it was still cheap. That distinction should not be smoothed over in a status report.

## Quick Start

```bash
make env          # create deploy/compose/.env from the example
make secrets      # generate the REQUIRED secrets
make dev          # bring the local stack up
```

The base compose file is **not deployable on its own** — it has no port publishing and no environment-specific settings. Always combine it with an overlay. `make up ENV=dev|staging|prod|vm` does that for you.

**The database is not seeded on first boot.** See [First Boot](#first-boot) below, or the stack comes up with 72 tables, zero rows and no account to log in with.

## The Four Required Secrets

```
CERT_SIGNING_SECRET   ENCRYPT_KEY   ATTACHMENT_URL_SECRET   KMS_MASTER_KEY
```

**`KMS_MASTER_KEY` was found by deploying**, not by reading anything: it was absent from `.env.example` and from the configuration document. `src/services/kms.service.js` throws at module load in production and the container crash-loops. Until A-14 that crash was invisible — production wrote nothing to stdout and the throw went to `log/activity/exception/<date>.log` only. **Since A-14 production logs JSON to stdout, including uncaught exceptions**, so `docker compose logs backend` shows it ([`../docs/OBSERVABILITY/01-LOGGING.md`](../docs/OBSERVABILITY/01-LOGGING.md)).

Read `docker compose logs backend` first when a container exits.

**The application exits without these.** Failing fast is correct: starting without a signing secret produces certificates that cannot be verified and attachment URLs that cannot be validated — failures that appear days later, in front of an auditor.

**Back up all but `ATTACHMENT_URL_SECRET` separately from the database and from the host.** A restore that recovers the data and loses them produces a system that starts cleanly and is **permanently broken**: every issued certificate fails public verification (the key cannot be re-derived) and every wrapped credential is undecryptable. Neither is practically rotatable.

A backup strategy that captures the data and loses the keys has captured ciphertext.

## Guards That Refuse Rather Than Warn

Both stacks fail **at configuration time** rather than deploying something that misbehaves quietly.

### Compose

| Guard | Effect |
|---|---|
| `IMAGE_TAG` required in staging and prod | a **presence** check (`${IMAGE_TAG:?}`) — it rejects unset or empty, and **cannot** reject the value `latest`. `.env.example` therefore ships it **empty** (S-10); the value check is `make preflight` / `make deploy`, which refuse `TAG=latest`. A direct `docker compose … -f docker-compose.prod.yml up` with `IMAGE_TAG=latest` in `.env` is **not** refused |
| `CORS_ORIGIN` required in staging and prod | with no origins in production the app rejects everything |
| `ACME_DIRECTORY_URL` required in prod | the **default is Let's Encrypt staging** — certificates no browser trusts |
| `make preflight` | rejects `TAG=latest`, `NODE_ENV != production`, `SEED_DEMO=true`, a wildcard CORS origin, a staging ACME URL, an empty / `guest` / `CHANGE_ME` `RABBITMQ_PASS`, and (S-09) a `REDIS_PASSWORD` that is empty or shorter than 16 characters, or set alongside a credentialed `REDIS_URL` |
| `make check-env` (every `make up`) | rejects missing required secrets, and a `RABBITMQ_URL` whose credentials differ from `RABBITMQ_USER`/`RABBITMQ_PASS` (S-09). Inside compose the backend's URL is now BUILT from those two (ADR-066), so the `.env` line only matters for a backend run outside compose |

### Helm

| Guard | Effect |
|---|---|
| Missing `image.tag` | **refuses to render** |
| `cron.enabled` with `replicaCount > 1` | **refuses to render** |
| Missing required secret (inline mode) | refuses to render |
| `cron.enabled` without a backup volume (S-18) | refuses to render |
| production without upload persistence (S-18) | refuses to render |
| a `redis.url` / `rabbitmq.url` with `user:password@` (S-09) | refuses to render — credentials belong in the Secret (`secrets.redisPassword`, `secrets.rabbitmqUrl`) |
| Equal JWT access and refresh secrets | refuses to render |
| `NODE_ENV=production` with no `corsOrigin` | refuses to render |

Both guards are verified working:

```bash
helm template cal deploy/helm/callibrator -f deploy/helm/callibrator/values-prod.yaml
#   → "backend.image.tag is required."

helm template cal deploy/helm/callibrator -f deploy/helm/callibrator/values-prod.yaml \
  --set backend.image.tag=a --set frontend.image.tag=a --set backend.replicaCount=3
#   → "Scheduled jobs are installed in EVERY replica and would run once per replica"
```

## Why `cron.enabled` Cannot Coexist With Replicas

**A cron job installed in every replica runs once per replica.** Two backend replicas means every tenant backup runs twice, every data-retention purge runs twice, every calibration sweep notifies twice.

The intended shape is two deployments:

- one replica with `cron.enabled: true` — the scheduler,
- N replicas with `cron.enabled: false` — the API.

Turning that into a **render failure** rather than a silently double-running stack is the entire point.

## Horizontal Scaling Prerequisites

Three, all hard, all before replica count goes above one. The chart guards only the second.

| # | Prerequisite | Failure without it |
|---|---|---|
| 1 | `STORAGE_DRIVER` = `s3` or `nfs` | replica A writes an attachment, replica B cannot serve it |
| 2 | Exactly one replica running schedulers | every scheduled job runs once per replica |
| 3 | Socket.IO **Redis adapter** | a notification reaches only one replica's clients |

Plus: the backend runs **migrations at boot**, so two replicas starting together both attempt them. Use an init container, or advisory-lock.

## Image Choices That Are Not Incidental

| Service | Image | Why not the obvious one |
|---|---|---|
| postgres | **`pgvector/pgvector:pg18`** | plain `postgres:18-alpine` lacks the `vector` extension; migration `0018` fails |
| rabbitmq | `3.13-management-alpine` | the management UI earns its size on-premise |
| backend runtime | **`debian:bookworm-slim`** | needs Chromium for certificate PDFs; Alpine Chromium against a glibc pkg binary is a fight not worth having |
| frontend runtime | **`node:22-alpine`** | Next.js **standalone** output; see below |

## Startup Ordering

`depends_on` with **conditions**, because the backend runs `db.sync()` and migrations at boot.

| Dependency | Condition | Why |
|---|---|---|
| postgres | `service_healthy` | `pg_isready` — accepting connections, not merely started |
| redis | `service_healthy` | connected at boot |
| rabbitmq | `service_healthy` | **`check_port_connectivity`**, not `ping` — `ping` only proves the Erlang node is up |
| clamav | `service_started` | first-run `freshclam` takes minutes; scanning is optional |

Requiring ClamAV healthy would block the whole stack on an optional component at every cold start. Requiring Postgres merely started produces a crash loop that looks like a code fault.

## nginx: Five Routes Easy to Get Wrong

All five fail confusingly. See [`../docs/DEVOPS/03-REVERSE-PROXY.md`](../docs/DEVOPS/03-REVERSE-PROXY.md).

| Route | Getting it wrong |
|---|---|
| `/api/*` → **frontend** | routing it to the **backend** breaks login: Next.js owns `/api/v1/*`, sets the httpOnly `auth_token` cookie and injects `Authorization` from it |
| `/socket.io/*` **with upgrade headers** | Socket.IO **silently** falls back to long-polling — works until connection counts matter |
| `/oidc/*` **at the root** | discovery advertises `<issuer>/oidc/...`; relying parties cannot follow it |
| `/.well-known/*` | ACME verification fails in a way that looks like DNS |
| `X-Forwarded-For` | rate limiting collapses to one bucket, `sessions.ip_address` and `audit_logs.ipAddress` record the proxy, and `e_signature_records.ipAddress` records the **proxy** — a compliance defect |

## Volumes

| Volume | Losing it means |
|---|---|
| `volumes/postgres` | everything |
| `volumes/redis` | WebAuthn challenges, OIDC authorisation state, rate-limit counters and caches — sign-ins in progress fail; no data is lost |
| `volumes/rabbitmq` | queued work |
| `volumes/uploads` | attachments and the upload quarantine — local disk whatever `STORAGE_DRIVER` says |
| `volumes/storage` | the `local` storage driver's objects (S-40) |
| `volumes/well-known` | an ACME HTTP-01 challenge in flight (it retries) |
| `volumes/backup` | tenant backups |
| `volumes/log` | scheduled-job status (`log/jobs/*.json`, P7-02) and, with `LOG_TO_FILE=true`, log files |

`volume-init` creates and chowns every application volume to uid 997 on each `up`.

## Redis Authentication (S-09)

Set `REDIS_PASSWORD` in `.env` (`make secrets` prints one). The compose Redis starts with `--requirepass` from that variable and the backend sends `AUTH` with the same value — one variable, read by both, so they cannot disagree. Keep `REDIS_URL` credential-free. Unset, nothing changes: no authentication, as before. An existing stack picks the password up on its next `up`; Redis stores no password in its data volume. Verified against a local `redis-server` 7.0: an unauthenticated `PING` answers `NOAUTH`, the healthcheck command authenticates, and the backend client with `REDIS_PASSWORD` connects.

## Container Hardening (S-19)

Every service: `no-new-privileges`, `cap_drop: [ALL]` plus only the capabilities its entrypoint needs; nginx and redis run read-only; CPU limits beside the memory limits in the prod, staging and vm overlays. The dev overlay binds every port to `127.0.0.1` except nginx. Table and reasoning: [`../docs/DEVOPS/02-CONTAINERIZATION.md`](../docs/DEVOPS/02-CONTAINERIZATION.md). **PARTLY VERIFIED BY RUNNING (2026-09-25, ADR-066): with the dev overlay, volume-init, postgres, redis (read_only), rabbitmq and the backend (uid 997, no capabilities) all reached healthy under these settings, and the backend connected to all three datastores. clamav, frontend, nginx, pgadmin and minio were NOT started, and no other overlay was brought up.** Confirm the rest on the first `make up`.

`volumes/redis` matters more than it looks.

## Frontend Images Are Per-Environment

**`NEXT_PUBLIC_*` values are inlined at build time**, not read at runtime.

- A different API URL means a **different image**.
- A tenant-pinned build (`NEXT_PUBLIC_TENANT_ID`) is a **separate image**.
- Setting them in the container environment does nothing.

Rolling back means deploying the **previously built image for that environment** — a rebuild is not a rollback.

One value is deliberately **not** inlined: `BACKEND_INTERNAL_URL` has no `NEXT_PUBLIC_` prefix and is read at **runtime**, because the server-side Next.js proxy and the browser need different addresses for the same backend. Pointing the server-side hop at the public origin makes it re-enter the proxy that called it and loop.

## The Next.js Runtime

The frontend image runs Next.js **standalone** output on `node:22-alpine`, and two details are not obvious.

`next.config.ts` carries a `next-bun-compile` adapter that is **opt-in via `NEXT_COMPILE=true`**. Left always-on it breaks `next build`:

```
ENOENT: no such file or directory, open '.next/next-server.js.nft.json'
```

The package is still a devDependency, and its postinstall shells out to `bun` purely to create a symlink — so the builder stage copies the `bun` binary in. Without it `npm install` exits **127** with `sh: bun: not found`.

The standalone server binds **`process.env.HOSTNAME`**, and Docker sets `HOSTNAME` to the container ID. Unset, the container listens on an address nothing can reach, the healthcheck reports "connection refused", and the service looks crashed while the process is fine:

```dockerfile
ENV HOSTNAME=0.0.0.0
```

## Single-Host VM Deployments

`docker-compose.vm.yml` builds the images locally (no registry) and serves plain HTTP on a high port (no domain, no certificate):

```bash
make up ENV=vm
# or, without the Makefile:
docker compose -f docker-compose.yml -f docker-compose.vm.yml up -d --build
```

It publishes a **19xxx** block rather than the defaults, because the reference host already ran nine other compose projects and 3000, 5432 and 8080 were taken. Only `19080` (nginx) is bound to `0.0.0.0`.

Bind-mounted volumes must be **chowned before the first start**. The backend image runs as UID 997; directories created by Docker belong to root, and the container exits with `EACCES: permission denied, mkdir '/app/log/activity/'`:

```bash
docker run --rm -v "$PWD/volumes:/v" alpine:3.22   sh -c "chown -R 997:997 /v/log /v/uploads /v/backup"
```

## First Boot

**Seeding is not automatic.** Migrations create 72 tables; nothing populates them. `POST /auth/login` fails because no user exists, and the 500 looks like a code fault.

`GET /api/v1/migration/seeding` is gated by `superAdminOrBootstrap` — it needs a super-admin token that cannot exist before the first seed. `ALLOW_SEEDING=true` breaks that chicken-and-egg:

```bash
ALLOW_SEEDING=true  →  restart  →  GET /api/v1/migration/seeding
                    →  ALLOW_SEEDING=false  →  restart  →  verify it returns 401
```

A successful seed reports the roles, the menu groups with their permission counts, and one super-admin user (`sys` / `sys@mail.com`).

**Turn it off again immediately.** While set it is an unauthenticated endpoint that writes to the database — verifying the 401 afterwards is part of the procedure, not an optional check.

## After Any Deployment

- [ ] `/health` returns 200 with `{"status":"ok"}` — a verdict over PostgreSQL, Redis and RabbitMQ that names no dependency; for the per-dependency breakdown, `GET /api/v1/health` with a super-admin token
- [ ] a user can log in **in a browser** — a 200 from `curl` against the backend proves nothing about the cookie
- [ ] `ALLOW_SEEDING` is unset and `/migration/seeding` returns **401**
- [ ] `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` match the public domain — unset, the server issues passkey challenges for `rp.id: "localhost"`, which every browser on the real domain rejects. The reference deployment ran that way until 2026-09-21, masked by a separate bug that made passkeys fail even earlier (A-24)
- [ ] a tenant-scoped list returns that tenant's rows **and no others**
- [ ] **a certificate issued before the deploy still verifies at its public URL**
- [ ] an attachment uploaded before the deploy still downloads
- [ ] migrations report nothing unexpected, **verified by inspecting columns**
- [ ] schedulers run on **exactly one** instance

The certificate check is the one that catches a deploy that lost a secret. Without it, a broken configuration looks successful for weeks.
