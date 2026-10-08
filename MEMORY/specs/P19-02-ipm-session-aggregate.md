# Feature Spec — P19-02 The IPM Session Aggregate: `inspection_sessions` and `inspection_results`, Their States, Corrections, Voids, the Visit Number, "Due", the Work-Order Link and the Recommendation's Side Effects

**Written:** 2026-10-08 — **before** implementation. **Everything in this spec is TARGET: nothing here is built.**
**Task:** P19-02 (Phase 19, Domain Design). Builds in **P20-04** (tables, keys, idempotency table), **P20-05** (immutability triggers), **P20-08** (the IPM attachment type), **P21-03** (API, idempotency), **P21-04** (side effects, "due"), **P22-03 / P22-04** (capture, history); consumed by **P19-06** (IPM report document), **P19-08** (offline capture), P21-07 (dashboard, technician activity), P23-02 (renderer), P24-02 (import of history)
**Author:** software-architect agent, under the owner's standing delegation (decide by best practice, record it; owner decisions stay open with a recommendation)
**Card scope (verbatim):** *"IPM aggregate spec: `inspection_sessions` / `inspection_results`, states, corrections/supersede, void, visit number computed at submit, "due" flag, work-order link (UD-12), side effects (UD-17)."*
**Decision record:** **ADR-126 Amendment 1** (`MEMORY/DECISIONS.md`, written with this spec)
**Spec refs:** ADR-126 § 1 – § 8 (this spec implements it) · ADR-062 and migration 0057 (append-only, correct/void) · ADR-124 § 3, § 5, § 10 and Amendments 1 – 2 (facility scope, the move, performer snapshots) · ADR-125 § 3 and Amendments 1 – 2 (pinned versions, typed items) · ADR-127 § 1, § 7, § 8 (idempotency, `client_ref`, 409 reasons) · ADR-095 § 4, ADR-107 (data document + hash — P19-06) · ADR-101 (separation of duties) · ADR-100 Am. 3 · `MEMORY/specs/P19-01-inspection-catalogue.md` § 5 – § 7 (the result columns this spec must provide) · `P19-04-client-facilities.md` § 5, § 11, § 12, § 17 · `P18-03-facility-scope-permissions.md` § 8.3 (N-2 … N-5, N-8, N-9), § 11 · `P18-01-02-role-matrix-and-grants.md` § 3.1 · `P18-04-two-tenant-two-facility-test-plan.md` A-10, C-03 … C-09, C-12, C-13 · `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` FT-52, FT-53, FT-60, FT-71, FT-91 … FT-93, AM-6, AM-7, AM-16, AM-25, G-07, G-08, G-14, G-19 … G-26 · `docs/UPSTREAM/02-FEATURES.md` F-35 … F-57 · `03-DATABASE.md` § 4.6, Q-2, Q-4 … Q-8, Q-21 … Q-23 · `04-SCHEMA-MAPPING.md` § 4.8, § 4.9, § 5, § 6, § 7 · `07-DATA-MINIMISATION.md` § 2.4, § 3 · `09-REPORT-LAYOUTS.md` § 2 · `TASKS/PHASE-12-…` § 3 (UD-6, UD-12, UD-13, UD-17 working decisions of 2026-10-08)
**Code read 2026-10-08 (working tree, including the P20-07 migrations another agent is writing — read only):** `services/calibrationRecords.service.ts` (`lockRecord`, `lifecycleConflict`, correct/void in one transaction), `migrations/0057` (the `to_jsonb(NEW) - lifecycle` comparison), `0060` (one open auto-scheduled work order per device), `0089` (the transaction-local-setting precedent), `0112` (the catalogue), `0117` (`facility_insert_default`, `facility_column_guard`, `facility_accepts_inserts`, `facility_move_admits`, `facility_resource_device` / `_facility`), `0119` (0057's function replaced with the move exception), `0123` (`attachments_facility_kind`, the AM-7 triggers), `migrations/facilityMigration.shared.ts`; models `calibrationRecord`, `calibrationDevice` (`status` ENUM active / inactive / maintenance / retired, no `created_by`), `maintenanceWorkOrder` (`type` Preventative / Breakdown / Repair, `autoScheduled`, `completedDate`), `tenantSettings` (key/value); `services/calibrationScheduler.service.ts` (`buildDueWhere`); `constants/auditActions.ts` (closed: CREATE, UPDATE, DELETE, LOGIN, APPROVE, EXPORT, …), `constants/attachmentResources.ts`, `constants/facilityAccess.ts`; `packages/contracts/src/states.ts`, `inspectionValues.ts`; `middlewares/auth.middleware.ts` (`data: { code }` refusals).

> **Deviation note (2026-10-08, ADR-136; `docs/CONTRACT/04`):** machine codes travel as a **top-level `code`** in the error envelope, not `data.code` — as built, `response.util.ts#error` spreads its `extra` at the top level and `data` is `null` (e.g. `auth.middleware.ts`'s `PASSWORD_CHANGE_REQUIRED` / `MFA_ENROLMENT_REQUIRED`). Every error's `data.code` / `data.<field>` below now reads top-level `code` / `<field>`.

> **Privacy.** No upstream data value appears here. Counts are structural (`03` § 4.6, § 7). Every example is synthetic.

---

## 1. Problem

Upstream keeps an IPM visit across 16 `trx_*` tables with no header row, identifies it by `(no_qrcode, DATE(created_at))`, deletes and re-inserts on every edit, allows one per device per month, copies item labels as text, and re-renders reports from current rows (`03` § 4.6; drift D-07, D-08). The owner decided (UD-6, ADR-126): **many sessions per device, full history, corrections and voids, nothing deleted**; the 2026-10-08 working decisions fixed the side effects (UD-17) and the work-order link (UD-12). ADR-126 decided the shape; nothing fixes yet the columns, the constraints, the exact transitions and their 409s, what a correction does to side effects, how the visit number survives an import, how "due" is computed, how an offline replay is made safe, or how the facility move reaches an append-only record.

Personas: the **provider technician** (unbound; captures anywhere in the tenant), the **facility technician** (bound `HEALTHCARE TECHNICIAN`; captures in its facility), the **facility's readers** (bound `HEALTHCARE ADMIN`, `ROOM USER`, `FACILITY MAINTENANCE` — read), the **tenant administrator** (unbound; voids, discards others' drafts), the **ETL** (imports history, no context), the **report renderer** (P19-06), the **PWA outbox** (replays the normal API, ADR-127).

---

## 2. What Is Already Decided (not re-decided here)

| Decision | Source |
|---|---|
| Two tables, tenant- and facility-scoped, `client_facility_id` NOT NULL from the device; composite keys so a session cannot name another facility's device | ADR-126 § 1; ADR-124 § 3, Am. 2 § 5; P19-04 § 5.1 |
| `template_version_id` pinned (RESTRICT), NULL only for imported rows; results pin `template_item_id` + a label snapshot | ADR-126 § 1, § 7; ADR-125 § 3 |
| ADR-062 lifecycle columns; `submitted_at/_by`; `performer_snapshot {name, role, organisation}` at submit; `client_ref`, `captured_offline`, `client_captured_at` | ADR-126 § 1 |
| Many sessions per device; no "already done this month" 409; two offline captures of one device are both kept | ADR-126 § 2 |
| Statuses `draft`, `submitted`, `voided`, `discarded`; "superseded" = `submitted` with `superseded_by_id`; **effective** = `submitted` and not superseded | ADR-126 § 3 |
| Draft edit/submit by its creator (403 otherwise); discard by creator or a tenant administrator; correction = a new draft with results copied, one open correction per original; void by an **unbound tenant administrator**, final; voiding a chain's head voids the visit | ADR-126 § 3; P18-03 § 11 |
| Visit number assigned at the first submit of a chain under a device row lock; corrections inherit it; voided visits keep theirs | ADR-126 § 4 |
| Immutability in the database, every role, the 0057 pattern; draft results replaceable | ADR-126 § 5 |
| "Due" computed at read from `calibration_devices.ipm_interval_months` (0 = not under IPM) or the tenant setting `ipm.intervalMonths`; calendar months in the tenant time zone, default `Asia/Jakarta`; never blocks a capture; the import sets `ipm.intervalMonths = 1` for the provider tenant | ADR-126 § 6 |
| Imported history: `submitted`, effective, `template_version_id` NULL only with `legacy_key`; corrected only by the correction/void path | ADR-126 § 7 |
| Reports and exports rendered in the frontend from API reads; no stored file | ADR-126 § 8 |
| `needs_repair` → a Repair work order; `not_fit_for_use` → device status `maintenance`; `needs_calibration` → a scheduler flag; each audited in the submit transaction; IPSRS countersignature by `FACILITY MAINTENANCE`, a per-tenant setting, never the submitter | UD-17 (working decision 2026-10-08) |
| No work order for imported history; a future IPM session creates a linked Preventative work order | UD-12 (working decision 2026-10-08) |
| One audit row per imported business row | UD-13 (working decision 2026-10-08) |
| Idempotency keys `(tenant_id, user_id, key, request_hash, …)` for 30 days; same key + same hash → stored answer; different hash → 409; in flight → 409; no client-chosen primary key | ADR-127 § 7 |
| `client_ref` unique **per creating user**; another user's collision is a 409 naming nothing | OQ-6 working decision (`docs/SECURITY/15` § 13.1); AM-16 |
| The facility column changes only by the audited device move; every append-only trigger on a facility table carries the move exception | ADR-124 Am. 2 § 2, § 5; P19-04 § 5.4 (requirement handed to this card) |
| Result columns `outcome`, `cleanliness`, `measured_value(_1/_2)`, `raw_value`, `computed_outcome`, `outcome_source`, `warn_flag`, `label_snapshot`, `template_item_id`; electrical-safety outcome computed and not overridable; performance outcome the technician's with the computed one beside it | P19-01 spec § 5.2, § 6; ADR-125 Am. 1 § 9 |
| Slugs `ipm` (read: every bound role; write: `TECHNICIAN`, `HEALTHCARE TECHNICIAN`, `FACILITY MAINTENANCE` — bound FM capped to read); marked rows N-2 (reads), N-3 (capture, HT·b), N-4 (void: never marked), N-8, N-9 | P18-01-02 § 3.1; P18-03 § 5, § 8.3 |
| A device move is refused while an IPM draft of the device is open | P19-04 § 11.2 |

### Gaps and contradictions found — resolved by ADR-126 Amendment 1 (deviation protocol)

| # | What `docs/` says | What is true or missing | Resolution (§) |
|---|---|---|---|
| G-S1 | ADR-126 § 1: `client_ref` `UNIQUE (tenant_id, client_ref)` | the working decision OQ-6 / AM-16 scopes it per creating user; a tenant-wide key lets one user's random ref collide with another's (a 409 that is an oracle, or worse, another user's session returned) | `UNIQUE (tenant_id, created_by, client_ref)`; a replay resolves **in the caller's context** (§ 4.1, § 9.3) |
| G-S2 | ADR-126 § 4: visit = count of submitted-or-voided roots + 1; § 4 / § 7: the upstream `visit` "imported as is" | upstream `visit` is a 0/1 flag + 1 (D-08: values 1, 2, 3 only) — imported as is, two roots of one device would carry the same number and violate the very unique index ADR-126 § 4 asks for; and "count + 1" diverges from the stored numbers as soon as one is not dense | the visit is **max + 1** over the device's numbered roots; the ETL **recomputes** imported visit numbers in `performed_at` order and keeps the upstream value in `legacy_visit_number` (shown on the imported report as printed) (§ 6) |
| G-S3 | ADR-126 § 5: "the application role loses `UPDATE`/`DELETE` on both tables except the lifecycle columns" | a draft is edited in place (header) and its results replaced wholesale; a column grant cannot depend on the row's status — the same contradiction ADR-125 Am. 2 § 1 found for template items | sessions: no `DELETE`/`TRUNCATE` for the application role, `UPDATE` kept; results: `DELETE` kept for drafts; **the triggers are the guarantee**, every role (§ 5.4) |
| G-S4 | `04` § 4.8: `deleted_at`, `is_deleted`; environment temperature and humidity as header columns | a paranoid model gets a `defaultScope`, and an include of it is an INNER JOIN (A-75) — a work order or report including its session would vanish; `discarded`/`voided` are the removals. Environment items are base-template items of section `environment` (P19-01 § 5.1, `measured` with `valid_*`/`warn_*`), so header columns would duplicate them | **not paranoid, no `defaultScope`**; no environment header columns — environment is two results (§ 4) |
| G-S5 | UD-17 names three side effects; UD-12 one link; neither says what a **correction** or a **void** does to them | an IPM corrected from `needs_repair` to `fit_for_use` must not silently delete a repair order a workshop may already be working; a voided visit's own "preventive maintenance done" order must not stay `Completed` | side effects apply on entry into a recommendation; nothing is reversed automatically except the visit's own Preventative order (Cancelled on void) and the calibration request flag (cleared when its chain is voided or superseded without `needs_calibration`) (§ 8) |
| G-S6 | ADR-126 § 1 asks only for a performer snapshot | the report prints device identity (name, brand, model, serial, QR, room) and the facility (`09` § 2.1) as of the visit; both are mutable afterwards (a device is edited or moved) — a report re-rendered from current rows is the upstream defect L-7 | `device_snapshot` and `facility_snapshot` taken at submit, together with the device's last and next calibration dates (fixes `09` L-1) (§ 4.1) |
| G-S7 | P19-04 § 5.4: "P20-05's results trigger … must carry the same exception"; the shared trigger functions of 0117 know `device`, `child`, `nc`, `attachment` | results have no `device_id` (their parent is the session; a second cascade path from the device would double-update them) | the P20-04 migration **replaces** `facility_insert_default` and `facility_column_guard` with a `result` branch resolving the session's facility and device; the session uses `child` (§ 5.3) |
| G-S8 | ADR-126 § 3, P18-03 N-3: API keys refused on submit/correct | a key creating or editing a draft is equally meaningless for a Part 11 record that needs a person | **every** IPM write carries `denyApiKey` (§ 10.1) |
| G-S9 | `02` F-36: `GET /ipm/sessions/prefill?deviceId=` | a second read that returns what the draft create returns; online, a technician who scans starts a capture | dropped: `POST /ipm/sessions` returns the prefilled draft document; a technician's second open draft for the same device is a 409 that offers to resume (§ 7.1) |
| G-S10 | ADR-127 § 7 stores "the response"; AM-25 asks for the scope at the time | a stored body replayed after a binding change returns data of the old scope (FT-92) | `idempotency_keys` stores the **resource reference and status**, not the body, plus a scope fingerprint; a replay re-reads in the current context, and a scope change is a 409 (§ 9) |
| G-S11 | ADR-124 Am. 1 § 5: `FACILITY_READABLE` = `ClientFacility`, `Session`, `Notification`, `ConsentRecord`, `DsarRequest` | `idempotency_keys` is tenant-scoped, per user, not facility-scoped — under the deny branch a bound technician's capture could never record or read its own key | **`IdempotencyKey` joins `FACILITY_READABLE`** with the rule `user_id = ctx.userId` (§ 9.1) |
| G-S12 | `07` § 3: the pseudonym "Former upstream user #<n>" (a per-migration sequence) "to be carried into 04 by the P19-02 spec"; `04` § 6 still says `#<legacy id>` | — | `04` § 6 amended (§ 13) |
| G-S13 | `02` F-53: "snapshot `room_name_snapshot` + optional device update" | rooms become facility-owned `warehouses` rows of kind `room` (UD-10; P19-03 § 6) | the session snapshots the room (name, floor) at submit; a room changed during capture updates the device's `location_id` at submit, audited (§ 8.2) |

---

## 3. The Model at a Glance

```
TENANT T ── client facility F (ADR-124)
 calibration_devices (tenant_id, client_facility_id NN, id)   ── UNIQUE (tenant_id, client_facility_id, id)  [0118]
   ▲ (tenant_id, client_facility_id, device_id)  ON UPDATE CASCADE, ON DELETE RESTRICT
 inspection_sessions                                            ── UNIQUE (tenant_id, client_facility_id, id)
   │  template_version_id → inspection_template_versions (GLOBAL, RESTRICT)    [0112]
   │  supersedes_id / superseded_by_id → inspection_sessions (id)  (one linear chain per visit)
   │  work_order_id, follow_up_work_order_id → maintenance_work_orders (id)
   ▲ (tenant_id, client_facility_id, session_id)  ON UPDATE CASCADE, ON DELETE RESTRICT
 inspection_results
      template_item_id → inspection_template_items (GLOBAL, RESTRICT)
      item_definition_id → inspection_item_definitions (GLOBAL, RESTRICT)
 attachments (resource_type 'inspectionsession', purpose 'ipm_evidence')   [P20-08; AM-7 triggers]
 idempotency_keys (tenant_id, user_id, key)  — per user, FACILITY_READABLE own-user
```

**Aggregate.** One **visit** = one **chain**: a root session (`supersedes_id IS NULL`) and its linear corrections. The chain's **head** is its latest non-discarded member; the visit is **effective** when its head is `submitted`, **voided** when its head is `voided`. Invariants the aggregate protects: one open draft per root per creator; at most one non-discarded correction per session (a linear chain); a submitted or voided session's content never changes; the visit number is unique among a device's numbered roots and shared by the chain; results belong to their session's facility; a session's device never changes.

**Domain events** (realised as audit rows written in the transaction, and `emitForRow` socket events after commit — P19-04 § 9.1): `IpmDraftCreated`, `IpmDraftEdited`, `IpmSubmitted { sessionId, visitNumber, recommendation, sideEffects }`, `IpmCorrected { originalId, correctionId }`, `IpmVoided`, `IpmDiscarded`.

---

## 4. Tables and Columns (TARGET; P20-04)

Conventions as P19-01 § 4 / P19-04 § 4: UUID `id`, camelCase attributes over snake_case columns, `initModel` + `export =` alone; **every index, CHECK, unique and foreign key in the migration, none on the model** (ADR-100 Am. 3); the models declare `clientFacilityId` **without** `references` (P19-04 § 6.3); no blanket `try/catch`; **not `paranoid`, no `defaultScope`** (G-S4). Brands `InspectionSessionId`, `InspectionResultId`, `IdempotencyKeyId` in `src/types/ids.ts`. JSON columns declare their D-27 shape (`jsonShape`): `InspectionSession.performerSnapshot`, `.deviceSnapshot`, `.facilitySnapshot`, `.sideEffects`.

### 4.1 `inspection_sessions` (tenant- and facility-scoped)

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | NN | server-assigned; a client-chosen id is never accepted (ADR-127 § 7) |
| `tenant_id` | uuid → tenants RESTRICT | NN | stamped by the hooks |
| `client_facility_id` | uuid | NN | the device's (`facility_insert_default('child')`, Am. 3 of ADR-124 as built in 0117; the service stamps it too); changes only under a device move |
| `device_id` | uuid | NN | composite FK `(tenant_id, client_facility_id, device_id)` → `calibration_devices (tenant_id, client_facility_id, id)` ON UPDATE CASCADE ON DELETE RESTRICT; **immutable** (trigger) |
| `template_version_id` | uuid → `inspection_template_versions` RESTRICT | NULL | NN unless `legacy_key IS NOT NULL` (CHECK); a published or retired version (service; a draft/discarded version → 400) |
| `status` | ENUM `enum_inspection_sessions_status` = `INSPECTION_SESSION_STATUSES` (`draft`, `submitted`, `voided`, `discarded`) | NN, default `draft` | § 7 |
| `revision` | integer | NN, default 0 | draft optimistic concurrency (every header or results write carries it; + 1 on success) — frozen after the draft ends |
| `supersedes_id` | uuid → `inspection_sessions (id)` RESTRICT | NULL | on a **correction**: the session it corrects; same device (trigger); **immutable** |
| `correction_reason` | text | NULL | 3 – 2000; NN ⇔ `supersedes_id` NN (CHECK) |
| `superseded_by_id`, `superseded_at` | uuid → `inspection_sessions (id)` RESTRICT; timestamptz | NULL | set once, when the correction is **submitted** |
| `performed_at` | timestamptz | NN | when the inspection was done; default the draft's creation time; editable while draft; ≤ server now + 5 min (400); a change after submit is a correction (ADR-126 § 3) |
| `received_at` | timestamptz | NN, default now | the server's time of the create (ADR-127 § 7) |
| `captured_offline` | boolean | NN, default false | the client's claim; shown in the trail (ADR-127 § 9) |
| `client_captured_at` | timestamptz | NULL | the device's claim; **never** used for ordering, visit numbers or "due" |
| `client_ref` | uuid | NULL | `UNIQUE (tenant_id, created_by, client_ref) WHERE client_ref IS NOT NULL` (G-S1); immutable |
| `created_by` | uuid → users RESTRICT | NULL | the capturing user; NN unless `legacy_key` (CHECK); immutable |
| `updated_by` | uuid → users RESTRICT | NULL | |
| `performed_by` | uuid → users RESTRICT | NULL | who did the inspection: the creator for captured sessions (set at create, CHECK `performed_by = created_by` when `legacy_key IS NULL`); for imported history the mapped upstream user or NULL (`07` § 3) |
| `submitted_at`, `submitted_by` | timestamptz; uuid → users RESTRICT | NULL | set by the submit; `submitted_by = created_by` for captured sessions (the creator-only rule; CHECK); imported: `submitted_at = performed_at`, `submitted_by` NULL |
| `performer_snapshot` | jsonb `{ name, role, organisation }` | NULL | NN when `status IN ('submitted','voided')` (CHECK); taken at submit (`organisation` = the tenant's name for an unbound performer, the facility's for a bound one — P19-04 § 12); imported per `07` § 3; never written to logs or `audit_logs.changes` |
| `device_snapshot` | jsonb | NULL | NN when submitted/voided; at submit: `{ name, manufacturer, model, serialNumber, qrCode, deviceTypeId, deviceTypeName, lastCalibrationDate, nextCalibrationDate }` (G-S6; the calibration dates fix `09` L-1 — P19-05 § 5) |
| `facility_snapshot` | jsonb | NULL | NN when submitted/voided; `{ id, name, code, kind, address }` at submit (the report's "Rumah Sakit") |
| `room_snapshot` | varchar(255) | NULL | room name at submit (from the draft's `location_id` choice, else the device's location) — `07` § 2.3: free-text class on imported rows, flagged for the facility's review |
| `floor_snapshot` | varchar(50) | NULL | floor at submit (P19-03 § 6: rooms carry a floor) |
| `location_id` | uuid → warehouses SET NULL | NULL | **draft only**: the room the technician confirms or changes (F-53); at submit it is snapshotted and, when it differs from the device's, the device is updated (§ 8.2); must be a room of the session's facility (service 400; the device's room trigger of P19-03 holds the device side) |
| `visit_number` | integer | NULL | CHECK ≥ 1; NN when submitted/voided (CHECK); assigned at the chain's first submit, inherited by corrections (§ 6) |
| `legacy_visit_number` | smallint | NULL | the upstream `visit` value of an imported session (G-S2); never used for numbering |
| `inspection_outcome` | ENUM `INSPECTION_OVERALL_OUTCOMES` (`pass`, `fail`) | NULL | "Hasil Pemeriksaan" (F-47); required at submit (fixes `09` L-2); NULL allowed on imported rows |
| `maintenance_outcome` | ENUM `INSPECTION_OVERALL_OUTCOMES` | NULL | "Hasil Maintenance" (F-50); required at submit |
| `recommendation` | ENUM `INSPECTION_RECOMMENDATIONS` (`fit_for_use`, `needs_calibration`, `not_fit_for_use`, `needs_repair`) | NULL | F-51 (`04` § 5: upstream 1 / 0 / −1 / −2); required at submit; drives § 8 |
| `notes` | text | NULL | ≤ 4000; free text, sanitised on render (S-07 — the renderer writes text, never HTML) |
| `work_order_id` | uuid → `maintenance_work_orders (id)` RESTRICT | NULL | the visit's **Preventative** work order (UD-12), created at the chain's first submit; shared by corrections; NULL on imported history (UD-12) |
| `follow_up_work_order_id` | uuid → `maintenance_work_orders (id)` RESTRICT | NULL | the **Repair** work order a `needs_repair` recommendation opened (UD-17) |
| `side_effects` | jsonb | NULL | written by the submit: `{ preventiveWorkOrderId, repairWorkOrderId, deviceStatus: { from, to } \| null, deviceLocation: { from, to } \| null, calibrationRequested: boolean, notices: string[] }` — what this submit did (§ 8); `{}` on imported rows |
| `void_reason` | text | NULL | 3 – 2000 |
| `voided_by`, `voided_at` | uuid → users RESTRICT; timestamptz | NULL | `status = 'voided'` ⇔ the three are NN (CHECK) |
| `discarded_by`, `discarded_at` | uuid → users RESTRICT; timestamptz | NULL | `status = 'discarded'` ⇔ both NN (CHECK) |
| `legacy_key` | varchar(64) | NULL | `<qr>|<date>` of an imported session (`04` § 4.8); `UNIQUE (tenant_id, legacy_key) WHERE legacy_key IS NOT NULL`; never in any response contract (FT-104) |
| `created_at`, `updated_at` | timestamptz | NN | |

> **Added 2026-10-08 by P19-06 (ADR-126 Am. 2; [spec](./P19-06-ipm-report-document.md) § 4):** five more columns written once by the submit — `report_number`, `verification_token`, `report_content_hash`, `report_hash_scheme`, `issuer_snapshot` (NN when submitted/voided, extending `inspection_sessions_issued_fields`) — and the facility-scoped, append-only table `inspection_session_signatures`. P20-04 builds them with this table; P20-05 the signatures trigger.

**CHECKs** (all in the migration; the Zod contracts mirror what a client can send):
`inspection_sessions_version_or_import` `template_version_id IS NOT NULL OR legacy_key IS NOT NULL` ·
`inspection_sessions_captured_actor` `legacy_key IS NOT NULL OR (created_by IS NOT NULL AND performed_by = created_by)` ·
`inspection_sessions_submitter` `submitted_by IS NULL OR legacy_key IS NOT NULL OR submitted_by = created_by` ·
`inspection_sessions_issued_fields` `status NOT IN ('submitted','voided') OR (submitted_at, visit_number, performer_snapshot, device_snapshot, facility_snapshot) all NOT NULL` ·
`inspection_sessions_captured_outcomes` `legacy_key IS NOT NULL OR status NOT IN ('submitted','voided') OR (inspection_outcome, maintenance_outcome, recommendation) all NOT NULL` ·
`inspection_sessions_correction_reason` `(supersedes_id IS NULL) = (correction_reason IS NULL)` and `supersedes_id <> id` ·
`inspection_sessions_superseded_pair` `(superseded_by_id IS NULL) = (superseded_at IS NULL)` and `superseded_by_id IS NULL OR status = 'submitted'` ·
`inspection_sessions_void_fields`, `inspection_sessions_discard_fields` as above ·
`inspection_sessions_visit_positive` `visit_number IS NULL OR visit_number >= 1` ·
text lengths (`correction_reason`, `void_reason` 3 – 2000; `notes` ≤ 4000).

**Unique / partial indexes:**
- `inspection_sessions_tenant_facility_id_unique` `UNIQUE (tenant_id, client_facility_id, id)` — the results' composite-FK target (P19-04 § 5.1).
- `inspection_sessions_visit_unique` `UNIQUE (tenant_id, device_id, visit_number) WHERE supersedes_id IS NULL AND status IN ('submitted','voided')` (ADR-126 § 4; imported roots included — G-S2).
- `inspection_sessions_linear_chain` `UNIQUE (supersedes_id) WHERE supersedes_id IS NOT NULL AND status <> 'discarded'` — a session is corrected at most once (draft, submitted or voided), so the chain is a line; a discarded correction draft frees the slot.
- `inspection_sessions_one_root_draft` `UNIQUE (tenant_id, device_id, created_by) WHERE status = 'draft' AND supersedes_id IS NULL` — one open capture per device per technician (G-S9); two technicians may each have one.
- `inspection_sessions_client_ref_unique`, `inspection_sessions_legacy_key_unique` (above).

**Indexes (D-20 leading indexes and list orders):** `(tenant_id, client_facility_id, device_id)` (the composite FK); `(tenant_id, device_id, performed_at DESC, id)` (device history, ADR-126 § 6); **partial** `inspection_sessions_effective_device` `(tenant_id, device_id, performed_at DESC, id) WHERE status = 'submitted' AND superseded_by_id IS NULL` ("due" and "last IPM"); `(tenant_id, client_facility_id, performed_at DESC, id)` (bound lists); `(tenant_id, status, performed_at DESC, id)`; one each on `template_version_id`, `supersedes_id`, `superseded_by_id`, `created_by`, `updated_by`, `performed_by`, `submitted_by`, `voided_by`, `discarded_by`, `location_id`, `work_order_id`, `follow_up_work_order_id`. List-order indexes for the busiest bound lists are **measured** in P21-03 (the U-06 method), not guessed.

### 4.2 `inspection_results` (tenant- and facility-scoped)

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | NN | changes when a draft's results are replaced (nothing references a result id) |
| `tenant_id` | uuid → tenants RESTRICT | NN | |
| `client_facility_id` | uuid | NN | the session's (`facility_insert_default('result')`, § 5.3) |
| `session_id` | uuid | NN | composite FK `(tenant_id, client_facility_id, session_id)` → `inspection_sessions (tenant_id, client_facility_id, id)` ON UPDATE CASCADE ON DELETE RESTRICT |
| `section` | ENUM `enum_inspection_results_section` = `INSPECTION_SECTIONS` | NN | P19-01 § 5.1 |
| `input_kind` | ENUM = `INSPECTION_INPUT_KINDS` | NN | the template item's (server copy); for ad-hoc rows the section's single kind (P19-01 § 5.1) |
| `template_item_id` | uuid → `inspection_template_items` RESTRICT | NULL | NULL **only** for ad-hoc rows and imported history (CHECK with `is_ad_hoc` / session `legacy_key`, the latter held by the trigger) |
| `item_definition_id` | uuid → `inspection_item_definitions` RESTRICT | NULL | copied from the template item (the cross-version identity — trends); on imported rows the matched definition or NULL (`03` Q-6/Q-7) |
| `is_ad_hoc` | boolean | NN, default false | CHECK `NOT is_ad_hoc OR template_item_id IS NULL`; and `NOT is_ad_hoc OR section IN ('tools_used','electrical_safety','performance','consumable')` (the sections whose rule allows ad-hoc rows) |
| `label_snapshot` | varchar(255) | NN | the **server's** copy of the item label; the technician's text on an ad-hoc row; the upstream `description` on an imported row |
| `unit`, `symbol`, `setting_text`, `reference_text` | varchar(20 / 50 / 50 / 100) | NULL | snapshots for **ad-hoc and imported** rows only (a template row reads them from its pinned item); `reference_text` = the upstream `nilai_acuan` / the ad-hoc row's limit as typed |
| `outcome` | ENUM = `INSPECTION_OUTCOMES` | NULL | P19-01 § 5.1 per section |
| `cleanliness` | ENUM = `INSPECTION_CLEANLINESS` | NULL | `condition_clean` only (fixes `09` L-3: printed from its own field) |
| `measured_value`, `measured_value_1`, `measured_value_2` | numeric | NULL | read back as **exact decimal strings** (the reviewed D-21 exception of ADR-125 Am. 2 § 2, extended to these three attributes) |
| `text_value` | varchar(500) | NULL | `text` kind |
| `raw_value` | varchar(255) | NULL | verbatim text whenever a parse failed or the value came from the import (`03` Q-21 … Q-23) |
| `computed_outcome` | ENUM `pass`, `fail` | NULL | `evaluate()` of the item's limit (P19-01 § 6.4) |
| `outcome_source` | ENUM `INSPECTION_OUTCOME_SOURCES` (`technician`, `computed`) | NULL | |
| `warn_flag` | boolean | NN, default false | a value outside the item's warn range (P19-01 § 6.5) |
| `disagreement_flag` | boolean | NN, default false | `setting_measured_reference`: the technician's outcome differs from a determinate computed one (P19-01 § 5.2) |
| `sort_order` | integer | NN | inside its section; template rows take the item's order, ad-hoc rows follow them |
| `legacy_table`, `legacy_id` | varchar(64), integer | NULL | `UNIQUE (legacy_table, legacy_id) WHERE legacy_id IS NOT NULL` |
| `created_at`, `updated_at` | timestamptz | NN | |

**Unique / indexes:** `inspection_results_one_per_item` `UNIQUE (session_id, template_item_id) WHERE template_item_id IS NOT NULL`; `UNIQUE (session_id, section, sort_order)`; `(tenant_id, client_facility_id, session_id)` (the FK); `(session_id, section, sort_order, id)` (read order); `(template_item_id)`; `(item_definition_id, created_at)` (trend of one check across versions — later reporting). **Bounds** (Zod + service): ≤ 300 template results + ≤ 100 ad-hoc rows per session.

### 4.3 The device and tenant settings this aggregate reads (built elsewhere)

| Column / setting | Built by | Use here |
|---|---|---|
| `calibration_devices.ipm_interval_months` smallint NULL, CHECK 0 – 60 | **P20-02** (P19-03 § 4.1) | "due" (§ 11): 0 = not under IPM, NULL = the tenant setting |
| `calibration_devices.calibration_requested_at`, `calibration_requested_by_session_id` | **P20-02** (P19-05 § 4.2) | the `needs_calibration` flag (§ 8) |
| `calibration_devices.location_id` + rooms (`warehouses` kind `room`, `floor`) | **P20-02** (P19-03 § 6) | room confirmation (§ 8.2) |
| tenant settings `ipm.intervalMonths` (integer, unset = not scheduled), `tenant.timeZone` (IANA, default `Asia/Jakarta`), `ipm.countersignEnabled` (UD-17, read by P19-06) | P21-03 (keys introduced with their readers) | read through the reviewed `skipFacilityScope` of P18-03 § 10.2 (G-13) |

---

## 5. Constraints and Triggers in the Database (P20-04 keys, P20-05 triggers; tested as `callibrator_app` and as the owner)

### 5.1 `inspection_sessions_append_only` (BEFORE UPDATE / DELETE, statement-level TRUNCATE; ENABLE ALWAYS)

- `DELETE` and `TRUNCATE` refused for every role.
- Always immutable: `id`, `tenant_id`, `device_id`, `created_by`, `supersedes_id`, `client_ref`, `legacy_key`, `received_at`, `created_at`.
- `OLD.status = 'draft'`: any other column may change, **and** the status may move to `submitted` or `discarded` only (`draft → voided` refused).
- `OLD.status IN ('submitted','voided','discarded')`: `(to_jsonb(NEW) - lifecycle - 'client_facility_id') IS DISTINCT FROM (to_jsonb(OLD) - lifecycle - 'client_facility_id')` → refused, where `lifecycle` = `superseded_by_id`, `superseded_at`, `status`, `void_reason`, `voided_by`, `voided_at`, `updated_at`, `updated_by`; each lifecycle column one way (NULL → value, never changed again); `status` only `submitted → voided`; `superseded_*` only on a `submitted` row; `discarded` and `voided` final.
- `client_facility_id` changes only when `facility_move_admits(NEW.tenant_id, NEW.device_id, OLD.client_facility_id, NEW.client_facility_id)` (0117) — the cascade of a device move (P19-04 § 5.4; G-S7). `facility_column_guard('child')` (0117) is attached as well (BEFORE UPDATE OF `client_facility_id`): two layers, as on `calibration_records` (0119).
- `ERRCODE '42501'` with a message naming the row (0057); the service's own 409 fires first, and maps an unforeseen trigger refusal to 409, not 500.

### 5.2 `inspection_results_draft_only` (BEFORE INSERT / UPDATE / DELETE, statement-level TRUNCATE; ENABLE ALWAYS)

- Reads the parent session `FOR SHARE` (a write racing a submit waits, then is refused — the ADR-125 Am. 2 § 1 pattern).
- `INSERT`/`UPDATE`/`DELETE` refused unless the session is `draft` — **except** an `UPDATE` changing only `client_facility_id` (and `updated_at`) admitted by `facility_move_admits` for the session's device (the cascade from the session; G-S7).
- An `INSERT` with `template_item_id IS NULL AND NOT is_ad_hoc` is refused unless the session has a `legacy_key` (imported history only).
- `TRUNCATE` refused.

### 5.3 The facility functions gain a `result` branch (P20-04 replaces 0117's two functions — `CREATE OR REPLACE`)

- `facility_insert_default()` — `TG_ARGV[0] = 'result'`: `NEW.client_facility_id` := the session's (`WHERE id = NEW.session_id AND tenant_id = NEW.tenant_id`) when NULL; an explicit value is never replaced (the composite key checks it).
- `facility_column_guard()` — `'result'`: the device is the session's `device_id`.
- `facility_resource_device()` / `facility_resource_facility()` gain `'inspectionsession'` (P20-08, with the attachments CHECK — § 12).
- Triggers: sessions `inspection_sessions_facility_default` (`child`), `inspection_sessions_facility_open` (`facility_accepts_inserts`), `inspection_sessions_facility_guard` (`child`); results the same three with `result`. All ENABLE ALWAYS.
- `inspection_sessions_correction_same_device` (BEFORE INSERT): a row with `supersedes_id` must name a session of the same tenant **and device** (G-S7's sibling: the linear chain stays on one instrument).

### 5.4 Grants (G-S3)

`callibrator_app`: `inspection_sessions` SELECT, INSERT, UPDATE (no DELETE, no TRUNCATE); `inspection_results` SELECT, INSERT, UPDATE, DELETE (no TRUNCATE); `idempotency_keys` SELECT, INSERT, UPDATE, DELETE (the purge). The triggers bind the owner too. All triggers in `schemaVerify` `EXPECTED_OBJECTS`.

---

## 6. The Visit Number (G-S2)

- **When:** at the **first submit of a chain** (the root's submit). Corrections copy the root's number at their submit (the trigger refuses a head whose number differs from its root's — checked in the submit path, asserted in the live test).
- **How:** inside the submit transaction, lock order **device → original (corrections) → session** (one order everywhere, so two submits cannot deadlock): `SELECT … FROM calibration_devices WHERE id = $device FOR UPDATE`; then `max(visit_number) + 1` over the device's roots with `status IN ('submitted','voided')` (1 when none). Gaps after voids are evidence, never re-used.
- **Imported history:** the ETL numbers each device's imported roots 1 … n in `performed_at` order (ties by `legacy_key`), so the first visit captured after the cutover continues the sequence; the upstream value is kept in `legacy_visit_number` and printed on an imported report as "Visit ke (upstream): N".
- **Printed** zero-padded to three digits ("Visit ke: 004") — the renderer's, P19-06.

---

## 7. State Machine — Every Transition and Its Answer

`INSPECTION_SESSION_STATUSES` = `draft`, `submitted`, `voided`, `discarded`. Machine-readable codes travel in top-level `code` of the 409 (the `PASSWORD_CHANGE_REQUIRED` precedent, `auth.middleware.ts`), from `IPM_CONFLICT_CODES` in `@callibrator/contracts`, so the PWA outbox shows each "needs attention" item with the server's explanation (ADR-127 § 8).

### 7.1 Create a draft (root)

| Condition | Answer |
|---|---|
| device not found in the caller's context (another tenant, another facility for a bound caller, deleted) | **404**, identical to a random id |
| device `retired` | **409** `IPM_DEVICE_RETIRED` "This device was retired on <date>; an IPM cannot be started. A tenant administrator can reinstate it." |
| device `inactive` | **409** `IPM_DEVICE_INACTIVE` "This device is inactive; activate it before an IPM." |
| the device's facility `ended` | **409** `IPM_FACILITY_ENDED` "<facility> has ended; new records cannot be added. Reinstate it first." (also the `facility_accepts_inserts` trigger) |
| `templateVersionId` given, online (`capturedOffline` false), version `retired` | **409** `IPM_VERSION_RETIRED` "This checklist was replaced by version <n> on <date>; reload to start with it." (ADR-125 § 3) |
| `templateVersionId` given, `capturedOffline` true, version `retired` | accepted (ADR-125 § 3, ADR-127 § 8); the response notes when it is not the device's current checklist |
| `templateVersionId` names a draft, a discarded or no version | **400** "Unknown checklist version." |
| `templateVersionId` online but not what `resolveTemplateVersion(device)` gives today | **409** `IPM_VERSION_STALE` "The checklist for this device type changed; reload." |
| no `templateVersionId` | the server resolves it (`resolveTemplateVersion`, P19-01 § 7.5); no published base → **409** `IPM_NO_CHECKLIST` |
| the caller already has an open root draft for the device | **409** `IPM_DRAFT_EXISTS` "You already have an IPM draft for this device, started <date> — resume or discard it." with top-level `draftId` (the caller's own row) |
| `clientRef` already used **by the caller** and the session is visible in the caller's context | **200** with that session (idempotent, AM-16) |
| `clientRef` collision otherwise (cannot happen per user unless the client reuses refs across facilities after a move) | **409** `IPM_CLIENT_REF_REUSED` "This capture reference was already used." — names nothing |
| `performedAt` more than 5 min in the future | **400** |
| ok | **201** draft (`revision` 0), with the device prefill, the pinned version's id and `content_hash` (the client renders items from its catalogue copy or `GET /ipm/template-versions/:id`), and empty results |

### 7.2 Every other transition

| From | Action | To | Who (besides the route gate) | Otherwise — status, code, explanation |
|---|---|---|---|---|
| `draft` | edit header (`PATCH`, carries `revision`) | `draft`, `revision + 1` | the draft's **creator** | another user in scope → **403** "Only the technician who started this IPM can edit it."; `revision` stale → **409** `IPM_REVISION_CONFLICT` "This draft was saved at <time> (revision r); reload it before saving."; not a draft → **409** `IPM_NOT_DRAFT` "This IPM was <submitted on <date> / voided / discarded> and cannot be edited — <submit a correction / start a new IPM>." |
| `draft` | replace results (`PUT …/results`, carries `revision`) | `draft`, `revision + 1` | creator | as above; **400** per item (§ 9.4); the facility `ended` → 409 `IPM_FACILITY_ENDED` |
| `draft` | discard | `discarded` (final; rows kept) | creator, **or** an unbound tenant administrator (level ≥ 8, `facilityBound = false`) | another user → **403**; not a draft → **409** `IPM_NOT_DRAFT` "Only a draft can be discarded." |
| `draft` (root) | submit (carries `revision`) | `submitted`; visit number; snapshots; side effects (§ 8) — one transaction | creator | missing required items or header outcomes → **400** listing them by section and label; stale `revision` → 409 `IPM_REVISION_CONFLICT`; device retired meanwhile → 409 `IPM_DEVICE_RETIRED` ("discard the draft"); facility ended → 409 `IPM_FACILITY_ENDED`; not a draft → 409 `IPM_NOT_DRAFT` "This IPM was already submitted on <date>." |
| `submitted`, effective | correct (`reason`) | a **new** `draft` with `supersedes_id`, header and results copied, `revision` 0 | any `ipm` writer in scope (a bound HT in its facility) | voided → **409** `IPM_VOIDED` "This IPM was voided on <date> (reason) and cannot be corrected — a void is final."; superseded → **409** `IPM_SUPERSEDED` "This IPM was corrected on <date>; correct the latest version (visit <n>)." with `data.headId`; an open correction exists → **409** `IPM_CORRECTION_OPEN` "A correction of this IPM is already open (started by <name> on <date>)." (the partial unique index backs it) |
| correction `draft` | submit | `submitted`; the original gets `superseded_by_id`/`superseded_at` in the same transaction; side-effect delta (§ 8.3) | creator | the original was superseded or voided meanwhile → **409** `IPM_ORIGINAL_NOT_EFFECTIVE` "The IPM you corrected was <voided / corrected by someone else> on <date>; discard this draft." ; else as root submit |
| `submitted`, effective (the chain's head) | void (`reason`) | `voided` (final) | an **unbound tenant administrator** (route `rbac([TENANT_ADMIN])`, service re-checks `facilityBound = false` — 403) | `draft` → **409** `IPM_NOT_SUBMITTED` "Only a submitted IPM can be voided; discard a draft instead."; superseded → **409** `IPM_SUPERSEDED` (void the head); voided → **409** `IPM_VOIDED` "already voided on <date>"; discarded → 409 `IPM_NOT_SUBMITTED` |
| `voided`, `discarded`, superseded | anything | — | — | 409 as above; **the trigger refuses it anyway** (§ 5) |

**Voiding the head voids the visit** (ADR-126 § 3): its predecessors stay `submitted`, superseded and readable; there is no "un-void" and no restore of a predecessor — to fix a wrong correction, correct it again before anyone voids it. **A date change is a correction** (`performed_at` differs; reason required). **Two technicians' sessions of one visit** are both kept; an administrator voids the duplicate (ADR-126 implication).

---

## 8. Side Effects of a Submit (UD-12, UD-17) — All in the Submit Transaction

Actor of every side effect: the submitter (a person; the API key is refused on IPM writes). Each side effect writes its own audit row (§ 14) with the session's facility. The submit's response carries `sideEffects` so the technician sees what happened.

### 8.1 First submit of a chain (the root)

| Effect | Rule |
|---|---|
| **Preventative work order** (UD-12) | create `maintenance_work_orders` `{ type: Preventative, status: Completed, title: "IPM visit <n>", deviceId, clientFacilityId (the device's), assignedTo: performer, scheduledDate: performed_at, completedDate: performed_at, resolutionNotes: "Recorded by IPM <session id>", autoScheduled: false }`; `work_order_id` set. `autoScheduled: false` keeps it outside 0060's "one open auto-scheduled order per device" index; it is never `Open`, so it does not interact with the calibration scan |
| `needs_repair` | create a **Repair** work order `{ status: Open, priority: High, title: "Repair after IPM visit <n>", description: the recommendation's label + the session id (no free text copied) }` → `follow_up_work_order_id`; notify its recipients (`recipientsFor(row, "maintenance")`, P19-04 § 9.6) |
| `not_fit_for_use` | device `status` `active → maintenance` (no change when already `maintenance`; `inactive` unchanged and noted); recorded in `side_effects.deviceStatus` |
| `needs_calibration` | device `calibration_requested_at = performed_at`, `calibration_requested_by_session_id = session id` (P19-05 § 4.2) unless an earlier request is still open (then unchanged, noted); the calibration scan and the "calibration due" read include it (P19-05 § 6) |
| `fit_for_use` | nothing beyond the Preventative order |
| room confirmed and different from the device's (§ 8.2) | device `location_id` updated |

### 8.2 Room confirmation (F-53, G-S13)

A draft carries `location_id` (a room of the device's facility, chosen or confirmed on the form). At submit: `room_snapshot`/`floor_snapshot` = that room's name and floor (else the device's current location's); when the chosen room differs from the device's `location_id`, the device is updated in the same transaction (audited `UPDATE CalibrationDevice`, operation `IPM_DEVICE_LOCATION`). Creating a room is a device-form act (P19-03 § 6.3), not part of the IPM.

### 8.3 Correction submit — the delta (G-S5)

- The visit's Preventative order is **re-used** (`work_order_id` copied from the original); its `completedDate` follows a changed `performed_at` (audited).
- A recommendation **entering** `needs_repair`, `not_fit_for_use` or `needs_calibration` that the original did not have applies that effect as in § 8.1.
- A recommendation **leaving** one of them reverses **nothing** automatically — a repair order may already be in a workshop, a device status may have been changed by a person since. The response's `side_effects.notices` lists what to review ("Repair work order <id> was opened by the previous version"); the device page shows it. **Exception:** a calibration request whose `calibration_requested_by_session_id` is the original is cleared when the correction no longer says `needs_calibration` (the flag is derived evidence, not a person's act), audited.

### 8.4 Void (G-S5)

In the void transaction: the visit's **Preventative** order → `Cancelled`, `resolutionNotes` "IPM visit <n> voided" (the visit did not happen as recorded); a calibration request pointing at any session of the chain is cleared; **nothing else** (the Repair order and the device status stay, listed in the void response's `notices`). Each audited.

### 8.5 What is **not** a side effect

Device `condition` (P19-03) is not changed by an IPM; certificates are not issued here (P19-06 decides the IPM report's issuance); no e-mail beyond the Repair order's notification; nothing for imported history (UD-12).

---

## 9. Idempotency and Offline Replay (ADR-127 § 7; AM-16, AM-25; G-S10, G-S11)

### 9.1 `idempotency_keys` (P20-04; tenant-scoped, per user)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NN | hooks |
| `user_id` | uuid → users RESTRICT NN | the caller; never a key principal (IPM writes refuse keys; a key on another honouring route records `api_key_id` instead — CHECK exactly one of `user_id`, `api_key_id`) |
| `api_key_id` | uuid → api_keys RESTRICT NULL | for the device routes that accept keys (P19-03, P19-05) |
| `key` | uuid NN | the `Idempotency-Key` header (UUID v4; anything else → 400) |
| `route` | varchar(128) NN | `"METHOD /path-template"` (the route index of P19-04 § 7.7) |
| `request_hash` | char(64) NN | SHA-256 over method, route template, path parameters and the canonical JSON body (multipart: the file's SHA-256 + the fields) |
| `scope_fingerprint` | char(64) NN | SHA-256 of `(tenantId, clientFacilityId | "unbound", roleId, the effective permission of the route's slug)` at the first call (AM-25) |
| `status` | ENUM `in_flight`, `completed` NN | |
| `response_status` | smallint NULL | |
| `resource_type`, `resource_id` | varchar(64), uuid NULL | what the first call created or changed — **no body is stored** |
| `created_at`, `completed_at`, `expires_at` | timestamptz | `expires_at = created_at + 30 days` |

`UNIQUE (tenant_id, user_id, key)` (and `(tenant_id, api_key_id, key)`); index `(expires_at)` for the purge. **`FACILITY_READABLE` gains `IdempotencyKey: { rule: "own-user", attribute: "userId" }`** (G-S11; test `idempotencyKeys.facility.test.ts`). The purge is a nightly job deleting expired rows (no audit row per key — it is plumbing; the job logs a count).

### 9.2 The middleware `idempotency()` (P21-03)

On the routes that honour it (§ 10.2): absent header → the route runs as usual; present →
1. `INSERT … ON CONFLICT DO NOTHING` an `in_flight` row (own transaction, committed first).
2. Conflict: load the row (own-user rule): **same hash and same scope**, `completed` → **replay**: re-read `resource_type/resource_id` **in the current context** and answer with the stored `response_status` and the fresh body (a resource the caller can no longer see → 404); **same hash**, `in_flight` → **409** `IDEMPOTENCY_IN_FLIGHT` "This request is still being processed; retry shortly."; **different hash** → **409** `IDEMPOTENCY_KEY_REUSED` "This key was used for a different request."; **different scope** → **409** `IDEMPOTENCY_SCOPE_CHANGED` "This request was made under a different access; review it." (FT-92).
3. Success → the row `completed` with status and resource **in the route's transaction** (so a rolled-back write leaves the key `in_flight`, retried; a stale `in_flight` older than 5 min is taken over by the next attempt).
4. A 4xx answer is not stored (the client corrects and retries with a new key); a 5xx leaves the key `in_flight` → retried.

### 9.3 `client_ref` (AM-16, G-S1)

`POST /ipm/sessions` and `POST /ipm/sessions/:id/corrections` accept `clientRef` (UUID v4). It is resolved **in the caller's context**: an own session with that ref → the idempotent 200 (§ 7.1); otherwise the unique index is per creator, so another user's ref cannot collide. The PWA keys its outbox entries by `clientRef` and learns the server `id` from the create's answer (P19-08 builds the client side).

### 9.4 Validation of a draft's results (`PUT …/results`) — one implementation, shared with the offline client

Each input row is checked against **the pinned version's item** (loaded server-side; the client's copy of labels, limits and kinds is never trusted): `templateItemId` must belong to the pinned version (400 "This item is not part of the checklist this IPM uses"); ad-hoc rows only in ad-hoc sections; the value shape by `input_kind` (a discriminated union in the contract); `parseDecimal` (P19-01 § 6.1 — grouping refused → 400 naming the item); `valid_min/max` → 400; `warn_*` → `warn_flag`; `allowed_outcomes` → 400; `evaluate()` → `computed_outcome`; **`measured_with_limit` with a determinate computed outcome: that is the outcome** — a client-sent different outcome is **400** "The result of <label> is computed from its limit (<limit text>): <pass/fail>. Re-measure instead of overriding it."; indeterminate (a `text` limit) → the technician's choice, `outcome_source = technician`; `setting_measured_reference` → the technician's outcome, the computed one beside it, `disagreement_flag`. `label_snapshot` from the server. A draft may be incomplete; **submit** requires every `required` item answered (`check` items are always answered; `measured` items need a value or `not_applicable` where allowed), plus `inspection_outcome`, `maintenance_outcome`, `recommendation` — the 400 lists what is missing by section and label. The same pure functions (`normaliseResult`, `missingRequiredItems`) live in `@callibrator/contracts` so the PWA shows the same errors offline.

---

## 10. API (TARGET; P21-03) — Routes, Gates, Markers, Contracts

### 10.1 Gates and markers

- Reads: `auth, dynamicAccess("ipm", "read")` — **marked** facility-accessible (P18-03 N-2), kind `read`, every bound role.
- Capture writes: `auth, denyApiKey, dynamicAccess("ipm", "write"), denyPlatformAuthoring, validate(schema, { from: ["params", "body"] })` — **marked** (N-3), kind `write`; within the bound ceiling only `HEALTHCARE TECHNICIAN` holds `ipm` write (bound FM is capped to read, P18-01-02 § 3.1).
- Void: `auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN]), dynamicAccess("ipm", "write"), denyPlatformAuthoring, validate(…)` — **unmarked** (N-4; G-09 refuses a marker on it).
- `denyPlatformAuthoring` (ADR-052) on every write: an IPM is a Part 11 record authored by a member of the tenant.

### 10.2 Routes (mount `/api/v1`; `routes/api/ipmSessions.route.ts` + `.openapi.ts`; `:sessionId` registered after the literal paths)

| Method + path | Gate | Marked | Idempotency-Key | Contract (`@callibrator/contracts` `inspectionSessions.ts`) | Two-tenant / two-facility (P18-04) |
|---|---|---|---|---|---|
| `GET /ipm/sessions` | read | ✔ N-2 | — | `ipmSessionListQuery` (`deviceId`, `clientFacilityId` — convenience for unbound callers, a foreign value returns empty for a bound one —, `status` (default: drafts of the caller + submitted + voided; `discarded` only on request), `effective` boolean, `recommendation`, `from`, `to` (`performed_at`), `q` (device name / QR ≤ 100), `sort` `performedAt` \| `visitNumber`, ending in `id`; `page`, `limit` ≤ 200) → `ipmSessionSummary[]` in `data`, paging in top-level `meta` | list cases: B-style **absent** (C-04) |
| `GET /calibration-devices/:calibrationDeviceId/ipm-sessions` | read | ✔ N-2 | — | `calibrationDeviceIdParams` + paging → the device's sessions with chain links (`supersedesId`, `supersededById`, `visitNumber`, `status`, `effective`) | A-10 `@two-tenant`; C-04 `@two-facility` |
| `GET /ipm/sessions/:sessionId` | read | ✔ N-2 | — | `ipmSessionIdParams` → `ipmSession` (header, results in read order, pinned version id + `contentHash`, snapshots, `performerDisplay` (P19-04 § 12 — the snapshot once submitted), `sideEffects`, lineage) | A-10; C-03 |
| `POST /ipm/sessions` | write | ✔ N-3 | ✔ | `ipmSessionCreate` (`deviceId` uuid, `templateVersionId?`, `clientRef?`, `capturedOffline?`, `clientCapturedAt?`, `performedAt?`) — **strict**, no `tenantId`, `clientFacilityId`, `createdBy`, `status` | C-05 (device of F2 → 404, nothing written) |
| `PATCH /ipm/sessions/:sessionId` | write | ✔ N-3 | ✔ | `ipmSessionHeaderUpdate` (`revision`, `performedAt?`, `locationId?`, `inspectionOutcome?`, `maintenanceOutcome?`, `recommendation?`, `notes?`) strict | A-10; C-06; C-07 (another F1 user's draft → 403) |
| `PUT /ipm/sessions/:sessionId/results` | write | ✔ N-3 | ✔ | `ipmResultsReplace` (`revision`, `results[]` ≤ 400 of `ipmResultInput` — discriminated union on `inputKind`) | A-10; C-06 |
| `POST /ipm/sessions/:sessionId/submit` | write | ✔ N-3 | ✔ | `ipmSessionSubmit` (`revision`) → `ipmSession` with `sideEffects` | A-10; C-06 |
| `POST /ipm/sessions/:sessionId/discard` | write | ✔ N-3 | ✔ | `ipmSessionDiscard` (`reason?` ≤ 500) | A-10; C-06 |
| `POST /ipm/sessions/:sessionId/corrections` | write | ✔ N-3 | ✔ | `ipmSessionCorrection` (`reason` 3 – 2000, `clientRef?`) → 201 the correction draft | A-10; C-06 |
| `POST /ipm/sessions/:sessionId/void` | void | — (N-4) | — | `ipmSessionVoid` (`reason` 3 – 2000) | A-10; C-08 (bound → 403-route) |
| `GET /ipm/sessions/:sessionId/report-document` | read | ✔ N-2 | — | **P19-06's** (the hashed data document, `?render=pdf\|print` audited — [P19-06 spec](./P19-06-ipm-report-document.md) § 10) — listed so the plan's A-10 row is complete | A-10; C-03 |
| `POST /ipm/sessions/:sessionId/signatures` | `esignature` write | ✔ N-5 | — | **P19-06's** (§ 7, § 8) | A-11; C-09 |
| `GET /ipm/due` | read | ✔ N-9 | — | `ipmDueQuery` (`clientFacilityId?`, `state` `due` \| `never_inspected` \| `all_scheduled`, `month?` (YYYY-MM, default the current one in the tenant zone), paging) → devices with their `ipmDue` (§ 11) | C-13 |

**IPM photos** use the existing `POST /attachments` (A-5's bound gate already names "the IPM photo type") with `resourceType: "inspectionsession"`, `resourceId`, `purpose: "ipm_evidence"` (P20-08 adds the type and the purpose — P19-03 § 7): allowed while the session is a draft and only for its creator (403 otherwise); a photo of a submitted session cannot be deleted (**409** `IPM_NOT_DRAFT` "Photos of a submitted IPM are part of its record."). They are evidence, not the device's register photos.

Every path parameter is named in `validate(schema, { from: ["params", …] })` (the 400-on-every-request trap); handlers read `validated(req, schema)`; every route has its `*.openapi.ts` (ADR-103); `openapi:breaking` has nothing to break (all new).

### 10.3 Contracts (named exports)

- `states.ts`: `INSPECTION_SESSION_STATUSES` (held equal to the ENUM by `stateUnions.p905.guard`).
- `inspectionValues.ts`: `INSPECTION_OVERALL_OUTCOMES` (`pass`, `fail`), `INSPECTION_RECOMMENDATIONS` (`fit_for_use`, `needs_calibration`, `not_fit_for_use`, `needs_repair`), `INSPECTION_OUTCOME_SOURCES` (`technician`, `computed`); pure functions `normaliseResult(item, input)`, `missingRequiredItems(items, results)`, `computeIpmDue(input)` (§ 11), `IPM_CONFLICT_CODES` (`IPM_DEVICE_RETIRED`, `IPM_DEVICE_INACTIVE`, `IPM_FACILITY_ENDED`, `IPM_VERSION_RETIRED`, `IPM_VERSION_STALE`, `IPM_NO_CHECKLIST`, `IPM_DRAFT_EXISTS`, `IPM_CLIENT_REF_REUSED`, `IPM_REVISION_CONFLICT`, `IPM_NOT_DRAFT`, `IPM_NOT_SUBMITTED`, `IPM_VOIDED`, `IPM_SUPERSEDED`, `IPM_CORRECTION_OPEN`, `IPM_ORIGINAL_NOT_EFFECTIVE`) and `IDEMPOTENCY_CONFLICT_CODES` (`IDEMPOTENCY_IN_FLIGHT`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_SCOPE_CHANGED`).
- `inspectionSessions.ts`: the request schemas of § 10.2 and responses `ipmSession`, `ipmSessionSummary`, `ipmResult`, `ipmSideEffects`, `ipmDue`, `performerSnapshot` (`{ name, role, organisation }`, strict — the same shape P19-04's `personDisplay` reads).

### 10.4 Status codes

400 validation (missing required items on submit, values outside the hard range, a computed outcome overridden, a foreign template item) · 403 own-scope permission (another creator's draft; a bound administrator voiding; `FACILITY_ROUTE_REFUSED` on unmarked routes) · **404** another tenant's or another facility's session or device, identical to missing · **409** every conflict of § 7 and § 9.2 with its code and explanation.

---

## 11. "Due" (ADR-126 § 6) — Computed at Read

`computeIpmDue({ status, intervalOverride, tenantInterval, lastEffectivePerformedAt, today, timeZone })` (contracts; the server is authoritative, the PWA shows the same):

| Device | Result |
|---|---|
| `status` `retired` or `inactive`, or deleted | `{ state: "not_scheduled" }` |
| `ipm_interval_months = 0` | `not_scheduled` (not under IPM) |
| interval = `ipm_interval_months` ?? tenant `ipm.intervalMonths`; both NULL | `not_scheduled` |
| no effective session ever | `{ state: "never_inspected", intervalMonths }` — counted as due |
| month(last effective `performed_at`, tenant zone) + n ≤ current month | `{ state: "due", dueMonth, lastPerformedAt, intervalMonths }` |
| otherwise | `{ state: "ok", dueMonth, lastPerformedAt, intervalMonths }` |

"Effective" = `status = 'submitted' AND superseded_by_id IS NULL` (a correction's head counts at its own `performed_at`; voided visits do not count). Device reads gain `ipmDue`; `GET /calibration-devices` gains the filter `ipmDue` (`due`, `never_inspected`). **Implementation:** one batched read per page — `sql()` with the tenant predicate bound and **`facilityClause('d.client_facility_id', n)`** (P19-04 § 8) over `calibration_devices d LEFT JOIN LATERAL (… inspection_sessions … ORDER BY performed_at DESC, id DESC LIMIT 1)` using the partial index `inspection_sessions_effective_device`; listed in `rawSqlTenantPredicate.d05`'s facility twin and proved by `rawSqlFacility.live.test.ts` (memoryDb refuses raw SQL). It never blocks a capture. The dashboard's due counts (P21-07) cache per scope (AM-18).

---

## 12. Attachments — the IPM Type (P20-08; AM-7)

- `LINKABLE_RESOURCES` gains `inspectionsession: "InspectionSession"` (constants/attachmentResources.ts — the one list).
- P20-08 replaces 0123's CHECK `attachments_facility_kind` with the widened list, `facility_resource_device`/`facility_resource_facility` with an `inspectionsession` branch, and adds `inspection_sessions_attachments_follow_facility` (the AM-7 second trigger on the new resource table) — a move cascading to a session with photos must update them, or the commit fails.
- `attachments.purpose` (P19-03 § 7) value `ipm_evidence` is allowed only with resource type `inspectionsession` (CHECK).
- Upload rule for a bound principal (A-5's `boundGate`): the session loaded **in context**, `draft`, created by the caller, `ipm` write.

---

## 13. Import (P24-02; UD-12, UD-13; `07` § 2.4, § 3) — What the ETL Must Write

- **Sessions** ← distinct `(no_qrcode, DATE(created_at))` of `trx_hasil_pemeriksaan` (8,166 keys): `legacy_key`; device via `id_map('trx_inventory')` (a key with no device → quarantine `no_device`, `03` Q-4); the 16 duplicate headers → the latest `id` wins, the rest quarantined (`03` Q-8); `status submitted`; `performed_at` = the header's `created_at` in the zone of UD-7 (default `Asia/Jakarta`, **OA-6** checks it before the dry run); `submitted_at = performed_at`; `received_at` = the load time; `template_version_id` NULL; visit numbers recomputed (§ 6) with `legacy_visit_number`; outcomes and recommendation from `trx_hasil_pemeriksaan`, `trx_hasil_maintenance`, `trx_rekomendasi_hasil_pekerjaan` (`04` § 5); `notes` ← `trx_catatan` (625 non-empty, flagged for the facility's review, never in `audit_logs.changes`); `room_snapshot` ← the device's `nama_ruangan` at import, `floor_snapshot` ← `lantai`; `device_snapshot`/`facility_snapshot` from the imported rows; `work_order_id`, `follow_up_work_order_id` NULL and **no side effect at all** (UD-12, UD-17 do not apply to history); `side_effects = {}`.
- **Performer** (`07` § 3, amends `04` § 6): the upstream `id_user` of the session's environment rows → `performed_by` = the imported user when it exists (`created_by` NULL, `submitted_by` NULL — the import wrote it); a hard-deleted or NULL user → `performed_by` NULL and `performer_snapshot.name` = "Former upstream user #<n>" with `<n>` a **per-migration sequence** (never the upstream id); the link lives only in `upstream_import.id_map` until it is dropped.
- **Results** ← the 16 tables by section (P19-01 § 5.1 mapping); `template_item_id` NULL; `item_definition_id` by legacy id, else by `(device type, section, label)` match, else NULL (`03` Q-6, Q-7); `label_snapshot` ← `description`; `setting_text`, `reference_text`, `symbol`, `unit` from their columns; values through `parseDecimal` with `raw_value` kept on any failure (Q-22, Q-23); environment out of a plausible range → value NULL, raw kept, `warn_flag` (Q-21); electrical safety: `outcome` NULL, `computed_outcome` from the matched definition's limit where determinate (printed as "evaluated at import"), `outcome_source` `computed` only then; battery and consumable rows kept (`07` § 2.4).
- **Audit:** one row per imported session and per imported result (UD-13), `CREATE`, actor `system:upstream-import`, `changes` `{ source: "skp_ipm", legacy_table, legacy_id }` only.
- **Idempotent re-run:** by `legacy_key` / `(legacy_table, legacy_id)`; a wrong import is corrected only by the correction/void path — hence the mandatory dry run (P24-05).
- **Tenant setting** `ipm.intervalMonths = 1` for the provider tenant (ADR-126 § 6).

---

## 14. Audit Events

Every row inside its transaction; `client_facility_id` stamped from the session; `resource_type` `InspectionSession` unless stated. No free text (notes, reasons beyond their length, snapshots) in `changes`.

| Act | `action` | `changes.operation` | `changes` also carries |
|---|---|---|---|
| create draft | `CREATE` | `CREATE_IPM_DRAFT` | device id, template version id, `capturedOffline`, `clientRef` present (boolean) |
| edit header / replace results | `UPDATE` | `EDIT_IPM_DRAFT`, `EDIT_IPM_RESULTS` | revision before/after; changed field names; result count and the draft's canonical hash before/after |
| discard | `UPDATE` | `DISCARD_IPM_DRAFT` | by creator or administrator |
| submit | **`APPROVE`** | `SUBMIT_IPM` | visit number, recommendation, outcomes, template version id + content hash, result count, `sideEffects` ids |
| create correction | `CREATE` | `CREATE_IPM_CORRECTION` | original id, reason length |
| submit correction | `APPROVE` + `UPDATE` (original) | `SUBMIT_IPM_CORRECTION`, `SUPERSEDE_IPM` | original/correction ids, changed field names |
| void | **`DELETE`** (the calibration-record void precedent) | `VOID_IPM` | reason length, `notices` |
| side effects | `CREATE` `MaintenanceWorkOrder`; `UPDATE` `MaintenanceWorkOrder` / `CalibrationDevice` | `IPM_PREVENTIVE_WORK_ORDER`, `IPM_REPAIR_WORK_ORDER`, `IPM_WORK_ORDER_CANCELLED`, `IPM_DEVICE_STATUS`, `IPM_DEVICE_LOCATION`, `IPM_CALIBRATION_REQUESTED`, `IPM_CALIBRATION_REQUEST_CLEARED` | session id, from/to |
| attachment on a session | (the attachment service's existing rows) | | |

---

## 15. Reports and Exports — How They Read This Aggregate

- **The IPM report** (P19-06, P23-02): its data document is built from one session (the head being viewed or any chain member), its **pinned version** (`GET /ipm/template-versions/:id`, P19-01 § 11), its results, the three snapshots and the visit number — never from current device rows (fixes `09` L-7); imported sessions render from the result snapshots ("imported checklist", no version). A corrected session's report shows "supersedes visit <n>'s earlier version", and the earlier one stays renderable (ADR-126 § 8).
- **Fixes of `09` § 2.4 this aggregate provides the data for:** L-1 (`device_snapshot.lastCalibrationDate`), L-2 (`inspection_outcome` required and stored), L-3 (`cleanliness` its own column), L-4 (battery results kept and printed), L-5 (visit computed), L-8 (no public route; JSON data, the renderer writes text).
- **IPM lists and exports** (F-57, F-69-style lists) are paginated reads of `GET /ipm/sessions` and the device history (`meta` paging, order ending in `id`), rendered in the browser (P22-06); the rows carry `performerDisplay` from the snapshot (`09` § 7 "Teknisi Pelaksana"). A bound user's export contains only its facility (G-22).
- **Technician activity** (P21-07, N-8): the facility-scoped form reads `GET /ipm/sessions` by `performed_by` with the snapshot (FT-60).

---

## 16. Security (P17-06 cross-reference)

- **Tenant and facility:** both tables declare `tenantId` and `clientFacilityId` → the hooks filter, stamp and deny; a bound create naming another facility's device is 404 (device loaded in context) and the composite FK refuses anything the service missed (the ETL has no hooks — the database is the only control there, FT-99).
- **Attribution from the server** (FT-91): tenant, facility, creator, performer and submitter from the principal and the session; `clientCapturedAt` only as a claim.
- **No existence oracle:** `client_ref` per creator (FT-52); idempotency per user (FT-53); the visit-number unique index is per device, reachable only through a device the caller can see; 409s name only rows the caller can read (its own draft id; the head of a chain in its scope).
- **A-90:** no INNER include of `User` from either table; performer, voider and discarder shown through `…Display` (P19-04 § 12) — the snapshot for the performer.
- **Two layers for void** (FT-37 class): `rbac` on the route (unmarked → bound 403) and `facilityBound = false` in the service.
- **Denial of service:** results ≤ 400 per session; drafts per device per user one; list `limit` ≤ 200; idempotency rows purged at 30 days.
- **P17-06 should list:** "a correction used to rewrite a visit's recommendation after its side effects ran" (mitigation § 8.3: nothing reversed silently, notices) and "duplicate visits from two offline technicians" (accepted, ADR-126).

---

## 17. Test Plan — Mapped to the P18-04 Plan and the Gate Rows of `docs/SECURITY/15` § 11

**Contracts (`packages/contracts/test/`, 100 % gate):** `inspectionSessions.contract.test.ts` (strict bodies refuse `tenantId`/`clientFacilityId`/`status`; the result union per `inputKind`; ≤ 400 rows); `ipmResults.normalise.test.ts` (`normaliseResult`: decimal comma, grouping refused, hard range 400, warn flag, computed electrical-safety outcome and its override refused, performance disagreement flag, ad-hoc only in its sections); `ipmMissingItems.test.ts`; `ipmDue.test.ts` (`computeIpmDue`: zone boundary — 23:30 UTC on the last day of a month is next month in Jakarta —, interval 0, NULL, never inspected, a correction's head date, a voided visit ignored).

**Backend (memoryDb = the real models and hooks):**
- `ipmSessions.service.test.ts` — § 7.1 and § 7.2 row by row, each 409 asserting its code **and** explanation; the creator rule (403); discard by an unbound administrator; correction copies results; correction submit supersedes the original in the same transaction; concurrent submits of two roots of one device get visit numbers n and n+1 (device lock); **audit inside the transaction**: a submit forced to fail after the audit write leaves no audit row, no status change, no work order.
- `ipmSideEffects.p2104.test.ts` — § 8.1 per recommendation; § 8.3 delta (entering applies, leaving notices, calibration flag cleared); § 8.4 void cancels the Preventative order and clears the flag, leaves the Repair order and the status; nothing for an imported session.
- `ipmSessions.twoTenant.test.ts` — **A-10**: every `:sessionId` route and the device-history route → **404=** for a T2 principal, nothing written, `@two-tenant` markers (× 10).
- `ipmSessions.twoFacility.test.ts` — **C-03 … C-07**: reads 404= / absent; create naming F2's device 404=; edit/results/submit/discard/correct on F2's session 404=; another F1 creator's draft **403**; `@two-facility` markers; positive and unbound controls.
- `ipmVoid.bound.test.ts` (**C-08**, G-P7) — bound HA/HT → 403-route; unbound TA → 200; a bound principal reaching the service through a planted marker → 403 (fail-before recorded by P21-03).
- `ipmDue.twoFacility.test.ts` (**C-13**), `technicianActivity.twoFacility.test.ts` (**C-12**, P21-07).
- `idempotencyKeys.p2103.test.ts` (G-26: replay → same status and a re-read body; different hash 409; in flight 409; a 4xx not stored; a rolled-back write leaves the key retryable), `idempotencyKeys.scopeChange.test.ts` (G-26/AM-25: re-bound user → 409 `IDEMPOTENCY_SCOPE_CHANGED`), `idempotencyKeys.facility.test.ts` (the `FACILITY_READABLE` own-user rule: a bound user reads/writes only its own keys), `clientRef.twoFacility.test.ts` (G-26/AM-16), `sync.attribution.p2103.test.ts` (FT-91: payload `createdBy`/`performedBy`/`tenantId` ignored).
- `performerSnapshot.p2103.test.ts` (G-24: exact key set; organisation tenant vs facility), `includes.a90.facility.test.ts` row N-2 (the facility's own sessions authored by provider staff present with a non-redacted display).
- `exportReads.twoFacility.test.ts` (G-22: the IPM list pages contain only F1).
- `socket.ipmEvents.test.ts` (G-19: `ipm:submitted` reaches the tenant room and F1's room only).
- Guards: `stateUnions.p905`, `twoTenantRoutes.guard`, `twoFacilityRoutes.guard` (G-08), `facilityAccessibleRoutes.guard` (G-09 planted marker on void), `routePermissionGuard.p604`, `pageOrderTiebreaker.ci3`, `facilityScopedModels.guard` (G-11: both models declare `clientFacilityId`), `facilityReadable.guard` (G-12: the new `IdempotencyKey` entry and its test), `modelIndexColumns.am3`, `decimalGetters.d21` (the three result decimals as strings), D-26 (ENUMs against `pg_enum`), D-27 (snapshots' shapes).

**PostgreSQL 18, as `callibrator_app` and as the owner (`*.live.test.ts`, P20-04/05; G-25 rows):** `inspectionSessions.p2004.live.test.ts` — composite FK refuses a session naming another facility's device and a result naming another facility's session; the CHECKs; the partial uniques (second visit number, second open correction, second root draft of one creator, `client_ref` per creator); `inspectionImmutable.p2005.live.test.ts` — `UPDATE` of a submitted session's `notes`, `recommendation`, `performed_at` refused; `voided → submitted` refused; `superseded_by_id` set twice refused; `DELETE`/`TRUNCATE` refused; results insert/update/delete on a submitted session refused; draft replace allowed; **a device move (`deviceMove.p2007.live` extended) cascades to submitted sessions and their results and passes both triggers**, and the same `UPDATE` of `client_facility_id` without the setting is refused for the owner too; `schemaVerify` sees every trigger; run on an **upgrade boot** (`upgradeBoot.am3.live`).

**Live (P21-10, P22-03/04):** API smoke of every route on a running stack; an E2E spec: scan → draft → fill → submit (visit 1, Preventative order) → correct (visit 1, superseded) → void by an administrator (order Cancelled) — and the offline replay of a create + submit with the same keys answering the stored statuses.

**Privacy:** synthetic fixtures only ("Device A", QR `TST000001`, "Facility One").

---

## 18. Threat-Model Additions (AM-n) Adopted Here

| AM | Here | Left to |
|---|---|---|
| AM-6 | adopted: both triggers admit `client_facility_id` only under the move (§ 5.1, § 5.2) | — |
| AM-7 | adopted for the IPM type (§ 12) | P20-08 builds |
| AM-16 | adopted: `client_ref` per creator, resolved in context (§ 9.3) | P19-08 (client) |
| AM-17 | adopted: sessions and devices loaded in context before any comparison | — |
| AM-19, AM-21 | adopted: `emitForRow` for IPM events; `recipientsFor(row, "maintenance")` for the Repair order | — |
| AM-25 | adopted: scope fingerprint, no stored body, re-read in context (§ 9) | P19-08 (client) |
| AM-1, AM-23, AM-24, AM-26 | — | P19-08 |

## 19. Traps Checked

| Trap | Here |
|---|---|
| optional include without `required: false` | session → device, version, work orders, creator/performer: every include LEFT; G-24 guard |
| include of a model with a `defaultScope` | sessions and results have **none** (G-S4); device includes keep `required: false` |
| A-90 / super-admin-authored rows in a facility | performer from the snapshot; `denyPlatformAuthoring` keeps the operator from authoring |
| `schema.validate` / unseen path parameter | `validate(schema, { from: ["params", "body"] })` on every `:sessionId` route |
| `is_deleted` in code | neither model is paranoid |
| blanket `try/catch` in a migration | none; columns, triggers and grants read back by `migrate-verify` |
| model index on a migration-added column | none on either model; all in P20-04/05 |
| global uniqueness oracle | every unique is per tenant, device, creator or session |
| named export beside `export =` | models `export =` alone; contracts named exports |
| a new role without `ROLE_LEVELS` | none |

## 20. Decisions Made Here (recorded as ADR-126 Amendment 1)

1. `client_ref` unique per creator, resolved in context (G-S1).
2. Visit = max + 1 at the chain's first submit; imported visits recomputed by date, upstream value kept (G-S2).
3. Triggers, not grants, hold the drafts' mutability; sessions lose DELETE, results keep it for drafts (G-S3).
4. Not paranoid; no environment header columns (G-S4).
5. Side effects on entry only; corrections apply the delta and reverse nothing but the derived calibration flag; void cancels the visit's own Preventative order (G-S5).
6. Device, facility and performer snapshots at submit, with the last/next calibration dates (G-S6).
7. The `result` branch of the facility functions and the move exception in both IPM triggers (G-S7).
8. `denyApiKey` on every IPM write (G-S8).
9. No prefill route; one open root draft per device per technician (G-S9).
10. Idempotency stores the resource and a scope fingerprint, never a body; `IdempotencyKey` on `FACILITY_READABLE` (G-S10, G-S11).
11. Room confirmation updates the device at submit (G-S13).
12. 409s carry machine-readable codes (`IPM_CONFLICT_CODES`, `IDEMPOTENCY_CONFLICT_CODES`).

**For the owner / SME (none blocks the migration):** whether an IPM correction that drops `needs_repair` should **cancel** an untouched Repair order automatically (recommended no — § 8.3); whether a device with `ipm_interval_months` unset and no tenant interval should show "not scheduled" or "due" (recommended "not scheduled" — ADR-126 § 6).
