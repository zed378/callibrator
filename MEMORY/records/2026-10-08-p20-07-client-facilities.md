# P20-07 — client facilities: `client_facilities`, `client_facility_id` on the evidence chain, the self facility per tenant, the move and binding triggers (migrations 0117 – 0123)

**Date:** 2026-10-08 · **Task:** P20-07 (Phase 20; BACKLOG Q-57) · **Decision:** ADR-124 Amendment 3 (new), on ADR-124 Am. 2 · **Spec:** [`MEMORY/specs/P19-04-client-facilities.md`](../specs/P19-04-client-facilities.md) § 4 – § 6 (amended § 5.4, § 6.3) · **Base commit:** `9e4663b` (working tree, not committed) · **Kind:** migrations + models + one service + tests. **Nothing committed.**

> **Privacy:** no upstream value anywhere. Every fixture is synthetic ("Rumah Sakit Sintetis Satu", `F-0001`, `@example.test`).

## What was built

| | |
|---|---|
| `0117-client-facilities` (M1) | `client_facilities`: CHECKs — id is not `NO_FACILITY_ID`; the self facility is active; a non-active status names a reason; code and name shapes; legacy id positive. Unique per tenant: `(tenant_id, id)`, code, `lower(btrim(name))`, one `is_self`, legacy id. D-20 indexes and a list index. Trigger `client_facilities_identity_immutable` (id, tenant, `is_self`). `client_facility_moves`: composite keys to the two facilities and to the device `(tenant_id, id)`; CHECKs; append-only and no-truncate triggers; a **deferred trigger refusing a COMMIT that leaves a move `in_progress`**; DELETE and TRUNCATE revoked from `callibrator_app`. `calibration_devices UNIQUE (tenant_id, id)`, idempotent (named `calibration_devices_tenant_id_id_unique` — P20-02 reuses the name). `audit_logs.client_facility_id` (no FK, no back-fill) and index `(tenant_id, client_facility_id, created_at)`. Eleven trigger functions. **One self facility per tenant** (PLATFORM and soft-deleted tenants included) and one CREATE audit row each under `system:client-facility-backfill` |
| `0118-facility-devices` (M2) | Column; back-fill to the self facility; NOT NULL; FK `(tenant_id, client_facility_id)` RESTRICT; target `UNIQUE (tenant_id, client_facility_id, id)`. **UD-9:** 0026's per-tenant serial index replaced by `calibration_devices_tenant_facility_serial_unique`. Triggers: default (Am. 3), ended-insert, column guard |
| `0119` – `0122` (M3 – M6) | Records, certificates, work orders and readings: column; back-fill from the device (one set-based UPDATE); NOT NULL; composite key to the device `ON UPDATE CASCADE`, with `ON DELETE` as 0037's (RESTRICT, RESTRICT, CASCADE, RESTRICT); D-20 index; default, ended-insert (not on readings) and guard triggers. 0119 lifts 0057's append-only trigger for its back-fill only, restores and asserts its exact state, and **replaces 0057's function** to admit exactly a move's facility change. 0120 adds the deferred `MATCH SIMPLE` certificate → record key, plus a records target unique |
| `0123-facility-nullable` (M7) | Attachments: column plus `rekey_pending`; back-fill from the resource (an orphan to its tenant's self facility); CHECK `attachments_facility_kind`; the two AM-7 deferred triggers (`attachments_facility_matches_resource`, `<table>_attachments_follow_facility` × 4). Non-conformances: column from the device; CHECK `(device_id IS NULL) = (client_facility_id IS NULL)`; key `ON DELETE SET NULL (client_facility_id, device_id)`. Warehouses: column and FK (no room CHECK until UD-10). Users: column (everyone stays unbound) plus `facility_binding_pending`; CHECK; FK; `users_facility_binding_guard` and `users_facility_bound_role` |
| Shared | `migrations/facilityMigration.shared.ts` (helpers, frozen lists; never adds a column or creates an index — `migrationScan` enforces it). `0057` exports its `FUNCTION_SQL` (no behaviour change) so 0119's `down` restores it exactly |
| Every `down` | Refuses while any facility beyond the self ones, any move or any bound user exists. Otherwise drops in reverse; `audit_logs.client_facility_id` stays |
| Models | New `ClientFacility` and `ClientFacilityMove` (not paranoid, no defaultScope, no indexes). `clientFacilityId` added to CalibrationDevice, CalibrationRecord, Certificate, MaintenanceWorkOrder, IotReading, NonConformance, Attachment (+`rekeyPending`), Warehouse, User (+`facilityBindingPending`) and AuditLog — `allowNull: true` (Am. 3). Device and User have `belongsTo(ClientFacility, { constraints: false })`. Barrel, `types/models.ts`, `types/ids.ts` (`ClientFacilityId`, `ClientFacilityMoveId`, `toClientFacilityId`, `NO_FACILITY_ID`) |
| Service | `services/clientFacility.service.ts#createSelfFacility` (idempotent, audited, reviewed `skipTenantScope`). Called from `tenant.service#createTenant` (the tenant's CREATE audit row gains `selfFacilityId`), `tenantHierarchy#createSubOrganization` (likewise) and the seeds `seedPlatformTenant`, `seedDefaultTenant`, `seedDemoTenants` (ensured on every seed). `audit.service#logAction` accepts `clientFacilityId` |
| Other source | `SYSTEM_ACTORS.CLIENT_FACILITY_BACKFILL`. `constants/facilityAccess.ts` (`FACILITY_BOUND_ROLES`). JSON shape `ClientFacilityMove.counts`. schemaVerify: 45 new control objects (76 in total), and the serial entry renamed. `tenantLifecycle` hard delete removes `client_facilities` after users. `calibrationDevices.service` claims both serial index names. Contracts `states.ts`: `CLIENT_FACILITY_KINDS`, `CLIENT_FACILITY_STATUSES`, `CLIENT_FACILITY_MOVE_STATUSES` |

## Deviation → ADR-124 Amendment 3

Am. 2 put G-F1's default in the service (P21-09) and rejected a database default. P20-07 makes the column NOT NULL first, which would have broken every existing create path. Decision: a BEFORE INSERT trigger fills a NULL. A device gets the self facility **only while the tenant has no other facility** (23502 otherwise); children get the device's facility. The models declare the column nullable. **Bad implication, handed to P21-09:** once a tenant has a second facility, every create path that omits the facility fails with 23502 until the service default lands. The full text, alternatives and implications are in the ADR.

## What surprised me

1. **0057 blocks the back-fill.** Every column added later is immutable, so 0119 lifts the trigger as DDL inside its own transaction.
2. **Two keys on one column must agree on `ON DELETE`.** RI action triggers fire in name order, so a composite RESTRICT beside 0037's CASCADE (work orders) or SET NULL (NCs) would have changed what deleting a device does. For NCs, the default trigger clears the facility with the device so the CHECK holds whichever key fires first.
3. **RI cascades run as the table owner.** `has_column_privilege(callibrator_app, calibration_records.client_facility_id, UPDATE)` is **false**, yet the cascade succeeds as the app role — the spec's "expected, not proven" is now proven.
4. **A move's key lock.** An UPDATE of the device from another session waits on the moving session's key lock. The invisibility proof calls `facility_move_admits` directly instead (false there, true in the mover).
5. **Cross-tenant legacy rows** (a work order or attachment naming another tenant's record) can no longer be written. A database already holding a cross-tenant work order, record, certificate or reading **cannot be upgraded** until that row is repaired — the migration throws and records nothing. The dbC fixture now builds its pre-A-97 attachments the way the upgrade leaves them.
6. **The closed-world migration readers** (`migrationScan`, used by AM-3 and D-20) read one file at a time, so the ADD COLUMN and CREATE INDEX statements stay literal in each migration and the shared module is held to containing neither.

## Evidence — tests named, with counts

**Unit (in `npm run test:coverage`):**
- `src/tests/migrations/0117-0123-client-facilities.p2007.test.ts` — **55**:
  - manifest order; no try/catch;
  - the frozen lists equal their constants;
  - 0117's tables equal the models column for column;
  - upgraded and fresh statement lists, one transaction each; refusals;
  - function texts;
  - every `down` refuses for a non-self facility, a move and a bound user; `down` statement lists;
  - 0119's trigger lift and restore for 'O', 'A' and 'R'; 0119's function keeps all of 0057's refusals; 0120's deferred key; 0123's CHECKs and triggers.
- `src/tests/guards/facilityScopedModels.guard.test.ts` — **8** (G-11, with planted fail-before cases).
- `src/tests/guards/tenantCreateSelfFacility.guard.test.ts` — **3** (5 creation sites found; planted fail-before).
- `src/tests/services/clientFacility.service.p2007.test.ts` — **6** (memoryDb; service at 100 %).
- Updated: `associationForeignKeys.a148` (+4 decisions), `enumMirrors.d26` (+3), `includeRequired.d12` (83 models), `stateUnions.p905` (+ClientFacility), `jsonShape.d27` (23 columns), `modelIndexColumns.am3` (+2 cases: sees the 12 added columns; the shared-module rule), `schemaVerify.util.p605` (76 objects), `systemActors.a124`, `tenantLifecycle.hardDelete.d23` (the delete list).
- Fixture changes in 13 tenant-creation unit/route suites: `jest.mock` of `clientFacility.service`. `tenantHierarchy.createSub.a187` additionally asserts `selfFacilityId` and the call inside the transaction.
- Contracts: `packages/contracts/test/clientFacilityStates.p2007.test.ts` — **4**.

**Live, PostgreSQL 18 (`pgvector/pgvector:pg18`; containers `p2007-pg18` and `p2007-pg18b`, removed by name):**
- `src/tests/migrations/clientFacilities.p2007.live.test.ts` — **56 passed** (G-25):
  - FAIL-BEFORE: the sync-alone schema lets the app role cross tenants and facilities;
  - seeded upgrade path: 5 tenants (one soft-deleted), 12 users, 48 devices, 144 records, 48 certificates, 96 work orders, 480 readings, 32 NCs, 44 attachments;
  - selfFacility: 5 of 5, names normalised, 5 audit rows;
  - facilityBackfill: reconciled per table **and per tenant**;
  - facilityNotNull: NOT NULL; 31 triggers all `A`; schemaVerify 76 with 0 problems; serial per facility;
  - facilityCompositeFk: 23503 for each child, for another tenant's facility, and for the record path at COMMIT;
  - insertDefault (Am. 3): single-facility tenant OK; multi-facility tenant 23502; no-self tenant 23502;
  - checks: 11 refusals;
  - facilityImmutable: 7 tables refused for the app role and the owner; garbage, unknown, other-device and wrong-target moves refused;
  - usersBinding, endedFacilityInsert, AM-7 at COMMIT, moveLog;
  - REBOOT clean;
  - `down` refused with a non-self facility; down ×7 then up ×7: rows intact, 0057's function restored, back-fill reconciled again, one audit row per facility id.
  - The first run had 2 failures, both in the test, not the schema: the app role's refusal on the records column is "permission denied" (no column grant, which is correct); and TRUNCATE inside a transaction with pending deferred events raises 55006, so it is now asserted in a clean transaction.
- `src/tests/migrations/deviceMove.p2007.live.test.ts` — **7 passed**:
  - the cascade as `callibrator_app` with no column grant on calibration records; every child follows along one path; 0057's correction chain intact; 4 files flagged for re-key; MOVE_DEVICE_OUT and MOVE_DEVICE_IN audit rows;
  - refused at COMMIT: forgotten files (AM-7 follow), a move left in progress;
  - refused: a serial collision in the target (23505); a record's other content, and a third facility, under the move;
  - the in-progress row is invisible to another session;
  - a completed move is final and admits no later change.
- `src/tests/migrations/upgradeBoot.am3.live.test.ts` with **`AM3_UPGRADE_BASE=78f3784`** (git base — newer than the `zed378/calibration-be:25521ff` image, and includes 0113 – 0116; no image was built) — **9 passed**: exactly 0117 – 0123 applied with the schema check clean; the new P20-07 case (self facility for AM3 and PLATFORM; the old device, record and certificate in it; the user unbound; 31 triggers `A`; 2 back-fill audit rows); a second boot applies nothing.
- Existing live suites that insert tenants by raw SQL and then devices now call `fixtures/selfFacility.ts` (`SELF_FACILITIES_SQL`) before their first device:
  - **passed:** `apiKeyActor.q51.live` 6/6, `uiCorrectness.adr101adr102.live` 3/3, `calibrationDevice.retired.q02.live` 12/12, `authCards.a215.live` 8/8, `backgroundJobs.w12.live` 8/8, `calibrationScheduler.batch.w17.live` 2/2, `calibrationScheduler.w03.live` 3/3, `dataLayer.dbB.live` 10/10, `dataLayer.dbC.live` 4/4 (with `DB_APP_ROLE` on a booted schema; its two pre-A-97 cross-tenant attachments are built as the upgrade leaves them, and its deleted-parent work order is on A's own device);
  - **failing identically on the HEAD baseline** (a `git archive HEAD` tree run on the same container, so not caused by P20-07): `dataIdentity.dbA.live` 3/11 (D-11 mfa fields, D-40 audit actor, D-09 0067 state row), `attachmentService.p918.live` 2/6 (storage download path), `dataIntegrity.p6.live` (0110 `search_vector` — 26/26 on base), `queryCount.p804.live` 4/4;
  - **not run:** `iot.sharedSubscription.w14.live` (needs MQTT).

**Back-fill timing** (synthetic, 50 tenants: 100,000 devices; 200,000 records; 100,000 certificates; 100,000 work orders; 999,990 IoT readings; 50,000 attachments). Workstation Docker Desktop, `pgvector:pg18`, default settings:

| Migration | Time |
|---|---|
| 0117 | 0.3 s |
| 0118 (devices) | 4.7 s |
| 0119 (records) | 9.9 s |
| 0120 (certificates) | 8.3 s |
| 0121 (work orders) | 3.5 s |
| **0122 (1M readings)** | **47.3 s** |
| 0123 | 2.4 s |

About **76 s in total**, 0 rows left NULL. 0122 holds an ACCESS EXCLUSIVE lock on `iot_readings` for its whole transaction; the deploy is Recreate anyway. Production-shaped measurement is P20-09's.

**Gates (2026-10-08; tree NOT quiet — another agent was restructuring `frontend/src/app` into route groups):**
- backend: `node scripts/ci/eslint-ratchet.js` "0 error(s), 0 warning(s); baseline 0"; `npm run typecheck` 0; `npm run ratchet` 695 `.js`, at the floor; `npm run build:dist` OK (667 TypeScript files; contracts 55); `load:check` OK in both modes (107 in boot order); `npm run openapi:check` current;
- **`npm run test:coverage -- --ci`: 922 suites passed, 41 skipped, 1 failed; 15,982 tests passed, 338 skipped, 1 failed; 100 / 100 / 100 / 100**, in 387 s. The one failure is `webhookEmit.a11` ("the frontend offers exactly `*`…"), which reads `frontend/src/app/dashboard/webhooks/components/WebhookModal.tsx` — a file the other agent's concurrent route-group move (ADR-131) deleted. It is not a P20-07 file, and it needs that agent's path update;
- contracts: 52 suites, 1,194 tests, 100 %; typecheck 0.

## Not done / open

- `make migrate-verify` on production-shaped data: P20-09.
- `deviceMove` proves the database side; the move **service**, route, 409s and re-key job are P21-09's.
- The live E2E suite was not run (no route changed).
- `pgvector/pgvector:pg18` was left in place (the shared base image of every live suite).

## Hand-offs

- **P21-09:**
  - the service default of G-F1 (Am. 3's 23502 once a tenant has a second facility);
  - `findSerialHolder` is still a per-tenant pre-check (UD-9 needs per facility);
  - `logAction` should resolve `clientFacilityId` from the resource when it is omitted (spec § 16);
  - the hooks' immutability (AM-6) beside the triggers;
  - review `createSelfFacility`'s `skipTenantScope`.
- **P20-02:** `UNIQUE (tenant_id, id)` exists as `calibration_devices_tenant_id_id_unique` — reuse it. The serial is P20-07's.
- **P20-04 / P20-05 / P19-02:** `inspection_sessions` / `inspection_results` get the same column, keys and triggers (`facility_insert_default('child')`, the guard). Any append-only trigger must admit `facility_move_admits` the way 0119 does.

## Boards

P20-07 **DONE**. Phase 20: 3 DONE · 0 TODO · 6 BLOCKED.
