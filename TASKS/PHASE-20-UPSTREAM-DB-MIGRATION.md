# Phase 20 — Upstream: DB-Structure Migration to Our Conventions

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 19 — Domain Design](./PHASE-19-UPSTREAM-DOMAIN-DESIGN.md) · [Phase 21 — Backend Implementation](./PHASE-21-UPSTREAM-BACKEND.md) →

| | |
|---|---|
| **Status** | 4 DONE (P20-01, P20-03 — 2026-10-07; P20-07, **P20-06** — 2026-10-08) · 4 TODO (**P20-02, P20-04, P20-05, P20-08**, specified 2026-10-08 by P19-02 / P19-03 / P19-05 — each extends P20-07's functions and keys, now built) · 1 BLOCKED (P20-09) |
| **Goal** | Models + forward migrations in our conventions |
| **Depends on** | Phase 19 |
| **Size** | M |
| **Cards** | 9: P20-01 … P20-09 |
| **Was** | UP-08 (cards UP-08-01 … UP-08-09) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) **plus the group-wide DoD** in [Phase 12 § 2](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) (every implementation card of Phases 20 … 31 inherits it) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

**Goal:** the schema of 04, in migrations, proved on PostgreSQL 18. **Spec refs:** 04 § 2, § 4, § 8,
§ 10, § 11 · docs/DATABASE/00, 13 · ADR-100 Am. 3 · migration 0057 (append-only precedent). **Size:** M.
Numbers are 04's proposal; renumber at implementation.

| Card | Title | Status | Depends on |
|---|---|---|---|
| P20-01 | `0111` `device_types` (+ version per P19-01) and `calibration_devices.device_type_id`; model; `unscopedModels.d17` entry | **DONE 2026-10-07** — migration `0111-device-types` (table, normalised-name CHECK, `lower(btrim(name))` UNIQUE over every status, no-delete/no-truncate triggers ENABLE ALWAYS, no DELETE for `callibrator_app`, `device_type_id` → RESTRICT with index `(device_type_id, tenant_id)` — ADR-125 Am. 2 § 3), model `DeviceType` (global, not paranoid, no defaultScope), `CalibrationDevice.belongsTo(DeviceType)`; tests `0111-device-types.test.ts` (13), `calibrationDevice.deviceType.p2001` (4), live PG 18 `inspectionCatalogue.p2003.live` (13) and `upgradeBoot.am3.live` from 25521ff (8) — [record](../MEMORY/records/2026-10-07-p20-01-03-catalogue-schema.md) | P19-01 |
| P20-02 | next free number after P20-07's 0117 – 0123 and P20-06's: **device extensions** (P19-03 spec § 4, § 6: `qr_code` with `UNIQUE (tenant_id, qr_code) WHERE qr_code IS NOT NULL` over every row, `inventoried_on`, `accessories_complete`, `condition` + `_changed_at` + `_source`, `calibration_vendor_id`, `created_by`, `registrant_snapshot`, `ipm_interval_months`, `client_ref`; `warehouses.kind` + `floor` with the room CHECKs, the per-facility room-name unique and the device-room trigger) **and the calibration-date columns** (P19-05 spec § 4: `calibration_records.entry_kind`, `calibration_vendor_id`, `external_lab_name`, `room_snapshot`, `floor_snapshot`, `performer_snapshot` + two CHECKs; `calibration_devices.next_calibration_date_source` back-filled `manual`, `calibration_requested_at` / `_by_session_id` — the session FK added by P20-04 if it runs later); `UNIQUE (tenant_id, id)` and the per-facility serial are P20-07's — **built 2026-10-08: reuse `calibration_devices_tenant_id_id_unique` (0117), do not create a second; the serial index is `calibration_devices_tenant_facility_serial_unique` (0118)** | **TODO** (unblocked 2026-10-08: P19-03, P19-05, P20-07 DONE) | P19-03, P19-05, P20-07 |
| P20-03 | `0112` (was `0113`) inspection catalogue tables and ENUM types | **DONE 2026-10-07** — migration `0112-inspection-catalogue` (five tables, 14 ENUM types, 35 CHECKs, 32 indexes incl. one-published / one-draft / one-base, ten triggers ENABLE ALWAYS, revokes — the items keep DELETE for a draft, ADR-125 Am. 2 § 1 — base checklist v1 published by `system:catalogue-seed`, hash `165ac87a…`, its APPROVE audit row once); six models; `@callibrator/contracts` `inspectionValues.ts` (vocabularies, section registry, `canonicalDecimal`, `canonicalTemplateVersion`) and `states.ts` tuples; 18 schemaVerify control objects; guards `catalogueModels.p2003`, d17/d21/d26/d27/a148/d12/p905 updated; tests `0112-inspection-catalogue.test.ts` (31), contracts `inspectionValues.p2003` (37), live PG 18 as `callibrator_app` — [record](../MEMORY/records/2026-10-07-p20-01-03-catalogue-schema.md). The parser, evaluator and request schemas are P21-01's | P19-01 |
| P20-04 | next free number: `inspection_sessions` / `inspection_results` (P19-02 spec § 4: columns, CHECKs, partial uniques — visit, linear chain, one root draft per creator, `client_ref` per creator — composite FKs `(tenant_id, client_facility_id, …)` ON UPDATE CASCADE, indexes incl. the effective-session partial index), **`idempotency_keys`** (§ 9.1), the `result` branch of 0117's `facility_insert_default` / `facility_column_guard` and the facility default / open / guard triggers (§ 5.3), grants (§ 5.4); **+ P19-06 (2026-10-08): the five report columns on `inspection_sessions` and the table `inspection_session_signatures`** ([P19-06 spec](../MEMORY/specs/P19-06-ipm-report-document.md) § 4) | **TODO** (unblocked 2026-10-08: P19-02 DONE; builds after P20-07) | P19-02, P19-06, P20-07 |
| P20-05 | next free number: `inspection_sessions_append_only`, `inspection_results_draft_only`, `inspection_sessions_correction_same_device` (P19-02 spec § 5.1 – § 5.3; each admits `client_facility_id` only under a device move), in `schemaVerify`; tested as `callibrator_app` and as the owner, on an upgrade boot, with the device move cascading through submitted sessions and their results; **+ `inspection_session_signatures_append_only` (P19-06 spec § 4.2)** | **TODO** (specified 2026-10-08 by P19-02; builds with or after P20-04 — may ship in the same release) | P20-04 |
| P20-06 | next free number (was `0116`, now taken by P24-06's menu migration) menu groups `ipm`, `ipm-templates`, `client-facilities` and grants — **including UD-4 (b)**: `calibration` write for `TECHNICIAN` and `HEALTHCARE TECHNICIAN` in every tenant, and calibration-record void narrowed to `rbac([TENANT_ADMIN])` in the same release; its record **must state the effect on existing tenants** with the counts measured at deploy (spec [`P18-01-02`](../MEMORY/specs/P18-01-02-role-matrix-and-grants.md) § 3.2, § 4, tests § 5) | **DONE 2026-10-08** — migration `0124-ipm-menus-technician-calibration` (the three entries seeded **inactive** until their pages, ADR-124 Am. 5 § 2); the record void narrowed to `rbac([TENANT_ADMIN])`; live PG 18 `menuGrants.p2006.live` 5/5 — [record](../MEMORY/records/2026-10-08-p20-06-ipm-menus-ud4b.md). The deploy counts and the `permissions:*` flush are the deploy's (record § Effect) | P18-02 |
| P20-07 | `0117` `client_facilities` (+ one `is_self` row per tenant), `client_facility_id` on the evidence chain with composite FKs and backfill, `users.client_facility_id`, `audit_logs.client_facility_id` (ADR-124; replaces `service_engagements`) | **DONE 2026-10-08** — migrations `0117-client-facilities`, `0118-facility-devices`, `0119-facility-calibration-records`, `0120-facility-certificates`, `0121-facility-work-orders`, `0122-facility-iot-readings`, `0123-facility-nullable`. They build:
- the tables, with one self facility per tenant and its audit rows;
- composite keys `ON UPDATE CASCADE`;
- the immutability, binding, bound-role, ended-insert and AM-7 triggers, and 0057's move exception;
- UD-9 (serial unique per facility) and `UNIQUE (tenant_id, id)`.

**ADR-124 Am. 3:** the database fills `client_facility_id` on insert for today's create paths (the self facility only while the tenant has no other; 23502 otherwise).

Also: models `ClientFacility` and `ClientFacilityMove` and ten facility columns; `createSelfFacility` in every tenant-creation path.

Tests:
- unit: `0117-0123-client-facilities.p2007` (55), `facilityScopedModels.guard` (8, G-11), `tenantCreateSelfFacility.guard` (3), `clientFacility.service.p2007` (6);
- live PostgreSQL 18 as `callibrator_app`: `clientFacilities.p2007.live` (56), `deviceMove.p2007.live` (7, the cascade with no column grant), `upgradeBoot.am3.live` from `78f3784` (9);
- back-fill of 100k devices and 1M readings in about 76 s;
- `test:coverage` at 100 %.

**Deploy with Recreate.**

[Record](../MEMORY/records/2026-10-08-p20-07-client-facilities.md) (hand-offs to P21-09, P20-02, P20-04/05). | P19-04 |
| P20-08 | next free number: **a DB-level list exists** (0123's CHECK `attachments_facility_kind` and the `facility_resource_*` functions): `attachments.purpose` with its CHECK and the one-live-device-photo partial unique (P19-03 spec § 7.1); the `inspectionsession` resource type in the widened CHECK and functions, and `inspection_sessions_attachments_follow_facility` (P19-02 spec § 12); no folder values (G-D4) | **TODO** (unblocked 2026-10-08: P19-02, P19-03 DONE; builds after P20-07 and P20-04) | P19-02, P19-03, P20-04, P20-07 |
| P20-09 | Upgrade boot and `make migrate-verify` on production-shaped data; columns inspected, not the log | BLOCKED | P20-01 … 08 |

**DoD (adds):** one transaction per migration, reversible `down`, no blanket try/catch, indexes and
CHECKs in the migration only; every negative of 04 § 10 re-proved by a named test on the real migration.
