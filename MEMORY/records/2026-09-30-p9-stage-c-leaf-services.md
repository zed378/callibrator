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
- **`config/socket.d.ts`** (the lead agreed) declares `socket.js`'s four exports for `notification`'s conversion. `declarationDrift.p912` finds it and passes (10/10). `socket.js` itself is not touched.
- **Containers** `p9svc-rmq` and `p9svc-bj-pg18` have been removed.
- **Not re-keyed:** a comment in `constants/systemActors.ts` still names `batchJob.service.js`. It was left alone because another lane has that file modified.

### Also

- The stale "JavaScript until Stage C" comments on the lazy `kms.service` require in `tenantSettings.model.ts` and `user.model.ts` are updated, comment-only; the lead agreed.
- **Containers.** `p9svc-kms-pg18`, `p9svc-kr-pg18`, `p9svc-tb-pg18` and `p9svc-srch-pg18` have all been removed; none remain (checked 2026-09-30).
- **Not yet converted:**
  - the remaining storage modules: `storage/index` (it loads `s3.driver`, which the SSRF agent is editing), `storageSettings` (modified by another agent) and `storageMigration` (it loads `storage/index`);
  - `attachmentFileSweep` (`attachment` modified);
  - `gdpr` (released by the P6-11 lane);

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
> - **`search` had its own change first:** raw SQL with `replacements` moved to `sql()`/bind in a change that edited its tests, then the conversion (four gates; the soft-delete predicate is now pinned by a new test). `storage/local.driver` also converted (four gates; the fsync call is now pinned by a new test), then `rabbitmq` and `batchJob` (identity, planted defects and the live broker and PostgreSQL 18 suites), `config/socket.d.ts`, and `notification` (the services helper's interim `.d.ts` retired).
> - **Three `@types` packages added** for the libraries these services load: `@types/nodemailer`, `@types/mustache` and `@types/sanitize-html`.
