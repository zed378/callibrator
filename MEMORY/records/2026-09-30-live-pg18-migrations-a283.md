# 2026-09-30 — Migrations 0091–0106 on a live PostgreSQL 18, fresh and upgraded; A-283 live suites as `callibrator_app`

**Tree:** HEAD `ce74932` plus uncommitted parallel work (several lanes active during the run).
**Engine:** disposable `pgvector/pgvector:pg18` (PostgreSQL 18.6), container `openwork-pg18`, removed by name afterwards. Owner login `callibrator` (a superuser, as in compose).
**Scope:** OPEN-WORK-2026-09-30 §2 (0096/0098 never run on PG, 0104 unrecorded, 0100 vs 0104), priority 3, and A-283.

## 1. Migrations

### How it was run

- **Fresh:** an empty database, then the boot's own schema step: `runSchemaSetup` (advisory lock, `db.sync()`, `migrator.up()`), `assertSeededRoles`, `assertSchemaMatchesModels`, `enterApplicationRole`. Then `seedAll`.
- **Upgrade:** `git archive ce74932 backend/src` into scratch, never a checkout. That tree was booted and seeded on an empty database, which left it at 0090. Representative rows were then added:
  - 3 users: two carry a legacy single passkey on `users`, one carries none;
  - 3 certificates: a draft, one `pending_approval` with a SUBMIT_FOR_APPROVAL audit row, and one soft-deleted `approved`;
  - one each of calibration record, stock adjustment and stock transfer, all user-authored;
  - HEALTHCARE ADMIN `read` on network-security.

  The current tree was then run on that database. `ow_pre` kept a snapshot at 0090.
- **Checks:** `npm run migrate:verify` on both databases, then a psql catalog dump of every 0091+ object on both, diffed. Also backfill data checks, and behaviour under `SET ROLE callibrator_app`.
- **Round trip, on a copy of the upgraded database:** each 0091–0105 `up()` was called again while already applied. Then `migrator.down()` ran 14 times, down to 0090, and `migrator.up()` brought it back. The re-upped catalog was diffed against the upgraded one. On a second copy, the downed schema was diffed with `pg_dump -s` against the 0090 snapshot.

### DEFECT — an existing database cannot boot the current tree (Q-51 / 0105)

`db.sync()` runs **before** the migrator at every boot. On an existing table it creates any missing index the model declares. `calibrationRecord`, `stockAdjustment` and `stockTransfer` models declare `{ fields: ["api_key_id"] }`, but on an existing database that column is only added later, by 0105. The boot on the ce74932 database therefore failed:

```
ERROR: column "api_key_id" does not exist
STATEMENT: CREATE INDEX "calibration_records_api_key_id" ON "calibration_records" ("api_key_id")
```

Nothing migrated: `schema_migrations` stayed at 0090. A probe of every model index against the 0090 catalog found **exactly these three** would fail. No other 0091+ change has the problem. It is the D-13 rule that 0093, 0096 and 0100 state in their headers: "the index lives only here, never on the model".

- **Why it was missed:** `apiKeyActor.q51.live` builds "pre-0105" by running 0105's `down` after a sync of today's models, so sync-before-migrate on an old schema is never exercised. The "upgraded" run recorded in `2026-09-29-security-followups.md` (Amendment 1, "from 0095") has the same shape. The CHANGELOG line "run migration 0105 on upgrade" does not work through the image.
- **Workaround:** `npm run migrate` (no sync) before the new image starts. The compiled binary has no migrate subcommand (`cliDispatch.ts`), so it has to be run from a host checkout.
- **Proposed fix, not applied (owning lane Q-51, active in the tree):** drop the three `{ fields: ["api_key_id"] }` from the models. 0105 creates the same indexes (`CREATE INDEX IF NOT EXISTS`), so the fresh path is unchanged. Also correct the models' "CHECK, migration 0104" comments, which should say 0105.
- **Status:** reported to the coordinator for the Q-51 lane. **Deploy blocker for any existing database.**

With the workaround (`npm run migrate`, then the boot), the upgrade completes and everything below holds.

### Verified objects

In the table, **F** is fresh and **U** is upgrade. `diff` of the catalog dump, F against U after both were seeded, is identical except the two FK `ON UPDATE` notes. Grants were checked with `has_table_privilege` / `has_column_privilege` for `callibrator_app`.

| Migration | Verified objects (psql, F and U) |
|---|---|
| 0091 audit-logs append-only | functions `audit_logs_append_only()` (volatile), `audit_logs_masks_only(jsonb,jsonb)` (immutable). Triggers `audit_logs_append_only` BEFORE UPDATE OR DELETE and `audit_logs_no_truncate` BEFORE TRUNCATE, both `tgenabled = A`. App role: INSERT/SELECT yes; UPDATE/DELETE/TRUNCATE no; column UPDATE exactly on `changes, ip_address, user_agent`. As the app role, `DELETE FROM audit_logs` → permission denied |
| 0093 list-order indexes | 6 indexes, all `indisvalid`: `calibration_records (tenant_id, calibration_date DESC)`, `certificates (tenant_id, created_at DESC)`, `calibration_devices (tenant_id, name)`, `maintenance_work_orders (tenant_id, created_at DESC)`, `attachments (tenant_id, created_at DESC)`, `stocks (tenant_id, item_name)` |
| 0094 | `users.password_one_time` boolean NOT NULL DEFAULT false. U: 0 of 4 set |
| 0095 | `certificates.submitted_by` uuid NULL, FK → users ON DELETE RESTRICT, index `certificates_submitted_by`. U backfill: the pending certificate gets the submitter from its audit row; the draft and the soft-deleted one stay NULL |
| 0096 | `certificates.verification_token` varchar(64) NOT NULL, UNIQUE `certificates_verification_token_unique`. U: 3/3 filled, soft-deleted included, 3 distinct, length 32 |
| 0097 | menu `stock` (top level, sort 7) and `storage` (under mgmt-content, sort 2). U grants equal a fresh seed's row for row (stock ×11, storage ×3, tenants, tenant-hierarchy, kanban, api-keys, webhooks, attachments) |
| 0098 | U: HEALTHCARE ADMIN `read` → `write` on network-security. Equals the fresh seed |
| 0099 access_requests | 25 columns (types, lengths and nullability as the header states), 4 enums, CHECK `access_requests_decided_iff_not_pending`, FK `provisioned_tenant_id` → tenants SET NULL, FKs admin_user_id/decided_by → users SET NULL, indexes status_created_at, work_email, the 3 FK indexes, and a partial UNIQUE invitation hash. App role: full DML, no TRUNCATE. INSERT works as the app role; `approved` without `decided_at` is refused by the CHECK |
| 0100 | partial UNIQUE `users_webauthn_credential_id_unique ... WHERE webauthn_credential_id IS NOT NULL` |
| 0101 | menu `access-requests` under mgmt-organization; SUPERADMIN `write` only |
| 0102 | `tenants`: description/address text; phone varchar(50); city, state, country varchar(100); zip_code varchar(20); website varchar(255). All nullable |
| 0103 | `certificates.signed_snapshot` jsonb NULL |
| 0104 webauthn_credentials | 10 columns; FK user_id → users ON DELETE CASCADE; UNIQUE credential_id; index `webauthn_credentials_user_id`. U: both legacy passkeys moved (name "Passkey", sign_count 7 kept) and the `users` columns cleared; `webauthn_enabled` kept. App role: full DML, INSERT works |
| 0105 | `api_key_id` uuid on 3 tables, FK → api_keys ON DELETE RESTRICT; `performed_by`/`adjusted_by`/`requested_by` now nullable; the 3 CHECKs `convalidated = t`; the 3 `<table>_api_key_id` indexes. The app role's calibration_records column UPDATE grant does not include `api_key_id`. As the app role, a neither-actor insert fails the CHECK |
| 0106 vendor-notes | `vendors.notes` text NULL, app-role UPDATE yes. Applied by `npm run migrate` on both databases, **after** they had booted, so both are upgrade runs. No fresh-sync run. Not round-tripped |

- **`migrate:verify`:** OK on both: 73 tables, 918 columns, 13 control objects. Boot `assertSchemaMatchesModels` OK, and `enterApplicationRole` self-check OK on both.
- **Idempotency:** every 0091–0105 `up()` re-run on the applied database raised no error.
- **Down then up:** all 14 downs recorded, 0105 → 0090. `pg_dump -s` of the downed database equals the 0090 snapshot except one residue, **0091 down leaves `GRANT UPDATE (changes, ip_address, user_agent) ON audit_logs`**. It is redundant, because down re-grants table UPDATE, but down is not an exact inverse. This is low severity and goes to the Q-34/ADR-095 lane. 0104 down restored both legacy passkeys exactly. After up again, the catalog was identical to the upgrade. 0096 down/up regenerates tokens, as its record warns.
- **Low drift:** a fresh sync omits `ON UPDATE CASCADE` on `certificates_submitted_by_fkey`, while 0095 adds it. `webauthn_credentials_user_id_fkey` is the reverse. UUID keys never change, so this is cosmetic.

### 0100 vs 0104

No conflict. They run in order: 0100 guarantees `users.webauthn_credential_id` has no duplicates, and 0104 copies those ids into `webauthn_credentials` (UNIQUE), so its backfill cannot hit a unique violation. After 0104 the `users` columns are all NULL, so 0100's index is inert.

- **Sign-in path:** `webauthn.service` reads only `WebauthnCredential`. The migrator comment on 0100 ("the passkey sign-in looks it up") is stale.
- **Contract step:** it should drop 0100's index along with the columns.
- **Edge case:** 0104's CLEAR also clears a user whose credential id has no public key, without moving it. Such a half-enrolled credential is unusable anyway, but it is dropped silently.
- **Owner:** 0104 has no record, and its owner is the P10 passkey lane.

## 2. A-283 — live PostgreSQL suites and the application role

Suites were decided one by one. The owner is kept only for DDL, or where production also runs as the owner.

| Suite | Before | Now |
|---|---|---|
| `webhook.durable.a10` | owner; **stale**: no audit actor (A-124), no `pinnedFetch` in its ssrf mock (A-307), and cleanup deleting tenants that have append-only audit rows | own disposable DB (O-2); every process `enterAppRole`; creators per tenant; current_user asserted. **Fail-before:** with `REVOKE UPDATE ON webhook_deliveries FROM callibrator_app`, the app-role run fails 6/6 on `permission denied for table webhook_deliveries`; with the grant, **6/6 pass**. The owner run on the revoked DB raised no permission error (0 occurrences); its failures on the loaded host were timing |
| `tenantHookless.w34` | owner | app role, current_user asserted: **7/7 pass** |
| `queryCount.p804` | owner | app role, current_user asserted: **4/4 pass** |
| `0090-…p613.live` | owner; **stale** RE-RUN test (`down({to:0090})` now reverts 0091–0105 too) | migration tests stay owner; rotation and url-change as the app role. Stale expectation fixed. Last full run 4/5 with the old expectation, **not re-run after the fix** |
| `calibrationDevice.retired.q02` | owner, sync-only | owner keeps the DDL and the "even for the owner" trigger test. New fixture `grantAppRoleOnSyncedSchema` (0057+0091 as owner). An app-role process runs the model write, the edit-path 409, the cross-tenant 404, the reinstatement, and a new "refused for callibrator_app too". Last run: setup hook timed out at 120 s on the loaded host; budget raised to `LIVE_BOOT_TIMEOUT_MS`. **Not re-run** |
| `dataIdentity.dbA` | owner, sync-only | D-11 erasure and D-40 certificate issue as the app role; the rest owner. Baseline run lost its database to a runner race. **Not re-run** |
| `dataLayer.dbB` | owner, sync-only | D-19 purge (isolation) as the app role. Last run: its unchanged `sync({force:true})` hook timed out at 180 s (load). **Not re-run** |
| `bulkDestroyRoutes.w33` | app role already; **stale**: `resetTenantFlag` / `deleteClient` without an actor | actor passed. 10/12 before the fix; **not re-run** |
| `authCards.a215` | mixed (A-259 checks the app role) | kept; hook budgets 60 s → 300 s (full sync exceeded 60 s). **Not re-run** |
| `uiCorrectness.adr101adr102` | owner | kept: migration-only (owner DDL). 3/3 pass |
| `migrationLock.p803` | owner | kept: the schema lock is DDL. 3/4, the `npm run migrate` child-output test failed under load |
| `keyRotation.s08` | owner | kept: `keys:rotate` runs as DB_USER in production (no role switch in `src/scripts/rotateKeys.js`). Failed on a 10 s hook timeout (load) |
| `accessRequest.p1005` | owner for the service tests | **not touched**: P10 lane edited it 14 min before. Its BR-P10-4 approval race and rollback are app paths and should run as the app role. Reported. 7/7 pass as owner |
| `apiKeyActor.q51` | app role for the service part | not touched (Q-51 lane active). 6/6 pass |
| already app role (O-2 fixtures or explicit) | — | w12 8/8, w07 4/4, w17 2/2, w03 3/3, dbC 4/4, dbD 6/6, w15w16 2/2, w20 4/4, q34 7/7 pass. p6 26/26 failed on "connection terminated" / auth timeout (host overload; docker itself timed out). s20 4 failed: `keyRotation.service.js` vanished mid-run (another lane's Stage C conversion) |
| `iot.sharedSubscription.w14` | app role | not run (needs an MQTT broker) |

**Scorecard:**
- **Green in the last run:** 15 suites.
- **Red for load or timing:** p6, s08, p803, dbB, q02, a215.
- **Red from another lane's in-flight work:** s20.
- **Fixed, not re-run:** p613, w33, dbA, q02, dbB.
- **"All live suites green" is NOT achieved.** A serial re-run on a quiet host is owed.

The fixture is `tests/fixtures/liveBoot.ts#grantAppRoleOnSyncedSchema`. Every changed file lints clean (`npx eslint`). `npm run typecheck` reports errors only in other lanes' files (meteredBilling, p10 e2e, q50).

**Run:** `scratchpad run-live.sh` pattern, one database per suite. Every suite has its own flag; one `make test-live` target is still the recommendation (A-283), and three stale suites found here show why: nothing runs them.
