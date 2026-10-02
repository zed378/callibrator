# 2026-09-29/30 — Phase 9 Stage C: eleven leaf services converted ahead of their cards

**ADR:** ADR-087. The amendment text is in § "For the ADR-087 amendment" below, for the Phase 9 lead to merge. It follows Amendment 13's module pattern.
**Cards (part):** P9-13 (`featureFlag`) and P9-18 (the other ten).
**Agent:** Stage C leaf-services helper.
**Tree:** HEAD `ce74932` plus the uncommitted work of the other agents.

## What was converted

Each file was converted to `.ts` and its `.js` deleted.

| Card | File |
|---|---|
| P9-18 | `services/storage/signing` |
| P9-18 | `services/storage/keys` |
| P9-18 | `services/storage/config.service` |
| P9-18 | `services/quarantineSweep.service` |
| P9-13 | `services/featureFlag.service` |
| P9-18 | `services/email.service` |
| P9-18 | `services/reporting.service` |
| P9-18 | `services/content.service` |
| P9-18 | `services/alert.service` |
| P9-18 | `services/notificationChannels.service` |
| P9-18 | `services/contentMedia.service` |

**How each file was chosen.** I built an import graph of `services/**` with scratch `p9svc/graph.js`. It counts `require` calls inside functions as well as top-level ones. A file qualified when every import was already one of these:

- a `.ts` file;
- a package;
- a `.js` file with a sibling `.d.ts` (the lead's `config/index.d.ts`, `audit.service.d.ts` and `emailQueue.service.d.ts`).

It also had to have no uncommitted change by another agent. I recomputed the graph after each conversion.

## The pattern (ADR-087 Amendment 13)

- **Exports.** `export =` of an object literal, in the original key order.
- **Internal calls.** A function that called a sibling through `exports.x` now calls it through that object (`featureFlag.initializeTenantFlags` → `service.getTenantFlags`), so a spy on the export still intercepts the call.
- **Load-time captures.** Every load-time destructure is kept as a `const`, captured at load: models from the barrel, `AppError`, `logger`, `db`, the limits and `PUBLIC_UPLOADS_URL`.
- **CommonJS packages.** `fs`, `crypto`, `nodemailer`, `mustache` and `sanitize-html` are default imports of the module objects. A `jest.mock` factory or a `jest.spyOn` therefore still applies to them.
- **Lazy requires stay lazy.** `alert.service` still `require`s `email.service` inside `sendAlertEmail`, typed as `typeof EmailService`. Loading `email.service` reads the templates and builds the SMTP transport, which must not happen when `alert.service` loads.
- **Environment reads.** All `process.env` reads go through `config/env`, read at call time. `||` is kept wherever the `.js` had it, under a line-level or region-level reasoned directive.
- **Types.** They are module-local, with no additions to `src/types/`. Any value a JavaScript caller can pass is typed `unknown` or as a wide union, and every defensive check the `.js` made is still made.

## Accepted differences (checked)

- **`Function.name`.** Functions that were `exports.x = async () => …` had the name `""`. As `const x` they now have the name `"x"`. This applies to five functions in `featureFlag`, twelve in `content`, and `dispatch` and `recordMediaUpload`. Nothing reads these names, and the lead accepted the same difference in Amendment 13.
- **Environment read counts.** `storage/config.getGlobalConfig` now reads `STORAGE_S3_BUCKET` and `STORAGE_NFS_ROOT` once each instead of twice. The environment does not change between the two reads, so the result is the same.
- **`reporting.getOverdueDevices`.** It writes `now - date` as `+now - +dateOf(date)`. Both use the same ToNumber, and a BigInt still throws.
- **`Op` in `featureFlag`.** `featureFlag` imports `Op` at the top instead of `require("sequelize").Op` inside `getTenantFlags`. It is the same object, and the models barrel has already loaded sequelize.

## Identity evidence

**Method.** Each file was checked against its working-copy `.js`, snapshotted to scratch `p9svc/wc/` before it was deleted. Both versions were loaded from one scratch tree, compiled by TypeScript 7 from `tsconfig.build.json` (`p9svc/compile.sh`). I did not use `build:dist`, because it was refusing another agent's four middleware `.js`/`.ts` pairs.

The database, SMTP, fetch, the queue and audit were stubbed at the module boundary identically for both versions. The recording models fake is `p9svc/fakemodels.js`.

**Results.** Each harness was bitten by planted changes: at least three plants per harness, and every harness failed on at least one of them.

| Module | Checks | Different | Scratch script |
|---|---|---|---|
| `storage/signing` + `storage/keys` | 1,543 | 0 | `cmp-storage1.js` |
| `quarantineSweep` | 290 | 0 | `cmp-quarantine.js` |
| `featureFlag` | 4,421 | 1 (the names) | `cmp-featureFlag.js` |
| `storage/config.service` | 3,999 | 0 | `cmp-storageConfig.js` |
| `email` | 140 | 0 | `cmp-email.js` |
| `reporting` | 399 | 0 | `cmp-reporting.js` |
| `content` | 344 | 1 (the names) | `cmp-content.js` |
| `alert` | 459 | 0 | `cmp-alert.js` |
| `notificationChannels` + `contentMedia` | 40 | 2 (the names) | `cmp-small2.js` |

What each harness covered:

- **`storage/signing` + `storage/keys`:** traversal keys, backslash and NUL, lengths, tenant and domain matrices, and malformed tokens.
- **`quarantineSweep`:** a real temporary directory, environment cases, fault injection (ENOENT, EACCES, a thrown `null`, unlink failures), and a check that the store inside the sweep is the system context.
- **`featureFlag`:** prototype keys such as `toString` and `__proto__`. Late binding through the export was proven.
- **`storage/config.service`:** 15 environment cases; corrupt, primitive and `null` stored JSON; and credentials written through `findOrBuild` + `save`.
- **`email`:** the transport options at load across environment cases; every message; and escaping. The baseline is the main session's branding edit.
- **`reporting`:** CSV formula injection, `null`/`undefined`/invalid dates, raw grouped rows, and a frozen clock for `getSummary`.
- **`content`:** the sanitizer (real sanitize-html), slug collision, transaction commit/rollback, and the thrown `{ status, message }` objects.
- **`alert`:** stubbed fetch, `setTimeout` delays, env parsing, and a failing sink.

## Tests, typecheck and lint

**Own and dependent suites, unchanged and passing:**

- `storage.*`, `quota.*`, `featureFlag.*`, `tenantLifecycle`, `migration.service`, `tenant.platform.a76`;
- `email.*`, `emailQueue`, `alert*`, `jobMonitor`, `health.jobs.p702`;
- `reporting.*`, `content.*`, `contentMedia`, `notification*`, `quarantineSweep*`.

For example, the last targeted run covered 21 suites and 464 tests. `alertRouting.p702` timed out once under full-machine load and passed alone (10/10).

**Test edits.** The only test edits are re-keyed lines in `unboundedFindAll.d24.test.js`:

- `featureFlag` (1);
- `storage/config.service` (1);
- `reporting` (4);
- `content` (1).

Each keeps its value and carries the comment "P9-18 leaves: the file is TypeScript (re-keyed, ADR-087)". The lead cleared these edits. No other test changed.

**Typecheck and lint.** `npm run typecheck` shows no errors in these eleven files. The remaining errors were in other agents' in-flight files (`user.service.ts`, migrations). `npx eslint` on the eleven files reports 0 problems.

**Coverage.** Every one of the eleven files is at 100/100/100/100.

**Ratchet.** Each deletion lowered the floor. The last reading was "966 .js file(s), at the floor"; the number is shared with the other agents' conversions.

**New devDependencies.** `@types/nodemailer` ^8.0.2, `@types/mustache` ^4.2.6 and `@types/sanitize-html` ^2.16.2 were added, as the lead agreed. None has an install script, and `npm audit` reported 0 vulnerabilities after the last install.

## Full gate: not green, and not because of these files

- **Boundary 1 (after five files):**
  - 710 suites passed, 6 failed, 26 skipped. 13,437 tests passed and 12 failed.
  - Coverage was 100 / 99.99 / 100 / 100. The shortfall was `validators/fields.ts`, in the P9-11 lane.
- **Boundary 2 (after nine files):**
  - 679 suites passed and 51 failed. 13,361 tests passed and 135 failed.
  - Coverage was 99.57 / 99.26 / 99.23 / 99.57.

Every failure traced to another agent's in-flight work:

- the Joi→Zod validator move ("Validation Error" messages in the controller suites);
- migration conversions (`manifestNames.p923`, `0019`–`0027` suites);
- the audit, kanban and menuGroup edits (the `memoryDb` grouped-aggregate failures, the menuGroup assignments);
- the `rateLimiter` request-budget edits;
- the controllers mid-conversion.

The suites touching these eleven modules pass. **The gate has to be re-run on a quiet tree before anyone can quote it green.**

## Not converted, and why

| Files | Reason |
|---|---|
| `search.service` | Raw SQL with `replacements` (`:tenantId`), and its tests assert the replacements. Moving to `sql()`/bind changes the call and the tests, so it is its own change. The lead agreed. |
| `storage/local.driver`, `storage/s3.driver`, `storage/index` | The A-176 SSRF agent is editing them. |
| `redis`, `rabbitmq`, `audit`, `mfa`, `rateLimiter.redis`, `emailQueue` | The lead's `.d.ts` dependencies; ask the lead first. |
| `ai`, `apiKey`, `finance`, `networkSecurity`, `risk`, `supplierScorecard`, `vendor`, `stripeWebhook`/`billing`, `ticket`, `kanban`, `eSignature`, `tenantLifecycle`, `oidcJwks`/`sso` | The security-fixes agent's lane. |
| `kms`, `certificatePdf`, `certificate`, `keyRotation` | The fixes agent's lane. |
| `audit`, `dashboard`, `kanban` | The performance agent's lane. |
| `warehouse`, `stock`, `tenant` | They carry uncommitted changes. |

## Findings recorded, not fixed (ADR-038 rule 3)

- **`content.service` broke the response envelope.** It answered `data.rows` / `data.meta` on its two lists, which is the shape CLAUDE.md forbids, and it threw plain `{ status, message }` objects instead of `AppError`. The conversion kept both as built; they are now **A-297, fixed as its own change** (below).
- **`emailQueue.service.d.ts` is narrower than the JavaScript it describes.** It omits `| undefined` on `firstName` and `actionUrl` under `exactOptionalPropertyTypes`, although the JavaScript accepts `undefined`. `notificationChannels` therefore views its call through one documented assertion, reported to the lead.

## A-297 — the `content.service` envelope, fixed as its own change (2026-09-30)

The coordinator directed this fix. It was made **after** the conversion, on the `.ts` file, because the conversion had already been proved identical against the `.js` and the `.js` no longer existed.

**What changed:**

- **`services/content.service.ts`:**
  - `listPosts` and `listPublishedPosts` return `{ success, status, message, data: rows, meta }`.
  - Every catch block throws `failure(error, fallback)`. That rethrows an `AppError` unchanged; anything else becomes `new AppError(Number(status) || 500, message || fallback)`.
  - The `only-throw-error` directive is gone.
- **`controllers/content.controller.js`:** the two list handlers read `result.data` / `result.meta`. The file also carries another agent's A-282 hunk (`auditPrincipal`); my two lines do not overlap it.

**The wire did not change.** The controller already sent `data: rows` and a top-level `meta`. So no frontend consumer needed a change. I checked every one:

- `frontend/src/api/services/content.service.ts`;
- `frontend/src/lib/content.api.ts` (the public blog and news fetches);
- the blog, news and dashboard content pages and components, and `sitemap.ts`.

Each reads `data` as the array and `meta` at the top level.

**Error-path difference (dev only):** outside production, `details` now carries the AppError's stack instead of `"[object Object]"`. The status and the message are unchanged. In production a 500's message was already hidden.

**Evidence:**

- **Fail-before:** the new `src/tests/services/content.envelope.a297.test.ts` failed 5 of its 8 tests against the unfixed service:
  - the two list-shape tests;
  - the 404 AppError test;
  - the wrapped-error test;
  - the fallback test.

  The three wire tests passed before and after; they pin that the wire did not change. After the fix it passes 8/8.
- **Updated tests:**
  - `content.service.test.js`: the list reads, and 19 rejection assertions changed from `toEqual` to `toMatchObject`.
  - `content.controller.test.js`: the list mocks use the new shape, and `success` is asserted with `(res, rows, meta, message, 200)`.
- **Results:** 105 tests passed, and `content.service.ts` and `content.controller.js` are each at 100/100/100/100.
- **Frontend:** the content suites passed 61/61 with no change.
- **Checks:** typecheck and lint are clean on the changed files (4 existing `prefer-arrow-callback` warnings in lines not touched).

## Round 2 (2026-09-30): seven more leaves

These were converted after A-297, with the same method. Each file was confirmed unmodified by other agents when I started it, snapshotted to `p9svc/wc/`, compared against its compiled `.ts`, and bitten by planted changes.

| Service | Card | Checks | Differences | Bites |
|---|---|---|---|---|
| `quota` | P9-17 | 7,207 | 0 | 4 of 4 |
| `ownSessions` | P9-12 area; the lead released it | 294 | 1 (function names) | 3 of 4, plus one that broke the module |
| `webhookDeliveryPurge` | P9-18 | 78 | 0 | 4 of 4 |
| `iotDevice` | P9-14 | 213 | 1 (function names) | 3 of 5 |
| `sop` | P9-16 | 155 | 1 (function names) | 4 of 4 |
| `admin` | P9-13 | 127 | 1 (function names) | 3 of 4 |

`notificationChannels` + `contentMedia` are in round 1; the lead's `.d.ts` widening removed the assertion there.

What each harness covered:

- **`quota`:** 8 tenant shapes, 4 usage levels and 4 own-storage states. The lazy `storage/config.service` require is kept.
- **`ownSessions`:** the session list and the revoke path: transaction, audit-row failure, and an update failure.
- **`webhookDeliveryPurge`:** environment cases, a tenant fan-out with batching and a budget, and the tenant context at the audit row.
- **`iotDevice`:** token issue, rotate and revoke; the 409s; and the `before` values read back.
- **`sop`:** numbering, keyset fan-out over 0 to 1,200 users, separation of duties, and acknowledgement 404/409.
- **`admin`:** list, status and flags, cache invalidation after commit, and the two audit rows.

**As-built details the typing kept:**

- `ownSessions` lists by the column name `created_at`, which is not a model attribute (the attribute is `createdAt`). The row is typed as a view that allows it.
- `sop` keeps `requiresTraining !== undefined ? … : true`, so an explicit `null` is still stored as given. The TypeScript rule accepted it without a directive.
- `admin` imports `Op` at the top instead of requiring `sequelize` inside `getAllTenants`. It is the same object.

**Guard edits (file-name re-keys only):**

- `unboundedFindAll.d24`: `webhookDeliveryPurge.service.ts::purgeFinishedDeliveries::Tenant`, and the paged-read list entry `["sop.service.ts", "assignTraining", "User"]`.
- `auditInTransaction.p611`: another agent had already re-keyed `contentMedia.service.ts` there.

**Own suites:**

| Service | Suites | Tests |
|---|---|---|
| `quota` | 5 | 63 |
| `ownSessions` | 1 (`session.own.q08`) | 12 |
| `webhookDeliveryPurge` | 3 | 22 |
| `iotDevice` | 2 | 37 |
| `sop` | 9 | 215 |
| `admin` | 7 | 123 |

In the `sop` run, the only failures were `denyPlatformAuthoring.a127` (another agent's `auth.route.js POST /login`) and d24's `signInPolicy`/`warehouse` `.ts` entries (other lanes). Each of the six files is at 100/100/100/100, typecheck is clean on them, and lint reports 0 problems.

**Not converted this round:**

- `predictiveMaintenance` and `tenantUpload` were modified by another agent when I reached them.
- `iot` (335 lines, MQTT), `jobMonitor` (732) and `tenantBackup` (1,168) are the remaining large leaves. They are unmodified and next.

**Boundary 3, the full run between the two rounds:**

- 737 suites passed, 26 failed, 28 skipped.
- 14,033 tests passed and 34 failed.
- Coverage was 99.99 / 99.98 / 99.96 / 99.99. The shortfall was other agents' `menuGroup.controller.js`, `certificateDocument.service.ts` and `workflow.service.js`.

The failures belonged to other lanes: validator contracts, migrations `0086`–`0089`, the OpenAPI/`p925` work, MFA, `signingKeyWrap`, `tenantBackup.backupType`, `workflow`, `routePermissionGuard`/`denyPlatformAuthoring` (`auth.route`), and `schedulerSwitch`, which needs Helm.

`auditInTransaction.p611` failed in that run on `contentMedia.service.ts:72`. It passed 5/5 once the other agent's re-key landed.

**Boundary 4, after round 2:**

- 741 suites passed, 24 failed, 28 skipped.
- 14,055 tests passed and 60 failed.
- Coverage was 98.82 / 98.16 / 98.68 / 98.81. It is pulled down by other agents' mid-conversion files: `billing.service.ts` and `warehouse.service.ts` at 0%, `accessRequest.service.ts`, `user.service.ts`, `user.controller.js` and `menuGroup.controller.js`.

All 15 of my round-2 and A-297 files are at 100/100/100/100.

The failures belong to other lanes:

- auth, MFA and passkey (`p1004`, `p1010`, `p1016`, `a81`, `a141`, `a142`, `a162`);
- webhook delivery (A-307 SSRF agent) and `clamAv`;
- `scim.userAudit.a278`, the `multipartSanitizer.a296` run and `apiDocs.p925`;
- `routePermissionGuard`, `swaggerValidatorAlignment` and `denyPlatformAuthoring`;
- `signingKeyWrap`;
- `schedulerSwitch.w02`, which needs Helm;
- d24's `signInPolicy`/`warehouse` `.ts` entries;
- `password.test`, a 10 s timeout under load.

**The gate has to be re-run on a quiet tree.**

## Round 3 (2026-09-30): `iot` and `jobMonitor`

I claimed these with the new services helper (P9-15/P9-17) and the lead, so no module is taken twice. Both were unmodified when I started.

### `iot` (P9-14): 103 scenario checks identical

- **What is exported.** `export =` still exports ONE `IotService` instance. Its four fields are `declare`d and assigned in the constructor, so the own-key order is unchanged.
- **Imports.** `mqtt.connect` is a named import read at call time, because mqtt 5 is an `__esModule` build; `jest.mock("mqtt")` still applies. `crypto` is the module object.
- **What the harness covered:**
  - the instance's shape and prototype;
  - `connect` across 6 environment cases × 4 broker modes × 3 argument forms (a fake mqtt client);
  - `publish` and `disconnect`;
  - `ingestReading` over 3 devices × 6 payloads, including the tenant context and the anomaly transaction;
  - `handleIncoming` concurrency and parse failures across 4 `MQTT_INGEST_CONCURRENCY` values.
- **Bites:** 4 of 5.
- **As-built details kept:**
  - `connect` still returns the promise un-awaited inside its `try`, so a connection timeout still skips the catch's log line (reasoned `return-await` directive).
  - Relational comparisons and template interpolation of whatever the device sent are kept.
- **Suites:** 6 passed (2 live skipped), 161 tests; `iot.service.ts` 100%.

### `jobMonitor` (P9-18): 26 multi-step scenarios identical

- **Imports.** `cron` is node-cron 4's default export, which holds the same `schedule`/`validate` functions as the module; the W-02 and W-13 guards still find `cron.schedule(`.
- **Lazy requires stay lazy.** `redis.service`, `sequelize` and the models barrel are still required inside the functions that use them, so loading the monitor never loads the database layer.
- **What the harness covered:**
  - the singleton claim in 6 Redis modes;
  - a failure streak with alert throttling and recovery;
  - `isFailure` / `isIncomplete`;
  - register, overdue and disabled jobs, and `refuseSchedule`;
  - a persisted missed run reloaded from disk, and a corrupt status file;
  - stuck batch jobs (0, 3 and 20 rows);
  - the watchdog tick's failures;
  - `startWatchdog` across 5 schedules and routing states;
  - 3 environment cases, and a persist failure.

  The status files written and the Prometheus text were compared too.
- **Bites:** 3 of 5 (the other two plants change nothing on these inputs).
- **Guard re-key:** the W-13 exemption key `services/jobMonitor.service.js` → `.ts`.
- **Suites:** 14 suites, 162 tests; `jobMonitor.service.ts` 100%.

### Not done this round, and why

- **`tenantBackup` (1,168 lines).** It holds the restore path: A-120 and D-02 (a backup file is untrusted input; a restore never creates an account and never raises privilege) and the cross-tenant refusal in `assertRestorable`. It is isolation-critical in the same way as `tenantScope` and `jobContext`, so I am recommending a dedicated pass under the owner's four isolation gates, including a live two-tenant restore probe on PostgreSQL 18 as `callibrator_app`. A rushed conversion is not the right way to do it.
- **`predictiveMaintenance` and `tenantUpload`.** Still modified by another agent on 2026-09-30.

## Round 4 (2026-09-30): `tenantBackup` under the four isolation gates

The coordinator decided this under the owner's delegation, and the lead acknowledged it and kept other agents off the file. The baseline is the working-copy `.js`, unmodified when I started, snapshotted to `p9svc/wc/`.

**The conversion.**

- **What is exported.** `export =` keeps the same object with the same 10 keys, in the same order.
- **Imports.**
  - `fs`, `path`, `crypto`, JSZip, moment and the `sequelize` package are default imports of the module objects. The tests' `jest.spyOn(fs, …)` still applies.
  - The three models, `Op`, the logger, the three error classes and `storagePath` are captured at load.
  - Both `require("../models").sequelize` fallbacks stay lazy.
- **How the untrusted archive is typed.** The archive and its user rows are typed as untrusted (`unknown` fields). `assertRestorable`, `reconcileUsers` and `pickFields` keep every check they made.
- **What moved in the guards.** No logic moved. Two parameters that were never read are now named `_models`, which does not change the arity.
- **Test edits (file names only):**
  - `tenantBackup.status.s32` now reads `tenantBackup.service.ts`;
  - `unboundedFindAll.d24` has three re-keyed entries.

**Gate (a): the watching suites catch planted defects.** Nine planted defects were each caught by the watching suites. The file was restored byte for byte, confirmed with `cmp`.

| Planted defect | Tests failed |
|---|---|
| A cross-tenant archive accepted | 1 |
| `roleId` and `isActive` restorable (privilege raise) | 2 |
| The export carries `mfaSecret` | 4 |
| A restore creates an absent account | 2 |
| A soft-deleted account revived | 2 |
| Backup type compared case-sensitively | 4 |
| A STATUS member the ENUM lacks | 2 |
| Checksum not verified | 1 |
| The restore claim not conditional | 1 |

Scratch script: `p9svc/bite-tenantBackup.sh`.

**Gate (b): identity.** 189 checks, all identical (scratch `cmp-tenantBackup.js`), with real fs, JSZip and moment and a frozen clock. What it covered:

- **`createBackup`:** 2 tenants × 6 backup types × 2 actors × 2 audit outcomes × 2 failure points. The zip written is compared by SHA-256, so it is byte-identical.
- **`downloadBackup`:** 5 states.
- **`restoreBackup`:**
  - 9 row states and 11 crafted archives (good, cross-tenant, no metadata or tenant, users not a list, full with no users, missing fields, no data file, bad JSON, empty), each with 3 `mergeData` values;
  - a lost claim, an update failure, a count failure and an audit failure;
  - models without `sequelize`.
- **`deleteBackup`:** 6 states × 2 actors, including an unlink failure.
- **Stats and cleanup.**

Six planted changes to the compiled module each failed it, with 2 to 28 differences.

**Gate (c): the isolation and authorisation suites.** 84 suites, 1,757 tests passed. They cover every two-tenant suite, `tenantScope`, the tenant hooks, `includeRequired`, the `includes.a*` suites, `tenantHierarchy`, `jobContext`, `rawSqlTenantPredicate`, `auditInTransaction`, `routePermissionGuard`, `dynamicAccessSlugs`, `tenantContext`, the `a63` suites, `crossTenant`, `systemActors`, the secrets suites, and every `tenantBackup`/`scheduledBackup` suite.

The one failure is `denyPlatformAuthoring.a127`, on the lead's in-flight `webauthn.route.js DELETE /credentials/:id`. It is not related to this file.

**Gate (d): live, on a disposable PostgreSQL 18.6 as `callibrator_app`.** The database was booted with `createDisposableDatabase` and `bootSchemaAsApplicationRole`. Scratch `live-tenantBackup.js` passed **24/24**:

- **Setup:** the module under test is the `.ts`, and queries run as `callibrator_app`.
- **A normal backup and restore round-trips:**
  - the backup completes with its record count and expiry, and its CREATE audit row is in A's trail;
  - the archive carries no password hash;
  - the restore puts the profile back and writes an UPDATE audit row;
  - the backup is left COMPLETED with `restoredAt` set;
  - a second restore is a 409.
- **A's backup cannot be restored into B:**
  - from B, A's backup id answers 404;
  - A's row is untouched;
  - a B row pointing at A's archive is refused with a 409 naming both tenants, nothing is written into B, and the forged row stays unclaimed.
- **A crafted archive creates nothing and raises nothing.** It named a new user (mallory) and carried `roleId`, `isActive`, `status`, `password` and a foreign `tenantId` for carol:
  - no account is created, and mallory is reported `absent`;
  - carol's role, active flag, status, password and tenant are unchanged;
  - only her `firstName` (allow-listed) is written.
- **A tampered archive** is a 409 on its checksum.
- **Delete:** B deleting A's backup is a 404, and A's delete is audited in A's trail.

The repository's live suite `backgroundJobs.w12.live` (including the backup-prune keyset) also passed 8/8 on the same container.

**Clean-up.** The disposable databases were dropped, confirmed as 0 scratch databases left. The Docker daemon then stalled removing the container: `p9svc-tb-pg18` is left in state **Dead**, and its anonymous volume `09de94e7…` cannot be removed while the container exists. **Both need `docker rm -f p9svc-tb-pg18 && docker volume rm 09de94e79edfe7a41e3e46d8cf58a734714bb026f634de5fbc5eace3836a5f6e` once the daemon lets go.**

**Other checks.** `tenantBackup.service.ts` is at 100/100/100/100 across 17 suites (217 tests); the one failing suite in that run was d24 on the services helper's `meteredBilling` entries. Typecheck and lint are clean. The ratchet reads "905 .js file(s), at the floor".

**No defect was found in the conversion.** Nothing was fixed, and no AUDIT row is needed.

## Round 5 (2026-09-30): P9-18 platform services, part 1

The coordinator assigned me P9-18. I split the modules with the lead, which reserved `redis`, `rabbitmq`, `audit`, `mfa`, `rateLimiter`, `emailQueue` and `menuGroup`, and with the services helper (P9-15/P9-17; no overlap). Every swap was made in one step: a draft in scratch, then the `.js` removed and the `.ts` placed together. After each swap, `npm run load:check -- --src` printed OK. Every module keeps `export =` with no named export beside it.

### Security-sensitive modules, converted under the four gates

**`kms.service`**

- **What was preserved.** Late binding goes through the export object (`isEnvelope`, `encryptData`, `decryptData`). The production check and the key ring are still built at load.
- **(a) Planted defects:** 8 of 9 were caught. Removing the "unknown key id" check still fails decryption, but with the generic message, and no suite pinned the named one. That gap is now closed by `src/tests/services/kms.unknownKey.p918.test.ts`, which fails when the check is removed.
- **(b) Identity:** 24 checks across 8 environment cases, each in a fresh process, with deterministic randomness. The only difference is `Function.name`.
- **(c) Suites:** 115 isolation, secrets and authorization suites; 2,119 tests.
- **(d) Live, as `callibrator_app`: 10/10.**
  - A stored secret is a v2 envelope, never plaintext.
  - B cannot read A's setting at all.
  - A's envelope copied into B's row does not decrypt (the tenant id is the AAD).
  - A tampered envelope is refused.

  The repository's live suites also passed:
  - `keyRotation.s08.live` 5/5 (the Q-36 staleness no longer shows);
  - `secretsAtRest.s20.live` 9/9;
  - `0090-…p613.live` 6/6.

**`signingKeyWrap.service`**

- **(a) Planted defects:** 7 of 7 effective plants caught. Two plants that tried to fix the tenant id changed nothing, so I rewrote them; both then bit.
- **(b) Identity:** 15 checks across 5 `ENCRYPT_KEY` cases, identical. They cover legacy CBC reads under the current and previous keys, a non-PEM legacy value, and the AAD.
- **(d) Live:** the `keyRotation.s08.live` rehearsal (the 0058 legacy signing keys) passes with the `.ts` module.

**`keyRotation.service`** was done in two steps.

- **Step 1, its own change on the `.js`: the SQL moves to `sql()`/bind.**
  - Every statement uses `$n` binds and never `replacements`.
  - The UPDATE says how many rows it wrote with `RETURNING id`, not the driver's `rowCount`.
  - Fail-before test: `keyRotation.sqlBind.p918.test.ts` failed on `replacements` before the change and passes after.
  - Test doubles updated: `keyRotation.service.s08.test.js`, and the migrations lane's `0086` test. Migration 0086 calls `rewrapTarget`; its double gained a `namedValues()` helper that serves both shapes, 11/11.
  - D-05 has a reviewed CROSS_TENANT entry, keyed `services/keyRotation.service.ts#${table}`: the operator's rotation spans tenants on purpose, and each write binds the row's id and tenant.
  - `keyRotation.s08.live` passed 5/5 after the change.
- **Step 2, the conversion.**
  - (b) Identity: 52 checks, all identical, with 4 of 4 bites.
  - (a) Planted defects: 5 of 7 caught. The two SQL-predicate plants (the tenant predicate removed; the optimistic `<column> = $4` removed) passed every existing unit and live suite. The new `src/tests/services/keyRotation.predicates.p918.live.test.ts` closes that gap: on real PostgreSQL 18 it interleaves an application write with the rotation's UPDATE, and each plant now fails it (3/3 green without plants).

### Other modules

| Module | Identity | Bites | Notes |
|---|---|---|---|
| `scheduledBackup` | 65/65 | 3 of 4 | Real fs; a frozen clock; the status file and stderr compared; the models barrel stays lazy. The `s32` guard's file list was re-keyed |
| `clamAv` | 21 checks, all identical | 3 effective | Fresh processes per environment case; a real fake clamd over TCP and a fake HTTP front end. `scanCache` is still exported only when NODE_ENV is test. One added `??` branch was removed to keep 100% |
| `virusScan` | 101/101 | 3 of 4 | |
| `health` | 32/32 | 3 of 4 | `amqplib.connect` is a named import (amqplib 2 ships its own types) |

Each of these files is at 100/100/100/100 in its own suites. Typecheck and lint are clean.

### `search.service`: the SQL move first, then the conversion

- **Step 1, its own change on the `.js`: the SQL moves to `sql()`/bind.**
  - The FTS statement binds `$1` term, `$2` tenant, `$3` limit. The ILIKE fallback binds `$1` tenant, `$2` the `%term%` pattern, `$3` limit. Neither uses `replacements`, and the tenant predicate is bound (`tenant_id = $n`).
  - Fail-before test: `src/tests/services/search.sqlBind.p918.test.ts` failed 2 of 2 before the change and passes after.
  - Test doubles updated: `search.service.test.js` (the limit is now `bind[2]`) and `search.twoTenants.a56.test.js` (a `boundTenant()` helper reads the bound tenant from `tenant_id = $n`). All 74 search tests pass.
  - Live, PostgreSQL 18, two tenants: a 6-check probe covers the FTS path, the ILIKE fallback, a quote in the term, a `%` term, the per-type limit and an unknown tenant. It passed 6/6 on the pre-change copy and again after the change.
- **Step 2, the conversion.**
  - (b) Identity: 3,173 checks, all identical. They cross 8 terms, 9 type lists, 11 limits and 4 database failure modes, and compare the statements, binds, logs and results. A planted defect in the compiled output was caught (144 differences).
  - (a) Planted defects: 6 of 7 caught by the watching suites. Removing the soft-delete predicate from the FTS statement passed every unit suite, though the live probe would have caught it. The new `src/tests/services/search.softDelete.p918.test.ts` closes that gap: its expected predicate per table is written by hand, not read from the service. It fails on each of three plants (FTS predicate dropped, ILIKE predicate dropped, certificate predicate changed), 6/6 green without them.
  - (c) The search, D-05, `softDeleteMechanisms.d25`, `dynamicAccessSlugs.a07` and guard suites pass: 25 suites, 195 tests. `search.service.ts` is at 100/100/100/100.
  - (d) Live: the same probe passed 6/6 against the `.ts` module. It ran as the owner on a `db.sync` schema, because the migration chain currently stops at 0002 while the migrations lane is mid-change.
  - `db` goes to `sql()` as `db as unknown as SqlRunner`, as `meteredBilling` and `qms` do. The comment in `search.twoTenants.a56.test.js` that names the file was re-keyed.

### `storage/local.driver` (four gates)

- **The pattern.** `export =` of the class. `fs`, `fs/promises` and `path` are default imports, which bind the same module objects, so the suites that spy on `fsp.*` still intercept every call. `normalizeKey` is captured at load; `signing` is read at call time. The fields are declared in the order the constructor assigns them, so the instance's own keys and their order are unchanged.
- **(b) Identity:** 102 steps on a real filesystem, the original and the `.ts` each in a fresh temporary tree, all identical. They cover construction, puts from buffers and streams, a stream error, nine malformed keys, ranged gets, 410 and 404, `exists`, nine list and limit cases, `delete`, `deleteMany`, six `signedUrl` cases on a frozen clock, and health on a present and a missing root. They also cover a symlink escape through a junction inside the root, which is refused. Planted defects in the compiled output were caught (the symlink check disabled; the truncation flag off by one).
- **(a) Planted defects:** 7 of 9 caught by the watching suites.
  - The `put` result's `normalizeKey(key)` replaced by `String(key)` survived. That is equivalent for every key that gets that far, because `normalizeKey` returns a valid key unchanged.
  - Disabling `handle.sync()` survived: `storage.local.test.js` "fsyncs when configured" checks only the size. The new `src/tests/services/storage.localFsync.p918.test.ts` closes that gap. It watches the file handle (sync then close when fsync is on; close only when off) and fails on the plant.
- **(c) Suites:** every suite naming storage or attachment, plus the guards: 87 suites, 1,527 tests. `local.driver.ts` is at 100/100/100/100 in the storage suites (9 suites, 253 tests).
- **(d) Live:** the driver touches no database, so there is no PostgreSQL check. The live boundary is the filesystem, and the identity run above is on a real one, including a real junction.

### `rabbitmq.service` and `batchJob.service` (released by the lead for `batchJob`)

- **`rabbitmq.service`**
  - **The pattern.** `connect` is a named import of amqplib, read at call time, so `jest.mock("amqplib")` still intercepts it. `redis` is read at call time through its `.d.ts`. The tuning constants are still read once at load and `rabbitUrl()` at each connect, both now through `config/env`. `register` stays a hoisted function declaration. Three un-awaited calls from the `.js` are kept un-awaited, marked `void`: `closeQuietly`, `register` from the retry timer, and `work.then`.
  - **Identity:** 342 checks across 6 environment cases, all identical. The fakes are a scripted broker (connections and channels as EventEmitters), Redis in six modes and manual timers. The comparison covers the full event log (connects, channels, sends, acks and nacks, timers with their delays, every log line), plus W-18 connect sharing, stale-event identity, dedup claims, supervised consumers (cancel, close, failed and closed-during registration, backoff), drain with a hung handler, and the connect timeout. Four planted defects in the compiled output were each caught.
  - **Planted defects:** 11 of 11 caught by the watching suites.
  - **Live:** `rabbitmq.w06.live` passed 4/4 against a real RabbitMQ 4 container that the suite restarts.
  - **Coverage:** 100% in its suites.
- **`batchJob.service`**
  - **The pattern.** `createJob` reaches `registeredTypes` and `runJob` through the export object, as the `.js` did through `exports`, so the suites' `jest.spyOn(service, "runJob")` still intercepts. A planted defect proves it: calling the local `runJob` fails 4 tests.
  - **Identity:** 156 checks across 4 environment cases, all identical. They cover unknown types, queue and inline paths (including the broker being down), every `runJob` branch (no tenant, not found, already done, 5 handler-result shapes, a job that failed itself, a vanished row, a failing heartbeat, a handler error, no handler), both sweeps, `getJobs` paging and `getJobStatus`. Four planted defects in the compiled output were each caught.
  - **Planted defects:** 12 of 12 caught by the watching suites.
  - **Live, PostgreSQL 18:** `batchJob.w07.live` and `backgroundJobs.w12.live` passed 12/12.
  - **Coverage:** 100%.
  - **Unchanged edge:** a claim that counts a row that `findByPk` then cannot see throws a `TypeError`, in the `.js` and the `.ts` alike. It needs the row deleted inside the claiming transaction, so it is not recorded as a defect.
- **`notification.service`**
  - **The swap.** It went in with `socket.d.ts` in place, and the services helper's interim `notification.service.d.ts` was retired in the same swap. That file's `emitNotification` types are kept as the floor. The other six functions are typed now, with `tenantId: TenantId` and `userId: UserId`. These are compile-time brands, not validation: `toUserId` would validate, so it is not used.
  - **Loading.** `../config` is loaded as a side-effect import, because the `.js` destructured an unused `db` from it. The other imports are captured at load; `notificationChannels` is read at call time.
  - **Identity:** 208 checks, all identical. They cover `emitNotification` (5 data shapes, with and without a transaction, and 7 modes: socket down, dispatch failing, no user, empty user email, create failing, a plain created row), `fetchUserNotifications` (6 read filters, 5 page/limit pairs, 3 types, 3 failures), `markAsRead`, `deleteNotification`, `markAllAsRead`, `deleteAll` and `deleteMany`. The comparison covers every model call, including the `Op` where-clauses. Planted defects in the compiled output were caught.
  - **Planted defects:** 11 of 11 caught by the watching suites.
  - **`d24` guard:** its four entries were re-keyed to `notification.service.ts`.
  - **Suites:** 16 suites, 687 tests. The file is at 100%.
  - **Not run live:** notification is not on the four-gate list.
- **`gdpr.service` (four gates; released by the P6-11 lane, whose finished edits are the baseline)**
  - **What was preserved.** The P6-11 work: `auditGdpr`, one audit row per write inside its transaction, and the trailing `actor` parameters. `updateConsent` and `restrictProcessing` still reach `recordConsent`, `withdrawConsent` and `createDsar` through the export object.
  - **Loading.** Every lazy `require` stays lazy, typed through type-only imports: the models barrel, mfa, session, auth, the validator, jwt, emailQueue, activationToken, crypto, and sequelize's `where`/`fn`/`col`. archiver 8 ships no types, so it is required as the `.js` required it, with a declared `ZipArchive` shape.
  - **One unused constant dropped.** `ERASURE_BATCH_SIZE` read an environment variable and was never used. Reading the variable has no effect.
  - **(b) Identity:** 320 checks across 4 environment cases, all identical. The fakes stand in for the database, the audit service and the lazy services; the real archiver, validator, AppError and auditPrincipal run on a real temp filesystem. The checks cover export (7 modes, including the streamed file contents and the tree left on disk), the export sweep (expired, unexpired, no manifest, unparseable expiry, broken manifest, audit failing, unreadable directory), erasure (10 cases), consent, DSAR, preferences and rectification (16 cases, including SSO, re-authentication, a taken address, a unique violation and mail failing). The comparison covers model where-clauses, symbol keys included. Seven planted defects in the compiled output were each caught. One plant in the audit-log predicate needed the symbol-key comparison before it was caught.
  - **(a) Planted defects:** 18 of 22 caught by the watching suites (23 suites, 431 tests).
    - One survivor is the late binding in `updateConsent`. No suite spies on it; the identity harness catches it (72 differences).
    - The other three removed an explicit tenant predicate: the profile read, the consent withdrawal and the consent history. The new `src/tests/services/gdpr.tenantPredicates.p918.test.ts` closes that gap, with hand-written expected predicates. Each plant fails it, and it passes 3/3 without them.
  - **(c) Suites:** the gdpr, dataRetention, auth, controller and guard suites pass, 25 suites, 464 tests. The file is at 100%.
  - **(d) Live, PostgreSQL 18:** 19/19. The schema came from the real migration chain, and every query ran as `callibrator_app`, with tenants A and B. The checks:
    - consent grant and withdrawal isolated by tenant;
    - the history and DSAR are unreadable from B;
    - no IP address or free-text reason appears in an audit row;
    - B exporting or erasing A's subject is a 404 and changes nothing;
    - the pseudonymised account;
    - the erasure audited with its requester;
    - the export sweep purges and audits in the export's own tenant.

    Container `p9svc-gdpr-pg18` has been removed.
  - **Guards re-keyed:** `d24` (two entries) and `auditInTransaction.p611` (the sweep's reviewed exception).
  - **Finding A-333, then fixed as its own change (2026-10-01, at the coordinator's request).** The compiler exposed that `privacyPreferences` is not a `User` attribute: `updatePrivacyPreferences` stored nothing while auditing a change, and `getPrivacyPreferences` always answered `{}`.
    - **Decision: removed.** The privacy doc names no such store, nothing called either function, and the consent records already carry each choice with its history. The remediation row gives the reasoning.
    - **Fail-before test:** `gdpr.privacyPreferences.a333.test.ts`, 1/3 failing before the change and 3/3 after.
    - **Tests removed with the functions:** their unit tests in `gdpr.service.test.js` and the key-only P6-11 test in `gdpr.newmethods.test.js`.
    - **Concurrent edit:** another lane (D-21/Q-55, `decimalsAsNumbers`) is editing `gdpr.service.ts` uncommitted at the same time. Both changes are in the working copy; the gdpr suites pass with both, 26 suites, 442 tests.
- **`storage/s3.driver` (four gates; the SSRF lane, A-176/A-307, is finished with it)**
  - **The pattern.** `export =` of the class. The AWS SDK classes and `getSignedUrl` are named imports; the SDK ships its own types. They are read through the module at call time, where the `.js` destructured them at load. That is the same accepted difference as `amqplib.connect` in `health`, and it is invisible unless a module's exports are mutated after load. `AppError`, `normalizeKey` and the SSRF guards are captured at load. The A-176 rule is unchanged.
  - **(b) Identity:** 88 checks, all identical. The fake SDK records each client config, with the request handler's agent classes, and each command's input. The real `keys` and `ssrf.util` are used. The checks cover:
    - 14 construction cases, including a tenant endpoint on 127.0.0.1 or 169.254.169.254, a 10.x address marked untrusted, a trusted operator endpoint, an invalid URL and a numeric prefix;
    - every operation, with and without a prefix;
    - four "not found" error shapes;
    - list paging with empty tokens;
    - deleteMany across pages;
    - presigned URLs.

    Four planted defects in the compiled output were each caught, among them the SSRF check skipped and the pinned agents dropped.
  - **(a) Planted defects:** 9 of 11 caught. The two survivors were a key sent without `normalizeKey` (traversal or empty keys reach the bucket) and a no-prefix list that dropped the configured bucket prefix. Either would let one store address another's objects in a shared bucket. The new `src/tests/services/storage.s3Keys.p918.test.ts` closes both: each plant fails it, and it passes 8/8 without them.
  - **(c) Suites:** the storage, SSRF (a176), storageSettings and storageMigration suites pass, 11 suites, 274 tests. `s3.driver.ts` is at 100%.
  - **(d) Live: not run.** The driver touches no database. Its live boundary is an S3 endpoint, and no MinIO image could be pulled on this workstation: `minio/minio` (latest, and the compose file's pinned `RELEASE.2024-11-07T00-52-20Z`) returned "pull access denied", and quay.io returned 401. The SSRF refusals in the identity run are the real `ssrf.util`. **The S3 path still needs a live check against MinIO** (it was already "pending live MinIO verification").
- **`storage/index` (the storage façade; four gates)**
  - **The pattern.** `export =` of the original object, `ScopedStorage` included, keys in the same order. A local `StorageDriver` interface types what the façade calls on either driver. The signing secret is still read once at load; the cache TTL and `PUBLIC_BASE_URL` at each call, through `config/env`.
  - **(b) Identity:** 389 checks across 4 environment cases, all identical. Fake drivers, config and Redis; the real `keys` and `signing`. They cover:
    - resolve, caching, TTL expiry, a changed generation, Redis down;
    - tenant S3 and NFS overrides, an invalid stored config;
    - global storage, probes and invalidation;
    - every scoped operation on the tenant's own key, another tenant's key, a traversal key and an empty key;
    - usage with missing, gone and failing objects;
    - signed objects (the real HMAC), a token reused for another key, and a bad token.

    Three planted defects in the compiled output were each caught: the tenant guard bypassed, the generation ignored, and the tenant taken from the request.
  - **(a) Planted defects:** 12 of 13 caught by the storage, attachment-sweep, controller and settings suites. The survivor cached a probe driver as the platform driver. The new `src/tests/services/storage.probeNotCached.p918.test.ts` closes it: 2/2 fail on the plant and pass without it.
  - **(c) Suites:** 12 suites, 279 tests. `index.ts` is at 100%.
  - **(d) Live, PostgreSQL 18 as `callibrator_app`:** 12/12 with the real config.service, keys, signing and local driver on a real filesystem, with tenants A and B. A cannot get, stat, delete, overwrite or sign B's key; list, usage and deleteMany stay in A's namespace; a signed link opens only its own key; a ranged open works.
  - **Noted, not changed:** a key of another tenant is refused with **403** at this layer (`keys.assertKeyForTenant`). The keys are built server-side and the signed-object route derives the tenant from the key, so no request reaches it with a guessed id. The 404 rule applies at the route.
- **`storageSettings.service` (four gates)**
  - **(b) Identity:** 54 checks, all identical, with two compiled plants each caught. The first harness run passed nothing to the functions, so all 54 checks compared identical errors. It was caught because the plants did not bite, and fixed before any result was used.
  - **(a) Planted defects:** 7 of 8 caught. The survivor dropped the actor from the save, which makes a storage-credential change unattributable. The new `src/tests/services/storageSettings.actor.p918.test.ts` closes it, covering both save and clear.
  - **(c) Suites:** 100%.
  - **(d) Live, on the same PostgreSQL 18 run:** 9 more checks, 21/21 in total.
    - A saves an NFS override after its health check, and B stays on the default.
    - A's storage switches to NFS at once, because the cache is invalidated.
    - A's object and usage come from A's root.
    - A root that fails its health check is refused with 422 and not saved.
    - The save is audited in A, naming A's admin.
    - A clear reverts A to the platform default.
- **`storageMigration.service` (four gates)**
  - **(b) Identity:** 24 checks on a real filesystem, all identical, covering path refusal (S-15), checksum refusal, copy verification, cleanup, dry run, tenant and limit filters. Three compiled plants were each caught.
  - **(a) Planted defects:** 10 of 11 caught. The survivor copied every row into one fixed tenant's storage; the suite's storage double ignores the tenant. The new `src/tests/services/storageMigration.tenant.p918.test.ts` closes it.
  - **(c) Suites:** 100%. The `d24` entry was re-keyed.
  - **(d) Live, PostgreSQL 18 as `callibrator_app`:** 13/13.
    - A run for A migrates only A's row, and A's context asking for B's rows sees none.
    - B's row with no checksum is verified against its source file; a row whose file no longer matches its checksum is refused; a `../` folder is refused.
    - Each key sits in its own tenant's namespace, the copies match, and the legacy files stay.
    - A re-run is idempotent.
    - As built, a dry run checks paths, not checksums.
- **`attachmentFileSweep.service` (four gates)**
  - **The pattern.** `resolveAbsPath` comes through `attachment.service.d.ts`. It was `Untyped` there; this first TypeScript caller types it, as that file's header asks. It is destructured at load, as the `.js` did. The environment is read at each call through `config/env`.
  - **(b) Identity:** 32 checks across 4 environment cases, all identical. Fake models, transaction, audit and storage; a real filesystem. The checks cover removed, absent, outside-uploads, unlink-refused (a directory), storage-object delete and storage failure, audit failure (rollback), the retention floor and fractional or negative values, batch and budget paging across 4 tenants with keysets, and the default clock. Four compiled plants were each caught.
  - **(a) Planted defects:** 13 of 13 caught.
  - **(c) Suites:** 100%. `d24` re-keyed: the paged `sweepBatch` entry, value unchanged, guard 8/8.
  - **(d) Live, PostgreSQL 18:** the repository's `dataLayer.dbD.live` suite passed 6/6 against the `.ts` module, as `callibrator_app` on a schema booted from sync plus every migration. It covers the expired file removed, the row marked, a system-actor audit row passing 0033's CHECK, and a live row, an in-window row and another tenant's live row keeping their files.
  - **Comments re-keyed** to the `.ts` name in `systemActors.ts`, `attachmentFileSweepScheduler.middleware.js` and migration 0088. Comment-only.
- **`predictiveMaintenance.service`**
  - **The pattern.** `export =` of the ONE instance; its two methods stay on the class prototype.
  - **Identity:** 160 checks, all identical. They cover the 10 reading and anomaly mixes across 5 device states and 3 actors (none, a user, an API key), no device, the audit failing (rollback), and approval in every state. Three compiled plants were each caught.
  - **Planted defects:** 8 of 10 caught. The two survivors were the tenant dropped from the anomaly count (the total count kept it), and the API key's id dropped from the audit changes (A-282). The new `src/tests/services/predictiveMaintenance.scope.p918.test.ts` closes both, each plant failing it.
  - **Suites:** the route, controller, two-tenant, A-145, A-190 and guard suites pass, 27 suites, 302 tests. The file is at 100%.
- **`dashboard.service`**
  - **The pattern.** The models are read through a narrow local `AggregateModel` surface (count, sum, findAll, findByPk, and the two properties `monthlyTrend` reads). The service aggregates over ten models generically. `runBounded` is generic over its task type.
  - **Identity:** 32 checks, all identical. They cover 7 modes (timezones +07:00, -05:30, UTC, none, a null sum and no tenant, no tenants, a failing count) × 4 tenant arguments, recording every model call with its symbol-keyed where-clause. `runBounded` is checked at 4 limits for start order, failure and empty. Four compiled plants were each caught.
  - **Planted defects:** 7 of 10 caught.
    - Two closed by the new `src/tests/services/dashboard.pins.p918.test.ts`: `runBounded` stops starting tasks after a failure (its documented contract, P8-04), and "due soon"/"overdue" count active devices only.
    - The third survivor, the null-tenant group counted into the breakdown map, is an equivalent mutant. The map is read only for the listed tenants' ids, so the answer cannot change.
  - **Suites:** 100%. `d24` re-keyed: five dashboard entries, values unchanged.
- **`ai.service` (raw SQL and SSRF, so held to the four gates): the SQL move first, then the conversion**
  - **Step 1, its own change on the `.js`: the RAG store's two statements move to `sql()`.**
    - The chunk INSERT and the similarity SELECT, with binds unchanged. The INSERT's result was never read, so `type: "SELECT"` changes nothing it returns.
    - Fail-before test: `src/tests/services/ai.sqlBind.p918.test.ts` failed 1 of 2 before the change (the INSERT carried no `type`) and passes after.
    - **D-05 taught one rule:** a helper INSERT has no predicate, and its tenant is the value it writes. `insertBindsTenant` accepts an INSERT only when its column list names `tenant_id` and that position's value is a bound `$n` (optionally cast). A new bite test in `rawSqlTenantPredicate.d05.test.js` shows a literal or missing tenant column is still flagged. The guard passes 7/7.
    - All ai suites still pass, 146 tests.
    - Live on PostgreSQL 18 + pgvector as `callibrator_app`, two tenants: 9/9 on the pre-change copy and on the changed file. The checks cover each tenant's chunks stored under its own tenant, A's retrieval never returning B's chunk, quotes stored as data, re-ingest replacing, the AZ-02 source-type filter, and an unknown tenant retrieving nothing.
  - **Step 2, the conversion.**
    - **The pattern.** `export =` of the ONE instance, with internal calls through `this`, so replacing `generateEmbedding` on the instance still intercepts; the harness checks this. `../config` and the models barrel stay lazy where they were. The OpenAI fallbacks are read at each call through `config/env`. `ingestDocument`'s return type is a named interface: a `{` in a return type hides the method from the P6-11 audit-coverage scanner. That is reported to the lead as a guard gap, because a mutation in a hidden method is attributed to the method above it.
    - **(b) Identity:** 164 checks across 2 environment cases, all identical. They cover config resolution, OCR, embedding, query and ingest across 5 settings shapes (including a tenant URL on 169.254.169.254), vendor failures and bad response shapes, invalid ingests, retrieval limits, chunking edge cases, vendor options for operator and tenant URLs (the real `ssrf.util`), and `this` binding. Three compiled plants were each caught.
    - **(a) Planted defects:** 10 of 11 caught. The survivor replaced the RAG grounding instruction with a generic prompt. The new `src/tests/services/ai.grounding.p918.test.ts` closes it.
    - **(c) Suites:** 100%. `d24` was re-keyed and the P6-11 audit-coverage guard passes 11/11.
    - **(d) Live:** the same probe passed 9/9 against the `.ts` module. Container `p9svc-ai-pg18` has been removed.
- **`webhook.service` (four gates): the claim's SQL move first, then the conversion**
  - **Step 1, its own change on the `.js`: the delivery claim moves to `sql()`.**
    - Binds: `$1` lease seconds, `$2` limit, and for one delivery `$3` id and `$4` tenant (bound). No `replacements`. `type: "SELECT"` answers the RETURNING rows directly.
    - Fail-before test: `src/tests/services/webhook.claimBind.p918.test.ts` failed 2/2 before the change.
    - Test doubles updated for the new call shape (bind instead of replacements, rows instead of `[rows]`): `webhook.service.test.js`, `webhook.delivery.a10.test.js`, `webhook.secret.a51.test.js`, `webhook.rebinding.a307.test.ts`, `scheduledJobs.w17.test.js` and `routes/webhooks.twoTenant.test.js`.
    - Live: `webhook.durable.a10.live` passed 6/6 on PostgreSQL 18 with the pre-change `.js` and again with the changed `.js`.
  - **Step 2, the conversion.**
    - **The pattern.** `export =` of the eighteen keys in order. It replaces the interim `webhook.service.d.ts` and keeps its `emitEvent`/`emitAfterCommit` types as the floor. `emitAfterCommit` still returns the emit's promise to `afterCommit`, because Sequelize awaits each hook (`transaction.js`: `await hook.apply(...)`); wrapping it in `void` would have changed when `commit()` resolves.
    - **(b) Identity:** 213 checks across 3 environment cases, all identical. They cover the CRUD paths (SSRF refusals, empty events, a caller's `secret` ignored, url change rotating, an overlap window), rotation with 5 overlap values, emit under 9 delivery outcomes (success, 500, 302, abort, network error, rebinding, no match, many, find failing), the W-17 cap, `emitAfterCommit`'s three shapes, `dispatchDue` with exhausted, deleted, test and missing rows, the test webhook, and the helpers. Five compiled plants were each caught.
    - **(a) Planted defects:** 11 of 16 caught at first.
      - Two survivors were ineffective or equivalent. The first A-51 plant never took effect; a corrected one is caught by the A-51 suite and the new test. Adding the secret to the rotation's audit changes is stripped by audit.service's redaction before it reaches the sink.
      - Three were real gaps: the registration SSRF check, the explicit tenant predicate on the webhook lookup, and the resolved-host backstop before a delivery. The new `src/tests/services/webhook.guards.p918.test.ts` closes all three, each plant failing it.
    - **(c) Suites:** 42 suites, 496 tests, plus the two-tenant and declaration-drift guards. The file is at 100%. Re-keyed: `d24`, and the comment-only references in the two webhook models.
    - **(d) Live, PostgreSQL 18:** `webhook.durable.a10.live` 6/6 and `0090-…p613.live` 6/6 against the `.ts` module. Container `p9svc-wh-pg18` has been removed.
- **`ticket.service` (four gates, keeping A-318/A-320/A-277): the counter's SQL move first, then the conversion**
  - **Step 1, its own change on the `.js`: the per-tenant counter upsert moves to `sql()`.**
    - The tenant is bound as `$1`, in the create's transaction. `type: "SELECT"` answers the RETURNING row directly.
    - Fail-before test: `src/tests/services/ticket.counterBind.p918.test.ts` failed before the change. It now also asserts that the tenant column's value is the bound `$1`.
    - Doubles updated for the rows-not-`[rows]` shape: `ticket.service.test.js` and the counter branch in `routes/auditCoverage.p611`, `routes/tenantMembers.a277` and `routes/ticket.descriptionSanitize.a318`.
    - Live on PostgreSQL 18 as `callibrator_app`, two tenants: 6/6 on the pre-change copy and on the changed file. Five concurrent creates in A take TKT-1…TKT-5 with no collision, B numbers independently, there is one counter row per tenant, each create is audited in its own tenant, and B cannot open A's ticket (404).
  - **Step 2, the conversion.**
    - **The pattern.** `export =` of the keys in order (`ASSIGNEE_NOT_FOUND` first). createTicket/updateTicket reach `getTicket`, and assignTicket reaches `updateTicket`, through the export object. The identity harness checks this, and a plant that bypasses it is caught.
    - **A D-05 blind spot found and avoided.** The scan reads a helper call only when its runner is a plain identifier, so `sql(sequelize as unknown as SqlRunner, …)` was invisible to it. The module now uses a `dbRunner` constant, and no other `sql()` call in `src/` has a non-identifier runner.
    - **(b) Identity:** 221 checks, all identical. They cover 7 principals (requester, stranger, responder, both super-admin spellings, API key, no role), each across list filters (A-320 ILIKE), get, create (A-318 sanitizing, a missing assignee, the audit failing), 9 updates, assign, delete, both comment kinds and metrics. Late binding and the helpers are checked too. Three compiled plants were each caught.
    - **(a) Planted defects:** 13 of 16 caught on the first run, and all 16 after fixes. The A-320 plant is caught by `routes/search.caseInsensitive.a320` (it was not in the first suite list). The A-277 plant first did not apply (wrong text); corrected, it is caught by `routes/tenantMembers.a277`. The counter-literal plant is caught by D-05 (now that the call is visible) and by the tightened counter test.
    - **(c) Suites:** 11 suites, 222 tests. The file is at 100%. Re-keyed: `d24`, `d17`, the seven `routeGateExemptions.ts` service checks, and comment references in `ticketCounter.model.ts` and `menuPageAccess.ts`.
    - **(d) Live:** the same probe passed 6/6 against the `.ts` module. Container `p9svc-tkt-pg18` has been removed.
- **`kanban.service` (four gates, keeping A-277, D-22, P6-11 and P8-04): the card number's SQL move first, then the conversion (2026-10-01)**
  - **Step 1, its own change on the `.js`: the per-project `card_seq` bump moves to `sql()`.**
    - The project is bound as `$1` and its tenant as `$2` (`tenant_id = $2`, D-05), in the card's transaction. `type: "SELECT"` answers the RETURNING rows directly, and a statement that updates no row is still a 404.
    - Fail-before test: `src/tests/services/kanban.cardSeqBind.p918.test.ts` failed before the change.
    - Doubles updated for the rows-not-`[rows]` shape and `bind`: `kanban.service.test.js`, `routes/kanban.twoTenant.test.ts`, and the card_seq branch in `routes/auditCoverage.p611` and `routes/tenantMembers.a277`.
    - Live on PostgreSQL 18 as `callibrator_app`, two tenants (`live-kanban.js`): 6/6 on the pre-change copy and on the changed file. Four concurrent creates in A take ALP-1…ALP-4, B numbers BRV-1, BRV-2 on its own project, each project's `card_seq` counts only its cards, B creating a card on A's project is a 404 that bumps nothing, and each card is audited in its own tenant.
  - **Step 2, the conversion.**
    - **The pattern.** `export =` of the 34 keys in the `.js`'s order (`assertAccess`, `USER_NOT_IN_TENANT` first; `_resolveAccess`, `_serializeCard`, `_loadCard`, `notifyCardActivity` last). Every write that answers a board reaches `getProject` through the export object, as the `.js` did through `exports`; `getProject` reaches `assertAccess` directly, as before. `attachment.service` stays a lazy require at call time. The unused `logger` destructure becomes a side-effect import of `activityLog.middleware`, so the load order is unchanged. `sql()` goes through a module-level `dbRunner`, so D-05 reads the call.
    - **D-17 note.** A `whereOf()` wrapper on the membership and reorder `where`s hid their parent keys from `unscopedModels.d17`; both are plain object literals again.
    - **(b) Identity:** 823 checks against the post-move `.js`, all identical. They cover 7 principals (super admin, creator, editor member, role-granted viewer, stranger, another tenant's user, API key), each across every export: access at every level, list, create (members, audit failing), get by every sprint selector, project update and delete (keyset paging over 500 cards), members (A-277, last owner), columns (Done kept last), cards (sprint resolution, key prefixes, a missed `card_seq`, A-277 assignees, a project stored under another tenant), move, delete (D-22), labels, sprints, migrate, relations and metrics. Late binding and the helpers are checked too. 16 compiled plants were each caught, after three harness gaps (a project tenant differing from the caller's, a NaN count, a due date at exactly now) were closed.
    - **(a) Planted defects:** 11 of 14 caught at first. Three were real gaps no suite watched: the explicit tenant predicate on the project lookup (a super admin's context skips the hooks), a no-access caller answered 403 instead of 404, and `moveCard` finding a card outside the project in the path. The new `src/tests/services/kanban.accessGuards.p918.test.ts` closes all three; each plant fails it.
    - **(c) Suites:** 16 suites, 371 tests, including the D-05, D-17, D-24, P6-04, P6-11 and two-tenant guards. The file is at 100%. Re-keyed: `d24`, `d17`, the D-05 sanity entry, the `routeGateExemptions.ts` service checks, and line 2 of `kanban.service.test.js`. Not re-keyed: a mention in `scripts/generate-illustrations.js`.
    - **(d) Live:** the same probe passed 6/6 against the `.ts` module. Container `p9svc-kb-pg18` has been removed.
  - **Step 3, the controller and route (P9-18 under the P9-20/21 and P9-25 rules).**
    - **`kanban.controller.ts`:** the 28 handlers, in order, under `export =`. Each passes `req.user`, the path parameters, the body and `auditPrincipal(req)` to the service as the `.js` did. The casts are typing only: `Arg<"method", n>` is the service parameter's own type. The service is read through its module object at call time; `asyncHandler`, `success` and `auditPrincipal` are captured at load, as the `.js` destructured them. The only service change is a typing one: `getProject`/`getMetrics` `options.sprintId` is widened to `| undefined`.
    - **Controller identity (p920 `ctrl.js`, its own copy in `p9svc/rt`):** 2,646 handler runs (28 handlers × 6 principals × samples × 7 service outcomes), 13,232 checks, all identical. Six compiled plants were each caught: a message, a status, a query key, a path parameter, the body's `order`, and the audit principal.
    - **`kanban.route.ts`:** every route and middleware in the same order. There is no menu gate, as before: the board is gated per project in the service, and `routeGateExemptions.ts` records why. Route table (`routecmp.js`): 29 layers and 86 handlers identical, 85 of them factory-made with arguments compared, and 948 exported functions wrapped with no module left unwrapped. Module text (`modcmp.js`): identical. Four route plants (a validator, a `validateUuid` name, a handler, `router.use`) were each caught by both harnesses.
    - **`kanban.openapi.ts`:** 28 operations. Each is `permission: authenticated`, with the reason (per-project access in `assertAccess`; no access is a 404, never 403). The bodies are the contract's own schemas (`validators/kanban.validator` → `@callibrator/contracts/kanban`). The response schemas are in the file, with synthetic examples. The `@swagger` blocks are gone.
      - `openapi:generate`: 443 operations, 342 code-first. `openapi:check` is current. `openapi:lint` has no new error.
      - The frontend `api:types` was regenerated, and the frontend typecheck is clean.
      - **Lists shrunk:** `openapiRoutes.undocumented.json` from 60 to 35 (25 kanban lines), and `swaggerValidatorAlignment.knownDrift.json` from 21 to 5 (16 kanban entries). No kanban Spectral baseline entry existed.
    - **Re-keyed:** `routeGateExemptions.ts` (`api/kanban.route.ts`), the 26 `@two-tenant` markers in `kanban.twoTenant.test.ts`, the require in `kanban.route.test.js`, and a comment in the frontend kanban page test.
    - **Gates:** `openapiRoutes.p925`, `swaggerValidatorAlignment.p608`, `routePermissionGuard.p604`, `twoTenantRoutes`, `apiKeyAuditPrincipal.a282` and the kanban, auditCoverage and A-277 suites all pass (12 suites, 359 tests). `load:check --src` is OK, and the ratchet floor dropped from 758 to 756. `build:dist` and the dist `load:check` were blocked by another lane's mid-swap `rateLimiter.redis.service`.
    - **Not mine, seen on the same run (2026-10-01):** `auditCoverage.p611` lists three `mfa.service` entries as stale, the typecheck fails in `ownSessions.createdAt.a339.test.ts`, the ratchet fails on two `zzp919*.dynamicAccess.middleware.js` scratch files, and `declarationDrift.p912` failed earlier on an untracked `redis.service.ts`. All are other lanes' work in progress.
- **Platform controllers and routes, with code-first contracts (P9-18 under the P9-20/21 and P9-25 rules, 2026-10-01).**
  - **Method, for each module:**
    - The controller is converted by hand, or by `rt/gen_ctrl.py` for the plain `asyncHandler` + `success` shape. The route is converted by `rt/gen_route.py`, which strips the `@swagger` blocks and maps each require to an import.
    - **Controller identity:** p920's `ctrl.js` (copied to `p9svc/rt`), with every handler × 6 principals × samples × service outcomes. It compares the result, every `res.*` call, every `next`, every fake call and the request after.
    - **Route identity:** `routecmp.js` (the mounted table, every gate factory and its arguments, about 948 wrapped exports) and `modcmp.js` (the module text, printed by esbuild).
    - **Bites:** each harness is bitten with planted changes (`cbite.sh`, `rbite.sh`).
    - **Afterwards:** `rekey.py` re-keys every `<name>.route.js` and `<name>.controller.js` reference (requires lose the extension; scanners, markers and comments take `.ts`), and `shrink.py` drops the mount's lines from the two shrink-only lists. Then `openapi:generate`, `openapi:lint`, the frontend `api:types`, and the module's suites plus the p925, p608, p604, two-tenant and a282 guards.
  - **Results:**

    | Module | Controller identity | Plants caught | Route table / module text | Suites + guards |
    |---|---|---|---|---|
    | dashboard | 842/842 | 4/4 | identical / identical; 2/2 route plants | 9 suites, 77 tests |
    | search | 1,052/1,052 | 5/6 (see below) | identical / identical; 2/2 | 14 suites, 117 tests |
    | tickets | 3,572/3,572 | 5/5 | identical / identical; 2/2 | 11 suites, 220 tests |
    | ai | 1,262/1,262 | 4/4 | identical / identical; 2/2 | 17 suites, 246 tests |
    | predictiveMaintenance | 842/842 | 5/5 | identical / identical; 1/1 | 14 suites, 149 tests |
    | batchJobs | 1,682/1,682 | 4/4 | identical / identical; 1/1 | 9 suites, 98 tests (+4 skipped) |
    | reports | 1,622/1,622 | 5/5 | identical / identical; 1/1 | 9 suites, 96 tests |

    | audit | 1,202/1,202 | 5/5 (one after a harness gap: no sample reached the platform scope) | identical / identical; 1/1 | 9 suites, 148 tests |
    | webhooks | 2,522/2,522 | 5/5 | identical / identical; 3/3 | 22 suites, 261 tests |
    | notifications | 2,162/2,162 | 5/5 (one after adding an empty-`type` sample) | identical (1 inline gate by source) / identical; 2/2 | 15 suites, 214 tests |
    | content | 3,572/3,572 | 4/4 | identical / identical; 2/2 | 20 suites, 311 tests |
    | attachments | 2,522/2,522 | 5/5 | identical / identical; 3/3 | 27 suites, 411 tests |
    | iot | 3,602/3,602 | 6/6 (the ingest `where` is recorded) | identical / identical; 3/3 | 18 suites, 317 tests |
    | storage | 2,943/2,943 | 7/7 | identical / identical; 1/1 | 24 suites, 380 tests |
    | gdpr | 2,312/2,312 | 5/5 | identical / identical; 2/2 | 26 suites, 266 tests |
    | menuGroups | 4,862/4,862 | 4/4 (one after a valid create sample) | identical (3 inline gates by source) / identical; 2/2 | 16 suites, 341 tests |
    | internal/health | 362/362 | 5/5 | identical (`routecmp2`: 4 exports, 6 layers) ; 4/4 | 14 suites, 125 tests |
    | internal/migration | 1,052/1,052 | 2/2 | identical (`routecmp2`, 3 gates by source with the `env("X")` and `_req` rewrites); 4/4 | 12 suites, 107 tests |

  - **The last four were prioritised for the services helper's `index.ts` swap.** gdpr, menuGroups, internal health and internal migration landed in that order, and the helper (acdeaeffc1ddaed5d) was told. No `.js` is left under `src/routes` or `src/controllers`. `openapi.json` is now **448 of 448 operations code-first**.
  - **Harnesses added for this round (scratch `p9svc/rt`).**
    - **`routecmp2.js`:** a route module that exports an object (health: two routers, `forceHttps` and `PROBE_PATHS`). Each router is compared as a table, and every other export by printed source or deep value, frozenness included. Two sanctioned rewrites apply to the converted side only: `env("X")` is `process.env.X`, and an unused `_req` is `req`.
    - **`modcmp.js`:** gained `MODCMP_NS`. A validator namespace the `.js` held (`v.createProject`) is now a named import, so the qualifier is stripped from the original before the comparison.
    - **`cbite-tsx.sh`:** runs the controller harness under tsx, because the validators re-export the contracts' TypeScript source.
  - **Coverage: the routes and controllers gates.**
    - The first full run (856 suites passed) failed `./src/routes/` at 85.1% branches and `./src/controllers/` at 99.9%.
    - **The cause** is Babel's `import * as X` interop helper: its never-taken branch is counted in the importing file.
    - **My files were fixed:** named imports in kanban, tickets and content (routes and contracts), gdpr and menuGroups (contracts), and `menuGroup.controller`. The doc `override` functions in storage, webhooks and gdpr were made branchless. Re-verified: route tables and module texts identical, the menuGroup harness identical with a plant caught, and `openapi:check` current.
    - **Not mine, and the same cause:** `admin.route.ts`, `auth.route.ts`, `session.route.ts`, `tenantBackup.route.ts` and `webauthn.route.ts` (the P9-20/21 lane).
  - **Two doc gaps fixed so P6-08 agrees with the validators:**
    - The webhook bodies leave out the refused `secret` key (an `override` on a `.meta()` clone).
    - The storage settings body lists its per-provider union's keys at the top, beside the `oneOf`. That closes the last `knownDrift` entry (21 → 0).
    - In the gdpr erasure body, `confirm` (booleanish piped into `true`) is marked required.
  - **Spectral:** the attachments `orphans` 403 baseline entry is fixed and was deleted from the baseline. Five schema ids and nine operationIds were renamed to avoid collisions with other modules.
  - **(d) Live over HTTP — `rt/live-platform.js`.** The 19 converted routers were mounted at index.ts's mounts with the real auth chain, on a disposable PostgreSQL 18 as `callibrator_app`, with two tenants and a technician, each signing in through the real `/auth/login`. **47/47 checks passed**:
    - Cross-tenant 404s, identical to a missing id: kanban, tickets, webhooks, attachments and gdpr. B's attempts bumped no card number.
    - Refusals: webhooks, storage settings and iot tokens refuse a technician; the attachment orphan report refuses a technician; menu-groups refuses another role's menu (and its admin view refuses a tenant admin); a technician's tenant notification broadcast is refused (A-251).
    - Platform routes: the platform audit scope, health detail and migration `/down` all refuse a tenant admin.
    - Bad tokens: storage objects and signed attachments refuse a bad token, and IoT ingest without a token or with an unknown one is 401.
    - Webhook protections: an SSRF metadata target is refused, and a caller-supplied secret is refused.
    - Other behaviours: ticket descriptions are sanitized; another member reading an erasure request gets 404 (A-252); AI with no provider is a 409 naming the setting (A-281); the card create is in A's audit trail.
    - The reads all answer 200.
    - Container `p9svc-rt-pg18` has been removed.
  - **Builds:** `build:dist` (599 TypeScript files) and `load:check` in both modes are OK; ratchet 699, at the floor; frontend typecheck clean after `api:types`.
  - **Follow-ups (2026-10-02, the coordinator's decisions).**
    - **A-343 closed as designed.** A report is a single document, not a list; the coordinator clarifies CLAUDE.md's envelope rule as applying to list endpoints.
    - **A-342 fixed as its own change.**
      - **Backend:** `GET /api/v1/jobs` now answers the jobs in `data` and `{ total, page, limit, totalPages }` in a top-level `meta` (`batchJob.controller#getJobs`; the service is unchanged).
      - **Frontend:** `batchJob.service#getAll` reads the rows and pagination there (the page reads the service, unchanged).
      - **Fail-before:** `backend/src/tests/controllers/batchJob.envelope.a342.test.ts` and `frontend/src/api/services/batchJob.envelope.a342.test.ts` each failed 1/1 before and pass after.
      - **Fixtures re-pinned to the new shape:** `batchJob.service.test.ts` and the batch-jobs page test (18/18 frontend; 56 backend batch-job tests).
      - **Contract:** `batchJobs.openapi.ts` documents a `list`, and `openapi.json` and the frontend api types were regenerated.
    - **Undocumented routes: 30 → 0.** The 30 entries were the second mounts of two routers: the menu-group router at `/api/v1/menu-group-roles` and the OIDC provider at the issuer root `/oidc`.
      - `RouteDocs` gained `alsoMountedAt: [{ mount, operationIdSuffix }]` (`src/docs/openapi/operation.ts`). `toPathItems` publishes every operation at each mount as the same contract, with a suffixed operationId and `x-alias-of` naming the primary path.
      - `menuGroups.openapi.ts` and `oidc.openapi.ts` use it.
      - New test: `src/tests/docs/routeDocs.alsoMountedAt.p918.test.ts` (3/3).
      - `openapi.json` is now **478 operations, all code-first**, and the p925 and p608 guards are green.
    - **Spectral baseline: 2 → 1.**
      - The unreferenced `PaginatedResponse` component (it documented a `pagination` object the envelope never had) was deleted from `src/docs/components.ts`, which the services helper had just converted (they were told).
      - **The last entry, then fixed at the coordinator's request (2026-10-02).** `GET /tenant-hierarchy/:tenantId/children` and `POST /:parentId/children` were equivalent paths with different parameter names. The POST's parameter is now `:tenantId` (the parent), so **the Spectral baseline is empty**.
        - **Code:** `tenantHierarchy.route.ts` uses `validateUuid("tenantId")`. `tenantHierarchy.controller#addChildTenant` reads `const { tenantId: parentId } = req.params`, so the service call is unchanged. `tenantHierarchy.openapi.ts` follows: `path: "/:tenantId/children"`, with the parameter described as the parent.
        - **Route table:** against the P9-21 snapshot, it differs in exactly that one layer (path `/:tenantId/children`, `validateUuid` argument `tenantId`). Every other layer and handler is identical.
        - **Tests re-keyed:**
          - the `@two-tenant` pin in `twoTenantRoutes.guard`;
          - `tenantHierarchy.guards` (the platform-operation list);
          - the A-187 suite's describe and header;
          - `tenantHierarchy.controller.test` and `bodyless.a09` (`req.params.tenantId`);
          - the e2e module test's title;
          - the live smoke's `paramValue`, which keeps tenant B for this POST, the tenant `:parentId` used to get.
          - `routeGatePins.p921` does not name this route.
        - **Suites:** 19 suites, 269 tests, including A-187, two-tenant, p604, p925, p608 and a282. `load:check --src` is OK.
        - **Frontend:** it calls the URL with its own variable, so nothing changed beyond comments. Types regenerated, typecheck clean, 28 tenant-hierarchy tests pass.
        - **Docs amended** (a naming fact, recorded here): `docs/API/04-TENANT-API.md`, `docs/MULTI-TENANCY/01`, `07` and `08`, `docs/BACKEND/10-MODULE-REFERENCE.md`, `docs/UI-UX/research/03-personas-and-flows.md`, and the contracts comment.
        - `openapi:lint`: 0 baselined errors.
    - **The services helper** (acdeaeffc1ddaed5d) was told that no JSDoc route remains. It has removed swagger-jsdoc, `components.js` and `tags.js`, and its builder now refuses a `@swagger` tag line. That refusal caught a leftover tags-only block in `content.route.ts`, which it replaced with a note.
  - **search:** the one surviving plant (`.filter(Boolean)` → `.filter(x => x !== "bogus")`) is equivalent: an empty or unknown type has no menu, and `permittedTypes` drops it either way.
  - **Typing-only service edits:** `search.service#search` takes `q?: string | null | undefined`.
  - **Accepted differences:**
    - **Load order.** In `batchJobs` and `reports`, the controller is now imported before the gates are built, because imports are hoisted. Building a gate has no effect beyond its closure.
    - **The search gate.** `search.route.ts` takes `SEARCH_MENUS` as a named import of the service's `export =` object. It is read at load, as the `.js` destructure was.
  - **Contracts:** each `<name>.openapi.ts` names the validators' own schemas where the route validates. A body the route does not validate is described inline and marked so (ai, batchJobs). Response schemas use synthetic examples.
    - **Permissions:** dashboard is `home` read; search is OR over `calibration`, `warehouse` and `certificate`; ai is `certificate` write and `sop` read; predictiveMaintenance is `calibration` write/read; batchJobs is `batch-jobs` read/write; reports is `reports` read. Tickets is `authenticated`, because ticket.service scopes every call.
    - **Spectral:** two schema ids and the reports operationIds were renamed to avoid collisions with the stock module (`InventoryStockReport`, `ReportComplianceSummary`, `getReports*`).
    - **Final counts:** `openapi.json` has 448 operations, 365 code-first, with no new Spectral error.
  - **Lists:** `openapiRoutes.undocumented.json` lost the 5 ticket lines, and `knownDrift` lost the 4 ticket entries. A first `shrink.py` run was a no-op, because Git Bash rewrote the `/api/v1/...` argument into a Windows path; it now runs with `MSYS_NO_PATHCONV=1`.
  - **Findings recorded, not fixed (kept as built and documented as built):**
    - **A-342:** `GET /api/v1/jobs` answers its rows under `data.jobs`, with the paging inside `data`.
    - **A-343:** the overdue-devices and inventory reports carry `data.rows`. These are report documents, not lists, and the proposed resolution is to clarify the envelope rule.
- **Known guard limitation: D-05 cannot see a `sql()` call whose runner is an expression.** `HELPER_CALL` (`rawSqlTenantPredicate.d05.test.js`) reads the statement only when the first argument is an identifier or dotted name. `sql(sequelize as unknown as SqlRunner, …)` or `sql(getDb(), …)` is skipped silently, so a missing or literal tenant predicate in it would pass. The workaround is a module-level `dbRunner` constant (ticket, webhook, meteredBilling, qms). On 2026-10-01 no `sql()` call in `src/` has an expression runner. The guard could be taught to refuse one; that is left to the P9-21 guard owner.
- **The `decimalsAsNumbers` edit in `gdpr.service.ts`** is the P9-22 helper's (ae031334c6dbf7c15): a Q-55 addendum for D-21 numbers in the Article 15 export, ADR-097 Am. 4. Both edits are kept.
- **Guard changes (the lead's rulings, 2026-10-01)**
  - **D-05 `insertBindsTenant` (confirmed).** A helper INSERT ... VALUES passes when its column list names `tenant_id` and that position's value is a bound `$n`. The bite cases in `rawSqlTenantPredicate.d05.test.js` show what is still flagged: a literal tenant value, a missing tenant column, and an INSERT ... SELECT whose SELECT has no bound predicate. That last case is outside the rule, which applies to VALUES only. 7/7.
  - **P6-11 `auditCoverage` gap (fixed; the lead released the guard).** `functionsOf` missed a class method whose return type contains `{` (`Promise<{ message: string }>`). The method's body, a mutation included, was read as part of the method above it, so an unaudited write passed whenever the method above was audited. The pattern now takes `(?::.*)?` before the final `{`.
    - **New bite test:** a `remove(): Promise<{ message: string }>` that destroys without auditing, placed under an audited method, is flagged. It fails on the old pattern and passes on the new.
    - **No change in classification.** Under both patterns, every service's audited and unaudited entry points are byte-identical (`ac-old.json` = `ac-new.json`, 12,344 bytes). Only the method map changed: `roles.service.ts`, `storage/index.ts`, `local.driver.ts` and `s3.driver.ts` gained methods that were hidden before, and none of them changes an outcome.
    - Guard 12/12. The `ai` workaround (a named return type) stays; it does no harm.
- **`config/socket.d.ts`** (the lead agreed) declares `socket.js`'s four exports for `notification`'s conversion. `declarationDrift.p912` finds it and passes (10/10). `socket.js` itself is not touched.
- **Containers** `p9svc-rmq` and `p9svc-bj-pg18` have been removed.
- **Not re-keyed:** a comment in `constants/systemActors.ts` still names `batchJob.service.js`. It was left alone because another lane has that file modified.

### Also

- The stale "JavaScript until Stage C" comments on the lazy `kms.service` require in `tenantSettings.model.ts` and `user.model.ts` are updated, comment-only; the lead agreed.
- **Containers.** `p9svc-kms-pg18`, `p9svc-kr-pg18`, `p9svc-tb-pg18` and `p9svc-srch-pg18` have all been removed; none remain (checked 2026-09-30).
- **Not yet converted:**

## Next leaves unlocked

| Leaf | Unlocked by |
|---|---|
| `jobMonitor` | `alert` |
| `quota` | `storage/config.service` |
| `predictiveMaintenance`, `sop`, `tenantBackup`, `tenantUpload`, `webhookDeliveryPurge`, `iot`, `iotDevice`, `ownSessions`, `admin` | the lead's `.d.ts` files |

All of these were unmodified on 2026-09-30.

## For the ADR-087 amendment (for the lead to merge)

> **Stage C leaves (helper), 2026-09-29/30.**
> - **Converted, all under Amendment 13's pattern:** eleven services — `storage/signing`, `storage/keys`, `storage/config.service`, `quarantineSweep`, `featureFlag`, `email`, `reporting`, `content`, `contentMedia`, `alert` and `notificationChannels`.
> - **Identity:** 11,635 checks against the working-copy `.js`. Every difference is the accepted `Function.name` of `exports.x =` functions.
> - **Lazy requires:** a lazy `require` stays lazy where loading the dependency has effects (`alert` → `email`).
> - **`search` had its own change first:** raw SQL with `replacements` moved to `sql()`/bind in a change that edited its tests, then the conversion (four gates; the soft-delete predicate is now pinned by a new test). `storage/local.driver` also converted (four gates; the fsync call is now pinned by a new test), then `rabbitmq` and `batchJob` (identity, planted defects and the live broker and PostgreSQL 18 suites), `config/socket.d.ts`, `notification` (the services helper's interim `.d.ts` retired), `gdpr` (four gates; live 19/19 on PostgreSQL 18 as `callibrator_app`; a tenant-predicate gap closed by a new test; A-333 recorded and then fixed by removal), `storage/s3.driver` (gates a to c; d blocked because no MinIO image was available), `storage/index`, `storageSettings` and `storageMigration` (four gates, live on PostgreSQL 18), `attachmentFileSweep` (four gates), `predictiveMaintenance`, `dashboard`, `ai` (its SQL moved to `sql()` first, with D-05 taught bound-tenant INSERTs; four gates), `webhook` (the claim moved to `sql()` first; four gates; the interim `.d.ts` retired), `ticket` (the counter moved to `sql()` first; four gates), and `kanban` (the card_seq bump moved to `sql()` first; four gates; three unwatched access guards pinned by a new test). Then the P9-18 controllers and routes (seventeen API modules plus internal health and migration), each with a code-first `.openapi.ts`: controller identity, route table and module text identical and bitten, live 47/47 over HTTP; `openapi.json` is 448/448 code-first.
> - **Three `@types` packages added** for the libraries these services load: `@types/nodemailer`, `@types/mustache` and `@types/sanitize-html`.

## P9-25 item 11 — frontend services on the typed client (helper, 2026-10-01/02)

Each service below sends every JSON call through `typedApi` (`frontend/src/api/typed.ts`, openapi-fetch over the generated `paths`, sent through the axios `api.*`), and its types come from `paths`/`components`. The hand-written duplicate types are gone. Multipart uploads, blob/text downloads and `validateStatus` calls stay on `api`. Drift is resolved one of three ways: (a) the contract was wrong and the backend proves it, so the `.openapi.ts` is fixed (doc-only; regenerate, Spectral, `api:types`); (b) the difference is harmless on the wire, so the call adopts the contract's type and the test is re-pinned; (c) the mismatch is real, so behaviour is kept behind a narrow commented cast and an AUDIT row is opened.

- **On the typed client (33: vendor, the precedent, and 32 by this lane):** ticket, socketToken, quota, ai, dashboard, predictiveMaintenance, search, health (types only; it stays on `api` for `validateStatus`), calibrationScheduler, iot, webhook, kanban, calibration (an interim `z.input` service), userPermission, apiKey, accessRequest, featureFlag, batchJob, warehouse (`z.input`), storage, tenantLifecycle, networkSecurity, audit, customDomain, notification, report, risk, sop, attachment, oidc, device (`z.input`), session.
- **Transport changes in `typed.ts`:**
  - A write with no body is `api.post(path)`, with one argument.
  - A DELETE that has a body sends it as axios `data`, which is the notifications bulk delete.
  - A GET with no query is `api.get(path)`. Tests that pinned `{ params: undefined }` are re-pinned.
  - `typed.test.ts` covers each of these.
- **Contract fixes (a), all doc-only:**
  - **certificates:**
    - The read joins: device, the three people, and the detail's calibrationRecord and tenant.
    - The exact CertificateDocument and Integrity.
    - The example's algorithm and legacyHash.
  - **calibrationRecords:** the device include.
  - **userPermissions:** the role permission enum.
  - **admin:** the access-request enums, and the approve answer's tenant.
  - **batchJobs:** `errorDetails`.
  - **storage:**
    - The PUT body's top-level merge was last-wins. It published `provider: "nfs"` and marked s3 as forbidden.
    - StorageSettings and the health answer are now exact.
  - **audit:** the row's actor and impersonation fields, and the list meta's `totalIsCapped` and `window`.
  - **notifications:** the list meta's `unread`, the bulk answer's `requested`, and the test `scope`.
  - **sop:** the list's `author`, and the acknowledgment status enum.
  - **attachments:** `resourceId` is nullable.
  - **calibrationDevices:** the status enum, the warehouse `code`, and the import report's error union.
  - Earlier in this lane: tickets, dashboard, health, search, calibrationScheduler, webhooks and kanban.
- **Real mismatches (c), recorded and kept as built:** A-349 to A-358 (TASKS/AUDIT-2026-09-REMEDIATION.md).
  - A-349 quota card nulls.
  - A-350 predictive toast field.
  - A-351 kanban project code.
  - A-352 sprint cardCount.
  - A-353 feature flags with no tenantId (a 400).
  - A-354 the batch-job phantom fields.
  - A-355 warehouse "suspended".
  - A-356 the lifecycle page's suspension fields.
  - A-357 the geofence `distanceKm` null crash.
  - A-358 the device-import error render crash.
- **Gate, 2026-10-02:**

  | Check | Result |
  |---|---|
  | Frontend typecheck | 0 errors |
  | `npx eslint` (frontend) | 0 errors |
  | `jest --coverage --ci` | 290 suites, 3,043 tests; 93.81 / 84.56 / 89.53 / 94.5 (gate 90 / 81 / 86 / 91) |
  | `next build` | exit 0 |
  | Backend typecheck | 0 errors |
  | Ratchet | at the floor |
  | `openapi:lint` | no new error |
  | Backend suites for the touched contracts | pass |

- **Not yet migrated:**
  - billing, which was reverted to HEAD after the stopped batch agent.
  - supplierScorecard, held while the A-346/347 lane edits its contract.
  - maintenance, which carries another lane's Q-55 edit. It is an interim `z.input` service, as are role, stock and user.
  - The rest: content, dataRetention, eSignature, finance, gdpr, menuGroupRole, meteredBilling, qms, scim, tenant, tenantBackup, tenantHierarchy, webauthn, workflow and auth.

### P9-25 item 11, part 2 — the remaining 21 services (second helper, 2026-10-02)

Same method as part 1: each service sends its JSON calls through `typedApi`, takes its types from `paths` / `components`, and drift is resolved as (a) a doc-only contract fix, (b) a harmless wire difference adopted with a re-pinned test, or (c) a real mismatch kept as built behind a commented cast and recorded as an A-number. The per-service log is the scratch `p9svc/drift.md` (second-helper section).

- **Migrated (21):** billing (redone), maintenance, role, stock, user (the four interim `z.input` services and maintenance replaced), content, dataRetention, eSignature, finance, gdpr, menuGroupRole, meteredBilling, qms, scim, tenant, tenantBackup, tenantHierarchy, webauthn, workflow, auth, and supplierScorecard last. The A-346/347 lane's `supplierScorecard.openapi.ts` had not changed since 01:59 and the backend typecheck was clean when it was done.
- **All 54 services are on the typed client.** 53 go through `typedApi`. `health` takes its types from `paths` and stays on `api` for `validateStatus`. No service imports a `z.input` type.
- **What stays on `api`, by design:**
  - Multipart: the user avatar, tenant create/edit/logo, and content media.
  - Blob and text: the backup zip, the finance and stock CSVs, and the SAML metadata.
  - The Next-owned auth routes: `login`, `logout`, `logout-all`, `refresh` and `passkey/verify`. Their answer comes from the Next route, which writes the cookies and removes the tokens, not from the backend contract.
  - `mfa/login` and `impersonate` go through the generic proxy. They are typed on the way out, and their answer is handed on as `BackendLoginResponse`, because the proxy strips the tokens (A-71).
- **Contract fixes (a), doc-only:**
  - **user:** the User row now names the fields the list carries and the page reads: `isEmailVerified`, `mustChangePassword`, `picture`, `first_name`, `last_name` and `role.description`. The password-reset answer is exact.
  - **auth:**
    - `pass-is-valid` answers `{ valid }`.
    - `mfa/setup` answers `{ secret, qrCodeUrl, rotation }`.
    - `verify` answers `passwordManagedBy` as `{ protocol, provider } | null`, not a string.
  - **stock:** the transfer history includes the API key (Q-51).
  - **content:**
    - `ContentPost` was an open object naming a `body` that no answer carries. It is now the exact admin row.
    - The public reads have their own `ContentPublicPost`, because they select no `status` or `updatedAt`.
    - `ContentCategory` is exact, and `ContentCategoryRef` is the join.
  - **eSignature:** the history row names `ipAddress`, `userAgent` and `biometricData`, which only `qms` readers receive.
  - **gdpr:**
    - The consent history is the real ConsentRecord row: `purpose` and `status`, not `category` and `consent`.
    - The processing record is exact.
  - **menuGroups:**
    - `MenuGroupNode` was published as the raw row. Every tree read actually answers the formatted entry `{ id, label, icon, path, sortOrder?, isAssigned?, items? }`, which is recursive.
    - The assign answer is `RoleMenuPermissionRow`.
    - The bulk-revoke answer is `{ revoked, notFound }`.
    - The roles answer is `RoleRow[]`.
    - The permission values are an enum.
  - **tenant:** the settings PATCH body documents the nested `settings` object, which `settingEntries` unwraps (`tenantId` is never stored as a setting).
  - **tenantBackup:** the restore outcome is exact.
  - **workflows:** a pending task includes its workflow (name, resource type and steps) and its actions.
- **Real mismatches (c), recorded and kept as built** (all five fixed the same day: `2026-10-02-a359-a363.md`, ADR-114)**:**
  - **A-359:** `role.service` sends camelCase menu fields, and the API drops them. The service has no caller.
  - **A-360** (medium): the GDPR export's `downloadUrl` has no route, and the page saves the metadata as if it were the export.
  - **A-361:** the tenants page compares status in upper case, but the API answers in lower case, so the counts and badges never match.
  - **A-362** (medium): the tenant-backup page never offers Download or Restore, for the same reason.
  - **A-363:** a backup's required `name` and `description` are dropped by the model, and the page shows `completedAt` and `error`, which are never sent.
- **Wire-identical re-pins:**
  - The `roles` and `scim` list queries are published as strings, so they are now sent with `String()`. Tests over the real axios serializer prove the URL is the same: `role.service.test` and `scim.service.test`, "the list query on the wire".
  - `tenantBackup` keeps sending numbers behind a commented cast.
  - The query-less `supplierScorecard.list` is now `api.get(path)`.
  - Test fixtures that the API never sends were made real: the tenant-hierarchy parent `id` is now `tenantId`, the q51 adjustment row is complete, and the scim page mock answers `Number(startIndex)`.
  - The menu-groups "notice disappears" test now flushes the typed client's extra ticks. The assertion is unchanged.
- **Transport (`typed.ts`):**
  - openapi-fetch treats a *falsy* rejection as "no error" and then throws a TypeError about `headers`.
  - `apiFetch` now rethrows `error || {}`. That value is neither an Error nor a message, so callers' fallbacks read it the way they read the falsy value.
  - Covered by `typed.test` "a falsy rejection reaches the caller as an empty object".
- **Coordinator cleanups:**
  - `featureFlag.getTenantFlags` requires `tenantId`. Its cast is gone, and the "undefined tenantId" test went with it.
  - `BatchJob` no longer carries `failedItems` or `errorMessage`.
  - `TenantLifecycleStatus` no longer carries the suspension fields.
- **Shared types:**
  - `@/types` `Role` is the contract's `RoleRow` plus the derived `isActive`. The new `UserRole` is a user's partial role.
  - `Stock`, `StockTransfer`, `StockAdjustment` and `StockOpname` alias the contract rows plus their optional joins.
  - The `stockStore` mutation inputs are now the service's contract inputs.
- **Gate, 2026-10-02:**

  | Check | Result |
  |---|---|
  | Frontend typecheck | 0 errors |
  | `npx eslint` on every changed frontend file | 0 errors |
  | `jest --coverage --ci` | 291 suites, 3,055 tests, all passing; 93.82 / 84.54 / 89.6 / 94.5 (gate 90 / 81 / 86 / 91) |
  | `next build` | exit 0 |
  | `api:types:check` | current |
  | Backend typecheck | 0 errors |
  | `ratchet` | 695 `.js`, at the floor |
  | `npx eslint` on the touched `*.openapi.ts` and `contracts/stock.ts` | 0 errors |
  | `openapi:check` | current |
  | `openapi:lint` | no new error (0 baselined errors, 15 warnings) |
  | `openapi:breaking` | **SKIPPED**: no `oasdiff` binary here. CI runs it. |
  | Backend suites for the touched contracts | 398 suites, 7,074 tests, all passing (3 suites and 20 tests skipped) |
  | `packages/contracts` | 47 suites, 1,084 tests, 100% |

  The first full frontend run had one failure: the kanban socket test `useBoard.realtime` failed under load. It passes alone (3/3), and the re-run of the whole suite was green.
- **For CI's oasdiff:** several of the fixes rename or remove *response* properties. They were never sent; for example, `MenuGroupNode`'s `name`/`slug`/`children` and `ContentPost`'s `body`. oasdiff may classify these as breaking response changes against `main`. They are documentation corrections of answers that were already different on the wire, so a hit there is the contract catching up, not an API change.
