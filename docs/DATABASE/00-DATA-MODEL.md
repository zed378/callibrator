# 00 — Data Model

72 Sequelize models. Engine strategy and operational concerns are in [`../ARCHITECTURE/04-DATABASE-ARCHITECTURE.md`](../ARCHITECTURE/04-DATABASE-ARCHITECTURE.md); this folder is the schema itself.

---

## Conventions

| Concern | Convention |
|---|---|
| Primary key | `UUID`, `defaultValue: UUIDV4` |
| Attribute names | camelCase |
| Column names | snake_case — models are `underscored` |
| Table names | snake_case plural |
| Tenant column | `tenantId` (attribute) → `tenant_id` (column) |
| Timestamps | `createdAt`, `updatedAt` on every model |
| Soft delete | `paranoid: true` plus an `isDeleted` boolean on most models |

### The three real inconsistencies

Each has caused a defect. They are documented rather than silently tolerated.

| Inconsistency | Consequence |
|---|---|
| **`sessions` uses snake_case attributes** — `tenant_id`, `user_id`, `token_hash` | `Session.destroy({ where: { tenantId } })` fails with `column "tenantId" does not exist`. This broke the nightly retention purge. `tenantKeyOf()` in the scoping util checks both spellings for exactly this reason. |
| **`UsageMetrics` is the one camelCase table name** | needs quoting in raw SQL on PostgreSQL |
| **`tenants.billingCycle` is `monthly`/`yearly`, `subscriptions.billingCycle` is `Monthly`/`Annually`** | two vocabularies for one idea; a case transform is not enough to map between them |

## Table Catalogue by Domain

### Tenancy — 7 tables
`tenants` · `tenant_hierarchies` · `tenant_settings` · `tenant_keys` · `tenant_backups` · `custom_domains` · `data_retention_policies`

### Identity — 3 tables
`users` · `sessions` · `consent_records`

### Authorization — 4 tables (all **global**, not tenant-scoped)
`roles` · `menu_groups` · `role_menu_permissions` · `user_menu_permissions`

### Warehouse — 6 tables
`warehouses` · `storage_locations` · `stocks` · `stock_adjustments` · `stock_transfers` · `stock_opnames`

### Device and calibration — 4 tables
`calibration_devices` · `calibration_records` · `iot_readings` · `asset_finances`

### Certificate and signature — 5 tables
`certificates` · `e_signature_records` · `signature_workflows` · `signature_workflow_steps` · `signature_records`

### Maintenance and quality — 7 tables
`maintenance_work_orders` · `non_conformances` · `capas` · `sop_documents` · `sop_training_acknowledgments` · `risks` · `vendors` · `supplier_scorecards`

### Workflow — 4 tables
`workflows` · `workflow_steps` · `workflow_instances` · `workflow_actions`

### Commercial — 5 tables
`subscriptions` · `invoices` · `plan_quotas` · `UsageMetrics` · `usage_alerts`

### Platform — 9 tables
`audit_logs` · `notifications` · `notification_states` · `attachments` · `batch_jobs` · `api_keys` · `webhooks` · `webhook_deliveries` · `dsar_requests`

### Content — 3 tables (**global**)
`posts` · `categories` · `post_categories`

### AI — 1 table
`document_chunks` — `vector(1536)`, PostgreSQL only

### Kanban — 9 tables
`kanban_projects` · `kanban_columns` · `kanban_cards` · `kanban_card_assignees` · `kanban_card_labels` · `kanban_card_relations` · `kanban_labels` · `kanban_sprints` · `kanban_project_members`

### Support — 3 tables
`tickets` · `ticket_comments` · `ticket_counters`

## Tenant-Scoped versus Global

Roughly 60 tables carry `tenantId` and are filtered automatically by the global hooks. The genuinely global ones:

| Table | Why global |
|---|---|
| `roles` | one catalogue, drawn on by every tenant |
| `menu_groups` | same |
| `role_menu_permissions` | keyed by role, which is global |
| `user_menu_permissions` | keyed by user, which is itself tenant-scoped |
| `posts`, `categories`, `post_categories` | platform marketing content, not tenant data |

Everything else is tenant-scoped. A new table without a `tenantId` needs a reason, and the reason belongs in an ADR.

**Target (decided 2026-10-07, not built):**

- **ADR-125 — the inspection catalogue is global:** `device_types`, `inspection_item_definitions`, `inspection_templates`, `inspection_template_versions`, `inspection_template_items` carry no `tenant_id` (and no `client_facility_id`); every write route is super-admin only (`inspectionCatalogueGlobal.guard`); a published version is immutable. Tenants propose changes through the tenant-scoped `inspection_template_proposals`. **ADR-125 Amendment 1 (P19-01 spec, target):** the five catalogue models are **not `paranoid` and have no `defaultScope`** (a `defaultScope` would make every include of a type or version an INNER JOIN — the A-75 trap); `status` `retired` is the only removal, and `DELETE`/`TRUNCATE` are refused by trigger. **Built 2026-10-07 (P20-01/03, migrations 0111 and 0112; ADR-125 Amendment 2):** the five tables and the proposals, their CHECKs and partial unique indexes (one published and one draft per version, one base template), ten immutability/no-delete triggers on the catalogue plus two on `device_types` (all `ENABLE ALWAYS`), no `DELETE` for `callibrator_app` except on a draft's items, `calibration_devices.device_type_id` → `device_types` RESTRICT, and the neutral base checklist version 1 published by `system:catalogue-seed`. The catalogue's limit and range decimals read back as exact strings (a reviewed D-21 exception). **Routes and services built 2026-10-09 (P21-01, ADR-125 Amendment 3):** `/api/v1/device-types`, `/api/v1/ipm/…` (the published document with a strong ETag, the operator's library, templates, drafts, publish with the base rebase, proposals) and the admin proposal queue; **migration 0125** rebuilds `inspection_template_versions_one_draft` as `WHERE status = 'draft' AND rebased_from_version_id IS NULL`, so a base rebase can publish a type version while that type's operator draft stays open.
- **ADR-124 — a second dimension, `client_facility_id`:** `client_facilities` (tenant-scoped) is a health facility the tenant serves. The device-anchored evidence tables (`calibration_devices`, `calibration_records`, `certificates`, `maintenance_work_orders`, `iot_readings`, and the new `inspection_sessions`/`inspection_results`) carry it NOT NULL with a composite FK `(tenant_id, client_facility_id)`; `attachments`, `warehouses`, `non_conformances`, `users` and `audit_logs` carry it nullable (NULL = provider-internal). The hooks apply it to facility-bound users. **ADR-124 Amendment 2 (P19-04 spec, target):** `client_facilities` is **not paranoid and has no `defaultScope`** (`ended` is its end of life; hard delete only when unreferenced); every tenant has exactly one `is_self` facility, always active; children reference their device by `(tenant_id, client_facility_id, device_id)` with `ON UPDATE CASCADE`, so a device moved by the audited move operation carries its history; the column is immutable outside the move and the user-binding operation (hooks and triggers, every role); `attachments` are tied to their resource's facility by deferred constraint triggers; `audit_logs.client_facility_id` has no FK and no back-fill; serial numbers are unique per facility. Spec: [`../../MEMORY/specs/P19-04-client-facilities.md`](../../MEMORY/specs/P19-04-client-facilities.md).
- **ADR-126 — `inspection_sessions`/`inspection_results` are append-only after submit** (trigger, the 0057 pattern); ADR-127 adds `idempotency_keys`. **ADR-126 Amendment 1 (P19-02 spec, target):** neither table is paranoid or has a `defaultScope`; sessions refuse DELETE/TRUNCATE for every role and change after submit only in their lifecycle columns, each once; results change only while their session is a draft; both admit `client_facility_id` only under a device move; `client_ref` is unique per creator; the visit number is unique per device among numbered roots; `idempotency_keys` stores a request hash, a scope fingerprint and a resource reference, never a response body. Spec: [`../../MEMORY/specs/P19-02-ipm-session-aggregate.md`](../../MEMORY/specs/P19-02-ipm-session-aggregate.md). **ADR-126 Amendment 2 (P19-06 spec, target):** the submit also writes, once, `report_number` (unique per tenant; `IPM-<facility code>-<YYYYMMDD>-<NNN>`), `verification_token` (random, globally unique), `report_content_hash` + `report_hash_scheme` and `issuer_snapshot` — the IPM report is a document of the session, **not** a `certificates` row; a new facility-scoped, append-only **`inspection_session_signatures`** (`UNIQUE (session_id, kind)`, kinds performer / countersign, signer snapshot, `document_hash`; trigger ENABLE ALWAYS with the device-move exception; no UPDATE/DELETE for `callibrator_app`). Spec: [`../../MEMORY/specs/P19-06-ipm-report-document.md`](../../MEMORY/specs/P19-06-ipm-report-document.md). **Built 2026-10-09 (P20-04, P20-05; ADR-126 Amendment 3):** migrations **0126** (the four tables, CHECKs, partial uniques, composite keys `(tenant_id, client_facility_id, …)` ON UPDATE CASCADE, the `result` branch of `facility_insert_default` / `facility_column_guard`, grants) and **0127** (`inspection_sessions_append_only`, `inspection_results_draft_only`, `inspection_sessions_correction_same_device`, `inspection_session_signatures_append_only`, each with its TRUNCATE twin, ENABLE ALWAYS, the device-move exception in each). As built: every uniqueness is per tenant, session or creator except `verification_token`; `idempotency_keys.user_id` is nullable (exactly one of user / API key); `performed_at`, `received_at`, `signed_at` default to `now()` in the database. The routes and services are P21-03.
- **ADR-132 / ADR-133 — device register and calibration dates (P19-03, P19-05 specs; the schema BUILT 2026-10-09 by migrations 0128/0129, P20-02/P20-08, ADR-132 Am. 1, ADR-133 Am. 1 — routes and services still target, P21-02/P21-05):** `calibration_devices` gains `qr_code` (unique per tenant over every row), `condition`, `inventoried_on`, `accessories_complete`, `calibration_vendor_id`, `created_by` + `registrant_snapshot`, `ipm_interval_months`, `client_ref`, `next_calibration_date_source`, `calibration_requested_at` / `_by_session_id`; `warehouses` gains `kind` (`store` | `room`) and `floor`, a room always belonging to a client facility and a device's room to the device's facility (trigger); `attachments` gains `purpose`; `calibration_records` gains `entry_kind`, `calibration_vendor_id`, `external_lab_name`, `room_snapshot`, `floor_snapshot` and a `performer_snapshot` written at insert (never back-filled). Specs: [`P19-03`](../../MEMORY/specs/P19-03-device-extensions.md), [`P19-05`](../../MEMORY/specs/P19-05-calibration-dates.md).

## Delete Behaviour

The rule from [`../PLAN/08-DOMAIN-MODEL.md`](../PLAN/08-DOMAIN-MODEL.md): **governance and evidence outlive operations.**

| Relationship | Rule | Why |
|---|---|---|
| `calibration_devices.locationId` → `warehouses` | `SET NULL` | losing a warehouse must not destroy device records |
| `calibration_devices.tenantId` → `tenants` | `CASCADE` | a deleted tenant takes its data |
| `users` | soft only, never hard | `calibration_records.performedBy` depends on them |
| `calibration_records` | soft — **and this is the gap** | append-only is a convention here, not a constraint (BR-7, PR-2) |
| `audit_logs` | **no delete path at all** | the absence is the control |

## Special Column Types

| Column | Type | Note |
|---|---|---|
| `risks.rpn` | `VIRTUAL` | derived from severity × likelihood, never stored (BR-12) |
| `supplier_scorecards.overallScore` | `VIRTUAL` | derived from three component scores |
| `document_chunks.embedding` | `vector(1536)` | pgvector, PostgreSQL only |
| `attachments.size` | `BIGINT` | scanned certificate archives exceed 2 GB |
| `calibration_records.results` | `JSONB` | measurement shape differs by device class |
| `calibration_devices.uncertaintyBudget` | `JSONB` | ISO 17025 uncertainty model |
| `audit_logs.resourceId` | `STRING`, not `UUID` | some audited resources are not UUID-keyed |
| `audit_logs.changes` | `JSONB` | before and after |

`VIRTUAL` rather than a generated column because generated-column syntax differs between PostgreSQL and MySQL. *(Chosen while MySQL was a target. PostgreSQL-only (ADR-039) now permits `GENERATED ALWAYS AS ... STORED`; `VIRTUAL` stands until a decision changes it — and it has the merit of never disagreeing with its inputs.)*

## Two Sequelize Traps

These are the most repeated defect shapes in this codebase.

**1. Optional includes need `required: false`.** Sequelize defaults an include with a `where` to an INNER JOIN, dropping every parent row whose optional association is null. This produced two separate list-returns-empty defects — risks without an assignee, and certificates with any null actor FK (which is every draft).

**2. `defaultScope` hides soft-deleted rows.** Use `.unscoped()` to see them, and remember that writing `is_deleted` (snake_case) in application code silently does nothing — the attribute is `isDeleted`.

## Where to Go Next

| Domain | Document |
|---|---|
| ERD | [`01-ERD.md`](./01-ERD.md) |
| Tenancy | [`02-TENANCY-TABLES.md`](./02-TENANCY-TABLES.md) |
| Identity | [`03-IDENTITY-TABLES.md`](./03-IDENTITY-TABLES.md) |
| Authorization | [`04-RBAC-TABLES.md`](./04-RBAC-TABLES.md) |
| Warehouse | [`05-WAREHOUSE-TABLES.md`](./05-WAREHOUSE-TABLES.md) |
| Device | [`06-DEVICE-TABLES.md`](./06-DEVICE-TABLES.md) |
| Calibration | [`07-CALIBRATION-TABLES.md`](./07-CALIBRATION-TABLES.md) |
| Certificates | [`08-CERTIFICATE-SIGNATURE-TABLES.md`](./08-CERTIFICATE-SIGNATURE-TABLES.md) |
| Maintenance and QMS | [`09-MAINTENANCE-QMS-TABLES.md`](./09-MAINTENANCE-QMS-TABLES.md) |
| Audit | [`10-AUDIT-LOGS.md`](./10-AUDIT-LOGS.md) |
| Billing | [`11-BILLING-TABLES.md`](./11-BILLING-TABLES.md) |
| Platform | [`12-PLATFORM-TABLES.md`](./12-PLATFORM-TABLES.md) |
| Migrations | [`13-MIGRATIONS.md`](./13-MIGRATIONS.md) |
