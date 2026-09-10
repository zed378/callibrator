# 08 — Domain Model

The conceptual model. Physical columns, indexes and delete rules live in [`../DATABASE/`](../DATABASE/00-DATA-MODEL.md); this document is the vocabulary those tables implement.

---

## The Four Layers

```
┌──────────────────────────────────────────────────────────────┐
│ GOVERNANCE   tenant · role · menu group · permission · audit │
├──────────────────────────────────────────────────────────────┤
│ EVIDENCE     calibration record · certificate · signature    │
│              non-conformance · CAPA · SOP · consent          │
├──────────────────────────────────────────────────────────────┤
│ OPERATIONS   device · work order · stock · transfer · ticket │
│              warehouse · vendor · risk · workflow            │
├──────────────────────────────────────────────────────────────┤
│ PLATFORM     notification · attachment · batch job · webhook │
│              api key · usage metric · backup · feature flag  │
└──────────────────────────────────────────────────────────────┘
```

The layering matters because it predicts delete behaviour. **Governance and evidence outlive operations.** Deleting a warehouse nulls a device location; it never deletes the device. Deleting a device never deletes its calibration history. Nothing deletes an audit row.

## Core Aggregates

### Tenant

The root of nearly every other aggregate. Owns plan, status, seat and storage limits, branding, and a settings bag. May have a `parentId`, with the hierarchy materialised separately in `tenant_hierarchies` as `path` and `depth` so ancestor and descendant queries do not require recursion.

Everything tenant-scoped carries `tenantId` and is filtered automatically (BR-1). The exceptions are the genuinely global tables: `roles`, `menu_groups`, `categories`, `posts`.

That `posts` is global is deliberate — the blog and news content is platform marketing, not tenant data.

### User

Belongs to one tenant, holds one role (BR-2). Carries its own authentication state (password hash, OTP fields, MFA secret, WebAuthn credential), lockout state (`failedLoginAttempts`, `lockedUntil`), and profile.

A user is never hard-deleted; the model is `paranoid`. An anonymised user must remain resolvable, because `calibration_records.performedBy` pointing at nothing destroys the attribution that made the record evidence.

### Device

See [`06-DEVICE-LIFECYCLE.md`](./06-DEVICE-LIFECYCLE.md). The hub of the operations layer.

### Calibration record

Append-only evidence (BR-7). One device, many records, ordered by `calibrationDate`.

### Certificate

Derived from one calibration record. Carries its own state machine and three distinct actor columns (`calibratedBy`, `approvedBy`, `signedBy`) so separation of duties is visible in the data rather than only in the process.

### Work order

One device, many orders. Typed, prioritised, assignable to a user or a vendor.

### Warehouse and stock

`warehouses` contain `storage_locations`; `stocks` reference both. Movement is recorded in three separate tables rather than one generic ledger:

| Table | Movement kind |
|---|---|
| `stock_adjustments` | addition, subtraction, write_off — a correction with a reason |
| `stock_transfers` | between two warehouses, as a state machine |
| `stock_opnames` | a physical count reconciliation |

Three tables rather than one because the three have genuinely different lifecycles: an adjustment is instantaneous, a transfer is a multi-step process with two locations, and an opname is a scheduled event that reconciles many rows at once.

### Quality

```
non_conformance ──escalates to──▶ capa ──verified by──▶ closed
       │
       └── may reference a device

sop_document ──requires──▶ sop_training_acknowledgment (per user)

risk (severity × likelihood ⇒ rpn, VIRTUAL)
```

### Vendor

Qualified (`approvalStatus`: `APPROVED` / `PENDING` / `REJECTED` / `CONDITIONAL`), typed (`CalibrationLab` / `PartsSupplier` / `Other`), audited on a schedule (`lastAuditDate`, `nextAuditDate`), and scored periodically in `supplier_scorecards` with `overallScore` derived rather than stored.

## Cross-Cutting Concepts

### Menu group

The unit of authorization (see [`03-USER-ROLES.md`](./03-USER-ROLES.md)). A tree via `parentId`, granted to roles in `role_menu_permissions` and overridden per user in `user_menu_permissions`.

Menu groups are **global**, not per-tenant. Every tenant sees the same catalogue of possible surfaces; what differs is which ones their roles grant.

### Workflow

A configurable approval chain over exactly three resource types: `Certificate`, `StockTransfer`, `MaintenanceWorkOrder`.

```
workflow (tenant, resourceType)
   └── workflow_steps (stepOrder, roleId, requiredApprovals)

workflow_instance (workflow, resourceId, status, currentStepOrder)
   └── workflow_actions (step, user, APPROVED | REJECTED, comments)
```

The ENUM is a closed set on purpose. A generic "any resource" workflow engine would need a generic permission model to go with it, and the menu-group model is not generic.

### Audit log

Append-only. `action` is an ENUM: `CREATE`, `UPDATE`, `DELETE`, `LOGIN`, `APPROVE`, `EXPORT`. `changes` is JSONB carrying before and after. `resourceId` is a `STRING`, not a `UUID` — some audited resources are not UUID-keyed.

### Attachment

Polymorphic by `(resourceType, resourceId)`, indexed as a pair. Carries `storageKey` (added by migration `0016`), `checksum`, `mimeType`, `size`, and `uploadedBy`. Served through signed URLs rather than direct paths.

### Notification

Split across two tables:

| Table | Holds |
|---|---|
| `notifications` | the content — type, title, message, actionUrl |
| `notification_states` | per-user read state — `isRead`, `readAt`, `deletedAt` |

The split exists so one notification can fan out to many users without duplicating its body, and so one user dismissing it does not affect anyone else.

## Identity Columns and Conventions

| Convention | Value |
|---|---|
| Primary key | `UUID`, `defaultValue: UUIDV4` |
| Tenant column | `tenantId` (a few legacy models use `tenant_id` — `sessions` is the notable one) |
| Soft delete | `paranoid: true` plus an `isDeleted` boolean on most models |
| Naming | camelCase attributes, `underscored` columns — `isDeleted` in code, `is_deleted` in the database |
| Timestamps | `createdAt` / `updatedAt` on every model |

The `sessions` model using `tenant_id` rather than `tenantId` is a real inconsistency that has caused a production defect: a retention purge wrote `Session.destroy({ where: { tenantId } })` and failed with `column "tenantId" does not exist`, breaking the nightly retention cron. Tenant scoping handles both spellings (`tenantKeyOf` checks each), but hand-written queries must use the right one.
