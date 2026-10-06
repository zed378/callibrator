# 2026-10-05 — Closing verification before the commit of everything since `dded70c`: gates, live pair S/T, upgrade boot, db-backup

**Asked by:** the coordinator, as the last check before committing the work since `dded70c`: U-05 (ADR-116), U-09, P8-01 (ADR-086 Am. 1), W-10, U-06 (ADR-119, migration 0109), U-06b (ADR-120, migration 0110), the CI second run (ADR-117), the logo recolour (ADR-118 Am. 2) and P10-17 (ADR-118, Am. 1, Am. 3).
**Standard:** ADR-077 (named runs; one uninterrupted run, twice), as the Q/R record ([2026-10-02-closing-gates-qr](./2026-10-02-closing-gates-qr.md)).
**Tree:** the working tree on `dded70c` (HEAD = `origin/main`). **Quiet for code**: one other agent wrote only planning documents during the session (`MEMORY/specs/P11-00-dashboard-palette-theme.md`, `TASKS/PHASE-11-DASHBOARD-REVAMP.md`), which no gate reads.

**Result:**
- Every gate is green. **No source was changed; no gate needed a fix.**
- **Live pair S and T green**, back to back on one fresh production-mode stack built from a snapshot of the final tree (§ 3).
- Migrations **0109 and 0110 apply on a fresh boot and on an upgrade boot** from a database written by `dded70c`'s own image; the reboot after each is clean (§ 4).
- **`db-backup` (ADR-116)**: the e2e overlay disables it as designed; enabled once on the pair stack it passed its first verification, restore 5 s (§ 5).
- **One contract finding:** `oasdiff` against `origin/main` reports **3 breaking changes, all `POST /api/v1/sop`** (W-10's new validation). A direct push to `main` passes the CI check (it compares the commit with itself); a pull request would fail it (§ 2).

## 1. Gates (2026-10-05, Node 26.10.0)

| Gate | Command | Result |
|---|---|---|
| Backend typecheck | `cd backend && npm run typecheck` | exit 0, 0 errors |
| TS ratchet | `npm run ratchet` | "695 .js file(s), at the floor" |
| Backend lint gate | `node scripts/ci/eslint-ratchet.js` (repo root) | "0 error(s), 0 warning(s); baseline 0" |
| Backend lint (turbo's script) | `npm run lint` | exit 0 |
| `build:dist` | `npm run build:dist` | 612 TypeScript files compiled, 7 JavaScript files copied; contracts 53 compiled |
| Load check, dist | `TSX_DISABLE_CACHE=1 npm run load:check` | OK: 602 modules; boot order 105 |
| Load check, src | `TSX_DISABLE_CACHE=1 npm run load:check -- --src` | OK: 602 modules; boot order 105 |
| OpenAPI current | `npm run openapi:check` | "backend/openapi.json is current" |
| Spectral | `npm run openapi:lint` | no new error; 0 baselined; 15 warnings |
| **oasdiff** | `tufin/oasdiff:v1.32.1` (the CI version, pulled for this check and removed) `breaking <origin/main openapi.json> <working tree> --fail-on ERR` | **exit 1: 3 errors**, all `POST /api/v1/sop` (§ 2) |
| **Backend coverage** | `npm run test:coverage -- --ci` (19:51:53–19:58:08 +07:00) | **100 / 100 / 100 / 100**; **890 suites passed, 37 skipped, 0 failed**; **15,054 tests passed, 247 skipped**; 371 s; exit 0. No suite failed, so none was re-run |
| `packages/contracts` | `npm run lint`, `npm run typecheck`, `npm test` | lint 0, typecheck 0; **48 suites, 1,097 tests, 100 %** on all four measures |
| Browser specs (TypeScript) | `node node_modules/@typescript/native/bin/tsc -p automate/tsconfig.json` | exit 0 |
| Frontend typecheck | `cd frontend && npm run typecheck` | exit 0 |
| Frontend lint | `npm run lint` | **0 errors**, 55 warnings |
| Frontend types from the contract | `npm run api:types:check` | exit 0 |
| **Frontend coverage** | `npx jest --coverage --ci` | **297/297 suites, 3,144 tests**; **93.94 / 84.77 / 89.63 / 94.6** (gate 90 / 81 / 86 / 91) |
| `next build` | `npx next build` | exit 0; 84 static pages |
| Bundle budget | `node scripts/bundle-budget.mjs` | all 10 public routes within. Tightest: `/` gzip 148.7 / 150 KB (brotli 127.9 / 180), `/login` brotli 153.9 / 155, `/request-access` brotli 147.5 / 148, `/verify/[n]` brotli 118.4 / 120 |
| npm audit, production | `npm audit --omit=dev --audit-level=high` | "found 0 vulnerabilities" |
| npm audit, whole tree | `node scripts/ci/npm-audit-gate.js` | "1 high/critical advisory(ies), 0 failing, production tree 0" — GHSA-vfj7-8cjw-p6xm (`braces`, dev only) allowed until 2026-11-05 |
| gitleaks 8.30.1 (`zricethezav/gitleaks:v8.30.1`, pre-existing image) | `gitleaks git` on the repository | 54 commits, **no leaks** |
| | `gitleaks dir` on the **340 modified and untracked files**, copied as-is into a scratch directory with `.gitleaks.toml` and `.gitleaksignore` | **no leaks** |
| actionlint 1.7.12 (with shellcheck) | `actionlint` on `.github/workflows/` | exit 0, no findings |
| Compose | `docker compose config -q` as CI does (`.env` from `.env.example` + `IMAGE_TAG`, `CORS_ORIGIN`, `PUBLIC_URL`, in a scratch copy of `deploy/compose`) | base, dev, staging, prod, vm: all OK; base services `backend clamav db-backup frontend nginx postgres rabbitmq redis volume-init`; dev publishes nothing but nginx beyond loopback |
| | e2e overlay with `scripts/ci/e2e-env.sh` | OK; services exactly `backend frontend mailpit postgres rabbitmq redis volume-init` (no `db-backup`, clamav or nginx) |
| Helm 3 (`C:\Tools\Helm`) | `helm lint` dev / staging / prod values | 0 failed, each |
| | `helm template` + kubeconform v0.7.0 `-strict`, Kubernetes 1.33.0 (`ghcr.io/yannh/kubeconform:v0.7.0`, pulled and removed) | dev 14/14 valid; dev with `backupVerify.enabled=true` **17/17** (CronJob, PVC, NetworkPolicy); staging 11/11; prod 12/12 |
| | the seven refusals of CI's "helm guards" step | all 7 refused |

`git status` was the same before and after the gates, apart from the other agent's two planning documents: the gate runs left no file behind. `backend/exports/` held 67 files before the coverage run and 67 after.

## 2. oasdiff: 3 breaking changes against `main`

```
error [request-property-became-not-nullable] POST /api/v1/sop — `requiresTraining` became not nullable
error [request-property-max-length-set]      POST /api/v1/sop — `title` maxLength 255
error [request-property-min-length-set]      POST /api/v1/sop — `title` minLength 1
```

- They are W-10's fix ([record](./2026-10-05-w10-bodyless-requests.md)): `POST /sop` had no body validation, and a missing `title` was a 500 (NOT NULL). The contract now states what the route accepts. I did not check, request by request, whether an empty `title`, a `title` over 255 characters or a `null` `requiresTraining` used to succeed.
- The W-10 record does not mention the contract break.
- **CI:** on a **direct push to `main`**, the `api-contract` job compares the pushed commit with itself and passes. On a **pull request** it fails. The script's instruction is "record the break (ADR + deprecation note) before merging". This is the coordinator's call; I did not write the ADR.
- The Q/R record's 857-error break is gone: that contract is on `main` now (`1100658`).

## 3. The live pair

### 3.1 Stack and procedure

- **Snapshot:** every tracked and untracked, non-ignored file of the final tree (`git ls-files -co --exclude-standard`, minus the deleted `hero.webp`): 3,294 files, at **20:04:39 +07:00**. `diff -rq` of `backend/src` and `frontend/src` against the live tree: identical (except an empty, ignored `frontend/src/data`).
- **Images**, built from the snapshot: `st1005/backend:e2e`, `st1005/frontend:e2e` (20:06–20:11), `st1005/backup-verify:e2e` (§ 5).
- **Stack:** project **`st1005`**, `deploy/compose/docker-compose.yml` + `docker-compose.e2e.yml` from the snapshot, **production mode**, ports 27170–27172. Env from `scripts/ci/e2e-env.sh` with `PRIVACY_NOTICE_URL=https://example.com/privacy-notice`. Fresh named volumes, `up --wait`, then `GET /api/v1/migration/seeding` (200).
- **Bootstrap password:** read with `docker exec … cat /app/.bootstrap/superadmin-password` (24 characters); it occurs **0 times** in `docker logs`.
- **Each run:** `npm run test:e2e` (from the live tree's `backend/`), then `automate/smoke.browser.js`, `a11y.browser.js`, `responsive.browser.js` and `p10.browser.mts`.
- **Between S and T:** about 60 minutes idle, so the P10 per-address budget keys expire, without flushing Redis (as Q/R). The db-backup check (§ 5) ran in that window; it did not recreate the backend or the database.
- **Monitor:** an in-network curl probe on `st1005_default` (`backend /live` and `frontend /login`, every second). The Q/R record's other monitors (host probe, VM and cgroup samplers, typeperf) were not run this time.

### 3.2 Results

| Run | Window (+07:00) | E2E (57 files) | smoke | a11y | responsive | P10 browser |
|---|---|---|---|---|---|---|
| **S** | 20:19:12–20:36:17 | 56 passed, 1 skipped; **433 passed**, 5 skipped, **0 failed** (32.4 s) | **7/7** | **80/80** (780 s) | **45/45** | **12/12** |
| **T** | 21:37:00–21:54:04 | 56 passed, 1 skipped; **433 passed**, 5 skipped, **0 failed** (28.3 s) | **7/7** | **80/80** (772 s) | **45/45** | **12/12** |

- 433 is Q/R's count: no live spec was added or removed since.
- P10's `sso` check is skipped by name, as in every earlier run (it needs a non-production backend). It is counted in the 12.
- During run S's a11y suite I built the small `backup-verify` image (COPY layers, about a minute). a11y passed 80/80 regardless; it is noted because Q/R ran with nothing else on the host.

**Access log** (`/app/log/access/access.log`, the whole stack life):

| | Lines | 5xx | 429 |
|---|---|---|---|
| after S | 1,532 | **0** | 3: 1 × `POST /access-requests`, 2 × `GET /certificates/verify/…` |
| after T | 3,060 | **0** | **6**: 2 × `POST /access-requests`, 4 × `GET /certificates/verify/…` |

Every 429 is one the P10 specs assert (the intake budget and the minimal verification verdict). Lines with status `-` are browser requests aborted by navigation (28 after S, 64 after T). node-cron "missed execution" in the backend log: **0**. Backend `RestartCount` 0 throughout.

**In-network probe** (13:19–14:54 UTC, through S, the idle window and T): 5,450 probes of each target, **0 non-200**, maximum backend `/live` 0.30 s and frontend `/login` 0.19 s, **0 probes over 1 s**. No stall.

## 4. Migrations 0109 and 0110

### 4.1 Fresh boot (the pair stack)

- The log shows `migrated 0108-…`, `migrated 0109-calibration-records-live-index.js (0.015s)`, `migrated 0110-search-tenant-gin.js (0.047s)`, then "Applied 82 migration(s)", then `[schema-verify] OK: 74 tables, 927 columns and 13 control objects match the models`.
- `pg_index`: `calibration_records_tenant_live_date`, `calibration_devices_tenant_id_search_vector`, `stocks_tenant_id_search_vector` and `certificates_tenant_id_search_vector`, all `indisvalid = t`.
- **Reboot after migration** (`docker restart`, before run S): healthy, `RestartCount` 0, no migration applied, `[schema-verify] OK` again. The 0109 `INCLUDE` crash class (Sequelize `showIndex` on every boot's `db.sync()`) does not recur.

### 4.2 Upgrade boot from `dded70c`

- **Old image:** `git archive dded70c` into the scratchpad, `docker build -f backend/Dockerfile -t st1005/backend:old` (20:11–20:15).
- **Stack `st1005up`** (ports 27175–27177), first with **`dded70c`'s own compose files** and the old image: fresh volumes, "Applied 80 migration(s)" ending in 0108, `[schema-verify] OK: 74 tables, 927 columns…`, seeded (200). Old indexes present: `idx_calibration_devices_search`, `idx_stocks_search`, `idx_certificates_search`.
- **Data added** with psql so the concurrent index builds ran on non-empty tables: 200 `calibration_devices` and 200 `calibration_records` in the default tenant.
- **Then the new compose files and `st1005/backend:e2e`** on the same volumes (`up --no-build`):
  - "[migrate] migrated 0109-calibration-records-live-index.js (0.013s)", "migrated 0110-search-tenant-gin.js (0.039s)", "Applied 2 migration(s)", `[schema-verify] OK: 74 tables, 927 columns and 13 control objects`;
  - healthy, `RestartCount` 0;
  - `pg_extension`: `btree_gin` owned by `callibrator`;
  - the four new indexes valid with the definitions the migrations state (`USING gin (tenant_id, search_vector)`; the 0109 partial btree on `(tenant_id, calibration_date DESC, is_compliant, superseded_by_id) WHERE is_deleted = false AND deleted_at IS NULL`, key columns, no `INCLUDE`);
  - 0003's three `idx_*_search` indexes **dropped**;
  - `schema_migrations` ends 0108, 0109, 0110.
- **Reboot after the upgrade:** healthy in 8 s, `RestartCount` 0, no migration, `[schema-verify] OK`.

### 4.3 The role that creates `btree_gin`

- **The compose roles:** migrations run as `DB_USER` = `callibrator`, which the pgvector image creates as `POSTGRES_USER`, so it is a **superuser** (`rolsuper = t`). `callibrator_app` (the request role) is not, and needs nothing for 0110.
- **Without superuser**, checked on the same PostgreSQL 18.6: `pg_available_extension_versions` shows `btree_gin` `trusted = t`. A `NOSUPERUSER` role that owns a database ran `CREATE EXTENSION IF NOT EXISTS btree_gin` successfully, and the extension was owned by that role. The same role on a database it does not own was refused with PostgreSQL's "Must have CREATE privilege on current database". This matches 0110's header and the U-06b record. The scratch role and database were dropped.

## 5. `db-backup` (ADR-116)

- **As designed in the e2e overlay:** `profiles: [off]`, and the backend's `RESTORE_VERIFY_STATUS_FILE` is empty. The pair stack's service list has no `db-backup`.
- **Run once on the pair stack** after run S, with a scratch overlay (the U-05 record's, reduced): `profiles: !reset []`, `build: !reset null`, a named `pgdump` volume chowned by `volume-init`, `BACKUP_RUN_ON_START=1`, alerts to Mailpit. The image `st1005/backup-verify:e2e` was built from the snapshot's `deploy/backup/Dockerfile` with `--build-context backend-image=docker-image://st1005/backend:e2e`. `up -d db-backup` recreated only `volume-init` and started `db-backup`; the backend and database containers were untouched.
- **Outcome (13:36:43–13:36:49 UTC): PASS.** Dump 402,587 bytes; `sha256` ok; `toc` 893 entries; scratch PostgreSQL 18.6; `pg_restore --exit-on-error` exit 0 in 3 s; vector 0.8.6; facts exact (`tenants` 12, `users` 15, `calibration_devices` 10, `calibration_records` 6, `certificates` 4, `audit_logs` 261, `tenant_keys` 1, `schema_migrations` 82); `schema` "OK: 73 tables, 926 columns and 13 control objects". **`restoreSeconds` 5, `totalSeconds` 6.** `backup-alert` reported the outcome file; next run scheduled for 02:30 Asia/Jakarta.
- The verifier's schema check reports 73 tables and 926 columns where the boot reports 74 and 927. The U-05 record shows the same pair (73/926 in the verifier, 74/927 at boot), so this is not new in this tree. I did not trace which table differs.
- **Secrets:** `DB_PASS`, `KMS_MASTER_KEY`, `JWT_ACCESS_SECRET`, `MAIL_PASSWORD` and `CERT_SIGNING_SECRET` each appear 0 times in the db-backup log and in the outcome file.
- The container was stopped and removed after the check, so it took no part in run T.
- **Not run here:** the failure paths (truncated, corrupt, tampered, missed). U-05 proved those live; nothing in their code changed since.

## 6. Docker

- **Removed by name:** projects `st1005` and `st1005up` with `down -v --remove-orphans`; images `st1005/backend:e2e`, `st1005/frontend:e2e`, `st1005/backup-verify:e2e`, `st1005/backend:old`; the monitor container `st1005-netprobe` (`--rm`, on the pre-existing `curlimages/curl:latest`).
- **Pulled for one check and removed by name:** `ghcr.io/yannh/kubeconform:v0.7.0` and `tufin/oasdiff:v1.32.1`. gitleaks and actionlint ran on images already present.
- Nothing was pruned, and no other project was touched. Afterwards: 0 containers, volumes, networks or images match `st1005`.

## 7. The working tree, checked for accidents

There are 320 changed paths at the end: 164 modified, 1 deleted, 155 untracked (`git status --porcelain`, untracked directories collapsed). They include this verification's own edits and the other agent's two planning documents.

| Check | Result |
|---|---|
| A `.js` beside a `.ts` of the same name under `backend/src` | **none** |
| Modified files whose diff is only whitespace or CRLF | **none** (every modified file differs with `--ignore-all-space --ignore-cr-at-eol --ignore-blank-lines`) |
| Secrets | gitleaks: none (§ 1) |
| Names that look like scratch (`zz*`, `probe`, `.bak`, `.orig`, `.log`, `.env`, keys) | none |
| Large binaries | the 84 `docs/UI-UX/research/screens/p1017-*.webp`: 78 P10-17 screenshots plus 6 `p1017-logo-*` before/after captures from the logo record; the largest is 6.1 MB (`p1017-id-1536-reduced-full.webp`), about 70 MB together. The 6 photos under `frontend/public/marketing/people/` |
| **`backend/exports/`** (untracked) | **looks accidental.** 34 `.zip` (ignored by `*.zip`) and **16 untracked `.json`** GDPR export manifests with test-fixture ids (`tenantId` `aaaaaaaa-…`, `userId` `cccccccc-…`), written 2026-10-05 13:49 and 2026-10-01. A test or a local backend ran the export service against the working directory. This verification's coverage run wrote none. **Do not commit;** consider `backend/exports/` in `.gitignore` |
| **`.claude/commands/redesign-landing.md`** (untracked) | the owner's `/redesign-landing` command (P10-17's brief). Local tooling; commit only if intended |
| `package-lock.json` | only the removal of `cls-hooked` and its four transitive packages (U-06, ADR-119) |
| `frontend/public/marketing/product/hero.webp` deleted | intended (P10-17: the hero is a photograph now) |
| Other agent's files | `MEMORY/specs/P11-00-dashboard-palette-theme.md` (new) and `TASKS/PHASE-11-DASHBOARD-REVAMP.md` (tracked, modified) changed during this session. They are not part of the work being verified |

## 8. Files changed by this verification

- `MEMORY/records/2026-10-05-closing-gates-st.md` (this record)
- `MEMORY/CHANGELOG.md`, `MEMORY/MEMORY-INDEX.md`
- `CLAUDE.md` § What Is Currently Failing (coverage, lint, typecheck/build/load, live E2E and CI rows)
- `README.md` § Current State, Stated Honestly (coverage, typecheck/lint/build/load, live E2E and CI rows)

## Open

1. **The `POST /sop` contract break** (§ 2): an ADR and deprecation note before any PR, or land on `main` directly. Coordinator.
2. **`backend/exports/`**: keep out of the commit; find the test that writes there (manifests carry fixture ids) or add the path to `.gitignore`.
3. **README § Scale** still counts 79 migrations and 950 test files (2026-10-02). The tree has 82 migrations applied and more tests (890 + 37 suites ran). Not changed here; re-count with the method `CLAUDE.md` states.
4. The db-backup verifier's 73/926 vs the boot's 74/927 (§ 5): consistent with U-05, not explained.
