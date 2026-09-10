# 09 — Kubernetes

Charts: [`../../deploy/helm/callibrator/`](../../deploy/helm/callibrator/). An umbrella chart with `backend` and `frontend` subcharts.

---

## Honest Status

**The manifests render. They are not known to be accepted by a cluster**, because no cluster has been reachable to validate against.

That distinction should not be smoothed over in a status report. `helm template` and `helm lint` pass; `kubectl apply --dry-run=server` has not been run.

Compose is the primary deployment path (ADR-032). These charts exist as the **escape route from the single-host risk** (PR-12), written while it was still cheap.

## Chart Layout

```
deploy/helm/callibrator/
├── Chart.yaml
├── values.yaml
├── values-staging.yaml
├── values-prod.yaml
├── templates/
│   ├── _helpers.tpl
│   ├── NOTES.txt
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── ingress.yaml
│   └── guards.tpl          ← render-time refusals
└── charts/
    ├── backend/
    └── frontend/
```

## Two Configurations the Chart Refuses to Render

Guard rails that fail the **render** rather than the cluster.

### 1. A missing `image.tag`

```
{{- if not .Values.backend.image.tag }}
{{- fail "backend.image.tag is required — refusing to deploy :latest" }}
{{- end }}
```

`:latest` in a cluster means nobody can say what is running, and a rollback has nothing to roll back to.

### 2. More than one cron-enabled replica

```
{{- if and .Values.backend.cron.enabled (gt (int .Values.backend.replicaCount) 1) }}
{{- fail "backend.cron.enabled with replicaCount > 1 would run every scheduled job once per replica" }}
{{- end }}
```

**A cron job installed in every replica runs once per replica.** Two replicas means every tenant backup runs twice, every retention purge runs twice, every calibration sweep notifies twice.

Turning that into a **render failure** rather than a silently double-running stack is the whole point of the guard.

The intended shape is a separate single-replica deployment with `cron.enabled: true`, and the API deployment scaled with `cron.enabled: false`.

## Horizontal Scaling Prerequisites

All three are hard, and all three come **before** replica count goes above one.

| # | Prerequisite | Failure without it |
|---|---|---|
| 1 | `STORAGE_DRIVER` = `s3` or `nfs` | replica A writes an attachment, replica B cannot serve it |
| 2 | Exactly one replica running schedulers | every scheduled job runs once per replica |
| 3 | Socket.IO **Redis adapter** | a notification reaches only the replica holding that connection |

Plus one more: **the backend runs migrations at boot.** Two replicas starting together will both attempt them. Either an init container runs migrations once, or migrations are advisory-locked.

The chart guards prerequisite 2. Prerequisites 1, 3 and the migration race are configuration and code, and are **not** guarded — they will fail quietly.

## Probes

```yaml
livenessProbe:
  httpGet: { path: /, port: 3000 }
readinessProbe:
  httpGet: { path: /health, port: 3000 }
```

**`/health` calls `db.authenticate()` and returns 503 when the database is unreachable.**

Using it as a **liveness** probe would restart a healthy process during a database blip, turning a brief outage into a crash loop. Liveness gets `/`; readiness gets `/health`.

A pod returning 503 on readiness is correctly kept out of rotation, which is exactly what you want when the database is unreachable.

## Secrets

Three are **required** — the application exits without them:

```
CERT_SIGNING_SECRET  ENCRYPT_KEY  ATTACHMENT_URL_SECRET
```

Kubernetes Secrets, optionally external via a secrets operator.

**They must be backed up separately from the cluster and from the database.** A cluster rebuild that recreates everything except these produces a system that starts cleanly and is permanently broken — every certificate fails verification, every wrapped credential is undecryptable ([`../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md`](../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md)).

## Ingress

| Path | Service | Note |
|---|---|---|
| `/api/*` | backend | |
| `/socket.io/*` | backend | **needs WebSocket annotations** |
| `/oidc/*` | backend | **at the root**, not under `/api/v1` |
| `/.well-known/*` | backend | ACME challenges |
| `/` | frontend | |

The `/socket.io/*` and `/oidc/*` entries are the two most likely to be omitted, and both fail confusingly:

- without WebSocket support, Socket.IO **silently falls back to long-polling** — it works, until connection counts matter;
- without `/oidc/*` at the root, discovery returns a document nobody can follow, because the issuer advertises `<issuer>/oidc/...`.

`X-Forwarded-For` must reach the application. Without it, session binding is meaningless, per-source rate limiting collapses into one bucket, and `e_signature_records.ipAddress` records the proxy — which is a compliance defect ([`03-REVERSE-PROXY.md`](./03-REVERSE-PROXY.md)).

## Stateful Dependencies

The charts assume Postgres, Redis and RabbitMQ are provided **externally** — a managed service, or a separately-managed operator.

Running a database from an application chart couples the two lifecycles: a `helm uninstall` that takes the database with it is a class of accident worth designing out.

**Postgres must have pgvector.** Migration `0018` runs `CREATE EXTENSION vector`, and plain Postgres fails it. Compose uses `pgvector/pgvector:pg17` for this reason; a managed service must have the extension available.

## Resources

Set requests and limits. The backend renders PDFs with Chromium, which is memory-hungry and bursty — a limit sized for the steady state will OOM-kill the pod on the first certificate.

## Values Per Environment

`values-staging.yaml` and `values-prod.yaml` override the base.

Production must set:

```yaml
NODE_ENV: production          # gates CORS, rate limits, error detail
CORS_ORIGIN: "https://…"      # explicit, never a wildcard
FORCE_HTTPS: "true"
SEED_DEMO: ""                 # unset
BATCH_JOBS_INLINE: ""         # unset
ACME_DIRECTORY_URL: "https://acme-v02.api.letsencrypt.org/directory"
STORAGE_DRIVER: "s3"          # if replicaCount > 1
```

`ACME_DIRECTORY_URL` **defaults to the Let's Encrypt staging directory**. Forgetting it yields certificates no browser trusts, and the failure appears in a browser rather than in any log.

## Frontend Images Are Per-Environment

`NEXT_PUBLIC_*` values are **inlined at build time**. A different API URL means a different image; a tenant-pinned build is a different image.

The chart takes an image tag; it cannot configure these at runtime.

## Validating the Charts

```bash
make helm-lint
make helm-template ENV=prod
```

Both run today. What has **not** run:

```bash
kubectl apply --dry-run=server -f -    # needs a cluster
helm install --dry-run                 # needs a cluster
```

Until one does, the charts are known to render and not known to deploy. Validating them against a real cluster is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).
