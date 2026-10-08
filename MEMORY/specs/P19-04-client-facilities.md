# Feature Spec — P19-04 Client Facilities: the `client_facilities` Entity, `client_facility_id` on the Evidence Chain, the Second Scope Dimension in the Hooks, User Binding, Device Moves, and the Two-Facility Proof

**Written:** 2026-10-07 — **before** implementation. **Everything in this spec is TARGET: nothing here is built.**
**Task:** P19-04 (Phase 19, Domain Design). Builds in **P20-07** (migrations), **P21-09** (hooks, route gate, services, routes), **P22-09** (admin UI, bound navigation); consumed by P18-04 (test plan), P19-02 / P19-03 / P19-08 (IPM, device extensions, offline), P21-06 / P21-07 (export reads, dashboard), P24-01 / P24-02 (ETL), P25 (reconciliation), P17-07 (penetration test)
**Author:** software-architect agent, under the owner's standing delegation (decide by best practice, record it; owner decisions stay open with a recommendation)
**Card scope (verbatim):** *"Client-facility spec (ADR-124; was "access-grant spec"): `client_facilities` and its lifecycle, `client_facility_id` on the evidence chain and the backfill to each tenant's self facility, the second dimension in `tenantScope.util`, `FACILITY_READABLE`, the route marker, raw-SQL helper, socket rooms, cache keys, the A-90 sweep with performer snapshots, two-facility suite and guards."*
**Decision record:** **ADR-124 Amendment 2** (`MEMORY/DECISIONS.md`, written with this spec)
**Spec refs:** ADR-124 § 1 – § 11 and Amendment 1 · ADR-048 (includes), ADR-062 / migration 0057 (append-only), ADR-073 (hookless statics), ADR-084 Q-02 / migration 0089 (`callibrator.reinstate_device` — the transaction-local-setting precedent), ADR-100 Am. 3, ADR-101, ADR-102, ADR-107 (signed snapshot), ADR-120 (dashboard cache), ADR-125/126/127 · `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` (EP-01 … EP-24, AM-1 … AM-29, G-01 … G-31, OQ-1 … OQ-12; read-only here) · `MEMORY/specs/P18-03-facility-scope-permissions.md` § 4 – § 15 · `MEMORY/specs/P19-01-inspection-catalogue.md` (format) · `docs/UPSTREAM/03` § 4.2, § 5; `04` § 3, § 4.2, § 4.6, § 6, § 7; `05` § 3 – § 8; `07` § 1, § 2; `08` § 7 · `TASKS/PHASE-12-…` § 2 (group DoD, pre-invitation gate), § 3 (UD-9, UD-10, UD-11, UD-18, Q-57·T)
**Code read 2026-10-07 (working tree, including uncommitted A-365 work of another agent):** `backend/src/utils/tenantScope.util.ts` (resolution, eleven hooks, `refuseBulkTenantReassign` A-365), `middlewares/tenantContext.middleware.ts`, `middlewares/auth.middleware.ts` (`auth`, `optionalAuth`, `tryApiKeyAuth`, `tenantRefusal`, the super-admin header override), `services/auth.service.ts#getAuthUserWithTenant`, `utils/sql.util.ts`, `utils/jobContext.util.ts`, `config/socket.ts` (`scopeDrift` A-365, room joins), `services/notification.service.ts:110-120`, `services/dashboardCache.service.ts`, `services/storage/keys.ts`, `services/attachment.service.ts` (signed links v2, A-365), `services/session.service.ts` (`revokeOtherSessions`, `invalidateLiveness`), `services/tenant.service.ts#createTenant`, `services/tenantHierarchy.service.ts` (child tenant), `services/migration.service.ts` (`seedPlatformTenant`, `seedDefaultTenant`), `services/audit.service.ts` (raw count), models `user`, `calibrationDevice`, `calibrationRecord`, `certificate`, `maintenanceWorkOrder`, `attachment`, `warehouse`, `storageLocation`, `iotReading`, `nonConformance`, `auditLog`, `session`, `notification`, `consentRecord`, `dsarRequest`, `assetFinance`; `constants/attachmentResources.ts`, `routeGateExemptions.ts`, `platformTenant.ts`, `systemActors.ts`; `types/ids.ts`; migrations `0026`, `0057`, `0089`, `0103`, `0111` (P20-01, in flight); the includes of `calibrationRecords.service`, `calibrationDevices.service`, `certificate.service`, `certificateDocument.service`, `maintenance.service`; the 16 files holding `skipTenantScope: true`.

> **Privacy.** No upstream data value appears here. Counts are structural (`docs/UPSTREAM/03` § 4.2, § 5). Every example id, name and code is synthetic.

---

## 1. Problem

ADR-124 decided the model (the tenant is the calibration company; a health facility is a `client_facilities` row inside it; facility staff are **bound** users confined by a second, deny-by-default scope) and P18-03 decided the lists (bound roles, bound menu ceiling, marked routes, `FACILITY_READABLE`). Nothing fixes yet **the identifiers, the columns, the constraints, the migration, the hook mechanics, the operations that change a facility or a binding, and the proof.** Without them three failure classes stay open:

1. **Forgetting** — a table, include, raw statement, cache key, emitter or job that does not know the facility (the threat model's likeliest adversary is the developer).
2. **Then ↔ now** — a binding change or a facility leaving `active` not reaching sockets, sessions, signed links, the PWA (BF-4).
3. **Wrong facility at write time** — the ETL and the provider's own staff write with no facility hook at all (unbound principals skip the dimension); only the database can hold "a child's facility is its device's".

Personas: the **provider administrator** (unbound; creates facilities, binds users, moves devices), **provider technicians** (unbound; work across facilities), **facility staff** (bound; see one facility), the **self-served hospital** (one `is_self` facility; must notice nothing), the **ETL** (no context), the **platform operator** (skips both dimensions).

---

## 2. What Is Already Decided (not re-decided here)

| Decision | Source |
|---|---|
| `client_facilities` tenant-scoped; `UNIQUE (tenant_id, code)`, `UNIQUE (tenant_id, id)`; `kind` ∈ hospital, clinic, health_centre, district_office, laboratory, other; `is_self` with **exactly one per tenant**; `status` active / inactive / ended — a leaving client is `ended`, never deleted | ADR-124 § 2 |
| Every tenant gets its `is_self` facility at migration and at tenant creation | ADR-124 § 2, § 11 |
| NOT NULL `client_facility_id` on `calibration_devices`, `calibration_records`, `certificates`, `maintenance_work_orders`, `iot_readings`, `inspection_sessions`, `inspection_results`; NULLABLE on `attachments`, `warehouses`, `non_conformances`, `users`; composite FK `(tenant_id, client_facility_id)`; NULL = provider-internal; a CHECK ties nullable rows to their kind | ADR-124 § 3 |
| Bound iff `users.client_facility_id` is set; bound roles `HEALTHCARE ADMIN`, `HEALTHCARE TECHNICIAN`, `FACILITY MAINTENANCE`, `ROOM USER` (400 otherwise); an `inactive`/`ended` facility refuses its bound users with 403 | ADR-124 § 4; P18-03 § 4.1 |
| Context gains `clientFacilityId`, `facilityBound`, from the loaded user row only; the resolution order; deny for tenant models neither facility-scoped nor on `FACILITY_READABLE`; `skipFacilityScope` separate from `skipTenantScope` | ADR-124 § 5 |
| Cross-facility 404; route deny-by-default for bound users; one reviewed marker list `FACILITY_ACCESSIBLE_ROUTES` + one middleware, 403 before parameters are read; the guard's refusal rules | ADR-124 § 6, § 7; Am. 1 § 3 – § 4; P18-03 § 8 – § 9 |
| Raw SQL: a context-derived helper, no `($n IS NULL OR …)` form, `d05` twin rule | ADR-124 § 8 |
| Caches, sockets, exports, search/RAG, storage keys `t/<tenant>/f/<facility>/attachments/…`, audit `client_facility_id`, notifications, certificate customer = facility, API keys unbound, SSO/SCIM, impersonation, suspension, seats | ADR-124 § 9 |
| `FACILITY_READABLE` = `ClientFacility` (own), `Session`, `Notification`, `ConsentRecord`, `DsarRequest` (own user); service-internal reads use a reviewed `skipFacilityScope` | Am. 1 § 5; P18-03 § 10 |
| Slug `client-facilities` under `mgmt-organization`; `GET /client-facilities/mine` as the bound user's self read | Am. 1 § 7 – § 8; P18-03 § 7, § 8.1 S-8 |
| Serial numbers unique per facility `(tenant_id, client_facility_id, serial_number)` | UD-9 (owner, 2026-10-07) |
| No facility-bound user is invited before the pre-invitation gate (threat model § 11) is green and P17-07 has closed its findings | ADR-124 § 10; Phase 12 § 2 |

### Gaps and contradictions found — resolved by ADR-124 Amendment 2 (deviation protocol)

| # | What `docs/` / the ADR says | What is true or missing | Resolution (§) |
|---|---|---|---|
| G-F1 | ADR-124 § 5: "an **unbound** principal must supply" `client_facility_id` on create | Every device-create path today (API, bulk import, frontend) sends no facility; requiring it breaks every existing tenant — the regression § 11 promised would not happen | an unbound create without a facility defaults to the tenant's **self** facility **in the service**; children always take their parent's (§ 6.3) |
| G-F2 | ADR-124 § 3: "children keep the facility they were created in"; implication: "moving a device … has no answer yet. P19-03 decides"; threat model OQ-5 / OQ-12 | Children keeping their facility contradicts the composite FK `(tenant, facility, device)` the same section asks for, and leaves a moved device's history readable by the facility that no longer holds it. The composite keys are this card's, so the move must be decided here | **children follow the device**: one audited move operation, a transaction-local setting naming a move row, `ON UPDATE CASCADE` along one path, two audit rows (§ 11) |
| G-F3 | ADR-124 § 2 table: `deleted_at`, `is_deleted`; "soft delete refused while any facility-scoped row references it (RESTRICT)" | RESTRICT never fires on a soft delete (it is an UPDATE); a paranoid model gets a `defaultScope`, and **an include of a model with a `defaultScope` is an INNER JOIN** (A-75) — every device of a soft-deleted facility would vanish from the provider's lists | **not paranoid, no `defaultScope`** (the ADR-125 Am. 1 precedent); `ended` is the end of life; a hard `DELETE` only of a facility nothing references (the FK RESTRICT says so) (§ 4.6) |
| G-F4 | ADR-124 § 3: "a room (`warehouses` of kind room) must carry it" | `warehouses` has **no** kind column (`warehouse.model.ts`); UD-10 is open | the column is added now (nullable, composite FK), the CHECK waits for UD-10's room kind (§ 5.1) |
| G-F5 | ADR-124 § 10: "the author is shown from a snapshot (`performer_snapshot`)" | `calibration_records` has no snapshot column and is **append-only for every column added later** (0057); a backfilled snapshot would need the trigger disabled — and would record today's names as if they were the names at the time (the 0103 "no back-fill" argument) | where a snapshot exists it is used (ADR-126 sessions, ADR-107 signed certificates); elsewhere a **person display projection** read through a reviewed `skipFacilityScope` (§ 12) |
| G-F6 | Threat model AM-15: JIT/SCIM users created `INACTIVE` | `INACTIVE` already means "an administrator deactivated this account"; overloading it hides why an account is refused | a dedicated `users.facility_binding_pending` flag (AM-3 + AM-15, § 10.6) |
| G-F7 | ADR-124 § 9: a key whose facility segment differs from the row's is refused | after a move (G-F2) every object of the device carries the old segment; legacy keys of today's tenants carry none | legacy (segment-less) keys are valid for the self facility; a move flags `attachments.rekey_pending` and a job re-keys (§ 9.4) |
| G-F8 | Phase 12 § 3 UD-9: "the P19-03 spec and the P20-02 migration build" the per-facility serial | the constraint names `client_facility_id`, which exists only after P20-07; P20-02 waits on UD-10 | the serial swap and `calibration_devices UNIQUE (tenant_id, id)` (idempotently) land in **P20-07**; P20-02 keeps the QR (§ 5.2) |
| G-F9 | P18-03 Matrix C: `client-facilities` write for an unbound `HEALTHCARE ADMIN` "(self facility only)" | enforcing it would derive a capability from a role name — the alternative ADR-124 rejected; a hospital that starts serving a clinic is a valid tenant shape (reading (b)) | not enforced; the annotation reads as expected use (§ 13.1) |
| G-F10 | `docs/UPSTREAM/05` § 3.1 step 1 `tenants ← mst_faskes`; `id_map` without a facility; `04` § 4.6 key `t/<tenant>/attachments/…`; `04` § 4.2 `id_client → tenant_id` | superseded by ADR-124 (threat model F-10, FT-102, FT-105) | amended as target here (§ 15) |
| G-F11 | ADR-124 § 2 lists no rule for **who** may end a facility or what happens to its users and data | — | the lifecycle and its 409s (§ 4.4 – § 4.6); what the facility receives when it leaves is a contract question → **UD-18 (b)**, open (§ 20) |
| G-F12 | ADR-124 § 9: "certificate customer = the client facility, snapshotted at signing" | the signed snapshot (0103, ADR-107 v3 hash) has no customer | P21-09 adds `customer` to the snapshot under a v4 hash; a move is refused while a certificate of the device is unsigned (§ 11.2) |

---

## 3. The Model at a Glance

```
TENANT T (the calibration company — or a hospital serving itself)
 ├─ client_facilities ──────────────────────────────────────────────────────────────┐
 │    SELF (is_self, exactly one, always active)   F1 (client)   F2 (client) …       │ UNIQUE (tenant_id, id)
 │                                                                                    │
 ├─ users ── client_facility_id NULL ⇒ unbound (provider staff, all facilities)      │
 │          client_facility_id = F1 ⇒ bound to F1 (sees F1 only; DENY elsewhere) ─────┤ (tenant_id, client_facility_id) RESTRICT
 │                                                                                    │
 ├─ calibration_devices  (tenant_id, client_facility_id NN) ─────────────────────────┘ UNIQUE (tenant_id, client_facility_id, id)
 │     ▲ (tenant_id, client_facility_id, device_id)  ON UPDATE CASCADE  (one path)
 │     ├── calibration_records (NN) ◄── certificates.calibration_record_id (deferred, NO ACTION)
 │     ├── certificates (NN)
 │     ├── maintenance_work_orders (NN)
 │     ├── iot_readings (NN)
 │     ├── inspection_sessions (NN, P19-02) ◄── inspection_results (NN, cascade via session)
 │     └── non_conformances (nullable; NULL ⇔ no device)
 ├─ attachments (nullable; = its resource's facility — deferred constraint triggers, both sides)
 ├─ warehouses (nullable; rooms after UD-10)
 ├─ audit_logs (nullable, no FK, no back-fill; stamped from the row)
 └─ client_facility_moves (provider-internal; the move log + the trigger key)

GLOBAL (no dimension): roles, menus, the catalogue (ADR-125)
PROVIDER-INTERNAL (tenant-scoped, no facility column, not FACILITY_READABLE ⇒ DENY for bound): vendors, stock, kanban, tickets, QMS (except NC rows), finance, settings, keys, …
```

**Aggregates.** *Client facility* — identity, lifecycle; invariants: one self per tenant, self always active, `is_self`/`tenant_id` immutable. *Device* (root of the evidence chain) — its children share its facility, enforced by the database; the facility changes only through the move. *User binding* — a property of the user row, changed only through the binding operation.

**Domain events** (realised as audit rows written in the transaction, and socket emits after commit): `ClientFacilityCreated`, `ClientFacilityStatusChanged`, `UserFacilityBindingChanged`, `DeviceMovedBetweenFacilities`.

---

## 4. `client_facilities` (P20-07, migration M1)

Conventions as P19-01 § 4: UUID `id`, camelCase attributes over snake_case columns (`underscored`), `initModel` + `export =` alone; **every index, CHECK, unique and foreign key in the migration, none on the model** (ADR-100 Am. 3); no blanket `try/catch`. **Not `paranoid`, no `defaultScope`** (G-F3). Brand `ClientFacilityId` in `src/types/ids.ts` with its validating constructor `toClientFacilityId`, and the deny sentinel `NO_FACILITY_ID = "00000000-0000-0000-0000-00000000f000"` (a valid UUID no v4 generator produces; distinct from `NO_TENANT_ID` so a log says which branch denied; a CHECK forbids it as an `id`).

### 4.1 Columns

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | NN | `CHECK (id <> NO_FACILITY_ID)` |
| `tenant_id` | uuid → `tenants` RESTRICT | NN | stamped by the hooks; **immutable** (trigger) |
| `name` | varchar(255) | NN | trimmed, inner whitespace collapsed (`CHECK` as `device_types_name_normalised`); the self facility's starts as the tenant's name and is then independent |
| `code` | varchar(32) | NN | `^[A-Z0-9][A-Z0-9._-]{0,31}$` (upper-cased by the service); the self facility's is `SELF`; the ETL generates `F-0001` … in name order — **never** the upstream id (FT-104) |
| `kind` | ENUM `enum_client_facilities_kind` = `CLIENT_FACILITY_KINDS` | NN, default `other` | |
| `is_self` | boolean | NN, default false | **immutable** (trigger); set only by `createSelfFacility` |
| `status` | ENUM `enum_client_facilities_status` = `CLIENT_FACILITY_STATUSES` (`active`, `inactive`, `ended`) | NN, default `active` | § 4.4 |
| `status_reason` | varchar(500) | NULL | required by CHECK whenever `status <> 'active'`, and by the service on every change |
| `status_changed_at`, `status_changed_by` | timestamptz; uuid → users RESTRICT | NULL | |
| `address`, `city`, `province`, `postal_code`, `phone` | varchar(500/100/100/20/50) | NULL | organisational data the reports and the certificate customer block print |
| `contact_name`, `contact_email`, `contact_phone` | varchar(255/255/50) | NULL | **personal data** of the facility's contact person (UU PDP); optional; never in a bound principal's response except its own facility's; erased by the GDPR rectify/erase path of the facility's admin (P21-09) |
| `logo_storage_key` | varchar(1024) | NULL | `t/<tenant>/f/<facility>/branding/<uuid>.<ext>` (the 9 upstream logos, `07` § 2.2) |
| `legacy_id` | integer | NULL | upstream `mst_faskes.id`; `UNIQUE (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL`; **never** in any response contract |
| `created_by`, `updated_by` | uuid → users RESTRICT | NULL (system) | |
| `created_at`, `updated_at` | timestamptz | NN | |

### 4.2 Constraints and indexes (all in M1)

`client_facilities_tenant_id_id_unique` UNIQUE `(tenant_id, id)` (the composite-FK target) · `client_facilities_tenant_code_unique` UNIQUE `(tenant_id, code)` · `client_facilities_tenant_name_unique` UNIQUE `(tenant_id, lower(btrim(name)))` (the ETL resolves `07`'s one case/space duplicate group by merging into the survivor, both legacy ids mapped to it) · `client_facilities_one_self` UNIQUE `(tenant_id) WHERE is_self` · CHECK `client_facilities_self_active` `NOT is_self OR status = 'active'` · CHECK `client_facilities_status_reason` `status = 'active' OR btrim(coalesce(status_reason,'')) <> ''` · CHECK code / name shapes · D-20 leading indexes on `created_by`, `updated_by`, `status_changed_by` · list index `(tenant_id, status, lower(name), id)`. **No global uniqueness on any column** (the oracle trap).

Trigger `client_facilities_identity_immutable` (BEFORE UPDATE, ENABLE ALWAYS): refuses a change of `tenant_id` or `is_self`, for every role.

### 4.3 The self facility — created for every tenant

| Path | How the self facility is made |
|---|---|
| Existing tenants (incl. PLATFORM `00000000-0000-4000-8000-000000000001` and the default tenant) | M1 inserts one per tenant row (`paranoid: false` scope: soft-deleted tenants too), `name` = tenant name, `code` = `SELF`, `kind` = `other`, and one audit row each under the new system actor **`system:client-facility-backfill`** (`SYSTEM_ACTORS`, closed list) |
| `tenant.service#createTenant` (admin UI and access-request approval, P10-05) | `clientFacilityService.createSelfFacility(tenant, actor, { transaction })` right after `Tenants.create`, inside the same transaction; one audit row `CREATE ClientFacility` (operation `CREATE_SELF_FACILITY`) in the **new** tenant; the tenant's `CREATE` audit row (PLATFORM) gains `selfFacilityId` |
| `tenantHierarchy.service` child tenant | the same call, inside its `db.transaction` |
| `migration.service#seedPlatformTenant` / `#seedDefaultTenant` | `createSelfFacility` as an idempotent *ensure* (find, else create) — fresh installs and seeds after M1 |
| ETL (P24-02) | the provider tenant is created through `createTenant`, so it gets its self facility like any other |

`createSelfFacility` is idempotent (looks up `is_self` first). **Proof that no path forgets:** `selfFacility.p2007.live.test.ts` (every tenant has exactly one) and the source guard `tenantCreateSelfFacility.guard.test.ts` (every `Tenant.create` / `Tenants.create` call site in `src/` is in a function that also calls `createSelfFacility`). A database trigger that inserted the row by itself was rejected: invisible to `memoryDb` (route tests would run without self facilities), unaudited, and a second mechanism beside the service.

### 4.4 Lifecycle and 409 explanations

```
            ┌──────── deactivate (reason) ────────┐
   active ──┤                                     ▼
     ▲  ▲   └──── end (reason) ──► ended      inactive ── end (reason) ──► ended
     │  └──────────── reactivate (reason) ──────┘                            │
     └────────────────────── reinstate (reason, TENANT_ADMIN) ───────────────┘
   self: always active (CHECK + 409)
```

| Status | Bound users of the facility | Provider staff | New rows in the facility |
|---|---|---|---|
| `active` | work as marked | everything as gated | allowed |
| `inactive` (a paused contract; a facility being onboarded) | refused at `auth`, 403 `FACILITY_INACTIVE`; sessions revoked on entry (AM-1) | read and write as normal | allowed |
| `ended` (the client left) | refused, 403 `FACILITY_ENDED`; sessions revoked on entry | **read only** for this facility's rows; moves **out** allowed | **refused**: service 409 + database trigger `facility_accepts_inserts` (§ 5.4) |

| Request | Answer |
|---|---|
| any status change on the self facility | **409** "The tenant's own facility cannot be deactivated or ended — it holds the tenant's own devices." |
| to the current status | **409** "This facility is already `<status>`." |
| `ended` → `inactive` | **409** "An ended facility can only be reinstated to active." |
| `ended` → `active` without `rbac([TENANT_ADMIN])` | 403 (route) |
| bind a user to an `inactive`/`ended` facility | **409** "Users cannot be bound to a facility that is `<status>`." |
| create a device / record / session / work order / attachment in an `ended` facility | **409** "`<facility name>` has ended; new records cannot be added. Reinstate it first." |
| move a device into an `inactive`/`ended` facility | **409** "The target facility is `<status>`." |
| delete the self facility | **409** "The tenant's own facility cannot be deleted." |
| delete a referenced facility | **409** "This facility holds N devices and M users; end it instead — its history is kept." (counts read in the provider's own context) |
| create with a code or name the tenant already uses | **409** "A facility with this code / name already exists." (per tenant — never another tenant's) |

### 4.5 Uniqueness — summary

Per tenant: `code`, normalised `name`, `legacy_id`, one `is_self`. Per facility (on children): `serial_number` (§ 5.2). Per tenant (unchanged, provider-written): the QR (P19-03).

### 4.6 Ending and deleting — what happens to data and bound users

- **Nothing is deleted by ending.** Devices, records, certificates, sessions, photos and audit rows stay; provider staff keep reading them; the reconciliation and the facility's breach scoping keep working.
- **Bound users** of an ended or inactive facility stay bound and are refused (403 with code; the PWA purges on it — AM-1); their sessions are revoked in the status-change transaction; the admin UI offers "deactivate these N accounts" as a follow-up action (P22-09). They still count as seats (Q-57·T (b), open).
- **Retention after `ended`** and **what the facility is handed** (an export of its records, rendered by the provider's browser — ADR-126 § 8 — before ending) are contractual: **UD-18 (b)**, open with a recommendation (§ 20). Until answered: kept indefinitely, deleted only through the existing data-retention policy. **WORKING DECISION 2026-10-08** (Phase 12 § 3; owner may revise): the status dialog **offers a browser-rendered handover package** (inventory, calibration and IPM history, certificates — paginated reads of that facility, rendered in the frontend, nothing stored; the rendering audited without content) before `ended`; ending deletes nothing; retention after `ended` follows the client contract, **default: kept for the facility's legal evidence period** through a per-tenant setting `clientFacilities.endedRetentionYears` (unset = no end date; the data-retention policy reports what is past the period, legal hold outranks it, and a purge of append-only evidence needs its own ADR); bound accounts are **deactivated 30 days after `ended`** by a nightly audited job (`clientFacilities.boundUserDeactivationDays`, default 30). Built by P21-09 (status, job, settings), P21-06 (reads), P22-09 (dialog, package).
- **Hard delete** (`DELETE /client-facilities/:id`): allowed only for a non-self facility that nothing references — the composite FKs `RESTRICT` turn a referenced delete into a constraint error the service pre-checks and answers 409 (§ 4.4). Audit rows naming it keep the dangling id (`audit_logs.client_facility_id` has no FK, § 5.1). It exists for a facility created by mistake.

---

## 5. `client_facility_id` per Table (P20-07, migrations M1 – M7)

### 5.1 The table list

| Table | Null | Back-fill (existing rows) | Composite keys | CHECK | `ON UPDATE` |
|---|---|---|---|---|---|
| `calibration_devices` | **NN** | the tenant's self facility | FK `(tenant_id, client_facility_id)` → `client_facilities (tenant_id, id)` RESTRICT; **target** `UNIQUE (tenant_id, client_facility_id, id)`; `UNIQUE (tenant_id, id)` if absent (P20-02's, made idempotent) | — | (the move changes it, § 11) |
| `calibration_records` | **NN** | from its device | FK `(tenant_id, client_facility_id, device_id)` → devices `(tenant_id, client_facility_id, id)` RESTRICT; **target** `UNIQUE (tenant_id, client_facility_id, id)` | — | **CASCADE** |
| `certificates` | **NN** | from its device | FK `(…, device_id)` → devices, CASCADE; FK `(tenant_id, client_facility_id, calibration_record_id)` → records `(…, id)` **MATCH SIMPLE, NO ACTION, DEFERRABLE INITIALLY DEFERRED** (the record path is checked at commit, so each certificate is updated along **one** cascade path) | — | CASCADE (device path) |
| `maintenance_work_orders` | **NN** | from its device | FK `(…, device_id)` → devices | — | CASCADE |
| `iot_readings` | **NN** | from its device | FK `(…, device_id)` → devices | — | CASCADE |
| `inspection_sessions` (P19-02 / P20-04) | **NN** | — (new) | FK `(…, device_id)` → devices; target `UNIQUE (tenant_id, client_facility_id, id)` | — | CASCADE |
| `inspection_results` (P20-04) | **NN** | — | FK `(tenant_id, client_facility_id, session_id)` → sessions | — | CASCADE (via session) |
| `non_conformances` | nullable | from its device; NULL when `device_id` is NULL | FK `(…, device_id)` → devices MATCH SIMPLE | `(device_id IS NULL) = (client_facility_id IS NULL)` | CASCADE |
| `attachments` | nullable | from its resource for the facility-scoped types; NULL otherwise | none possible (polymorphic) → **AM-7 deferred constraint triggers**, § 5.3 | `client_facility_id IS NOT NULL` ⇔ `lower(resource_type)` ∈ {`certificate`, `device`, `calibrationdevice`, `calibration`, `calibrationrecord`, `workorder`, `maintenanceworkorder`} (+ the IPM photo types, added by P19-02/03's migration replacing the CHECK) | — (the move updates them, § 11) |
| `warehouses` | nullable | none (NULL = provider's store) | FK `(tenant_id, client_facility_id)` → `client_facilities` | **none until UD-10** defines a room kind (G-F4) | — |
| `users` | nullable | none (every existing user stays **unbound**) | FK `(tenant_id, client_facility_id)` → `client_facilities` RESTRICT MATCH SIMPLE | `client_facility_id IS NULL OR tenant_id IS NOT NULL` | — |
| `audit_logs` | nullable | **none** — append-only (0091), and a back-fill would invent a fact (0103's argument); a NULL on a pre-migration row means the tenant's self facility, the only one then | **no FK** (a trail outlives what it names, like `resource_id`) | — | — |
| `client_facility_moves` | (n/a) | — | FKs `(tenant_id, from_/to_client_facility_id)` → facilities; `(tenant_id, device_id)` → devices `(tenant_id, id)` | `from <> to` | — |

**Not facility-scoped (provider-internal, DENY for bound principals), each with its reason in `facilityScopedModels.guard`:** `asset_finance` (has `device_id`; finance is the provider's business), `e_signature_records` / `signature_records` (until UD-17), `storage_locations` (provider stores), `document_chunks` (RAG not reviewed), every other tenant model. The guard (G-11) reads the **real** model registry: a model with a `device_id`/`deviceId` attribute must declare `clientFacilityId` or be on the provider-internal list with a reason.

**Indexes (D-20, all in the migrations):** each composite FK gets its leading index — devices `(tenant_id, client_facility_id, id)` (the unique), children `(tenant_id, client_facility_id, device_id)`, results `(tenant_id, client_facility_id, session_id)`, users and warehouses `(tenant_id, client_facility_id)`, `audit_logs (tenant_id, client_facility_id, created_at)` (breach scoping, ADR-124 § 9). List-order indexes for bound lists are **measured** in P21-09 (the U-06 method), not guessed.

### 5.2 Serial numbers (UD-9) — in M2

M2 drops 0026's `UNIQUE (tenant_id, serial_number)` and adds `calibration_devices_tenant_facility_serial_unique` `UNIQUE (tenant_id, client_facility_id, serial_number)` (NULLs distinct, as 0026). Identical behaviour for every existing tenant (one facility each); a move into a facility holding the serial is a 409 (§ 11).

### 5.3 The polymorphic attachment rule (AM-7) — in M7

Two `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` (checked at commit, so the move can update a device before its attachments):

1. `attachments_facility_matches_resource` — AFTER INSERT OR UPDATE OF `client_facility_id`, `resource_type`, `resource_id` ON `attachments`: for a facility-scoped type, loads the resource **including soft-deleted rows** and refuses unless its `client_facility_id` equals the attachment's; for any other type, refuses a non-NULL facility.
2. `<table>_attachments_follow_facility` — AFTER UPDATE OF `client_facility_id` ON each resource table: refuses at commit if any attachment of that row still carries the old facility (a move that forgot the attachments fails loudly).

The service stamps an attachment's facility **from its resource, loaded in context** — never from the request (FT-25).

### 5.4 The facility column is immutable outside two operations (AM-6) — in M2 – M7

**Database (every role, ENABLE ALWAYS, the 0089 pattern):**

- `facility_column_guard()` — BEFORE UPDATE OF `client_facility_id` on every NN table and `non_conformances`/`attachments`: a change is refused unless the transaction-local setting `callibrator.facility_move` names a `client_facility_moves` row with `status = 'in_progress'` whose `device_id` is the row's device (resolved per table by a trigger argument: the row itself for devices, `device_id` for children, the session's device for results, the resource's device for attachments) and whose `from`/`to` equal `OLD`/`NEW`. An `in_progress` move row is visible only to the transaction that inserted it, so only the moving transaction passes.
- **0057's function is replaced** (M3) so that `calibration_records` additionally allows exactly that change under that setting; every other column stays immutable. P20-05's results trigger and any later append-only trigger on a facility table must carry the same exception (requirement handed to P19-02).
- `users_binding_guard()` — BEFORE UPDATE OF `client_facility_id` ON `users`: refused unless `callibrator.facility_binding` names that user's id (set only by the binding operation, § 10).
- `users_bound_role_check()` — BEFORE INSERT OR UPDATE OF `role_id`, `client_facility_id` ON `users`: a bound row's role name must be in `FACILITY_BOUND_ROLES` (protects the ETL, SCIM and every path the hooks do not see).
- `facility_accepts_inserts()` — BEFORE INSERT on devices, records, certificates, work orders, sessions, results, attachments, non-conformances: refuses when the facility is `ended`. **`iot_readings` excluded**: machine telemetry of a device whose client left is dropped by the ingestion service (it reads the status) instead of failing the MQTT path.

- **`facility_insert_default()` — added as built by ADR-124 Am. 3 (P20-07):** BEFORE INSERT (attachments also `UPDATE OF resource_type, resource_id`; non-conformances also `UPDATE OF device_id`) on devices, records, certificates, work orders, readings, NCs and attachments. It fills a NULL facility and never replaces a given one. A device gets its tenant's self facility **only while the tenant has no other facility** (otherwise 23502); a child gets its device's; an NC gets its device's, or NULL without one; a linked attachment gets its record's. It stands in for G-F1's service default until P21-09 builds that, and it stays as the backstop.
- **As built (Am. 3):** `client_facility_moves` also has a deferred constraint trigger refusing a COMMIT that leaves a move `in_progress`; the children's composite keys copy `ON DELETE` from 0037's single-column device keys (records, certificates, readings RESTRICT; work orders CASCADE; NCs `SET NULL (client_facility_id, device_id)`).

**Application (hooks, § 7.4):** `beforeUpdate` / `beforeBulkUpdate` refuse a change of `clientFacilityId` from **any** context unless `options.facilityMove` (the move service) or `options.facilityBinding` (the binding service) is set — the facility twin of A-365's `refuseBulkTenantReassign`, but applied to unbound principals and the super admin too: it is an integrity rule, not a scope rule. No context (ETL, migrations) is skipped, as for every hook; the triggers hold there.

### 5.5 `client_facility_moves` (M1; provider-internal)

`id`, `tenant_id` NN, `device_id` NN, `from_client_facility_id` NN, `to_client_facility_id` NN, `reason` varchar(500) NN, `status` ENUM `in_progress`/`completed` NN, `counts` jsonb (children moved per table, attachments flagged for re-key), `moved_by` uuid → users RESTRICT NN, `created_at`, `completed_at`. Append-only by trigger except `in_progress → completed` with `completed_at`/`counts`; no DELETE. No `client_facility_id` attribute → bound principals DENY (its `from` names another client).

---

## 6. Migration and Back-fill Plan (P20-07)

### 6.1 The migrations (numbers follow the catalogue's `0111`/`0112`; renumber at implementation)

| # | File (proposed) | One transaction does |
|---|---|---|
| M1 | `0113-client-facilities` | ENUM types; `client_facilities` (create unless `db.sync()` did) + § 4.2 constraints + identity trigger; `client_facility_moves`; `audit_logs.client_facility_id` + index; `calibration_devices UNIQUE (tenant_id, id)` if absent; the trigger functions of § 5.4 (defined, not yet attached); **one self facility per tenant** + its audit row (`system:client-facility-backfill`) |
| M2 | `0114-facility-devices` | `calibration_devices.client_facility_id`: add NULL → `UPDATE … SET client_facility_id = <tenant's self>` → `SET NOT NULL` → FK + unique → serial swap (§ 5.2) → guard + insert triggers |
| M3 | `0115-facility-calibration-records` | add → back-fill from device → NOT NULL → FK CASCADE + unique → 0057 function replaced (§ 5.4) |
| M4 | `0116-facility-certificates` | add → from device → NOT NULL → both FKs |
| M5 | `0117-facility-work-orders` | add → from device → NOT NULL → FK |
| M6 | `0118-facility-iot-readings` | add → from device → NOT NULL → FK (no insert trigger, § 5.4) |
| M7 | `0119-facility-nullable` | `attachments` (+ `rekey_pending boolean NN default false`), `non_conformances`, `warehouses`, `users` (+ `facility_binding_pending boolean NN default false`): add, back-fill where § 5.1 says, CHECKs, FKs, AM-7 triggers, users triggers |

**One transaction per large table** (ADR-124 § 11): devices, records, certificates, work orders, IoT readings each alone; the nullable set together (small). Order is forced: M4's record FK needs M3's unique; M7's attachment triggers need every resource table to have the column.

### 6.2 Locking, batch size, timing

- Each back-fill is **one set-based statement** (`UPDATE child c SET client_facility_id = d.client_facility_id FROM calibration_devices d WHERE d.id = c.device_id AND d.tenant_id = c.tenant_id AND c.client_facility_id IS NULL`). Batching inside a transaction would not shorten the lock (the rows stay locked until commit); batching across transactions would break "one transaction per migration".
- `SET LOCAL lock_timeout = '10s'` (the 0111 precedent): a migration that cannot get its lock fails fast and is **not** recorded as applied.
- **Volumes:** the reference deployment's volumes are fresh since 2026-10-02 (small); the upstream's ~330 k rows arrive **after** these migrations, written with their facility by the ETL. The back-fill touches today's data only. P20-09 measures M3/M6 on production-shaped data; if a table there takes longer than the upgrade window, that card splits it (batched, idempotent `WHERE client_facility_id IS NULL`, NOT NULL in a following migration) — recorded, not assumed.

### 6.3 Upgrade-boot rule and deploy rule

- `db.sync()` runs before the migrator: the models declare `clientFacilityId` **without** `references` and **without** any model index (the composite FKs and indexes exist only in migrations — ADR-100 Am. 3, `modelIndexColumns.am3.guard`). `ClientFacility` and `ClientFacilityMove` declare no indexes either.
- Fresh install: ~~`sync` creates the columns NOT NULL~~ **as built (ADR-124 Am. 3): the models declare `clientFacilityId` `allowNull: true` (the database fills it on insert), so `sync` creates the columns nullable and M2 – M6 `SET NOT NULL`;** M1 – M7 add the constraints and triggers and find no rows to back-fill; the seeds' `createSelfFacility` ensures the self facilities.
- **Deploy rule — Recreate for this release.** An old replica inserting a device with no facility after M2 gets a NOT NULL error. Compose runs one replica; the Helm values for this release set `strategy: Recreate` (or the operator scales to zero first). Rollback after M2 is the pre-upgrade backup (`db-backup`), as ADR-116 provides; `down` migrations exist but refuse when any non-self facility, any bound user or any move exists (data loss), and otherwise drop in reverse order.

### 6.4 Verification (live PostgreSQL 18, **as `callibrator_app`**)

`make migrate-verify` (`schemaVerify` gains the new columns, constraints and triggers) — the log is not evidence — and the live tests of § 17 (G-25 row), each on an **upgrade boot** (`upgradeBoot.am3.live`) from the image before P20-07 with seeded data: every tenant has one self facility; every NN column is NOT NULL and back-filled; a child naming another facility's device is refused by the FK; the CHECKs refuse; the AM-7 triggers refuse at commit; `UPDATE … client_facility_id` without a move is refused for the owner too; a move with the setting passes and cascades; `users` binding and role triggers refuse.

---

## 7. The Context and the Hooks (P21-09)

### 7.1 The context — one writer (AM-2)

`TenantContextStore` gains:

| Field | Type | Set from |
|---|---|---|
| `userId` | `UserId \| null` | `req.user.id` (user principals); null for API keys, jobs, no principal — needed by the `own-user` rules of `FACILITY_READABLE` |
| `clientFacilityId` | `ClientFacilityId \| null` | `req.user.clientFacilityId` — the **row** `getAuthUserWithTenant` loaded |
| `facilityBound` | `boolean` | `req.user.clientFacilityId != null` — a **row property** (AM-3), never inferred from a join or a role |

- **Exactly one writer per entry path:** `tenantContextMiddleware` (for `auth`, `optionalAuth` and `tryApiKeyAuth` alike, so they share one derivation — FT-02), `authenticateHandshake` for sockets, `runForTenant` for jobs. `facilityContextSource.guard` (G-16) fails on any other assignment. No header, body, query, path, cookie, JWT claim, socket payload or OIDC claim carries a facility; the super-admin `x-tenant-id` override gains **no** facility twin (FT-06).
- `getAuthUserWithTenant` adds `clientFacilityId` and `facilityBindingPending` to the user projection and includes `ClientFacility` (`id`, `status`) with `required: false` (it runs with no context).
- **API key** principals: `facilityBound: false` — tenant-wide by design (ADR-124 § 9; FT-04 accepted; the key-creation screen says "this key reads every client facility").
- **Impersonation:** the token is the target's; the context is the target's row (FT-05).
- **Super admin:** `isSuperAdmin` skips both dimensions (unchanged).

### 7.2 Refusals at authentication (403, machine-readable codes in `@callibrator/contracts` `FACILITY_REFUSAL_CODES`)

After the tenant refusal (A-101) and before the context is built, for a user principal:

| Condition | Code | Message |
|---|---|---|
| `facilityBindingPending` | `FACILITY_BINDING_PENDING` | "Your account is waiting for an administrator to assign it to a facility." |
| bound, facility row missing (cannot happen with the FK; held anyway) | `FACILITY_UNRESOLVED` | "Your facility could not be found." |
| bound, facility `inactive` | `FACILITY_INACTIVE` | "Your facility's access is paused." |
| bound, facility `ended` | `FACILITY_ENDED` | "Your facility's access has ended." |

`optionalAuth` treats each as "no principal" (as it treats a suspended tenant). The PWA purges its working set on these codes as on 401 (AM-1; P19-08 builds the client side).

### 7.3 Resolution of the facility dimension

`tenantScope.util.ts` keeps `resolveScope` (tenant) unchanged and adds `facilityKeyOf(model)` (`"clientFacilityId" | "client_facility_id" | null`) and:

```
resolveFacilityScope(model, options):
  options.skipFacilityScope                         -> skip   (reviewed, G-13)
  no context                                        -> skip   (pre-auth, migrations, ETL, schedulers)
  ctx.isSystemTask || ctx.isSuperAdmin              -> skip
  !ctx.facilityBound                                -> skip   (provider staff; self-served hospitals)
  model has neither tenant key nor facility key     -> skip   (global: roles, menus, catalogue, tenants)
  facilityKeyOf(model)                              -> filter  { client_facility_id: ctx.clientFacilityId ?? NO_FACILITY_ID }
  FACILITY_READABLE[model.name]                     -> rule    { <rule.attribute>: <ctx value> ?? NO_FACILITY_ID / NO_TENANT_ID }
  otherwise                                         -> deny    { <tenant key>: NO_TENANT_ID }   (provider-internal)
```

- The facility predicate is **AND-ed beside** the tenant predicate and **forced** by the same spread/`Op.and` as `withTenantPredicate` — a caller's own `clientFacilityId` in a `where` (a provider filter) cannot widen a bound query (FT-10).
- **`skipTenantScope` does not skip the facility dimension** (FT-30): a bound request reaching any of today's 29 opt-outs still gets the facility branch, and the **deny** branch writes `NO_TENANT_ID` on the tenant column even when the tenant predicate was skipped.
- `ClientFacility` is tenant-scoped, **declares no `clientFacilityId`** (it *is* the facility) and reaches bound users only through its `FACILITY_READABLE` rule `id = ctx.clientFacilityId` (AM-8).

### 7.4 Every hook branch

> **As built (P21-09a, ADR-124 Am. 4 § 3):** a bound create is **stamped** when the facility (or rule value) is missing and **refused** when it names another — never overwritten ("forced" read as "cannot end up anywhere else", the tenant hooks' `bulkCreate` rule); the own-facility rule never stamps a primary key. Built in `utils/tenantScope.util.ts` (`resolveFacilityScope` … `refuseFacilityChange`); tests `tenantScope.facility`, `tenantScope.facilityDeny`.

| Hook / path | Tenant (today) | Facility twin (target) |
|---|---|---|
| `beforeFind`, `beforeCount` (root) | `applyTenantWhere` | `applyFacilityWhere`: filter / rule / deny as § 7.3 |
| includes (A-87, ADR-048) | `scopeIncludes` with join type pinned | the same walk resolves **each include's** model: facility-scoped → predicate in its ON clause; readable → rule; provider-internal → `NO_TENANT_ID` in its ON clause (**deny per include, AM-5**: LEFT → NULL, INNER → row drops); `through` models too; `separate` includes re-enter `beforeFind`; include-level `skipFacilityScope` honoured |
| `beforeBulkUpdate` | `refuseBulkTenantReassign` (A-365) + where | `refuseFacilityReassign` (AM-6, any context, unless `facilityMove`/`facilityBinding`) + facility where |
| `beforeBulkDestroy`, `beforeBulkRestore` | where by **field** (W-33) | facility where by field (`client_facility_id`) |
| `beforeDestroy`, `beforeRestore` (instance) | `assertSameTenant` | `assertSameFacility` for bound principals |
| `beforeCreate` | stamp tenant | bound: **stamp and force** the facility on facility-scoped models; on `FACILITY_READABLE` models stamp/require the rule value; on provider-internal models **refuse** ("a facility-bound principal cannot write provider-internal data") unless `skipFacilityScope` (reviewed: quota counters, audit is facility-scoped so not affected). Unbound: nothing (the service supplies, § 6.3 of G-F1) |
| `beforeUpdate` (instance) | stamp tenant | refuse `changed("clientFacilityId")` unless the typed option (AM-6) |
| `beforeBulkCreate` | stamp / refuse mismatch | bound: stamp missing, refuse a mismatched row; deny scope: refuse |
| `beforeUpsert` | refuse missing/mismatch | bound: refuse a missing or mismatched facility (an upsert cannot be stamped) |
| `aggregate` (`sum`/`min`/`max`/`count`), static `increment` (W-34) | wrapped | the wrappers add the facility predicate (and include walk) the same way; `scopedByCount` keeps single application (FT-11, FT-17, FT-18) |
| `TRUNCATE` | refused in any non-skip tenant scope | a bound context is always a tenant filter scope → already refused; a bound case is added to the W-34 test (FT-19) |

### 7.5 `FACILITY_READABLE` — the mechanics (constants/facilityAccess.ts)

```ts
export const FACILITY_READABLE = {
  ClientFacility:  { rule: "own-facility", attribute: "id",      reason: "the bound user's own facility row (AM-8)", test: "clientFacility.twoFacility.test.ts" },
  Session:         { rule: "own-user",     attribute: "user_id", reason: "own sessions (snake-case model)",         test: "ownSessions.facility.test.ts" },
  Notification:    { rule: "own-user",     attribute: "userId",  reason: "own notifications; tenant broadcasts hidden", test: "notification.facility.test.ts" },
  ConsentRecord:   { rule: "own-user",     attribute: "userId",  reason: "own consent",                             test: "gdprSelf.facility.test.ts" },
  DsarRequest:     { rule: "own-user",     attribute: "userId",  reason: "own data-subject requests",               test: "gdprSelf.facility.test.ts" },
} as const satisfies Record<string, FacilityReadableEntry>;
```

The attribute is per model because `Session` uses snake-case attributes (the CLAUDE.md trap). A rule kind other than `own-facility` / `own-user` does not compile. `facilityReadable.guard` (G-12) checks each entry's model exists, is tenant-scoped, declares the attribute, and that the named test file exists and names the model.

### 7.6 `skipFacilityScope` and the sweep of today's opt-outs

- Typed in `src/types/sequelize.d.ts` beside `skipTenantScope`, root and include level.
- Every use carries `// skipFacilityScope: <reason>` and an entry in `FACILITY_SCOPE_SKIPS` (constants/facilityAccess.ts, keyed `"<file>#<function>"`); `skipFacilityScope.guard` (G-13) fails on a use without an entry or an entry without a use. The initial list is P18-03 § 10.2 (tenant settings, `TenantKey`, quota tables, the GDPR export's subject rows, the tenant's own row) **plus** `personDisplay.service#displayPeople` (§ 12) and `userFacilityBinding.service` / `deviceMove.service` lookups that must see the target facility's rows.
- **P21-09 must review each of today's 29 `skipTenantScope: true` sites** (16 files: `controllers/sso.controller.ts`; `services/auth.service.ts` (3), `bootstrapCredential`, `customDomains`, `gdpr`, `jobMonitor`, `loginDiscovery` (4), `ownSessions` (2), `passkeyLogin`, `rateLimiter.redis`, `scheduledBackup` (2), `session` (5), `signInPolicy` (2), `tenantLifecycle` (2), `user`) and record per site: *unreachable under a bound context* (pre-auth, system), *correct under the facility branch* (e.g. `ownSessions` → `Session` own-user rule), or *needs a reviewed `skipFacilityScope`*.

### 7.7 The route gate — identifiers and mechanics

> **As built (P21-09b, ADR-124 Am. 4 § 4 – § 5):** the index is `app.router`, registered at boot by `utils/routeTable#registerAppRouteIndex` with each router mapped to its route file; `resolveRoute` uses router 2's own matchers; **no index registered refuses every bound request**. Marked so far: S-1 (verify, logout, logout-all, socket-token, impersonate/exit), S-2 `GET /sessions/mine`, S-5 `GET /notifications` + `PATCH /read-all`, S-6, S-7 `PATCH /users/:userId/profile` (`selfParam`), S-8. Tests `facilityRouteIndex.parity`, `facilityRouteDefault` (G-10), `facilityAccessibleRoutes.guard` (G-09).

- **`FACILITY_ACCESSIBLE_ROUTES`** (constants/facilityAccess.ts), keyed like `routeGateExemptions` (route file → `"METHOD /path"`) → `{ kind: "read" | "write" | "self", reason, selfParam?, boundGate? }` — the P18-03 § 8 rows.
- **`facilityRouteGate`** (`middlewares/facilityRouteGate.middleware.ts`) is called **from `tenantContextMiddleware`** for a bound principal, after the context is built — so it covers routers that mount `auth` with `router.use(auth)` (33 routers do; `req.route` is not set there) and route-level `auth` alike, and it runs before any `validate` (AM-12: id-independent 403).
- It cannot read `req.route` at that point, so it resolves the route the way Express will: **`routeIndex`**, built once at boot after every router is mounted (`index.ts`), by **the same walker the guards use** (moved from the guard tests into `src/utils/routeTable.ts`), is the **ordered** list of `(method, compiled full path, route file, "METHOD /path")` in mount and registration order. The gate takes the **first** entry matching the request (HEAD as GET) — so a shadowing route (`GET /calibration-devices/stats` registered before `GET /:id`) resolves to the route Express will dispatch. Marked → pass (then `selfParam` / `boundGate` checks); unmarked → **403 `FACILITY_ROUTE_REFUSED`** "This action is not available to facility accounts."; no match → pass (Express answers 404).
- Parity is **proved**, not assumed: `facilityRouteIndex.parity.test.ts` builds a request from every mounted route (with planted shadowing cases) and asserts the index resolves it to that route; G-10 calls every unmarked mounted route as a bound `HEALTHCARE ADMIN` and expects 403 with an identical body for a valid and an invalid id.

---

## 8. Raw SQL — the Facility Predicate Helper (AM-9)

`utils/facilityPredicate.util.ts`:

```ts
/** The facility clause for a raw statement, from the CONTEXT only. No facility parameter exists (AM-9). */
export const facilityClause = (column: FacilityColumn, position: number): { clause: string; bind: BindValue[] };
// column: an identifier matching /^([a-z_]+\.)?client_facility_id$/ (an allow-listed shape, never a value)
// skip (no ctx / system / super admin / unbound) -> { clause: "", bind: [] }
// bound                                         -> { clause: ` AND ${column} = $${position}`, bind: [ctx.clientFacilityId ?? NO_FACILITY_ID] }
```

- The clause is appended **last** (`position = bind.length + 1`), so an empty clause shifts no placeholder.
- No `IS NULL OR` form exists; `d05`'s twin rule rejects `client_facility_id IS NULL OR` anywhere (FT-35).
- **`rawSqlTenantPredicate.d05` twin rule:** a `sql()` call whose text names a facility-scoped table (derived from the real models declaring `clientFacilityId`) must build its text with `facilityClause(` **or** be listed in `RAW_SQL_UNREACHABLE_BY_BOUND` with a reason checked against the marker list. Initial entries (statements naming a facility-scoped table today): `search.service` (`calibration_devices`, `certificates` — search unmarked, ADR-124 § 9); `audit.service` count (`audit_logs` — audit route unmarked); `attachment.service#listOrphans` (`rbac([TENANT_ADMIN])`, unmarked); `calibrationDeviceReinstate.service` (rbac, unmarked); `qms.service` (`non_conformances`, unmarked); `meteredBilling.service` (system task). Each later marked route with raw SQL needs a live twin (`rawSqlFacility.live.test.ts`) — memoryDb refuses raw SQL (F-9).

> **As built (P21-09d, ADR-124 Am. 6 § 1):** `facilityClause` as above; the twin rule is `tests/utils/rawSqlFacilityPredicate.d05twin` (a stronger scanner than d05) with `RAW_SQL_UNREACHABLE_BY_BOUND` (seven statements, each reachable only from unmarked routes or system work). No marked route runs raw SQL over a facility table today; `literal()` subqueries are forbidden (G-15).

---

## 9. Sockets, Caches, Storage Keys, Signed Links, Notifications, Jobs

### 9.1 Socket.IO (AM-19, AM-20; F-6)

- The handshake builds the context of § 7.1 from the loaded user and refuses § 7.2's conditions.
- Rooms: **unbound** → `tenant_<tenantId>`, `user_<id>` (+ `super_admins`) as today; **bound** → `facility_<tenantId>_<clientFacilityId>` and `user_<id>` **only** — never `tenant_<id>`. No client event joins a facility room; `kanban:join` under a bound context is refused (kanban is provider-internal).
- `scopeDrift` (A-365) gains: `clientFacilityId`, `facilityBound`, and the facility's status ≠ `active` → disconnect (never re-join in place).
- One emitter helper `emitForRow(row, event, payload)` (services/realtime.ts): emits to `tenant_<row.tenantId>` and, when the row has a facility, to `facility_<tenantId>_<row.clientFacilityId>` — the facility named from the **row**, never the actor. `notification.service`'s tenant broadcast (no `userId`) carries no facility data and reaches no bound socket. `socketFacilityRooms.guard` / `socketEmitters.facility.guard` (G-19): no `join(` of a `tenant_` room outside the unbound branch; every `io.to(` in `services/` goes through the helper or the user room.

### 9.2 Caches (AM-18; F-3)

`dashboardCacheKey` takes the **scope from the context**, not controller arguments, and bumps the prefix to `dashboard:metrics:v2`: unbound tenant principal `…:tenant:<t>:all:<target>`; bound `…:tenant:<t>:f:<f>:<target>`; platform unchanged. The `:all` / `:f:<id>` segments cannot coincide. `cacheKeyFacility.guard` (G-20): every Redis key builder in `services/` that caches tenant data takes the scope object. Permission caches are unchanged (roles are global; bound-ness is not cached in them — FT-62); the binding operation clears `permissions:user:<id>`.

### 9.3 Storage keys

`keys.ts#buildKey({ tenantId, clientFacilityId?, domain, name })` → `t/<tenant>/f/<facility>/<domain>/<name>` when a facility is given (UUID-validated like the tenant segment; domains `attachments`, `branding`); `assertKeyForTenant` unchanged; new `facilityOfKey(key)` → the segment or `null` (legacy). Facility-owned files get the segment; provider-internal files keep `t/<tenant>/…`. **Integrity check before any signed link or stream** (after the row is loaded in the caller's context — AM-17's only allowed post-load comparison): the key's segment equals the row's `client_facility_id`, **or** the key has no segment and the row's facility is the tenant's self facility (today's files, ADR-124 § 9), **or** `rekey_pending` is true; anything else is refused and logged as an integrity error (FT-77).

### 9.4 Re-keying after a move

The move flags every attachment whose key segment differs from the new facility (`rekey_pending = true`, same transaction) and enqueues a re-key job (`runForTenant`, existing batch-job machinery, the storage migration tool's copy-then-switch): copy object and derivatives to `t/<tenant>/f/<to>/attachments/…`, switch `storage_key` and clear the flag in one statement, delete the old object after commit. Re-runnable; RC-F3 accepts flagged rows.

### 9.5 Signed links (AM-22; on top of A-365's v2 token)

A-365 (in flight, another agent) caps the lifetime and binds tenant + issuer. P21-09 bumps the message to `attachment-link/v3|id|tenant|facility|issuer|exp` with the row's facility at minting, and at redemption additionally requires: the row's facility still equals the token's (a moved attachment kills old links), and — for a user issuer who is **bound** — the issuer is still bound to that facility and the facility is `active` (a moved or ended user's links die). Every failure stays the same 404. S3 presigned URLs only after the in-context load, with the same cap (FT-78). No signed link in a stored or exported artefact.

### 9.6 Notifications and jobs (AM-21, AM-4)

- `recipientsFor(row, menuSlug)` (services/notificationRecipients.ts): unbound users of the row's tenant holding the menu, plus bound users **of the row's facility** holding it; never another facility's users. Jobs never build a per-tenant recipient list for facility data; digests for bound users are built per facility. P21-09 sweeps today's device reminders (`calibrationScheduler` / `system:calibration-scan`) onto it.
- `runForTenant(tenantId, fn, scope?: { clientFacilityId: ClientFacilityId })` — a job **started by** a bound principal passes its facility (`facilityBound: true`); none exists in this group (exports are browser-rendered).

> **As built (P21-09d, ADR-124 Am. 6 §§ 2 – 6):** `emitForRow` in `services/realtime.ts`; `recipientsFor` answers the tenant broadcast (unbound users, unchanged) plus the bound users of the row's facility addressed one by one; `dashboard:metrics:v2` with `:all:` / `:f:<id>:` from the context; key segment for `attachments` / `branding`, the upload carrying its record's facility; the re-key job runs after the move's commit (no periodic sweep yet); the v3 token is `<exp>.<tenant>.<issuer>.<facility | ->.<sig>`, a bound issuer `b<id>`.

---

## 10. User Binding (AM-1, AM-3, AM-14, AM-15; OQ-1)

### 10.1 The operation

`PUT /api/v1/users/:userId/client-facility` — body `userFacilityBinding` `{ clientFacilityId: uuid | null, roleId?: uuid, reason: string }`; gates `auth, denyApiKey, dynamicAccess("users", "write"), rbac([TENANT_ADMIN]), validate(schema, { from: ["params", "body"] })`; **unmarked** (a bound `HEALTHCARE ADMIN` gets 403 before the parameters are read).

`userFacilityBinding.service#setBinding(actor, userId, input)`:

1. The actor is **unbound** (re-checked in the service: 403 "Only an administrator who is not bound to a facility can change bindings.") — AM-14.
2. The target is loaded in the actor's context (other tenant → 404); not the actor (**400** "You cannot change your own facility binding." — an administrator binding itself would drop out of administration mid-act); not a super admin (404).
3. **Bind** (`clientFacilityId` set): the facility loaded in context (404), not `is_self` (**409** "Users are not bound to the tenant's own facility — leave them unbound."), `active` (409, § 4.4); the resulting role (`roleId`, or the current one) ∈ `FACILITY_BOUND_ROLES` (**400** naming the four roles). Same facility and role → **409** "This user is already bound to this facility with this role."
4. **Unbind** (`null`): `roleId` **required** (400 "Choose the role this user will hold across every facility.") — an unbound `HEALTHCARE ADMIN` in a provider tenant is a tenant administrator, so the administrator must pick it consciously; the existing role-assignment rules of `user.service` apply. Also clears `facility_binding_pending` (the "confirm unbound" path of § 10.6).
5. **One transaction:** lock the user row `FOR UPDATE`; `set_config('callibrator.facility_binding', userId, true)`; update `clientFacilityId`, `roleId`, `facilityBindingPending = false` with `{ facilityBinding: true }`; **revoke every session of the user** (`sessionService.revokeOtherSessions(userId, null, "FACILITY_BINDING_CHANGED", { transaction })` — AM-1, OQ-1 answered *yes*); audit rows (§ 16: one per affected facility). After commit: `invalidateLiveness(revoked ids)`, clear `permissions:user:<id>`, `io.in("user_<id>").disconnectSockets(true)` (best effort; `scopeDrift` catches it within 60 s anyway).

`GET /api/v1/client-facilities/:clientFacilityId/users` (gate `users` read) lists a facility's bound users for the admin UI.

### 10.2 Binding at creation and invitation

`POST /users` (admin create) accepts `clientFacilityId` from an unbound administrator, under the same rules as § 10.1 step 3, audited as a bind. The invitation / first-sign-in link (P10-15) is sent **after** the row exists bound; the token is an opaque reference and carries no facility (AM-14, FT-45). **Pre-invitation gate:** while the threat model § 11 gate is not green, `POST /users` and the binding route answer **409** "Facility-bound accounts are not enabled yet." when `FACILITY_BINDING_ENABLED` (a boot-time `config/env.ts` flag, default `false`) is off — the gate becomes a switch the release flips with a record, not a convention.

### 10.3 Mass assignment

Every other user contract is **strict** and has no `clientFacilityId`, `facilityBindingPending`, `tenantId` (and self-profile no `roleId`, `status`): `PATCH /users/edit`, `PATCH /users/:userId/profile`, avatars, SCIM, the GDPR rectify path. The hooks (AM-6) and `users_binding_guard` refuse the column change anyway. `userBinding.massAssignment.test.ts` sends the field to each and asserts 400 / ignored and the binding unchanged.

### 10.4 Session revocation on facility status

Moving a facility out of `active` revokes every session of its bound users in the same transaction (AM-1); `scopeDrift` disconnects sockets.

### 10.5 Audit and attribution

Every bind, unbind, move-binding and confirm-unbound writes its audit row(s) inside the transaction (FT-47); a rolled-back binding leaves none (`auditInTransaction` pattern).

### 10.6 SSO JIT and SCIM (AM-15; OQ-3 — owner to confirm)

In a tenant that has any non-self facility, a user created by **SSO JIT** (`sso.service`) or **SCIM** (`scim.service`) is created with `facility_binding_pending = true` and is refused at `auth` with `FACILITY_BINDING_PENDING` until an unbound administrator binds it or confirms it unbound (§ 10.1 step 4). A tenant with only its self facility is unchanged. SCIM cannot set or clear the facility (an extension attribute naming it → 400) and cannot give a bound user a role outside the bound set (400; the DB trigger also holds). The OIDC provider emits no facility claim.

> **As built (P21-09e, ADR-124 Am. 6 §§ 11 – 12):** JIT and SCIM create pending accounts in a multi-facility tenant; SCIM refuses any facility attribute and a non-bound role for a bound user (400); `POST /users/create` accepts `clientFacilityId` under § 10.1 step 3. The mass-assignment test is `routes/userBinding.massAssignment`.

---

## 11. Moving a Device Between Facilities (OQ-5, OQ-12 — decided here, G-F2)

### 11.1 The decision

**Children follow the device.** The device's whole history — records, certificates, work orders, IoT readings, IPM sessions and results, non-conformances, photos — moves with it, because the evidence belongs to the instrument: the facility now holding it needs its calibration status and history (ISO/IEC 17025 7.5, metrological traceability of the instrument), and the facility that gave it up no longer has a reason to see it. History is not rewritten: what was recorded is unchanged; only the access attribute moves, and the move itself is recorded. For a **bound** viewer of the new facility, people bound to the old facility are shown redacted (§ 12).

### 11.2 The operation

`POST /api/v1/calibration-devices/:calibrationDeviceId/move` — body `deviceMove` `{ targetClientFacilityId: uuid, reason: string }`; gates `auth, denyApiKey, dynamicAccess("calibration", "write"), rbac([TENANT_ADMIN]), validate(…, { from: ["params", "body"] })`; unmarked. `deviceMove.service#moveDevice`:

1. Actor unbound (403). Device loaded `FOR UPDATE` in context (404); target facility loaded in context (404).
2. **409s:** target = current ("The device is already in this facility."); target `inactive`/`ended`; device `retired` ("A retired device stays in the facility that retired it; reinstate it first."); an open IPM draft on the device ("Submit or discard the N open IPM draft(s) of this device first."); a certificate of the device not yet signed or voided ("Certificate `<number>` is `<status>`; issue or void it first — its customer is the facility the calibration was done for."); the serial already used in the target facility ("A device with this serial number already exists in `<target>`.").
3. Transaction: insert `client_facility_moves` (`in_progress`); `set_config('callibrator.facility_move', moveId, true)`; `UPDATE calibration_devices SET client_facility_id = :to` with `{ facilityMove: moveId }` → the database **cascades** to every child along one path (§ 5.1) and `facility_column_guard` admits each row because the move row matches (RI actions run as the referencing table's owner, so `callibrator_app`'s column grants are not involved — **to be proven** by `deviceMove.p2007.live.test.ts`, not assumed); update the attachments of the device and of every moved child (`client_facility_id = :to`, `rekey_pending` where the key's segment differs); write the counts and mark the move `completed`; two audit rows (OQ-12, § 16); commit — the AM-7 deferred triggers check attachments at commit.
4. **The device's room** (added 2026-10-08 by the P19-03 spec § 9, ADR-132 § 8): the body also accepts `targetLocationId` (a room of the target facility, or a store); before the facility update the move sets it, or clears a room of the old facility — the room trigger of P19-03 § 6.2 holds the result.
5. After commit: enqueue the re-key job (§ 9.4); `emitForRow` `device:moved_out` to the old facility room (device id only) and `device:moved_in` to the new one; the dashboard cache expires within its 30 s.

`GET /api/v1/calibration-devices/:calibrationDeviceId/moves` (gate `calibration` read; unmarked) lists the device's moves for provider staff. Bound users see no move history (it names another client).

### 11.3 What a move does not do

It does not move audit rows (each keeps the facility where its act happened — that is the breach-scoping record); it does not change any snapshot (a signed certificate keeps the customer it was issued for); it does not move users. PWA outbox items captured for the device in the old facility replay into a 404 and stay "needs attention" (FT-93).

> **As built (P21-09d, ADR-124 Am. 6 § 7):** `POST …/move` and `GET …/moves` (gates `rbac` first, then `calibration` write); `targetLocationId` null clears, omitted clears a room of the old facility and keeps a store; files of the device and of its records, certificates and work orders follow, flagged. **Not built:** the open-IPM-draft 409 (P20-04 / P21-03 add it with the sessions).

---

## 12. The A-90 Sweep and How People Are Shown (G-F5)

**Why it widens:** provider staff have `client_facility_id` NULL, so for a bound viewer every `User` include of a provider author resolves to NULL. Since A-90/A-227 every such include on the evidence chain is already `required: false` (read 2026-10-07: `calibrationRecords.service` `performer`; `certificate.service` / `certificateDocument.service` / `certificatePdf.service` `calibratedByUser`, `approvedByUser`, `signedByUser`; `maintenance.service` `assignee`, `vendor`; `calibrationDevices.service` `warehouse`), so **no row disappears** — but the author shows as nothing, and for **bound colleagues** the include returns `email`, which a facility user does not need.

**The rule:**

1. Every include of `User` (and of any provider-internal model) reachable from a facility-scoped root stays `required: false` — pinned by `facilityUserIncludes.guard` (G-24), which walks the services' include trees from every model declaring `clientFacilityId`.
2. Responses carry an additive `…Display` field beside each person reference — `performerDisplay`, `calibratedByDisplay`, `approvedByDisplay`, `signedByDisplay`, `assigneeDisplay`, `uploaderDisplay`, `reporterDisplay` — of shape `{ name: string | null, role: string | null, organisation: string | null, redacted: boolean }` (`personDisplay` in `@callibrator/contracts`; no id, e-mail, phone or username — FT-15).
3. Source, in order: a stored snapshot (ADR-126 `performer_snapshot`; ADR-107 `signed_snapshot` for signed certificates; **`calibration_records.performer_snapshot`, written at insert for records created after P20-02 — ADR-133 narrows Am. 2 § 7, no back-fill**; `calibration_devices.registrant_snapshot` — ADR-132); else `personDisplay.service#displayPeople(userIds)`, one batched read of `users` (first/last name, role name, facility, tenant) through a **reviewed `skipFacilityScope`** (tenant predicate kept; `paranoid: false`, so a departed person still has a name). `organisation`: the tenant's name for an unbound author, the author's facility name for a bound one. A user outside the tenant (the super admin acting inside it, A-90/Q-17) → `{ name: "Platform support", … }`.
4. **Redaction for bound viewers:** an author **bound to a different facility** than the viewer (history moved in by § 11) is returned `{ name: null, role, organisation: null, redacted: true }` — "staff of a previous facility". Unbound viewers see every name.
5. For a bound viewer the raw `User` include objects are NULL (the hooks) and stay so; the opaque user-id columns stay in the payload (an id resolves to nothing a bound user can reach — FT-16).
6. The certificate document of an **unsigned** certificate, for a bound viewer, takes its people from `displayPeople`; a signed one from its snapshot.

Swept lists (the P18-03 Matrix D reads): A-1 devices, A-4 records, A-6 attachments, A-7 certificates (list, get, document, PDF link), A-8 work orders, N-2 IPM sessions — each with an `includes.a90.facility.test.ts` case: the facility's own records, authored by provider staff, are **present** in its own staff's lists, with a non-redacted display.

> **As built (P21-09e, ADR-124 Am. 6 §§ 8 – 10):** `services/personDisplay` and `@callibrator/contracts/people`; the displays are added by the A-4/A-6/A-7/A-8 controllers for every viewer. **Deviation from rule 6:** an unsigned certificate's document reads its people's printed names through a reviewed include-level skip (the same document and hash as the provider's). A-1 … A-8 and the self routes S-1 … S-7 are marked with their two-facility suites.

---

## 13. API — Routes, Contracts, Gates, Markers, Status Codes

### 13.1 Routes (`routes/api/clientFacilities.route.ts` + `.openapi.ts`; mounted `/api/v1/client-facilities`)

> **As built (P21-09c, 2026-10-08, ADR-124 Am. 5 § 4):** every administration route below is mounted with the gates of this table; `PATCH` and `POST …/status` validate `clientFacilityEdit` / `clientFacilityStatusRequest` (the body plus the path parameter) from `["params", "body"]`; the `client-facilities` menu entry is seeded **inactive** until its page (P22). `GET /menu-groups/my-permissions` answers `facilityBound`; the bound menu ceiling is applied in `effectivePermission`.
>
> **As built (P21-09b, ADR-124 Am. 4 § 1, § 6):** `GET /mine` and `PUT /users/:userId/client-facility` are mounted; the administration routes wait for **P20-06** (the `client-facilities` and `ipm` slugs) and land in P21-09c — their service is `services/clientFacilityAdmin.service.ts`. The binding route's gate is `dynamicAccess("users", "update", { checkTenant })` (`update` normalises to write).

| Method + path | Gate | Marked (bound) | Two-tenant | Notes |
|---|---|---|---|---|
| `GET /` | `dynamicAccess("client-facilities", "read")` | no | — | list; `status`, `kind`, `q` (name/code, ≤ 100), `sort` (`name`, `code`, `createdAt`) ending in `id`; `page`/`limit` ≤ 200; rows in `data`, paging in top-level `meta` |
| `GET /options` | `dynamicAccess(["calibration", "ipm", "client-facilities"], "read")` | no | — | `{ id, name, code, status, isSelf }` for pickers and the provider's facility filter (technicians lack `client-facilities`) |
| `GET /mine` | exemption **`self`** (routeGateExemptions) | **yes**, kind `self` (P18-03 S-8) | — | the caller's facility `{ id, name, code, kind, isSelf, status }` or `null` (unbound); registered **before** `/:clientFacilityId` |
| `GET /:clientFacilityId` | read | no | ✔ `@two-tenant` | full row incl. contacts; never `legacyId` |
| `POST /` | `"write"` + `denyApiKey` | no | — | `clientFacilityCreate`; never `isSelf`, `status`, `tenantId` |
| `PATCH /:clientFacilityId` | write + `denyApiKey` | no | ✔ | `clientFacilityUpdate`; the self facility's name/kind/address editable |
| `POST /:clientFacilityId/status` | write + `denyApiKey`; `ended → active` additionally `rbac([TENANT_ADMIN])` in the service | no | ✔ | `clientFacilityStatusChange`; § 4.4; revokes bound users' sessions on leaving `active` |
| `DELETE /:clientFacilityId` | write + `denyApiKey` + `rbac([TENANT_ADMIN])` | no | ✔ | § 4.6 |
| `GET /:clientFacilityId/users` | `dynamicAccess("users", "read")` | no | ✔ | bound users of the facility |

Elsewhere: `PUT /api/v1/users/:userId/client-facility` (§ 10.1, ✔ two-tenant), `POST /api/v1/calibration-devices/:calibrationDeviceId/move` and `GET …/moves` (§ 11, ✔ two-tenant). Existing lists of devices, records, certificates, work orders (and IPM, P21-03) gain an optional `clientFacilityId` query filter — a **convenience for unbound callers, not a boundary**: for a bound caller the forced predicate makes a foreign value return nothing (not an error). Their rows gain `clientFacilityId` and, for unbound callers, a LEFT include `clientFacility { id, name, code }`.

**`client-facilities` write is not restricted to the self facility for an unbound `HEALTHCARE ADMIN`** (G-F9).

`POST /auth/verify` gains `clientFacilityId`, `facilityBound` and `facilityMode: "single" | "multi"` (does the tenant have any non-self facility) — the frontend hides every facility concept in `single` mode, so a self-served hospital sees no change. `GET /menu-groups/my-permissions` gains `facilityBound` (P18-03 § 13).

All `:id` routes above are **unmarked**, so they need no `@two-facility` case; G-10 asserts their 403 for a bound principal. The **marked** routes this card adds is only `GET /mine` (no path parameter).

### 13.2 Contracts (`packages/contracts/src/`, named exports)

- `states.ts`: `CLIENT_FACILITY_KINDS`, `CLIENT_FACILITY_STATUSES`, `CLIENT_FACILITY_MOVE_STATUSES` (held equal to the ENUMs by `stateUnions.p905.guard`).
- `clientFacilities.ts`: `clientFacilityCreate` (strict: `name` 1–255 normalised, `code` regex, `kind`, optional address/contact fields, `contactEmail` e-mail), `clientFacilityUpdate` (partial, strict, non-empty), `clientFacilityStatusChange` (`status`, `reason` 3–500), `clientFacilityListQuery` (strict), `clientFacility` / `clientFacilityMine` / `clientFacilityOption` responses, `userFacilityBinding`, `deviceMove`, `clientFacilityMove` response, `personDisplay`, `FACILITY_REFUSAL_CODES` (`FACILITY_BINDING_PENDING`, `FACILITY_UNRESOLVED`, `FACILITY_INACTIVE`, `FACILITY_ENDED`, `FACILITY_ROUTE_REFUSED`).
- Validation: `validate(schema, { from: ["params", "body"] })` on every `:id` route (the path-parameter trap); handlers read `validated(req, schema)`.

### 13.3 Status codes

400 validation (bound role set, unbind without role, self-binding) · 403 own-tenant permission, `FACILITY_ROUTE_REFUSED`, the account codes of § 7.2, a bound actor on a binding/move · **404** another tenant's facility/user/device, **another facility's row for a bound user** (indistinguishable from missing) · **409** every state conflict of § 4.4, § 10.1, § 11.2, with its explanation.

---

## 14. Admin UI Requirements (P22-09)

- **Client facilities** page (`/dashboard/client-facilities`, `client-facilities` read; hidden in `single` mode except a "this organisation" card for the self facility): list with status tone (status-tone registry: active, inactive, ended — shape + icon, ADR-122), filters, search; detail with tabs *Profile*, *Bound users*, *Devices* (link to the filtered inventory), *History* (audit, unbound admins only); create/edit form; status dialog requiring a reason and showing the consequences ("N bound users will be signed out and refused"); delete only offered when nothing references the facility; ending offers "deactivate the N bound accounts" as a follow-up.
- **Bind / unbind dialog** on the user page and the facility's *Bound users* tab: facility picker (`/options`, active, non-self), role picker limited to the four bound roles when binding, **mandatory** role choice with a warning when unbinding ("this user will see every facility"), reason, consequence line ("their sessions end now"). Hidden while `FACILITY_BINDING_ENABLED` is off (the API says so with 409).
- **Move device dialog** on the device page (unbound tenant admins): target picker, reason, the 409 explanations shown verbatim.
- **Facility filter** (convenience) on devices, records, certificates, work orders and IPM lists for unbound users in `multi` mode, and a facility column.
- **Bound user's shell:** the facility name (from `/mine`) beside the tenant; navigation per P18-03 § 13; no facility switcher, ever (R-04 (6)).
- **Refusal page** for the five `FACILITY_*` codes with the § 7.2 messages and sign-out; the PWA purges on them (P19-08 / P22-10).
- **API key creation** shows "This key reads every client facility" in `multi` mode (FT-04).
- `id.ts` and `en.ts` for every string; warm-palette tokens only; one `<main>`/`<h1>`; accessibility suite in light and dark; frontend tests with a bound principal and with `single` mode (nothing facility-related renders — the self-served regression).

---

## 15. Import Implications (P24-01 / P24-02 / P25)

- **Order (amends `05` § 3.1 step 1):** `tenants ← the provider tenant` (through `createTenant`, which creates its self facility) → **`client_facilities ← mst_faskes`** (UD-11 decides which rows; codes generated `F-0001…`; names trimmed and the one duplicate group merged; `legacy_id` = upstream id) → users → … Every facility-owned row's `client_facility_id` comes from the **upstream device row's `id_client`** via `id_map('mst_faskes')`, never inferred from a name; children take their device's (the composite FKs refuse anything else — FT-99).
- **`upstream_import.id_map` gains `client_facility_id`** (AM-28) — the facility the transform **decided** — so RC-F1 compares the decision with what landed.
- **Users (AM-27):** a `client` / `teknisi_client` account with **zero or several** `trx_mapping_user_client` rows is never imported unbound: `quarantine` reason `facility_mapping_ambiguous`, resolved by the operator (two accounts, or provider staff) before invitation. Imported facility users are written bound (the bound-role trigger holds the role set) and invited only after the pre-invitation gate.
- **Files:** keys `t/<tenant>/f/<facility>/attachments/<uuid>.<ext>` (amends `04` § 4.6); the AM-7 trigger checks every attachment against its device at commit.
- **No hook protects the ETL** (no context): the database constraints of § 5 are the only control — NOT NULL, composite FKs, CHECKs, AM-7, bound-role, ended-insert triggers.
- **Reconciliation per facility (P25, G-30):** RC-F1 … RC-F5 of the threat model, RC-F3 accepting `rekey_pending` rows.

---

## 16. Audit Events

Every row inside its transaction; `audit_logs.client_facility_id` stamped **from the row** (or the context when there is no row). `auditService.logAction` gains `clientFacilityId`; when a caller omits it and the `resourceType` is facility-scoped, the service resolves it from the resource in the same transaction (one PK read) — so a forgetful caller still stamps correctly (`auditFacilityStamp.test.ts`).

| Act | `action` | `resourceType` | `changes.operation` | Facility on the row | `changes` also carries |
|---|---|---|---|---|---|
| self facility at tenant creation / back-fill | `CREATE` | `ClientFacility` | `CREATE_SELF_FACILITY` | the self facility | tenant id; actor or `system:client-facility-backfill` |
| create / edit | `CREATE` / `UPDATE` | `ClientFacility` | `CREATE_CLIENT_FACILITY`, `UPDATE_CLIENT_FACILITY` | the facility | before/after (contact fields as "changed", not values) |
| status change | `UPDATE` | `ClientFacility` | `CHANGE_CLIENT_FACILITY_STATUS` | the facility | from, to, reason, sessions revoked count |
| delete | `DELETE` | `ClientFacility` | `DELETE_CLIENT_FACILITY` | the facility | name, code |
| bind / unbind / re-bind / confirm unbound | `UPDATE` | `User` | `BIND_FACILITY`, `UNBIND_FACILITY`, `REBIND_FACILITY`, `CONFIRM_UNBOUND` | **one row per affected facility** (old and new) | from, to, role before/after, reason, sessions revoked count |
| device move | `UPDATE` | `CalibrationDevice` | `MOVE_DEVICE_OUT` (old facility) and `MOVE_DEVICE_IN` (new) — **two rows** (OQ-12) | each its facility | move id, from, to, reason, per-table counts, attachments flagged |

---

## 17. Test Plan — Mapped to the Gate Rows of `docs/SECURITY/15` § 11

Kinds as there: U unit · M memoryDb route test · L live PostgreSQL 18 as `callibrator_app` · G guard over the real route table / model registry / source · F frontend · B browser · R reconciliation. **Fail-before evidence** (a planted violation the test catches) is recorded by the building card for every G row and for G-01/G-06/G-14.

| Gate | Test(s) — this spec's content | Kind | Built by |
|---|---|---|---|
| **G-01** | `utils/tenantScope.facility.test.ts` — every line of § 7.3; forced predicate against `where: { clientFacilityId: F2 }` and `[Op.or]`; `skipTenantScope` under a bound context still filters; deny writes `NO_TENANT_ID` on provider-internal models | U | P21-09 |
| **G-02** | `utils/tenantScope.facilityDeny.test.ts` — iterates the **real** registry: bound + no facility → zero rows of every facility model; bound → zero rows of every provider-internal model; readable models only their rule | U/M | P21-09 |
| **G-03** | `utils/tenantScope.facilityIncludes.test.ts` (twin of `tenantScope.includes.a87`) — both join types, `through`, `separate`, `{ all: true }`; deny per include (device → vendor/warehouse NULL for bound) | U/M | P21-09 |
| **G-04** | `utils/tenantScope.facilityHookless.test.ts` + `services/tenantHookless.facility.live.test.ts` | U + L | P21-09 |
| **G-05** | `utils/tenantScope.facilityBulkDestroy.test.ts` (column name, underscored model) | U | P21-09 |
| **G-06** | `utils/tenantScope.facilityImmutable.test.ts` — instance and bulk update of `clientFacilityId` refused for bound, unbound and super admin without the typed option; allowed with it | U/M | P21-09 |
| **G-07** | `fixtures/twoFacilitySuite.ts` (+ `probeCrossFacility` in `fixtures/routeClient`) on every **marked** `:id` route: one tenant with SELF, F1, F2; bound F1 HA/RU/HT/FM, bound F2 HA, unbound CA and T; T2/F3 for the tenant regression; 404 identical to missing, absent from lists, nothing written, positive control; `@two-facility <file> <METHOD> <path>` | M | P21-09 + each route's card |
| **G-08** | `guards/twoFacilityRoutes.guard.test.ts` | G | P21-09 |
| **G-09** | `guards/facilityAccessibleRoutes.guard.test.ts` (P18-03 § 9 rules) — planted markers on `POST /api-keys`, `PATCH /users/edit`, a backup route, `POST /certificates/:id/approve`, `PUT /users/:userId/client-facility`, `POST /calibration-devices/:id/move` each fail it | G | P21-09 |
| **G-10** | `routes/facilityRouteDefault.test.ts` (every unmarked mounted route → 403 `FACILITY_ROUTE_REFUSED` for a bound HA, identical for valid/invalid ids; every marked route also works unbound) + **`middlewares/facilityRouteIndex.parity.test.ts`** (§ 7.7, shadowing cases) | M/G | P21-09 |
| **G-11** | `guards/facilityScopedModels.guard.test.ts` — § 5.1 list from the registry; a model with `deviceId` must declare `clientFacilityId` or be listed; `ClientFacility` declares none; no model index on `client_facility_id` | G | P20-07 |
| **G-12** | `guards/facilityReadable.guard.test.ts` (§ 7.5) | G | P21-09 |
| **G-13** | `guards/skipFacilityScope.guard.test.ts` (§ 7.6) + the recorded review of the 29 `skipTenantScope` sites | G | P21-09 |
| **G-14** | `utils/rawSqlTenantPredicate.d05.test.js` twin rule; `utils/facilityPredicate.util.test.ts` (no facility parameter at the type level; skip/bound/deny; placeholder last); `rawSqlFacility.live.test.ts` per marked raw statement | G + U + L | P21-09 |
| G-15 | `guards/literalSubquery.guard.test.ts` (AM-10, hardening) | G | P21-09 |
| **G-16** | `middlewares/facilityContext.auth.test.ts` (header/body/query/path/claim ignored; the five refusal codes), `facilityContext.optionalAuth.test.ts`, `guards/facilityContextSource.guard.test.ts` | U + G | P21-09 |
| **G-17** | `services/facilityBinding.revokesSessions.test.ts`, `facilityBinding.audit.test.ts` (one row per facility; rollback leaves none), `userBinding.massAssignment.test.ts`, `userBinding.roles.test.ts`, `userBinding.selfBind.test.ts`, `invitation.facility.test.ts`, `clientFacilityStatus.revokesSessions.test.ts` | U/M | P21-09 |
| **G-18** | `services/ssoJit.facility.test.ts`, `services/scim.facility.test.ts` (§ 10.6) | U | P21-09 |
| **G-19** | `config/socket.facilityRooms.test.ts`, `socket.facilityRecheck.test.ts`, `guards/socketFacilityRooms.guard.test.ts`, `guards/socketEmitters.facility.guard.test.ts` (existing `config/socket.test.js` extended) | U + G | P21-09 |
| **G-20** | `services/dashboardCache.twoFacility.test.ts` (existing `dashboardCache.u06b.test.ts` extended: `:all` vs `:f:`), `guards/cacheKeyFacility.guard.test.ts` | U + G | P21-07 / P21-09 |
| **G-21** | `services/notificationRecipients.twoFacility.test.ts` | U/M | P21-09 |
| **G-22** | `routes/exportReads.twoFacility.test.ts` — includes the device list with the `clientFacilityId` filter naming F2 from F1 → empty | M | P21-06 |
| **G-23** | `routes/attachmentSigned.twoFacility.test.ts`, `services/attachmentSigned.replay.test.ts` (v3 token: row moved / issuer re-bound / facility ended → 404), `storage/storageKeyFacility.test.ts` (segment, legacy key for self, `rekey_pending`) | M + U | P21-09 |
| **G-24** | `services/includes.a90.facility.test.ts` (§ 12 lists, display present, redaction after a move), `guards/facilityUserIncludes.guard.test.ts`, `services/personDisplay.test.ts` (exact key set), `performerSnapshot.p2103.test.ts`; existing `includes.a90.test.js`, `includeRequired.d12.test.js` stay green | M + G + U | P21-09 / P21-03 |
| **G-25** | `migrations/facilityBackfill.p2007.live.test.ts`, `selfFacility.p2007.live.test.ts`, `facilityCompositeFk.live.test.ts`, `facilityNotNull.p2007.live.test.ts`, `attachmentFacilityTrigger.live.test.ts` (both sides, at commit), **`facilityImmutable.p2007.live.test.ts`** (owner and app role refused without a move), **`deviceMove.p2007.live.test.ts`** (cascade along one path, 0057 exception, certificate→record deferred FK, attachments, `in_progress` row invisible to another session), **`usersBinding.p2007.live.test.ts`** (binding guard, bound-role trigger), **`endedFacilityInsert.p2007.live.test.ts`**; existing `upgradeBoot.am3.live.test.ts`; `make migrate-verify` | L | P20-07 |
| G-26 | (AM-16, AM-25 — P19-02 / P21-03) | U/M | P21-03 |
| G-27 | (PWA — P22-10; this spec provides the refusal codes and `/verify` fields) | F | P22-10 |
| **G-28** | live E2E two-facility spec: bound F1 / F2 users and a provider technician; lists, details, exports, photos, sockets; **plus** a binding change and a facility `ended` while signed in, and a device move between the two with both users watching | B | P21-10, P22-10, P26-02 |
| G-29 | (`upstream_import` grants — P24-01) | L | P24-01 |
| **G-30** | RC-F1 … RC-F5 with `id_map.client_facility_id` (§ 15) | R | P25 |
| **G-31** | the existing tenant suites unchanged, **plus the self-served regression**: the full existing backend suite and the live E2E pass on a tenant with only its self facility and no bound user, with no test edited for behaviour (fixtures may gain a self facility) | U/G/B | every card |

**Additional tests this spec defines (not gate rows):** `services/clientFacility.service.test.ts` (§ 4.4 table row by row, each 409 asserting its text; self facility immutable), `routes/clientFacilities.twoTenant.test.ts` (every `:id` route of § 13.1 → 404 for T2, `@two-tenant`), `services/deviceMove.service.test.ts` (each 409 of § 11.2; two audit rows; rollback leaves none), `guards/tenantCreateSelfFacility.guard.test.ts` (§ 4.3), `contracts clientFacilities.contract.test.ts`, `stateUnions.p905.guard`, `pageOrderTiebreaker.ci3.guard`, `routePermissionGuard.p604`, `twoTenantRoutes.guard` passing with the new routes, live API smoke of every new route (P21-10).

**Privacy:** synthetic fixtures only ("Facility One", code `F-0001`, `contact@example.test`).

---

## 18. Threat-Model Additions (AM-n) — Adopted Here, and Left to Other Cards

| AM | Here | How | Left to |
|---|---|---|---|
| AM-1 | **adopted** (OQ-1 → yes) | binding change and a facility leaving `active` revoke sessions in the transaction (§ 10.1, § 10.4); server refusal codes (§ 7.2) | client purge: P19-08 / P22-10 |
| AM-2 | **adopted** | one writer per entry path; no claim/header (§ 7.1) | build P21-09 |
| AM-3 | **adopted** | `facilityBound` = row's `client_facility_id IS NOT NULL`; `facility_binding_pending` row flag (§ 7.1, § 10.6) | — |
| AM-4 | **adopted** (signature) | `runForTenant(…, { clientFacilityId })` (§ 9.6) | no job in this group |
| AM-5 | **adopted** | deny per include (§ 7.4) | — |
| AM-6 | **adopted** | hooks (typed options) + DB triggers for every role (§ 5.4) | — |
| AM-7 | **adopted** | two deferred constraint triggers (§ 5.3) | IPM photo types: P19-02/03 |
| AM-8 | adopted by P18-03; **identifiers fixed** (§ 7.5) | — | — |
| AM-9 | **adopted** | `facilityClause(column, position)`, no facility parameter (§ 8) | — |
| AM-10 | adopted as G-15 (hardening) | — | P21-09 |
| AM-11 | refined by P18-03 (Am. 1 § 4); **planted cases added** (G-09) | — | — |
| AM-12 | **adopted** | gate in `tenantContextMiddleware`, before `validate`, ordered route index (§ 7.7) | — |
| AM-13 | **adopted** (rule) | a handler never treats `clientFacilityId == null` as "all"; a provider filter is an explicit validated query parameter (§ 13.1) | — |
| AM-14 | **adopted** | binding writers, strict contracts, invitation carries nothing (§ 10) | — |
| AM-15 | **adopted** as a mechanism (pending flag, G-F6) | § 10.6 | owner confirmation: OQ-3 |
| AM-16 | — | — | P19-02 / P19-08 |
| AM-17 | **adopted** (rule) | rows loaded in context; the key check is the only post-load comparison (§ 9.3) | — |
| AM-18 | **adopted** | context-derived key, `:all` / `:f:<id>`, prefix v2 (§ 9.2) | dashboard marking: P21-07 (OQ-8) |
| AM-19 | **adopted** | `emitForRow` (§ 9.1) | — |
| AM-20 | **adopted** | `scopeDrift` + facility fields (§ 9.1) | — |
| AM-21 | **adopted** | `recipientsFor(row, slug)` (§ 9.6) | — |
| AM-22 | **adopted (facility part)** | v3 token binds the facility; re-check at redemption (§ 9.5) | TTL cap and tenant/issuer binding: A-365 (in flight) |
| AM-23, AM-24, AM-26 | — | `/verify` exposes `clientFacilityId`, `facilityBound`, `facilityMode` for the fingerprint | P19-08 / P22-10 |
| AM-25 | — | — | P19-08 / P21-03 |
| AM-27 | **constraint fixed** (bound-role trigger; quarantine reason named) | § 15 | P24-02 |
| AM-28 | **schema fixed** | `id_map.client_facility_id` (§ 15) | P24-01 |
| AM-29 | — | — | P21-01 |

**Threat-model questions answered here** (for the owner of `docs/SECURITY/15`, which this card did not edit): **OQ-1** yes (AM-1); **OQ-5** children follow the device through an audited move (§ 11) — the question was assigned to P19-03 there, decided here because the composite keys are this card's; **OQ-12** two audit rows. **OQ-3** still awaits the owner.

---

## 19. Traps Checked

| Trap | Here |
|---|---|
| optional include without `required: false` | `clientFacility` include on lists LEFT; G-24 guard over every `User` include from facility roots |
| include of a model with a `defaultScope` | `ClientFacility` is **not** paranoid and has no `defaultScope` (G-F3) |
| A-90 (super-admin-authored rows) | display falls back to "Platform support"; no INNER `User` include |
| `schema.validate` / unseen path parameter | `validate(schema, { from: ["params", "body"] })` on every `:id` route |
| `is_deleted` in code | `client_facilities` has none; nothing writes it |
| `tenantId` on `sessions` | the `Session` readable rule names `user_id` (§ 7.5) |
| new role without `ROLE_LEVELS` | no role added |
| blanket `try/catch` in a migration | none; `lock_timeout`; `migrate-verify` reads columns |
| global uniqueness oracle | every unique is per tenant or per facility (§ 4.5) |
| model index on a migration-added column | none on `client_facility_id`; all in M1 – M7 (`upgradeBoot.am3.live`) |
| named export beside `export =` | models `export =` alone; `constants/facilityAccess.ts` named exports only |
| suspending the default tenant in a test | the two-facility suite ends/deactivates **F1/F2**, never the default tenant or a self facility |

---

## 20. Open Decisions

| Decision | Recommendation | Where |
|---|---|---|
| **UD-18 (b)** — *added by this card* — what a client facility receives when it leaves the provider (`ended`), and how long its records are kept afterwards | before ending, the provider renders and hands over the facility's inventory, IPM history and certificates (browser exports, ADR-126 § 8); nothing is deleted by ending; retention after `ended` follows the provider's contract, applied by the existing data-retention policy; bound accounts are deactivated 30 days after `ended` | Phase 12 § 3 (UD-18), BACKLOG Q-57·UD-18 — **WORKING DECISION 2026-10-08** as recommended, with the retention default "kept for the facility's legal evidence period" (setting, unset = no end date) and the 30-day deactivation as a setting (§ 4.6) |
| OQ-3 — JIT/SCIM pending binding (AM-15) | as § 10.6 | owner confirms (P21-09) |
| Q-57·T (b) — facility accounts count as seats | working decision stands | open |
| UD-10 — rooms | the `warehouses` CHECK and room kind come with it (G-F4) | open |
| UD-4 (b) — technicians' `calibration` write | unchanged (P18-03) | open |

---

## 21. Out of Scope

QR uniqueness and the 409 that names nothing (P19-03); IPM tables and their triggers' move exception (P19-02 — requirement stated in § 5.4); the PWA's purge, fingerprint and idempotency (P19-08); dashboard marking (P21-07, OQ-8); a facility group view (a district office over its centres — UD-10, ADR-124 implication); per-technician facility assignment (ADR-124 alternative, later); a facility-bound API key (OQ-11); facility user management by a bound admin (UD-4 (c)); search, RAG and `/reports/*` for bound users.

## 22. Decisions Made Here (recorded as ADR-124 Amendment 2)

1. Unbound creates default to the self facility in the service; children take the parent's (G-F1).
2. Children follow a moved device: one audited move operation, `client_facility_moves`, `callibrator.facility_move`, `ON UPDATE CASCADE` along one path, two audit rows; refused while an IPM draft is open or a certificate is unsigned (G-F2; OQ-5, OQ-12).
3. `client_facilities` is not paranoid, has no `defaultScope`; `ended` is the end of life; hard delete only when unreferenced; `inactive` = bound users refused, provider works; `ended` = bound refused, provider read-only, no new rows (service 409 + trigger) (G-F3, G-F11).
4. The self facility for every tenant (PLATFORM included) through every creation path, by an explicit audited service call, proved by a guard and a live test; always active; `is_self`/`tenant_id` immutable.
5. `audit_logs.client_facility_id`: no FK, no back-fill; stamped from the row, resolved by the audit service when omitted.
6. Binding: one operation, unbound actor, no self-binding, no binding to the self facility, unbind names the role, sessions revoked (OQ-1), one audit row per facility, DB binding guard and bound-role trigger; JIT/SCIM `facility_binding_pending` (G-F6); `FACILITY_BINDING_ENABLED` switch for the pre-invitation gate.
7. People shown through snapshots where stored, else a reviewed projection, redacted across facilities for bound viewers (G-F5).
8. The route gate runs from `tenantContextMiddleware` over an ordered route index built by the guards' walker.
9. Storage keys: segment at upload, legacy keys valid for the self facility, `rekey_pending` + re-key job after a move (G-F7); signed-link token v3 binds the facility.
10. Serial per facility and `calibration_devices UNIQUE (tenant_id, id)` land in P20-07 (G-F8).
11. `warehouses` gets the column now, the CHECK with UD-10 (G-F4).
12. `client-facilities` write is not limited to the self facility by role (G-F9).
13. `NO_FACILITY_ID` and the `ClientFacilityId` brand; refusal codes; `/verify` `facilityMode`.
14. This release deploys with `Recreate` (no mixed-version replicas).
