# 2026-10-08 — The live database suites repaired, one real migration defect (A-366), and a CI job that runs them (A-367)

**Date:** 2026-10-08 · **Items:** A-366 (defect, fixed), A-367 / M-17 (mechanism, implemented) · **ADR:** none (a defect fix and a CI stage; no architecture changed) · **Base:** `9e4663b` plus the uncommitted P20-07 tree · **Nothing committed.**

**Trigger.** The P20-07 agent ([record](./2026-10-08-p20-07-client-facilities.md)) found four live suites failing identically on a clean copy of HEAD: `dataIdentity.dbA` 3/11, `attachmentService.p918` 2/6, `dataIntegrity.p6` 26/26, `queryCount.p804` 4/4. Nothing runs the `*.live.test.*` suites: each is opt-in, and CI's `backend-test` skips them. Running every live suite found four more failures, and one setup timeout that a loaded host exceeds (`s08`).

**Environment.** Docker `pgvector/pgvector:pg18` (PostgreSQL 18.6), container `lsr-pg18`, role `cal_owner` (superuser, as the compose owner). Mosquitto 2.1.2 (`eclipse-mosquitto:2`, no-auth config), container `lsr-mqtt`. Both were removed by name afterwards. Node 26.

## Per suite

| Suite | Failing before | Root cause | Class | Fix | After |
|---|---|---|---|---|---|
| `services/dataIntegrity.p6.live.test.js` | **26/26** (in `beforeAll`) | The suite records migrations 0001–0091 as executed but runs only seven of them by hand. **0003** (the generated `search_vector` columns) and **0034** (the PLATFORM tenant) never ran. 0110 (U-06b, 2026-10-05) indexes `search_vector`, and 0112 (P20-03) refuses without PLATFORM. With those two run: **2 P6-06 cases** were stale because P20-07's UD-9 (0118) replaced the serial index with `(tenant_id, client_facility_id, serial_number)`. **2 migration-0057 cases** were stale because 0119 and 0123 add four triggers to `calibration_records` | (b) stale test | Run 0003 and 0034 by hand, as the boot always has them. P6-06 asserts the error is `0118.SERIAL_UNIQUE`, the index's exact columns, and that 0026's index is gone. The 0057 cases compare the trigger set: a second `up` changes nothing; `down` removes exactly 0057's two and leaves the others; `up` restores the set. Nothing was loosened: the serial case gained two assertions | **26/26** |
| `migrations/dataIdentity.dbA.live.test.js` | **3/11** | **D-11:** the test read the erased user through `toJSON()`. Since `models/secretAttributes.ts` (2026-10-01), `toJSON()` drops the MFA and credential attributes, so it could not show that the erasure cleared them. **D-40:** it called `createCertificate(tenant, user, data)` without the principal. Since A-282 the audit actor comes from the fourth argument, and a call without one fails closed ("An audit entry must name its actor"). **D-09:** a **real defect, A-366** (below) | D-11, D-40: (b). D-09: (a) | D-11 reads the stored values (`get({ plain: true })`). D-40 passes `{ userId }`, as the controller does. D-09: the 0030 fix, and the live case now asserts both tenant references keep their own migration's shape after the re-run | **11/11** |
| `services/attachmentService.p918.live.test.ts` | **2/6** | Since the P8-01 storage cut-over (ADR-086 Am. 1, 2026-10-06), an upload is an **object** in its tenant's storage (`storage_key`), and a download answers `{ object }` with no `absPath`. The test read `absPath` (`undefined`) and checked the file with `fs` | (b) | The stored bytes are read through the download's object (and the signed download's). The test asserts no `absPath`, a `t/<tenant>/` key, and presence and absence through `getTenantStorage(A).exists`. Cleanup goes through the storage. The cross-tenant 404s and the delete are unchanged | **6/6** |
| `services/queryCount.p804.live.test.ts` | **4/4** (in `beforeAll`, no message) | The header said "needs a database built by sync + every migration", and the suite never built one. P20-07's baseline used an unbuilt database | (c) environment, provisionable | `beforeAll` runs `fixtures/liveBoot#bootSchema` (the boot's own `runSchemaSetup`) as the owner, before the role switch. It applies nothing on an already-built database (run twice) | **4/4** |
| `migrations/inspectionCatalogue.p2003.live.test.ts` (newly found) | **2/13** | Written when 0112 was the newest migration: `migrator.up()` was expected to apply exactly 0111 and 0112 (it now applies 0111–0123), and `verifySchema` was expected to report 31 control objects (now 76) | (b) | Apply up to 0112 and assert exactly those two plus the 12 triggers. Then apply the rest (all newer than 0112) and assert the triggers survive it. The object count equals `EXPECTED_OBJECTS.length`, of which exactly 18 are the catalogue's, and there are no problems | **13/13** |
| `services/dataLayer.dbC.live.test.js` (newly found) | **4/4** | It assumed a database already booted (its header said so). P20-07 ran it on one | (c) | `bootSchema` as the owner first | **4/4** |
| `services/dataLayer.dbD.live.test.js` (newly found) | **6/6** | the same | (c) | the same | **6/6** |
| `services/tenantHookless.w34.live.test.js` (newly found) | **7/7** (in `beforeAll`) | the same | (c) | the same | **7/7** |
| `services/keyRotation.s08.live.test.js` | passed in run 1; **5/5 failed in run 2** | Its `beforeAll` (`db.sync({ force: true })` of every model plus seeding) ran under jest's default 10 s hook timeout, which a loaded host exceeds. Every other DB live suite already gave its setup a long timeout | (c) environment (timing), provisionable | `beforeAll` gets `LIVE_BOOT_TIMEOUT_MS`, as the disposable-database suites have. No assertion changed | **5/5** |
| `services/iot.sharedSubscription.w14.live.test.js` | not run (needs MQTT) | — | — | none: run with Mosquitto 2.1.2 | **3/3** |

"Before" counts for p6, dbA, p918 and p804 are P20-07's HEAD baseline, reproduced here: p6 26/26 on the first run, dbA 3/11, p918 2/6, and p804 4/4 on an unbuilt database. The other four are from this agent's first full run.

## A-366 — migration 0030, re-run, rewrote two tenant references (real defect)

0030 treats every single-column foreign key to `tenants`, except `tenants.parent_id`, as the column that says which tenant owns the row. It makes that key RESTRICT, and NOT NULL outside its nullable list. Two foreign keys added later are **references**, not owners:

- `access_requests.provisioned_tenant_id` (0099): SET NULL, and NULL while a request is pending;
- `upstream_file_imports.target_tenant_id` (0113): CASCADE.

On a first boot 0030 runs before they exist. A **re-run** sees them: the restore without `schema_migrations` that D-09 proves (dbA empties `schema_migrations` and runs `migrator.up()` again). That re-run made `provisioned_tenant_id` NOT NULL and both keys RESTRICT. Its state table went from 4 rows to 7. On a real restore, a pending request would refuse the boot. Without one, every later request would fail to insert.

**Fix:** `TENANT_OWNER_COLUMNS = ["tenant_id", "tenantId"]`. 0030 skips any other tenant reference. A first run is unchanged on every database 0030 has met: when it first ran, the only other tenant reference was `parent_id`, which the query already excluded.

**Evidence:**
- **Fail-before, unit:** `src/tests/migrations/0030-tenant-foreign-keys-restrict.test.ts`, new case "A-366: a REFERENCE to a tenant that is not the row's owner…". 1 of 19 failed before the fix; 19/19 pass after.
- **Fail-before, live:** `dataIdentity.dbA.live` D-09 on PostgreSQL 18.6, with the fix disabled by a temporary switch (removed): failed (`migration_0030_previous_foreign_keys` 4 → 7). With the fix: passes, and asserts `access_requests.provisioned_tenant_id` stays `SET NULL` and nullable, and `upstream_file_imports.target_tenant_id` stays `CASCADE`.

## A-367 — the mechanism: `npm run test:live` and CI job `live-db`

- **`backend/scripts/live-suites.ts`** (`npm run test:live`). A manifest of 36 runs over 35 files; `q34` runs in both modes. For each run it creates a fresh `live_<id>_scratch` database (or lets a disposable-database suite create its own), sets the suite's opt-in variable, runs jest on the one file, and drops the database `WITH (FORCE)`. It exits 1 if any run failed. Options: `--only=`, `--with=mqtt`, `--list`. Six files are by hand, with reasons in the file:
  - `upgradeBoot.am3` (needs an older revision's checkout and install);
  - `rabbitmq.w06` (stops and starts a named broker);
  - `storage.s3.u09` (needs S3);
  - the three Redis suites.
- **`src/tests/guards/liveSuites.a367.guard.test.ts`** (4 cases, in `backend-test`):
  - every `*.live.test.*` is in the manifest or the by-hand list, never both, and every listed file exists;
  - ids are database-safe and unique, and every run opts in;
  - a planted unlisted suite is caught.
- **CI job `live-db`** (`.github/workflows/ci.yml`):
  - a `pgvector/pgvector:pg18` service with the deployment's digest;
  - Mosquitto 2 started by `docker run`, digest-pinned (`sha256:38c0da4f…`), with its no-auth config — a service container cannot be given a command;
  - random secrets, as `backend-test` uses;
  - `npm run test:live -- --with=mqtt`, 60-minute limit.
  - actionlint 1.7.12 (the `rhysd/actionlint:1.7.12` image) over `.github/workflows/`: exit 0, no findings. **Not yet run on GitHub.**
- **Docs:** `docs/DEVOPS/01-CI-CD.md` (pipeline row) and `docs/ENGINEERING/09-TESTING-CONVENTIONS.md` (the runner; a live suite builds its own state; never record a migration as executed without running it).

## Evidence — the runs (named)

- **First full run** of `npm run test:live -- --with=mqtt`, with p6, dbA, p918att and p804 already repaired: **32 of 36** passed. dbC, dbD, p2003 and w34 failed, as in the table. Exit 1.
- **Second full run**, after the dbC, dbD, p2003 and w34 repairs: **35 of 36**. `s08` timed out in `beforeAll` (above); the host was loaded (p6 took 56 s, against 17 s in run 1). Exit 1.
- **Third full run**, after the s08 timeout: **36 of 36, 287 tests passed, 0 failed.** Exit 0.
- Each repaired suite was also run alone through the runner, on a fresh database: p6 26/26; dbA 11/11; p918att 6/6; p804 4/4 on an empty database, then 4/4 again on the built one; p2003 13/13; dbC 4/4; dbD 6/6; w34 7/7; w14 3/3.

## Gates (2026-10-08; tree not quiet — another agent was moving frontend files, ADR-131)

- `npm run test:coverage -- --ci`: **924 suites passed, 41 skipped, 0 failed; 15,988 tests passed, 338 skipped; 100 / 100 / 100 / 100**, in 463 s (Node 26). The `webhookEmit.a11` path failure P20-07 reported did not occur in this run.
- `node scripts/ci/eslint-ratchet.js`: "0 error(s), 0 warning(s); baseline 0". `npx eslint` on every changed file: clean.
- `npm run typecheck`: 0 errors. `npm run ratchet`: 695 `.js`, at the floor (no new `.js`).
- actionlint 1.7.12: 0 findings.
- Live: the third full `npm run test:live -- --with=mqtt` — **36 of 36 runs passed, 287 tests, 0 failed**, in 994 s summed per suite (PostgreSQL 18.6, Mosquitto 2.1.2).

## Observations, not defects

- **A lone re-run of 0057's `up` after 0119** replaces 0119's function with 0057's, and so loses the admission of a facility move. Only an operator re-running that one migration by hand can do it. The ordered re-run (D-09) re-applies 0119 after 0057, and dbA proves that path. The p6 case only compares trigger names. Noted for P21-09, which owns the move.
- **`createCertificate` called without a principal fails closed** (A-282 by design: no actor, no audit row, no certificate). The service signature's `actor = {}` default makes the `userId` fallback in `auditCertificate` unreachable. Harmless, because the only caller passes the principal.

## Files

- **Changed:**
  - `backend/src/migrations/0030-tenant-foreign-keys-restrict.ts`;
  - `backend/src/tests/migrations/0030-tenant-foreign-keys-restrict.test.ts`;
  - the nine suites in the table (w14 unchanged);
  - `backend/package.json` (`test:live`);
  - `.github/workflows/ci.yml`;
  - `docs/DEVOPS/01-CI-CD.md`, `docs/ENGINEERING/09-TESTING-CONVENTIONS.md`;
  - `TASKS/AUDIT-2026-09-REMEDIATION.md` (A-366, A-367), `TASKS/BACKLOG.md` (M-17);
  - `MEMORY/CHANGELOG.md`, `MEMORY/MEMORY-INDEX.md`, `CLAUDE.md`.
- **New:** `backend/scripts/live-suites.ts`, `backend/src/tests/guards/liveSuites.a367.guard.test.ts`, this record.
