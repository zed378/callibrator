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

`VIRTUAL` rather than a generated column because generated-column syntax differs between PostgreSQL and MySQL.

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
