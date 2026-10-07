# Phase 20 — Upstream: DB-Structure Migration to Our Conventions

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 19 — Domain Design](./PHASE-19-UPSTREAM-DOMAIN-DESIGN.md) · [Phase 21 — Backend Implementation](./PHASE-21-UPSTREAM-BACKEND.md) →

| | |
|---|---|
| **Status** | 2 DONE (P20-01, P20-03 — 2026-10-07) · 1 TODO (P20-07) · 6 BLOCKED |
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
| P20-02 | next free number (was `0112`; 0111/0112 are P20-01/03) device columns, `UNIQUE (tenant_id, id)` (also created, idempotently, by P20-07 — P19-04 spec G-F8), partial unique `(tenant_id, qr_code)`; the per-facility serial (UD-9) is P20-07's | BLOCKED | P19-03 |
| P20-03 | `0112` (was `0113`) inspection catalogue tables and ENUM types | **DONE 2026-10-07** — migration `0112-inspection-catalogue` (five tables, 14 ENUM types, 35 CHECKs, 32 indexes incl. one-published / one-draft / one-base, ten triggers ENABLE ALWAYS, revokes — the items keep DELETE for a draft, ADR-125 Am. 2 § 1 — base checklist v1 published by `system:catalogue-seed`, hash `165ac87a…`, its APPROVE audit row once); six models; `@callibrator/contracts` `inspectionValues.ts` (vocabularies, section registry, `canonicalDecimal`, `canonicalTemplateVersion`) and `states.ts` tuples; 18 schemaVerify control objects; guards `catalogueModels.p2003`, d17/d21/d26/d27/a148/d12/p905 updated; tests `0112-inspection-catalogue.test.ts` (31), contracts `inspectionValues.p2003` (37), live PG 18 as `callibrator_app` — [record](../MEMORY/records/2026-10-07-p20-01-03-catalogue-schema.md). The parser, evaluator and request schemas are P21-01's | P19-01 |
| P20-04 | `0114` `inspection_sessions` / `inspection_results`, composite FKs, CHECKs, indexes | BLOCKED | P19-02 |
| P20-05 | `0115` immutability trigger for submitted results; tested as `callibrator_app` | BLOCKED | P20-04 |
| P20-06 | `0116` menu groups `ipm`, `ipm-templates` (+ `client-facilities`, added by P18-03 spec § 7, which also drafts the grants and the seed plan) and grants | BLOCKED | P18-02 |
| P20-07 | `0117` `client_facilities` (+ one `is_self` row per tenant), `client_facility_id` on the evidence chain with composite FKs and backfill, `users.client_facility_id`, `audit_logs.client_facility_id` (ADR-124; replaces `service_engagements`) | TODO (unblocked 2026-10-07 by P19-04: spec § 4 – § 6 — **seven migrations** M1 – M7, one transaction per large table, the self facility per tenant with audit rows, composite FKs with `ON UPDATE CASCADE`, the facility-column, binding, bound-role, ended-insert and AM-7 triggers, the 0057 move exception; also lands the per-facility serial (UD-9) and `calibration_devices UNIQUE (tenant_id, id)`, idempotently; **this release deploys with Recreate**; live tests G-25) | P19-04 |
| P20-08 | `0118` attachment folders / resource type, if a DB-level list exists | BLOCKED | P19-03 |
| P20-09 | Upgrade boot and `make migrate-verify` on production-shaped data; columns inspected, not the log | BLOCKED | P20-01 … 08 |

**DoD (adds):** one transaction per migration, reversible `down`, no blanket try/catch, indexes and
CHECKs in the migration only; every negative of 04 § 10 re-proved by a named test on the real migration.
