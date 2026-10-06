# 2026-10-05 — U-05: every infrastructure dump is restored and checked, nightly

**Decision record:** [ADR-116](../DECISIONS.md). **Backlog:** U-05 (and U-04, M-12) in `TASKS/BACKLOG.md`.

## 1. Inventory: what existed before this change

| Mechanism | Evidence | Scheduled? | Stored | Verified? | Alerted? |
|---|---|---|---|---|---|
| Tenant backup (layer 1) | `services/tenantBackup.service.ts`, `services/scheduledBackup.service.ts`, migrations `0087`, `0108` | yes, `BACKUP_SCHEDULER` (compose/Helm `0 3 * * 0`) | `./volumes/backup/tenant-backups` | no. It holds the tenant row and its users only (P7-04, measured) | yes, P7-02 (`job.scheduled-backup.*`) |
| Infrastructure dump (layer 2) | `Makefile` target `backup` (`docker compose exec postgres pg_dump -Fc` → `./backups`) | **no**. By hand; `docs/DEVOPS/04` said "a scheduler for it is the operator's" | the host's `./backups` | **no** | **no** (`docs/DEVOPS/07`: "must alert on its own exit code; nothing does") |
| Restore | `docs/DEVOPS/04` § Restore Order; one drill (P7-04, ADR-078, RTO 234 s) | no | — | once, by hand | — |
| WAL archiving / PITR | none in compose or Helm (`grep archive_mode`: docs only) | — | — | — | — |
| Helm | the database is external; the chart backs nothing up | — | — | — | — |

## 2. What was built

- `deploy/backup/backup-verify.sh` (shellcheck 0.11 clean): `run-once | schedule | dump | verify [FILE]`. The dump runs `pg_dump -Fc --snapshot=` inside one REPEATABLE READ transaction. That transaction also writes `<dump>.manifest.json`: counts of `BACKUP_VERIFY_TABLES`, the `audit_logs` checksum, migrations, pgvector version and SHA-256. The verify step starts a throwaway PG 18 (initdb, loopback, deleted afterwards). Its checks: `sha256`, `toc`, `scratch`, `restore` (role first, `--no-owner --exit-on-error`), `pgvector`, `facts` (exact), and `schema` (`./backend verify-schema`). Each run writes an outcome JSON, then runs `./backend backup-alert`.
- `deploy/backup/Dockerfile`: the compose database's digest-pinned `pgvector/pgvector:pg18`, plus `/app/backend` from the named build context `backend-image`.
- Compose: the `db-backup` service in `docker-compose.yml`, with `additional_contexts: backend-image: service:backend`. Changes in the same file:
  - `volume-init` chowns `./volumes/pgdump` to 999;
  - the backend mounts that directory read-only;
  - the backend has `RESTORE_VERIFY_STATUS_FILE`.

  The prod overlay pins the promoted image and drops the build. The e2e overlay turns the service off and empties the variable. `deploy/compose/.env.example` documents the knobs.
- Helm: `templates/backup-verify-cronjob.yaml` holds the CronJob, the `<base>-pgdump` PVC (`keep`) and an egress-only NetworkPolicy. It is configured by `values.yaml` `backupVerify` (default `enabled: false`). Chart 0.2.0 → 0.3.0.
- Backend (TypeScript):
  - `services/backupVerify.service.ts`: `parseOutcome`, `failureAlert`, `reportOutcome`, and `checkRestoreVerification`, which handles missed, failed-once-per-run and unreadable outcomes, throttled by `JOB_ALERT_REPEAT_HOURS`;
  - `scripts/backupAlert.ts`;
  - `scripts/verifySchema.ts` now exports `main`; run directly, it behaves exactly as before;
  - `scripts/cliDispatch.ts` adds `verify-schema` and `backup-alert`;
  - `jobMonitor.service.ts#watchdogTick` runs the check, inside its own try/catch.
- Docs:
  - `docs/DEVOPS/04-DATABASE-BACKUP.md`: Layer 2, § Scheduled Restore Verification, § Off-Host Copy, gaps, alerting, volumes;
  - `docs/DEVOPS/07-ALERTING.md`: alert keys, honest limits;
  - `deploy/README.md`: § Backups runbook, volumes, after-deploy checklist.

## 3. Tests and gates (named)

- `backend/src/tests/services/backupVerify.u05.test.ts`: **17 passed**, with `backupVerify.service.ts` at **100/100/100/100**.
  - **Fail-before:** with the service file removed, the suite fails to load ("Cannot find module …backupVerify.service").
  - It covers parsing, the alert content, `reportOutcome` (pass, fail and unreadable), the watchdog (not configured, missed with throttle and repeat, stale vs fresh, invalid max age, failed once per run, unreadable throttled), `watchdogTick` running the check and surviving a throw, and the dispatcher knowing both commands with `backup-alert` exit codes 0/1/2.
- `npx eslint` on the six changed or new backend files: clean.
- `npm run typecheck`: 0 errors.
- `npm run ratchet`: 695 `.js`, at the floor.
- `npm run load:check -- --src`: OK, 596 modules.
- Full `npm run test:coverage -- --ci`: see § 6.
- `helm lint` (with `backupVerify.enabled=true`): 0 failed. `helm template` rendered for dev on and off and for staging and prod with the CronJob. **kubeconform v0.7.0 `-strict` against Kubernetes 1.33.0: 60 resources, 60 valid.** With the default (off), 0 objects render.
- `docker compose config -q`: OK for the base file and for each of the dev, staging, vm, prod and e2e overlays (`.env` from `.env.example`, as CI does). The e2e service list has no `db-backup`.

## 4. Live proof: disposable compose stack `callib-u05`

The stack used the base file, the e2e overlay and a scratch overlay that re-enabled `db-backup` on named volumes. It ran on loopback ports 27530–27532 with mail to Mailpit and `ALERT_EMAIL_TO=ops@u05.test`. Both images were built from the working tree: `callib-u05/backend:test`, then `callib-u05/backup-verify:test` via `--build-context backend-image=docker-image://…`. The backend ran with `NODE_ENV=development` so demo seeding was allowed. Data came from `/migration/seeding` + `/migration/seed-demo`: 4 tenants, 11 users, 2 devices, 2 records, 3 certificates, 80 migrations.

| Time (UTC) | What | Result |
|---|---|---|
| 05:58:41 | first run, **with a real bug** (`-X` passed to pg_dump) | `dump FAILED`. `backup.dump.failed` was logged by the verifier and **emailed** (Mailpit 05:58:48). At 06:00:00 the backend watchdog raised the same alert from the outcome file |
| 05:59:43 | fixed, image rebuilt, run again | **PASS.** The dump was 369,261 bytes with 890 TOC entries; scratch PostgreSQL 18.6; `pg_restore --exit-on-error` 12 s; vector 0.8.6; the facts matched exactly; `[schema-verify] OK: 73 tables, 926 columns and 13 control objects`. **`restoreSeconds` 18, `totalSeconds` 19, `dumpAgeSeconds` 18** |
| 06:00:42 | copy truncated to 200,000 bytes (scratch, `/tmp`) | `sha256 FAILED`, exit 1, alert logged and emailed |
| 06:00:49 | truncated copy, manifest re-stamped with its checksum | `toc FAILED` ("could not read from input file: end of file"), exit 1, alert logged and emailed |
| 06:01:28 | intact dump, manifest tenants 4→5 and audit_logs 1→2 | `facts FAILED — count:audit_logs source=2 restored=1; count:tenants source=5 restored=4`, exit 1, alert logged and emailed. The backend watchdog re-raised it at 06:05:00 (once) |
| 06:09:27 | re-verify the real dump | PASS, `restoreSeconds` **15** |
| 06:11:00 | backend recreated with `RESTORE_VERIFY_MAX_AGE_HOURS=0.02`, watchdog every minute | **`ALERT [critical] Backup restore verification DID NOT RUN`**, last run 06:09:27 |

**A tampering attempt that tested nothing, caught by looking.** The first "facts" probe edited `"tenants":4`, but the manifest is written `"tenants" : 4`, so the edit changed nothing and the run passed. The probe was redone with the real spacing, and that run failed as above. Without this check the record would have claimed that the facts compare was tested.

**Secrets:** each of `DB_PASS`, `KMS_MASTER_KEY`, `JWT_ACCESS_SECRET`, `MAIL_PASSWORD` and `CERT_SIGNING_SECRET` appeared 0 times in the db-backup logs and 0 times in the outcome files and history. The db-backup container's environment holds no `KMS_MASTER_KEY`, `JWT_*` or `CERT_SIGNING*`. The backend can read `last-restore-verify.json` but not the dumps ("Permission denied", 0600 uid 999).

**Teardown:** `docker compose -p callib-u05 … down -v` removed the containers, volumes and network. The images `callib-u05/backend:test` and `callib-u05/backup-verify:test`, and the pulled `koalaman/shellcheck:stable` and `ghcr.io/yannh/kubeconform:v0.7.0`, were removed by name. No prune was run.

## 5. RTO, measured again (U-04)

The database part is now measured **on every run**: **18 s** (first verification) and **15 s** (re-verification), counted from scratch initdb through restore and every check. This is not the 234 s drill figure, which ran from restore start to `/health` 200 and included the missing-role failure. Neither figure includes provisioning, the object store or escrow retrieval.

## 6. Full coverage gate

`npm run test:coverage -- --ci` (Node 26) on the working tree, with three other agents editing concurrently, so the tree was **not quiet**: **872 suites passed, 37 skipped, 0 failed; 14,882 tests passed, 246 skipped; 100 / 100 / 100 / 100** (statements / branches / functions / lines); 683 s; exit 0.

## 7. What remains

- Helm: the CronJob was rendered and schema-validated but **never run on a cluster**. No release pipeline builds or pushes `callibrator/backup-verify` (CI is another lane).
- The dumps stay on the database's host until an operator copies them off (ADR-116 trigger).
- WAL/PITR and `make restore` (M-12, scoped out with a trigger in ADR-116).
- The object store and the secret escrow are verified only by a drill. The verifier checks the database.
- No production or VM deployment runs `db-backup` yet. The next VM deploy, with the base file, starts it: copy `./volumes/pgdump` off that host.
- Missed-run detection in Kubernetes is the cluster's job (kube-state-metrics rules), not the application's.
