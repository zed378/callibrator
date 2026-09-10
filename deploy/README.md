# deploy/

Deployment artefacts. Operational procedure lives in [`../docs/DEVOPS/`](../docs/DEVOPS/00-ENVIRONMENTS.md); architecture in [`../docs/ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md`](../docs/ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md).

```
deploy/
├── compose/                     the primary deployment path
│   ├── docker-compose.yml       base — NOT deployable alone
│   ├── docker-compose.dev.yml   ports, pgadmin, MinIO, relaxed settings
│   ├── docker-compose.staging.yml
│   ├── docker-compose.prod.yml  no published database ports, pinned tags
│   ├── .env.example
│   └── nginx/default.conf
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
make secrets      # generate the three REQUIRED secrets
make dev          # bring the local stack up
```

The base compose file is **not deployable on its own** — it has no port publishing and no environment-specific settings. Always combine it with an overlay. `make up ENV=dev|staging|prod` does that for you.

## The Three Required Secrets

```
CERT_SIGNING_SECRET      ENCRYPT_KEY      ATTACHMENT_URL_SECRET
```

**The application exits without them.** Failing fast is correct: starting without a signing secret produces certificates that cannot be verified and attachment URLs that cannot be validated — failures that appear days later, in front of an auditor.

**Back the first two up separately from the database and from the host.** A restore that recovers the data and loses them produces a system that starts cleanly and is **permanently broken**: every issued certificate fails public verification (the key cannot be re-derived) and every wrapped credential is undecryptable. Neither is practically rotatable.

A backup strategy that captures the data and loses the keys has captured ciphertext.

## Guards That Refuse Rather Than Warn

Both stacks fail **at configuration time** rather than deploying something that misbehaves quietly.

### Compose

| Guard | Effect |
|---|---|
| `IMAGE_TAG` required in staging and prod | `:latest` means nobody can say what is running |
| `CORS_ORIGIN` required in staging and prod | with no origins in production the app rejects everything |
| `ACME_DIRECTORY_URL` required in prod | the **default is Let's Encrypt staging** — certificates no browser trusts |
| `make preflight` | rejects `NODE_ENV != production`, `SEED_DEMO=true`, a wildcard CORS origin, and a staging ACME URL |

### Helm

| Guard | Effect |
|---|---|
| Missing `image.tag` | **refuses to render** |
| `cron.enabled` with `replicaCount > 1` | **refuses to render** |
| Missing required secret (inline mode) | refuses to render |
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
| postgres | **`pgvector/pgvector:pg17`** | plain `postgres:17-alpine` lacks the `vector` extension; migration `0018` fails |
| rabbitmq | `3.13-management-alpine` | the management UI earns its size on-premise |
| backend runtime | **`debian:bookworm-slim`** | needs Chromium for certificate PDFs; Alpine Chromium against a glibc pkg binary is a fight not worth having |
| frontend runtime | `alpine:3.22` | the Bun binary needs only `libstdc++` and `libc6-compat` — no Node |

## Startup Ordering

`depends_on` with **conditions**, because the backend runs `db.sync()` and migrations at boot.

| Dependency | Condition | Why |
|---|---|---|
| postgres | `service_healthy` | `pg_isready` — accepting connections, not merely started |
| redis | `service_healthy` | connected at boot |
| rabbitmq | `service_healthy` | **`check_port_connectivity`**, not `ping` — `ping` only proves the Erlang node is up |
| clamav | `service_started` | first-run `freshclam` takes minutes; scanning is optional |

Requiring ClamAV healthy would block the whole stack on an optional component at every cold start. Requiring Postgres merely started produces a crash loop that looks like a code fault.

## nginx: Four Routes Easy to Omit

All four fail confusingly. See [`../docs/DEVOPS/03-REVERSE-PROXY.md`](../docs/DEVOPS/03-REVERSE-PROXY.md).

| Route | Omitting it |
|---|---|
| `/socket.io/*` **with upgrade headers** | Socket.IO **silently** falls back to long-polling — works until connection counts matter |
| `/oidc/*` **at the root** | discovery advertises `<issuer>/oidc/...`; relying parties cannot follow it |
| `/.well-known/*` | ACME verification fails in a way that looks like DNS |
| `X-Forwarded-For` | session binding meaningless, rate limiting one bucket, and `e_signature_records.ipAddress` records the **proxy** — a compliance defect |

## Volumes

| Volume | Losing it means |
|---|---|
| `volumes/postgres` | everything |
| `volumes/redis` | **in-flight worker idempotency claims** — the duplicate window reopens |
| `volumes/rabbitmq` | queued work |
| `volumes/uploads` | attachments, when `STORAGE_DRIVER=local` |
| `volumes/backup` | tenant backups |

`volumes/redis` matters more than it looks.

## Frontend Images Are Per-Environment

**`NEXT_PUBLIC_*` values are inlined at build time**, not read at runtime.

- A different API URL means a **different image**.
- A tenant-pinned build (`NEXT_PUBLIC_TENANT_ID`) is a **separate image**.
- Setting them in the container environment does nothing.

Rolling back means deploying the **previously built image for that environment** — a rebuild is not a rollback.

## After Any Deployment

- [ ] `/health` returns 200 with `database: "connected"`
- [ ] a user can log in
- [ ] a tenant-scoped list returns that tenant's rows **and no others**
- [ ] **a certificate issued before the deploy still verifies at its public URL**
- [ ] an attachment uploaded before the deploy still downloads
- [ ] migrations report nothing unexpected, **verified by inspecting columns**
- [ ] schedulers run on **exactly one** instance

The certificate check is the one that catches a deploy that lost a secret. Without it, a broken configuration looks successful for weeks.
