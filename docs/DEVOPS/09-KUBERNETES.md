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

## Object Names

Every object is named `<base>-<component>` by one helper, `callibrator.baseName` in [`templates/_helpers.tpl`](../../deploy/helm/callibrator/templates/_helpers.tpl), which the umbrella **and both subcharts** use:

| Release | `<base>` | Objects |
|---|---|---|
| `callibrator` (the Makefile default) | `callibrator` | `callibrator-backend`, `callibrator-frontend`, `callibrator-config`, `callibrator-secrets` |
| `prod` | `prod-callibrator` | `prod-callibrator-backend`, … |
| any, with `global.fullnameOverride=x` | `x` | `x-backend`, … |

Before S-27/S-06 the umbrella and the subcharts used two different rules, and **no release name rendered a consistent set**: under `callibrator` the ingress targeted services that did not exist and the backend's `envFrom` named a ConfigMap that did not exist; under any other name the backend named a Secret (`callibrator-secrets`) that did not exist. Both render cleanly and fail only in a cluster (`CreateContainerConfigError`).

Pods run with numeric ids matching the images: backend 997 (`backend/Dockerfile`), frontend 1001 (`frontend/Dockerfile`). With `runAsNonRoot` and a **named** image user, the kubelet refuses the container.

## Configurations the Chart Refuses to Render

Guard rails that fail the **render** rather than the cluster. Six, in [`templates/guards.tpl`](../../deploy/helm/callibrator/templates/guards.tpl): a missing image tag, cron with more than one replica, a missing required secret, production with no CORS origin, a value that moved (and would otherwise be ignored), and `VIRUS_SCAN_PROVIDER=clamav` with no `backend.clamav.host` (S-31 — the chart runs no ClamAV; clamd is external, like PostgreSQL, and since S-04 a clamav provider without `CLAMAV_ENABLED` refuses every upload). The first two:

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
  httpGet: { path: /live, port: 3000 }
readinessProbe:
  httpGet: { path: /health, port: 3000 }
```

**`/health` answers `{"status":"ok"}`, or 503 `{"status":"unavailable"}` when PostgreSQL, Redis or RabbitMQ is unreachable** (A-06, A-15). It is a verdict only; the per-dependency breakdown is `GET /api/v1/health`, super admin only. **`/live`** is dependency-free.

Using `/health` as a **liveness** probe would restart a healthy process during a datastore blip, turning a brief outage into a crash loop. Liveness gets `/live`; readiness gets `/health`.

A pod returning 503 on readiness is correctly kept out of rotation, which is exactly what you want when the database is unreachable.

## Secrets

Four are **required** — the application exits without them, and the chart refuses to render without them (guard 3):

```
CERT_SIGNING_SECRET  ENCRYPT_KEY  ATTACHMENT_URL_SECRET  KMS_MASTER_KEY
```

`KMS_MASTER_KEY` was missing from the chart until S-05, although compose and the Makefile already required it. `backend/src/services/kms.service.js` throws at startup in production without it, and because production writes nothing to stdout the pod crash-loops with **empty logs**. Values key: `secrets.kmsMasterKey`.

Kubernetes Secrets, chart-managed (`<base>-secrets`) or external via a secrets operator: `global.secrets.external.enabled` and `global.secrets.external.secretName`. The switch lives under **`global`** because the backend subchart must compute the same Secret name the umbrella creates, and a subchart sees only its own values and `global` (S-06). The old `secrets.external` key refuses to render rather than being ignored. An external Secret must carry the same keys [`templates/secret.yaml`](../../deploy/helm/callibrator/templates/secret.yaml) writes.

**`CERT_SIGNING_SECRET`, `ENCRYPT_KEY` and `KMS_MASTER_KEY` must be backed up separately from the cluster and from the database.** A cluster rebuild that recreates everything except these produces a system that starts cleanly and is permanently broken — every certificate fails verification, every wrapped credential is undecryptable ([`../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md`](../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md)).

## Ingress

| Path | Service | Note |
|---|---|---|
| `/api/*` | **frontend** | Next.js owns `/api/v1/*` and the httpOnly auth cookie — see [`03-REVERSE-PROXY.md`](./03-REVERSE-PROXY.md). The frontend reaches the backend via `BACKEND_INTERNAL_URL` |
| `/socket.io/*` | backend | **needs WebSocket annotations** |
| `/oidc/*` | backend | **at the root**, not under `/api/v1` |
| `/.well-known/*` | backend | ACME challenges |
| `/` | frontend | |

The `/socket.io/*` and `/oidc/*` entries are the two most likely to be omitted, and both fail confusingly:

- without WebSocket support, Socket.IO **silently falls back to long-polling** — it works, until connection counts matter;
- without `/oidc/*` at the root, discovery returns a document nobody can follow, because the issuer advertises `<issuer>/oidc/...`.

`X-Forwarded-For` must reach the application. Without it, per-source rate limiting collapses into one bucket, `sessions.ip_address` and `audit_logs.ipAddress` record the proxy rather than the client, and `e_signature_records.ipAddress` records the proxy — which is a compliance defect ([`03-REVERSE-PROXY.md`](./03-REVERSE-PROXY.md)).

## Stateful Dependencies

The charts assume Postgres, Redis and RabbitMQ are provided **externally** — a managed service, or a separately-managed operator.

Running a database from an application chart couples the two lifecycles: a `helm uninstall` that takes the database with it is a class of accident worth designing out.

**Postgres must have pgvector.** Migration `0018` runs `CREATE EXTENSION vector`, and plain Postgres fails it. Compose uses `pgvector/pgvector:pg18` for this reason; a managed service must have the extension available.

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
