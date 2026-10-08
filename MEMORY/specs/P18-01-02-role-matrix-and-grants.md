# Feature Spec — P18-01 Role Matrix and P18-02 Slugs and Grants: Each Upstream Account's Role and Scope, the Import Rules That Assign Them, the Three New Slugs, UD-4 (b)'s `calibration` Write for the Technicians, and the Seed / Migration That Ships Them

**Written:** 2026-10-08 — **before** implementation. **Everything in this spec is TARGET: nothing here is built.**
**Tasks:** P18-01 (role matrix) and P18-02 (slugs and grants spec), Phase 18. Consumed by **P20-06** (the seed and the migration), P24-02 (the user transform), P30-04 (invitations), P21-09 (binding), P22-09 (navigation).
**Author:** coordinating session's documentation agent, under the owner's delegation of 2026-10-08 (*continue autonomously, decide by best practice, record it; the owner may revise*).
**Decisions this spec builds on:** UD-4 (a), (c) — working decisions 2026-10-07; **UD-4 (b) — working decision 2026-10-08, ships** (Phase 12 § 3); ADR-124 and Amendments 1 – 2; ADR-064 (roles and their grants are global); ADR-102 (one effective permission); ADR-126 § 3 (IPM void by an unbound tenant administrator); ADR-062 (a void is final).
**Not duplicated here — read with:** [`P18-03-facility-scope-permissions.md`](./P18-03-facility-scope-permissions.md) § 4 (bound role set, Matrix A), § 5 (bound menu ceiling), § 6 (Matrix C), § 7 (slugs, default grants, plan), § 12 (API keys, SSO, SCIM). This spec adds what those sections left open: the deterministic assignment rules (§ 2), the final grant table with UD-4 (b) (§ 3), the measured effect on existing tenants (§ 3.2), the one gate narrowed in the same release (§ 4.3), the `reports` answer (§ 3.3), the migration's exact content (§ 4) and the tests (§ 5).
**Code read 2026-10-08:** `backend/src/constants/roleConstants.ts` (`ROLE_NAMES`, `ROLE_LEVELS`, `MENU_SLUGS`, `ROLE_MENU_ASSIGNMENTS`), `models/roleMenuPermission.model.ts` (no tenant column — D-17), `services/roles.service.ts#getRolePermissionsMatrix` (a role row reaches the menu's **direct children**; grants **union**), `services/menuGroup.service.ts` (`permissions:role:*` cache), `routes/api/{calibrationDevices,calibrationRecords,iot,predictiveMaintenance}.route.ts` (every `calibration` gate), `migrations/0111 … 0116` (numbering), `frontend/src/api/services/calibration.service.ts` (no page calls the record void).

> **Privacy.** No upstream data value appears here. Group names and per-group counts are structural (`docs/UPSTREAM/03` § 4.2, `04` § 6).

---

## 1. Problem

P18-03 fixed the **scope** of every upstream actor and drafted the roles and grants; it could not finalise them while UD-4 was open. Three things were still missing: a **deterministic** rule for which `client` account becomes the facility's `HEALTHCARE ADMIN` (the import must not depend on row order), the **final** default grants including the technicians' `calibration` write (UD-4 (b)), and the **exact** effect of that grant on tenants that exist today — because roles and their grants are global (ADR-064), one migration row changes every tenant at once.

---

## 2. P18-01 — The Role Matrix (final under the working decisions)

### 2.1 Matrix

| Upstream group | Users (dump) | Our role | Scope | Assignment rule (P24-02) | Invitation (P30-04) |
|---|---:|---|---|---|---|
| `admin` | 10 | `CALIBRATOR ADMIN` | unbound, provider tenant | every active member | yes |
| `user` (Teknisi SKP) | 35 | `TECHNICIAN` | unbound | every active member | yes |
| `client` | 57 | **one** bound `HEALTHCARE ADMIN` per facility; the others bound `ROOM USER` | bound to the one facility of its `trx_mapping_user_client` row | § 2.2 | yes, after the pre-invitation gate (`docs/SECURITY/15` § 11) |
| `teknisi_client` | 3 | `HEALTHCARE TECHNICIAN` | bound | as `client` (§ 2.2 rules 2 – 4) | yes, after the gate |
| IPSRS (no upstream account) | 0 | `FACILITY MAINTENANCE` | bound (provider tenant) / unbound (a self-served hospital) | created by the provider administrator, only where the facility enables countersigning (UD-17) | n/a |
| no group | 1 | — | — | not imported (AM-27; R-17 review) | no |
| — | — | `ENGINEERING MANAGER`, `SUPERVISOR` | unbound | optional provider management roles, created by hand | — |
| platform operator | — | `SUPERADMIN` | both dimensions skipped | — | — |

**No new role; `ROLE_LEVELS` unchanged** (the trap "a new role without a `ROLE_LEVELS` entry" does not arise).

### 2.2 Deterministic assignment rules (the transform, P24-02)

1. **The facility's `HEALTHCARE ADMIN`.** Among the **active** `client` accounts mapped to one facility, the one with the earliest `created_at`, ties broken by the lowest upstream id, becomes `HEALTHCARE ADMIN`; every other `client` account of that facility becomes `ROOM USER`. The rule reads only structural columns, never a name. The operator may swap the two at the invitation review (OA-8) — an audited role change **within the bound role set** (P18-03 § 11), never a second transform run.
2. **Exactly one facility.** A `client` / `teknisi_client` account with **zero or several** mapping rows is never imported unbound: `quarantine` reason `facility_mapping_ambiguous` (AM-27, P19-04 spec § 15), resolved by the operator before invitation (two accounts, or provider staff).
3. **Inactive accounts** (`users.active = 0`) are imported `is_active = false` (07 § 2.1) so that their history stays attributable, and are **never invited**.
4. **A facility with no `client` account** (63 of them, UD-11) gets **no** bound account at import; the provider's own administrators serve it, and the operator may invite a contact later (OA-8).
5. **The person behind a shared account.** At the invitation review the operator names the real person (UD-4 (a), Part 11 attributability, `05` § 5); an account nobody claims is not invited and stays inactive.
6. **One group per user** is the observed data (`03` § 4.2: `auth_groups_users` 105 rows for 99 users, one group each); a user found in two groups at the dry run goes to quarantine `group_conflict` — a person who is both provider staff and facility staff gets two accounts (ADR-124 § 10).

### 2.3 What a bound `HEALTHCARE ADMIN` is and is not

Read-only in the facility group (P18-03 § 5), **not** a tenant administrator (ADR-124 § 7), no facility user management (UD-4 (c): **no** in this group). It keeps level 8 for the code's comparisons; the route default and the bound menu ceiling hold it out of administration (P18-03 § 4.1, § 9).

---

## 3. P18-02 — Slugs and Grants

### 3.1 The final default grants (`ROLE_MENU_ASSIGNMENTS`; explicit rows only — inherited cells need none)

Three new slugs as P18-03 § 7: **`ipm`** and **`ipm-templates`** under `equipment`, **`client-facilities`** under `mgmt-organization`. Plus the **UD-4 (b)** rows (bold, **new 2026-10-08**):

| Role | `calibration` | `ipm` | `ipm-templates` | `client-facilities` |
|---|---|---|---|---|
| `SUPERADMIN` | (W via `equipment` W) | W | W | W |
| `HEALTHCARE ADMIN` | (W via `equipment` W) | (W) | (W) | **W** |
| `CALIBRATOR ADMIN` | (W via `equipment` W) | (W) | (W) | **W** |
| `ENGINEERING MANAGER` | (R) | (R) | (R) | **R** |
| `SUPERVISOR` | (R) | (R) | (R) | — |
| `TECHNICIAN` | **W — UD-4 (b)** | **W** | (R) | — |
| `HEALTHCARE TECHNICIAN` | **W — UD-4 (b)** | **W** | (R) | — |
| `FACILITY MAINTENANCE` | (R) — **not** widened | **W** (bound: capped to R by the ceiling) | (R) | — |
| `WAREHOUSE STAFF`, `ROOM USER`, `USER` | (R) | (R) | (R) | — |

Mechanics (read in `roles.service.ts#getRolePermissionsMatrix`): a role row on `calibration` is added to the list the `equipment` row already reaches, and grants **union** — so an explicit `calibration: write` row widens the inherited read without touching `equipment`. A **per-user override replaces** the role's grant (ADR-102): a technician whose administrator once set `calibration: read` per user stays read — the migration does not touch `user_menu_permissions`.

For a **bound** `HEALTHCARE TECHNICIAN` the ceiling (P18-03 § 5) allows `calibration` W, so the grant becomes effective — but only on the routes marked facility-accessible (A-2 create, A-3 edit, N-6 photos; P18-03 § 8). Delete, bulk import, record writes and predictive-maintenance writes stay unmarked → 403 for bound users.

### 3.2 The effect of UD-4 (b) on tenants that exist today (the statement the P20-06 record must carry)

Roles and grants are **global** (ADR-064, `role_menu_permissions` has no tenant column), so the migration changes **every** tenant in one row per role. Measured from the gates on 2026-10-08, an **unbound** `TECHNICIAN` or `HEALTHCARE TECHNICIAN` of any tenant newly reaches:

| Route | Gate today | After |
|---|---|---|
| `POST /api/v1/calibration-devices` | `calibration` write | ✔ create a device |
| `PUT /api/v1/calibration-devices/:calibrationDeviceId` | `calibration` write | ✔ edit |
| `DELETE /api/v1/calibration-devices/:calibrationDeviceId` | `calibration` write | ✔ soft delete (restore stays admin-only) |
| `POST /api/v1/calibration-devices/bulk-import` | `calibration` write | ✔ CSV import |
| `POST /api/v1/calibration-records` | `calibration` write + `denyPlatformAuthoring` | ✔ record a calibration |
| `POST /api/v1/calibration-records/:calibrationRecordId/corrections` | `calibration` write + `denyPlatformAuthoring` | ✔ correct (a new superseding record) |
| `POST /api/v1/calibration-records/:calibrationRecordId/void` | `calibration` write + `denyApiKey` + `denyPlatformAuthoring` | **✘ — narrowed in the same release** (§ 4.3) |
| `POST /api/v1/predictive-maintenance/analyze/:deviceId` | `calibration` write | ✔ |
| `POST /api/v1/predictive-maintenance/recommendations/:deviceId/approve` | `calibration` write | ✔ sets the device's calibration interval (the same field `PUT` edits) |

**Unchanged:** `POST …/:calibrationDeviceId/restore` and `…/reinstate` (`rbac([TENANT_ADMIN])`); the IoT provisioning routes (`PATCH /iot/devices/:deviceId`, token issue/revoke — `rbac([TENANT_ADMIN])`); every certificate route (`certificate` slug, not widened — issuing stays with the level-8 roles); work orders (`maintenance`, not widened). The sidebar and buttons follow automatically (ADR-102): technicians start seeing "Add device", "Import", "Edit", "Delete" and "Record calibration" where those pages gate on `calibration` write.

**What the record of the migration must contain:** this table; the number of tenants and of `TECHNICIAN` / `HEALTHCARE TECHNICIAN` accounts on the target database at deploy time (a count query, no names); the number of those with a per-user `calibration` override (unaffected); that `permissions:role:*` was flushed; and a live check that one technician can create a device and cannot void a record.

### 3.3 `reports` — no new slug

The card asked for a `reports` decision. **No new slug:** exports are rendered in the frontend from paginated reads gated by the slug of what they read (ADR-126 § 8: inventory → `calibration` read, IPM lists → `ipm` read, recaps → `calibration` read); the IPM report's data document is `ipm` read; the existing `reports` slug (a child of `equipment`) keeps gating `/api/v1/reports/*`, which stays provider-only and **unmarked** for bound users (P18-03 § 8.2, PT-10). Bound users get their facility's exports through the marked reads (A-1, A-4, A-7, N-2), not through `/reports/*`.

### 3.4 API-key scopes

As P18-03 § 7.5 / § 12: `ipm` read, `ipm-templates` read, `client-facilities` read are assignable; IPM submit / correct / void carry `denyApiKey`. UD-4 (b) changes nothing for keys (a key's scopes are chosen per key).

---

## 4. The Seed and the Migration (built by P20-06)

### 4.1 Seed (`constants/roleConstants.ts`, `constants/seededMenuSlugs.ts`, `utils/seedMenuGroups.util.ts`)

- `MENU_SLUGS.IPM = "ipm"`, `IPM_TEMPLATES = "ipm-templates"`, `CLIENT_FACILITIES = "client-facilities"`; `SEEDED_MENU_SLUGS` gains the three (`seededMenuSlugs.p919`); `menuData` gains the rows (P18-03 § 7 plan 1).
- `MENU_SLUGS` has no `CALIBRATION` member today (the routes name the seeded slug `"calibration"` as a literal, typed by `SeededMenuSlug`): add `CALIBRATION: "calibration"` (already in `SEEDED_MENU_SLUGS`, so the A-58 boot check `utils/authorizationWiring.util.ts#checkRoleMenuAssignments` accepts it).
- `ROLE_MENU_ASSIGNMENTS`: the explicit rows of § 3.1 — for `TECHNICIAN` and `HEALTHCARE TECHNICIAN` a new line `[MENU_SLUGS.CALIBRATION]: PERMISSION_TYPES.WRITE, // UD-4 (b), working decision 2026-10-08 (migration <n>)` beside the existing `EQUIPMENT: READ`.

### 4.2 Migration (next free number after `0116`; the 0097 / 0101 / 0116 grant-migration pattern)

One migration, three idempotent steps, **no blanket `try/catch`**, verified with `make migrate-verify` and the rows read back (not the log):
1. insert the three `menu_groups` rows by slug with their parents (skip a slug that exists);
2. insert the explicit `role_menu_permissions` rows of § 3.1 by role **name** and menu **slug** (skip an existing pair; never downgrade an existing row);
3. `calibration: write` for `TECHNICIAN` and `HEALTHCARE TECHNICIAN` — **upgrade** an existing `read` row on `calibration` to `write` if one exists, else insert.
`down` removes exactly the rows it inserted (by slug/role pair) and reverts step 3 to the prior value recorded in the migration's own table of what it changed — or, simpler and acceptable, documents that `down` leaves the technicians' write in place (a grant revert is a data decision, not a schema one). The application flushes `permissions:role:*` at boot after it (the ADR-102 note); the record proves the flush.

### 4.3 The one gate narrowed in the same release — calibration-record void

`POST /api/v1/calibration-records/:calibrationRecordId/void` gains **`rbac([ROLE_NAMES.TENANT_ADMIN])`** before `dynamicAccess("calibration", "write")`.

- **Why:** a void is a final retraction of a Part 11 record (ADR-062: "a void is final"); the IPM void is already an unbound tenant administrator's act (ADR-126 § 3). Widening `calibration` write to every technician would otherwise make every technician able to retract any calibration record of the tenant. Correction (a new superseding record) stays open to them — it keeps the original.
- **Who loses it:** today `calibration` write is held by role only by `SUPERADMIN`, `HEALTHCARE ADMIN`, `CALIBRATOR ADMIN` (all level ≥ 8 — unaffected). A lower-level user holding `calibration: write` **by a per-user override** loses the void; the P20-06 record counts such users on the target database (a query, no names).
- **Frontend:** no page offers a record void today (`calibration.service.ts` only); a future void button must be shown from a capability the API states, not a role name (ADR-102, `docs/FRONTEND/05-RBAC-IN-UI.md`).
- **Recorded** as a decision of this spec under the owner's delegation; the building card P20-06 records it in its record and in `docs/BACKEND` with the gate change (deviation protocol).

---

## 5. Tests (named; written by P20-06 unless stated)

| Test | Kind | Proves |
|---|---|---|
| `migrations/<n>-ipm-menus-technician-calibration.test.ts` | U | the three slugs inserted with their parents; the § 3.1 rows; step 3 upgrades a `read` row and inserts when absent; re-run inserts nothing; no other role's row changes |
| `constants/roleMenuAssignments.ud4b.test.ts` | U | `TECHNICIAN` and `HEALTHCARE TECHNICIAN` hold `calibration` write; `FACILITY MAINTENANCE`, `SUPERVISOR`, `ENGINEERING MANAGER`, `ROOM USER`, `WAREHOUSE STAFF`, `USER` do not — read from the **seed**, not from this list |
| `routes/calibrationDevices.technician.ud4b.test.ts` (memoryDb) | M | a technician creates, edits, deletes and bulk-imports a device (200/201); restore and reinstate → 403; a `SUPERVISOR` still → 403 on create |
| `routes/calibrationRecords.voidAdmin.ud4b.test.ts` (memoryDb) | M | a technician with `calibration` write → **403** on void (fail-before recorded: 200/409 without the gate); a tenant administrator → 200 on a submitted record, 409 on a voided one; an API key → 403 (unchanged) |
| `services/effectivePermission.ud4b.test.ts` | U | union semantics: the explicit `calibration` row yields write under an `equipment` read; a per-user `calibration: read` override still yields read |
| `services/menuEffectiveAccess.adr102.test.ts` (existing, re-baselined) | U | the technician's sidebar gains the write actions; no leaf without a reachable load route |
| `seededMenuSlugs.p919`, `routePermissionGuard.p604`, the A-58 boot check `authorizationWiring.util.ts#checkRoleMenuAssignments` | G | slugs seeded; assignments name seeded slugs only |
| `migrations/menuGrants.p2006.live.test.ts` | L (PG 18, as `callibrator_app`, on an **upgrade boot**) | rows present after upgrading a database seeded before the migration |
| live E2E: a technician registers a device and records a calibration; cannot void | B | the whole chain on a running stack (P21-10) |
| frontend `devices.technicianWrite.test.tsx` | F | the device page shows create/edit for a `calibration` writer with no role name in the page |

---

## 6. Traps Checked

New role without `ROLE_LEVELS` — none added · blanket `try/catch` in the migration — none; rows read back · a grant migration that downgrades — never (step 2 skips, step 3 only upgrades) · forgetting the permission cache — `permissions:role:*` flushed and proved · a per-user override silently overwritten — the migration never touches `user_menu_permissions` · `schema.validate` / path parameters — no new route here.

## 7. Out of Scope

Facility user management by a bound admin (UD-4 (c), no); certificate issuing for technicians (not widened; ISO/IEC 17025 7.8 stays with the laboratory's administrators); work-order writes for technicians (UI research 03 F4 also names them — **not** decided by UD-4 (b), stays an open UX question in that research); IPSRS accounts' creation flow (P21-09 / UD-17).
