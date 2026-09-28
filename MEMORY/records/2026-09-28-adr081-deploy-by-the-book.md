# 2026-09-28 — ADR-081: the by-the-book production start, and the deploy/docs S-card remainder

**Cards:** S-09 (remainder), S-13 (frontend half), S-23, S-25 (fresh-clone run), S-31, S-33, S-34 — `TASKS/AUDIT-2026-09-INFRA.md`
**Decision:** [ADR-081](../DECISIONS.md)

## How it was run

- A copy of the working tree (as of `c905e74` plus the in-flight edits) went into a scratch directory, never the repository. `deploy/compose/.env` was created only in that copy.
- **`make` ran for real:** GNU Make 4.4.1 inside `sdeploy/make:local` (`docker:29-cli` + `apk add make bash nodejs`), driving the host Docker daemon through the socket. The copy was mounted at Docker Desktop's host alias `/run/desktop/mnt/host/c/...` so compose bind mounts resolve to the same files.
- **Environment:** `COMPOSE_PROJECT_NAME=sdeploy-s09`, `BACKEND_IMAGE=sdeploy/backend`, `FRONTEND_IMAGE=sdeploy/frontend`.
- **The one departure from the book:** in the copy only, the prod overlay's nginx ports were `127.0.0.1:19580:80` and `127.0.0.1:19543:443`.
- Every stack, network and image was torn down afterwards. The VM was not touched, and neither were containers this work did not start.

## S-09 — `make env; make secrets; make up ENV=prod`

| Step | Result |
|---|---|
| `make env` | `Created deploy/compose/.env` |
| `make preflight` before pasting | exit 2: `Required secrets not set: CERT_SIGNING_SECRET ENCRYPT_KEY ATTACHMENT_URL_SECRET KMS_MASTER_KEY` |
| `make secrets`, then paste every line | 10 lines: 4 required + 2 JWT + `DB_PASS` (new) + `RABBITMQ_PASS`/`RABBITMQ_URL` + `REDIS_PASSWORD` |
| `make preflight ENV=prod TAG=sdeploy-s09` | `Preflight passed.`, exit 0 |
| compose `config` (the `$(DC)` line, prod) | **first run: exit 1**, `required variable ACME_DIRECTORY_URL is missing a value` → **fixed** (ADR-081 §2); after: exit 0. `RABBITMQ_URL: amqp://callibrator:<hex>@rabbitmq:5672` |
| `make images TAG=sdeploy-s09` | both images built (Node 26.10.0; backend `npm ci` 1035 packages, `build:dist`, pkg; frontend `npm ci` 827 packages, `next build`) |
| `make up ENV=prod TAG=sdeploy-s09` | **first run: exit 2**, `dependency failed to start: container sdeploy-s09-backend-1 is unhealthy`. The backend was running and connected. `wget -S http://localhost:3000/health` inside it returned `HTTP/1.1 301 Moved Permanently`, `Location: https://localhost:3000/health`. **Fixed** (ADR-081 §1). Second run: exit 0, `backend healthy` |
| nginx | `Restarting (1)`, `cannot load certificate "/etc/nginx/certs/fullchain.pem"`, while `make up` exited 0. **Fixed** (ADR-081 §3): `check-env` now refuses. Proved both ways: exit 2 without a certificate, exit 0 with a stand-in self-signed pair |
| final `make up ENV=prod` | exit 0. `backend`, `frontend`, `postgres`, `redis`, `rabbitmq` and `clamav` healthy; `nginx` up; `volume-init` exited 0 |
| from the containers | `rabbitmqctl list_connections user` → `callibrator running`. `redis-cli ping` with no auth → `NOAUTH Authentication required.` Backend `uid=997(app)`, `CapEff: 0000000000000000`, 0 error-level log lines |
| through nginx | `https://127.0.0.1:19543/health` → 200, `/` → 200, `/docs` → 404, `/docs.json` → 404; `http://127.0.0.1:19580/health` → 301 to https |

### Preflight refusals (each: exit 2)

`DB_PASS=CHANGE_ME` · `JWT_ACCESS_SECRET=CHANGE_ME` · `JWT_REFRESH_SECRET=` · `RABBITMQ_PASS=p@ss:w/rd` (with a matching URL, so it is the new URL-safety check that fires, not the agreement check) · `RABBITMQ_PASS=guest` · `REDIS_PASSWORD=`

**On the URL-safe question.** `make secrets` prints `randomBytes(24).toString('hex')`, which is URL-safe. Nothing refused a hand-chosen password that is not URL-safe, and `check-env` now does.

## S-13 — frontend half

This was already done by S-29 (`frontend/Dockerfile`). The build above confirmed it:

- `npm ci --workspace frontend` runs against the committed root `package-lock.json` (`git ls-files` lists only that lockfile).
- The base image is `node:26.10.0-alpine@sha256:0b36e8c1…`, and no bun image is copied in.
- `/etc/apk/repositories` in the runtime image is `https://dl-cdn.alpinelinux.org/alpine/v3.24/{main,community}`.
- Nothing disables verification: no `--allow-untrusted` and no `--no-check-certificate`.
- The runtime user is `uid=1001(app)` and Node is `v26.10.0`.

## S-23 — Swagger gating

The code was already done by ADR-066. Live, with `NODE_ENV=production` in the prod stack, `/docs` and `/docs.json` answered 404. In development (the S-25 run) they answered 200.

- **Tests:** `appRoutes.a253.test.js` ("production: /documentation and /standards answer 404, as /docs does"; "production with SWAGGER_ENABLED=true publishes them on purpose") and `csp.p708.test.js`.
- **Fixed:** a stale comment in `deploy/compose/nginx/vm-http.conf` still said `/docs` was reachable on the loopback port.

## S-25 — a fresh-clone start from `backend/.env.example`

- **Setup:** Node 26.10.0-alpine, with `backend/`, the root manifests and `.nvmrc` copied from the tree. The only env file present was `backend/.env.example`. Dependencies came from `npm ci --workspace backend` (1035 packages).
- **Datastores:** throwaway containers on network `sdeploy-s25`: `pgvector/pgvector:pg18` (the stack's digest), `redis:8.6-alpine`, and `rabbitmq:3.13-management-alpine` (the stack's digest, run as uid 100).
- **Edits to the copied template, which the template asks for:** `cp .env.example .env` and then exactly these changes: `DB_HOST`, `DB_PASS`, `REDIS_URL`, `RABBITMQ_URL`, and the three required secrets `CERT_SIGNING_SECRET`, `ENCRYPT_KEY` and `ATTACHMENT_URL_SECRET`.
- **Boot result:**
  - `Applied 63 migration(s)`, `[schema-verify] OK: 72 tables, 867 columns and 8 control objects match the models`.
  - `Redis connected successfully`, `Server running on port 3000`, and RabbitMQ consumers `batch_jobs` and `email_queue` registered.
  - 0 error lines.
  - `/health` → 200 `{"status":"ok"}`, and `/live` → 200.
- **Warnings the template left in place, as designed:** `DB_APP_ROLE is not set` and `AUTHZ_WIRING_SKIPPED` (the database was not seeded).
- An earlier run on 2026-09-27, on the Node 24 tree, gave the same result.

## S-31

This was already done. It was re-verified with helm v3.21.2:

- The default values plus `--set backend.clamav.host=clamd` render `CLAMAV_ENABLED: "true"`, `CLAMAV_HOST: "clamd"` and `CLAMAV_PORT: "3310"`.
- The prod values render `clamav.production.svc.cluster.local` and the staging values render `clamav.staging.svc.cluster.local`.
- `VIRUS_SCAN_PROVIDER=none` renders 0 `CLAMAV_` keys.
- An empty host refuses with `backend.env.VIRUS_SCAN_PROVIDER is clamav but backend.clamav.host is empty.`
- `clamAv.service.js:27-29` reads exactly these three names.
- **This is rendering only.** No cluster was available and no clamd was contacted.

## S-33

This was already done: `quarantineSweep.service.js` with its scheduler, and the singleton claim in `jobMonitor.service.js#claimRun` (ADR-060, P7-02).

- **Live, two replicas:** three processes ran against one real Redis with `requirepass`. Each called `runMonitored("scheduled-backup")` at the same instant. The results were `{"replica":"A","ran":false,"outcome":"skipped"}`, `{"replica":"B","ran":true,"outcome":"success"}` and `{"replica":"C","ran":false,"outcome":"skipped"}`. Redis held one key, `job-run:scheduled-backup:2026-09-28T04:59`, with a TTL of about 1,797 s.
- **Live, quarantine sweep:** on a real filesystem the sweep returned `{"scanned":2,"removed":1,"errors":0,"truncated":false}`.
  - Removed: a 2-hour-old file.
  - Kept: a fresh file, a sub-directory, and a symlink to `/etc/passwd`. `/etc/passwd` itself was untouched.
- **Tests:** `quarantineSweep.s33.test.js`, `quarantineSweepScheduler.s33.test.js` and `jobMonitor.service.p702.test.js` ("singleton claim across replicas (S-33)"). All passed, 63 tests with `csp.p708`.
- **Limit:** without Redis the claim is not enforced and the job runs anyway, as the code says. `SCHEDULERS_ENABLED=false` (ADR-060) remains the hard switch for a replica.

## S-34

This was already done in `beb0c4b` (2026-09-24).

- `docs/STORAGE/04-TENANT-STORAGE.md` § `storagePath.util.js` now describes the fixed S-15 root (`path.resolve(storagePath("uploads"))`, matching `attachment.service.js#resolveAbsPath`), and it records the S-17 quarantine deviation. The paragraph is now at line 265 and following, no longer at 254.
- `docs/DEVOPS/04-DATABASE-BACKUP.md` § Scheduled tenant backup lists `BACKUP_SCHEDULER` (`disabled`/`off`), `BACKUP_RETENTION_DAYS` (30, `TenantBackup.DEFAULT_RETENTION_DAYS`), `BACKUP_KEEP_MIN` (3, `scheduledBackup.service.js:60`) and `last-scheduled-backup.json`. All were checked against the code.
- The S-17 location deviation is in ADR-066.

## ACME / TLS consistency

`acme-client` was removed (ADR-076), and nothing reads `TLS_AUTO_PROVISION` or `ACME_*` (A-256). Only `CUSTOM_DOMAINS_ENABLED` is read, in `customDomains.service.js:36`. To match:

- **Compose:** the prod and staging overlays and both env templates.
- **Makefile:** `preflight`.
- **Helm:** the ConfigMap, `NOTES.txt`, and `values`, `values-prod` and `values-staging`.
- **Docs:** `deploy/README.md`, `AGENTS.md`, `docs/DEVOPS/00`, `03`, `07`, `09` and `11`, `docs/SECURITY/02` and `07`, and `docs/PLAN/10` (as-built note).

`helm lint` passes on the default, staging and prod values. `docker compose config -q` passes for the dev, staging, prod and vm overlays.

**Not changed:** `.github/workflows/ci.yml:362` still writes an `ACME_DIRECTORY_URL` line into its throwaway `.env`. It is harmless, and that file belongs to the P7 workstream.

## Files

- `Makefile`: `secrets` prints `DB_PASS`; `check-env` adds the URL-safe and certificate checks; `preflight` adds the placeholder check and drops the ACME check.
- `backend/index.js` and `backend/src/routes/internal/health.route.js` (`forceHttps`, `PROBE_PATHS`).
- `backend/src/tests/routes/health.forceHttps.s09.test.js` (new, 9 tests, passing).
- `backend/.env.example`.
- Compose: `deploy/compose/.env.example`, `docker-compose.prod.yml`, `docker-compose.staging.yml` and `nginx/vm-http.conf`.
- Helm: `deploy/helm/callibrator/templates/configmap.yaml`, `templates/NOTES.txt`, `values.yaml`, `values-prod.yaml` and `values-staging.yaml`.
- `deploy/README.md` and `AGENTS.md`.
- Docs: `docs/DEVOPS/00`, `03`, `07`, `09` and `11`; `docs/BACKEND/04`; `docs/SECURITY/02` and `07`; `docs/PLAN/10`.
- `MEMORY/DECISIONS.md` (ADR-081) and `TASKS/AUDIT-2026-09-INFRA.md`.

## Still open

- `make up` waits for the backend only.
- The backend does not refuse placeholder secrets at boot (ADR-081, alternatives).
- The Helm charts render and are not known to deploy (P7-06).
- The quarantine sweep and the Redis claim are proven on one host, not on a real multi-replica deployment.
