# 2026-09-30 — P7-06: the Helm charts on a real (kind) cluster

**Task:** P7-06 (TASKS/PHASE-7-OPERATIONAL-MATURITY.md) · **Decision:** [ADR-106](../DECISIONS.md) · **Closes:** P7-06 on kind. U-01 ("the charts deploy") stays open for a production cluster.

## What ran, exactly

| | |
|---|---|
| Cluster | kind **v0.33.0** (`kind-windows-amd64`, sha256 `4b22adaa…15fc9fc` verified against the release's `.sha256sum`), node image `kindest/node:v1.37.0`, **one node**, kindnet `v20260820-69b56db7`, local-path provisioner, on Docker Desktop 29.6.2 (16 CPUs, shared with other agents' stacks) |
| Ingress | ingress-nginx **controller-v1.15.1**, the `deploy/static/provider/kind` manifest (sha256 `2a3ae008…3299df`), host ports `127.0.0.1:28080/28443`, a self-signed TLS secret for `callibrator.kind.test` |
| Datastores (throwaway, namespace `callib-deps`, digests as compose pins them) | `pgvector/pgvector:pg18@sha256:2ba9ca5f…` → **PostgreSQL 18.6, pgvector 0.8.6**, a NON-superuser owner `callibrator` with `CREATEROLE` (the managed-database shape), `vector` pre-created by the superuser · `redis:8.6-alpine` with `requirepass` · `rabbitmq:3.13-management-alpine` with a user/password · `clamav/clamav:1.4` |
| Images | `callibrator/backend:p706` from **HEAD `ce74932`** (`git archive`, Dockerfile unchanged). The working tree did not build: first `build-dist: a module exists as both .js and .ts` (Phase 9 conversions in flight), then TypeScript errors in half-converted `validators/*.ts`. `callibrator/frontend:p706` from the working tree of 2026-09-29, `NEXT_PUBLIC_API_BASE_URL=https://callibrator.kind.test` |
| Secrets | chart-managed (`global.secrets.external.enabled=false`), all fresh `openssl rand -hex`: the four required, the JWT pair, `DB_PASS`, `REDIS_PASSWORD`, a credentialed `RABBITMQ_URL` |
| Scratch | everything under the session scratchpad `helm/` (values, manifests, scripts, logs); nothing in the repository but the chart and the documents |

## Evidence, step by step

| # | Check | Result |
|---|---|---|
| 1 | `kubectl apply --dry-run=server` of the **unmodified** chart | **clean, 14 objects**; the Ingress passed the ingress-nginx admission webhook (after re-running its cert patch job, which had run before the controller) |
| 2 | `helm install` (revision 1) | deployed; backend `Applied 63 migration(s)`, `[schema-verify] OK: 72 tables, 867 columns and 8 control objects`, `[kms-verify] OK`, `Database queries now run as the application role "callibrator_app"`, `Redis adapter enabled`, both RabbitMQ consumers registered; three PVCs `Bound` |
| 3 | Paths through the ingress (`paths.sh`) | `/login` 200, `/` 200, `/verify/NOPE` 200 (frontend), `/socket.io/?EIO=4&transport=polling` 200 with `upgrades:["websocket"]`, `/oidc/.well-known/openid-configuration` 200, `/uploads/public/x` 404 from the backend, `/uploads/private/x` the frontend 404, `http://` → 308 to https. **Defects:** `/health` → the frontend's 404 page; the OIDC issuer was `http://localhost:5000` |
| 4 | ConfigMap-only upgrade (revision 2, `backend.cron.calibration`) | ConfigMap changed; **same pod**, `CALIBRATION_SCHEDULER` absent from `/proc/1/environ`; `checksum/config: ""` → **defect** |
| 5 | After the fixes: revision 3 with `ALLOW_SEEDING=true` | backend **rolled to a new pod**; environment carried `ALLOW_SEEDING=true`, `OIDC_ISSUER`/`FRONTEND_URL`/`PUBLIC_BASE_URL=https://callibrator.kind.test`; NOTES printed the seeding warning. `GET https://callibrator.kind.test/api/v1/migration/seeding` → **200: 11 roles, 7 menu groups, 162 permissions, 1 user**. `/health` → 200 `{"status":"ok"}`; issuer `https://callibrator.kind.test` |
| 6 | Revision 4: `ALLOW_SEEDING=""` (and `FORCE_HTTPS=false`, see below) | `/migration/seeding` → **401**. `POST /api/v1/auth/login` through the ingress → **200**, cookies `auth_token`, `auth_refresh`, `auth_session`, `auth_logged_in` |
| 7 | NetworkPolicy matrix from pods (`np.sh`), with a scratch listener pod `np-probe` (:80, :8080) | **16 of 16 as intended.** Blocked: probe → backend:3000, probe → frontend:3000, frontend → postgres/redis, frontend → any other pod, backend → :8080 (not an egress port), backend → frontend:3000. Allowed: ingress → backend `/health`, frontend → backend:3000, frontend → DNS, backend → postgres/redis/rabbitmq/clamd, backend → :80. Controls: the same tool connects where allowed (`frontend nc → backend:3000 OPEN`), and blocked flows **time out** (4–5 s, dropped, not refused) — kindnet enforces |
| 8 | PVCs | `/app/uploads`, `/app/storage`, `/app/backup` are each a bind of their OWN PV (`/proc/self/mountinfo` → `…pvc-be6d7d66…_callibrator-storage`, `…pvc-be93d19c…_callibrator-objects`, `…pvc-3b2a8e83…_callibrator-backup`); `/app/log` and `/app/.well-known` are emptyDirs; the process is uid/gid 997. A marker written to each of the three **survived `kubectl delete pod`** (new pod, same contents) |
| 9 | Readiness 503 keeps the pod out of rotation without restarting it | Redis scaled to 0: within 15 s the pod went `ready=false`, its EndpointSlice endpoint `ready=false`, the ingress answered **503** for `/health` and `/socket.io`; after 75 s **restarts=0**; Redis back → ready again in 50 s, `/health` 200 |
| 10 | PDB (frontend, 2 replicas, minAvailable 1), via the Eviction API | eviction 1 → **201**; eviction 2 immediately → **429 "Cannot evict pod as it would violate the pod's disruption budget"**; once the replacement was Ready (`ALLOWED DISRUPTIONS` 0 → 1) eviction 2 → 201 |
| 11 | Two replicas on an EMPTY database (release `p2`, namespace `callib2`, database `callib2`, `replicaCount: 2`, `cron.enabled: false`) | first boots killed by the startup probe (30 × 10 s) on a starved node → **defect 6**. Next boots: container `00260e8f` logged **`Applied 63 migration(s)`**; container `fc95bb93` logged **`[migration-lock] another instance is migrating the schema; waiting`** (02:44:00) then **`lock acquired after waiting; pending migrations are re-read now`** (02:45:47), applied nothing, schema-verify OK. `schema_migrations`: **63 rows, 63 distinct**. Release uninstalled afterwards |
| 12 | Socket.IO fan-out, revision 5 (`backend.replicaCount=2`, `cron.enabled=false`, `frontend.replicaCount=1`; backend PDB rendered, frontend PDB removed) — `fanout.cjs` | client A port-forwarded to replica A, client B to replica B, client C **through the ingress** (real Host/SNI, `transports: ["websocket"]` only, `Origin: https://callibrator.kind.test`); all three `transport=websocket`. `POST /api/v1/notifications/test` via replica A and via replica B → 201, 201. **A, B and C each received both** — B got A's, A got B's, C got both over a WebSocket through nginx. (The super admin had to enrol TOTP first: `MFA_ENROLMENT_REQUIRED`; done through `/auth/mfa/setup` + `/mfa/verify`, then `/auth/mfa/login`.) |
| 13 | `helm rollback callibrator 4` (from revision 5) | **revision 6 "Rollback to 4", deployed.** Backend 2 → 1 replica, frontend 1 → 2; the backend PDB removed and the frontend PDB re-created; the ConfigMap back to the scheduler instance (`BACKUP_SCHEDULER` `0 3 * * 0`, `SESSION_CLEANUP_SCHEDULER` `0 2 * * *`, no `SCHEDULERS_ENABLED`); the three PVC markers from step 8 still present |
| 15 | Guards on the cluster path: `helm upgrade` against the live release with a refused value | `backend.replicaCount=2` → "backend.cron.enabled is true with backend.replicaCount > 1"; `secrets.kmsMasterKey=` → "secrets.kmsMasterKey is required …"; `backend.clamav.host=` → "… VIRUS_SCAN_PROVIDER is clamav but backend.clamav.host is empty". Each `UPGRADE FAILED` at render, exit 1; **the release stayed at revision 6** (no failed revision recorded) |
| 16 | `kubectl apply --dry-run=server` of the **fixed** chart (dev values) | **14 objects accepted** |
| 14 | `helm lint` + `helm template` + kubeconform 0.7.0 `-strict -kubernetes-version 1.33.0` (the CI step, run locally; kubeconform's Windows zip verified against the release CHECKSUMS, whose Linux line matches the hash pinned in `ci.yml`) | default values under `callibrator` and `prod` → **14 valid**; `values-staging.yaml` → **11 valid**; `values-prod.yaml` → **12 valid**; all **seven guards refuse** as CI asserts |

## Chart defects found and fixed (ADR-106)

| # | Defect | Fix | Re-proven by |
|---|---|---|---|
| 1 | `checksum/config` always `""` | default = sha256 of the backend subchart's values | step 5 (the pod rolled; new env) |
| 2 | `ALLOW_SEEDING` could not be set | `backend.env.ALLOW_SEEDING`, NOTES warning | steps 5–6 |
| 3 | `FRONTEND_URL`, `OIDC_ISSUER`, `PUBLIC_BASE_URL` unset → development fallbacks | derived from `ingress.host` | step 5 (issuer) |
| 4 | `/health` not on the ingress | `/health` `Exact` → backend | steps 5, 9 |
| 5 | 1 s probe timeouts; no frontend startup probe | `probes.timeoutSeconds` (5), frontend `startupProbe` | revisions 3–5 rolled out |
| 6 | backend startup budget 300 s < lock timeout 600 s | `probes.startup.failureThreshold` default 72 | rendered; revision 5 rolled out with it |
| 7 | NOTES/values/NetworkPolicy/Chart.yaml said "renders only" and "migration race unsolved" | restated to what is proven; chart **0.2.0**, `validation-status: kind-validated` | — |

Files: `deploy/helm/callibrator/{Chart.yaml,values.yaml,templates/configmap.yaml,templates/ingress.yaml,templates/NOTES.txt,templates/networkpolicy.yaml}`, `charts/backend/{values.yaml,templates/deployment.yaml}`, `charts/frontend/{values.yaml,templates/deployment.yaml}`. (`values-prod.yaml`, `values-staging.yaml` and `charts/backend/Chart.yaml` also show changes in the tree — another agent's, not this record's.)

## Found, not fixed here

- **Sign-in fails with the shipped `FORCE_HTTPS: "true"`** (BACKLOG A-310). `frontend/src/app/api/v1/auth/login/route.ts` (and `refresh`, `sso-session`) fetch `BACKEND_INTERNAL_URL` without `X-Forwarded-Proto`; the backend 301s to `https://callibrator-backend:3000/...`; Next's fetch fails with an OpenSSL `wrong version number` and the browser gets `500 Backend connection error`. Reproduced from a frontend pod with `wget` (301 without the header). The compose prod overlay has the same shape. Revision 4 onwards used `FORCE_HTTPS: "false"` **in scratch values only**; the chart default is unchanged.
- **Two releases on one Redis share the Socket.IO adapter channel** (noticed while running `p2` beside the main release; not tested).

## Rollback and cluster-path guards

Both ran (steps 13, 15), but late. For about 75 minutes the Docker Desktop VM sat at load 100+ (other agents' PostgreSQL containers reached 556% CPU), and the kind API server stopped answering TLS handshakes. A 30-attempt retry loop then reported "not ready" on every attempt. **That loop was itself broken.** Its readiness check was `kubectl get --raw /readyz` under Git Bash, and MSYS rewrote `/readyz` into a Windows path, so the check returned `NotFound` whatever the cluster's state. With `MSYS_NO_PATHCONV=1` it answered `ok`, load had fallen to 1.1, and the rollback ran at once. The first `helm rollback` attempts (before the loop) had failed on genuine `TLS handshake timeout`s.

## Teardown

`kind delete cluster --name p706` could not kill the node container ("did not receive an exit event"). `docker rm -f p706-control-plane` removed it. Also removed:

- its data volume `173ec999…`;
- the images `callibrator/backend:p706`, `callibrator/frontend:p706` and `kindest/node:v1.37.0`;
- the `kind` network, which had no containers left.

The scratch copies of the generated secrets, the TLS key and the TOTP secret were deleted. Nothing outside the session scratchpad was left behind.

## What is still not proven

- A production cluster: a managed CNI, a real StorageClass (RWX), more than one node, cert-manager, an external secrets operator, image pulls from a registry (`pullPolicy: Never` here).
- `values-prod.yaml` / `values-staging.yaml` against a cluster (they render and validate).
- An image of the current working tree, including ADR-099's one-time bootstrap password (`/app/.bootstrap`, not a volume) under Helm.
- Browser sign-in through the ingress with `FORCE_HTTPS: "true"` — blocked by A-310.
- Frontend probe behaviour on a quiet node. On this contended VM the frontend was still killed by its probes now and then, even with the new budgets.
- Two backend replicas sharing the RWO local-path volumes worked only because both ran on the one node.
