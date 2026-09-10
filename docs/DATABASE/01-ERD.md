# 01 — Entity Relationship Diagram

72 tables is too many for one readable diagram. This document gives the core relationships plus one diagram per domain cluster.

---

## The Spine

```mermaid
erDiagram
    TENANTS ||--o{ USERS : "employs"
    TENANTS ||--o{ CALIBRATION_DEVICES : "owns"
    TENANTS ||--o{ WAREHOUSES : "operates"
    TENANTS ||--o{ AUDIT_LOGS : "accumulates"
    TENANTS ||--o| TENANTS : "parent of"

    ROLES ||--o{ USERS : "held by"
    ROLES ||--o{ ROLE_MENU_PERMISSIONS : "granted"
    MENU_GROUPS ||--o{ ROLE_MENU_PERMISSIONS : "granted to"
    MENU_GROUPS ||--o{ USER_MENU_PERMISSIONS : "overridden for"
    USERS ||--o{ USER_MENU_PERMISSIONS : "overrides"

    CALIBRATION_DEVICES ||--o{ CALIBRATION_RECORDS : "calibrated by"
    CALIBRATION_RECORDS ||--o| CERTIFICATES : "evidenced by"
    CERTIFICATES ||--o{ E_SIGNATURE_RECORDS : "signed via"
    USERS ||--o{ CALIBRATION_RECORDS : "performed"

    WAREHOUSES ||--o{ STORAGE_LOCATIONS : "contains"
    WAREHOUSES ||--o{ STOCKS : "holds"
    CALIBRATION_DEVICES }o--o| WAREHOUSES : "located at"
```

`CALIBRATION_DEVICES }o--o| WAREHOUSES` is optional on purpose, with `ON DELETE SET NULL`: deleting a warehouse nulls the device location and never destroys the device.

## Tenancy

```mermaid
erDiagram
    TENANTS ||--o{ TENANT_SETTINGS : "configured by"
    TENANTS ||--o{ TENANT_KEYS : "signs with"
    TENANTS ||--o{ TENANT_BACKUPS : "backed up as"
    TENANTS ||--o{ CUSTOM_DOMAINS : "reachable at"
    TENANTS ||--o{ DATA_RETENTION_POLICIES : "governed by"
    TENANTS ||--o| TENANT_HIERARCHIES : "positioned by"
    TENANTS ||--o| TENANTS : "parentId"
```

Two extension mechanisms coexist: `tenants.settings` (JSONB, read as a unit) and `tenant_settings` (one row per key, written and read independently — including granular `lifecycle_status`).

## Identity and Authorization

```mermaid
erDiagram
    TENANTS ||--o{ USERS : ""
    USERS ||--o{ SESSIONS : "authenticates"
    USERS ||--o{ CONSENT_RECORDS : "consents"
    USERS }o--|| ROLES : "exactly one"
    ROLES ||--o{ ROLE_MENU_PERMISSIONS : ""
    MENU_GROUPS ||--o{ MENU_GROUPS : "parentId"
    MENU_GROUPS ||--o{ ROLE_MENU_PERMISSIONS : ""
    USERS ||--o{ USER_MENU_PERMISSIONS : ""
    MENU_GROUPS ||--o{ USER_MENU_PERMISSIONS : ""
```

`ROLES` and `MENU_GROUPS` are **global**. A user has exactly one tenant and exactly one role (BR-2); permission breadth comes from menu grants and per-user overrides, never from stacking roles.

## Device and Calibration

```mermaid
erDiagram
    CALIBRATION_DEVICES ||--o{ CALIBRATION_RECORDS : ""
    CALIBRATION_DEVICES ||--o{ IOT_READINGS : "reports"
    CALIBRATION_DEVICES ||--o{ MAINTENANCE_WORK_ORDERS : "serviced by"
    CALIBRATION_DEVICES ||--o| ASSET_FINANCES : "costed by"
    CALIBRATION_DEVICES ||--o{ NON_CONFORMANCES : "implicated in"
    CALIBRATION_RECORDS ||--o| CERTIFICATES : ""
    USERS ||--o{ CALIBRATION_RECORDS : "performedBy"
```

`iot_readings` is the only high-volume child and the only one purged by retention rather than soft-deleted. Telemetry is operational data; calibration history is evidence.

## Certificates and Signatures

```mermaid
erDiagram
    CERTIFICATES }o--|| CALIBRATION_RECORDS : "derived from"
    CERTIFICATES }o--|| CALIBRATION_DEVICES : "for"
    CERTIFICATES }o--o| USERS : "calibratedBy"
    CERTIFICATES }o--o| USERS : "approvedBy"
    CERTIFICATES }o--o| USERS : "signedBy"
    CERTIFICATES ||--o{ E_SIGNATURE_RECORDS : ""
    TENANT_KEYS ||--o{ CERTIFICATES : "signs"

    SIGNATURE_WORKFLOWS ||--o{ SIGNATURE_WORKFLOW_STEPS : "ordered"
    SIGNATURE_WORKFLOW_STEPS ||--o{ SIGNATURE_RECORDS : "produces"
```

**Three separate actor FKs on `CERTIFICATES`, all nullable.** That nullability is what made the certificate list return zero rows until the four includes were given `required: false` — every draft has null `approvedBy` and `signedBy`.

Keeping them separate rather than collapsing to one "who touched this" column is what preserves separation-of-duties evidence.

## Warehouse

```mermaid
erDiagram
    WAREHOUSES ||--o{ STORAGE_LOCATIONS : ""
    WAREHOUSES ||--o{ STOCKS : ""
    STORAGE_LOCATIONS ||--o{ STOCKS : ""
    WAREHOUSES ||--o{ STOCK_ADJUSTMENTS : ""
    WAREHOUSES ||--o{ STOCK_OPNAMES : ""
    WAREHOUSES ||--o{ STOCK_TRANSFERS : "from"
    WAREHOUSES ||--o{ STOCK_TRANSFERS : "to"
```

`STOCK_TRANSFERS` references two warehouses. Movement is three tables rather than one generic ledger because adjustment, transfer and opname have genuinely different lifecycles.

## Quality

```mermaid
erDiagram
    NON_CONFORMANCES ||--o{ CAPAS : "escalates to"
    NON_CONFORMANCES }o--o| CALIBRATION_DEVICES : ""
    SOP_DOCUMENTS ||--o{ SOP_TRAINING_ACKNOWLEDGMENTS : "requires"
    USERS ||--o{ SOP_TRAINING_ACKNOWLEDGMENTS : ""
    VENDORS ||--o{ SUPPLIER_SCORECARDS : "evaluated by"
    VENDORS ||--o{ MAINTENANCE_WORK_ORDERS : "services"
```

## Workflow

```mermaid
erDiagram
    WORKFLOWS ||--o{ WORKFLOW_STEPS : "ordered"
    WORKFLOWS ||--o{ WORKFLOW_INSTANCES : ""
    WORKFLOW_INSTANCES ||--o{ WORKFLOW_ACTIONS : ""
    WORKFLOW_STEPS }o--|| ROLES : "gated by"
    WORKFLOW_STEPS ||--o{ WORKFLOW_ACTIONS : ""
```

`workflows.resourceType` is a closed ENUM of three: `Certificate`, `StockTransfer`, `MaintenanceWorkOrder`. `workflow_instances.resourceId` is therefore a **polymorphic reference with no foreign key** — the type discriminator lives on the parent workflow, not on the instance.

## Commercial

```mermaid
erDiagram
    TENANTS ||--o| SUBSCRIPTIONS : ""
    SUBSCRIPTIONS ||--o{ INVOICES : ""
    TENANTS ||--o{ PLAN_QUOTAS : "entitled by"
    TENANTS ||--o{ USAGE_METRICS : "meters"
    TENANTS ||--o{ USAGE_ALERTS : "warns via"
    CALIBRATION_DEVICES ||--o| ASSET_FINANCES : ""
    VENDORS ||--o{ ASSET_FINANCES : "supplied"
```

`ASSET_FINANCES` belongs to the customer device estate, not to platform billing. Two different meanings of "finance" in one schema.

## Platform

```mermaid
erDiagram
    NOTIFICATIONS ||--o{ NOTIFICATION_STATES : "read state per user"
    USERS ||--o{ NOTIFICATION_STATES : ""
    WEBHOOKS ||--o{ WEBHOOK_DELIVERIES : ""
    TENANTS ||--o{ API_KEYS : ""
    TENANTS ||--o{ BATCH_JOBS : ""
    TENANTS ||--o{ ATTACHMENTS : ""
    TENANTS ||--o{ DSAR_REQUESTS : ""
    TENANTS ||--o{ AUDIT_LOGS : ""
```

`ATTACHMENTS` is **polymorphic** by `(resourceType, resourceId)`, indexed as a pair. No foreign key, by necessity — it attaches to anything.

The `NOTIFICATIONS` / `NOTIFICATION_STATES` split is what lets one event fan out to many users without duplicating its body, and lets one user dismiss it without affecting anyone else.

## Kanban

```mermaid
erDiagram
    KANBAN_PROJECTS ||--o{ KANBAN_COLUMNS : ""
    KANBAN_PROJECTS ||--o{ KANBAN_SPRINTS : ""
    KANBAN_PROJECTS ||--o{ KANBAN_LABELS : ""
    KANBAN_PROJECTS ||--o{ KANBAN_PROJECT_MEMBERS : ""
    KANBAN_PROJECTS ||--o{ KANBAN_CARDS : ""
    KANBAN_COLUMNS ||--o{ KANBAN_CARDS : ""
    KANBAN_SPRINTS ||--o{ KANBAN_CARDS : ""
    KANBAN_CARDS ||--o{ KANBAN_CARD_ASSIGNEES : ""
    KANBAN_CARDS ||--o{ KANBAN_CARD_LABELS : ""
    KANBAN_CARDS ||--o{ KANBAN_CARD_RELATIONS : "source"
    KANBAN_CARDS ||--o{ KANBAN_CARD_RELATIONS : "target"
```

## Support

```mermaid
erDiagram
    TENANTS ||--o{ TICKETS : ""
    TENANTS ||--o| TICKET_COUNTERS : "sequence"
    TICKETS ||--o{ TICKET_COMMENTS : ""
    USERS ||--o{ TICKETS : "createdBy"
    USERS ||--o{ TICKETS : "assignedTo"
```

`ticket_counters` gives each tenant its own sequence, so ticket keys are per-tenant and predictable.

## Polymorphic References — the ones without foreign keys

| Table | Discriminator | Note |
|---|---|---|
| `attachments` | `(resourceType, resourceId)` | attaches to anything |
| `e_signature_records` | `(entityType, entityId)` | signs anything |
| `document_chunks` | `(sourceType, sourceId)` | embeds anything |
| `audit_logs` | `(resourceType, resourceId)` | `resourceId` is `STRING`, not `UUID` |
| `workflow_instances` | `resourceId` | type lives on the parent workflow |

None of these can carry a foreign key, so none of them gets referential integrity from the database. A dangling reference here is possible and will not error — it will simply return nothing, which is why the cleanup paths for these tables matter more than usual.
