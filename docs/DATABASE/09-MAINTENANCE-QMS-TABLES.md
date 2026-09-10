# 09 — Maintenance and QMS Tables

`maintenance_work_orders` · `non_conformances` · `capas` · `sop_documents` · `sop_training_acknowledgments` · `risks` · `vendors` · `supplier_scorecards` · the four `workflow_*` tables

---

## `maintenance_work_orders` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | |
| `deviceId` | `UUID` | |
| `title`, `description` | `STRING`, `TEXT` | |
| `type` | ENUM | `Preventative`, `Breakdown`, `Repair` |
| `status` | ENUM | `Open`, `InProgress`, `Completed`, `Cancelled` |
| `priority` | ENUM | `Low`, `Medium`, `High`, `Critical` |
| `vendorId` | `UUID` | external provider, **nullable** |
| `assignedTo` | `UUID` | internal technician, **nullable** |

**Both actor FKs are nullable**, which makes this a textbook INNER JOIN trap: an include on either without `required: false` silently drops every order with no vendor or no assignee — which is most of them. The same shape has already produced two list-returns-empty defects elsewhere in this codebase.

`Preventative` is the only type the platform can propose (from predictive maintenance). `Breakdown` and `Repair` are always human-initiated.

One of three `workflows.resourceType` values.

## `non_conformances` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | |
| `ncNumber` | `STRING` | human reference |
| `title`, `description` | | |
| `status` | ENUM | `OPEN`, `UNDER_INVESTIGATION`, `CAPA_REQUIRED`, `CLOSED` |
| `severity` | ENUM | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `reportedBy` | `UUID` | |
| `deviceId` | `UUID` | optional |
| `dateIdentified` | `DATE` | |
| `rootCause` | `TEXT` | |

`CAPA_REQUIRED` is a distinct state from `UNDER_INVESTIGATION`: investigation has concluded, corrective action is owed and has not been delivered.

Collapsing them loses the ability to report on the gap between "we know what went wrong" and "we fixed it" — which is precisely the gap an auditor asks about.

## `capas` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | |
| `capaNumber` | `STRING` | |
| `ncId` | `UUID` | the non-conformance this answers |
| `title` | `STRING` | |
| `actionPlan` | `TEXT` | |
| `status` | ENUM | `DRAFT`, `OPEN`, `IN_PROGRESS`, `VERIFICATION`, `CLOSED` |
| `assignedTo` | `UUID` | |
| `dueDate`, `completedDate` | `DATE` | |
| `approvedBy` | `UUID` | who verified |
| `verificationNotes` | `TEXT` | how it was verified |

`VERIFICATION` sits between doing the work and closing it. A CAPA that goes straight from `IN_PROGRESS` to `CLOSED` records that someone did something, not that it was **effective** — and effectiveness is what ISO 13485 asks for.

`approvedBy` and `verificationNotes` are the evidence of that check.

## `sop_documents` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | |
| `documentNumber` | `STRING` | |
| `title` | `STRING` | |
| `version` | `STRING` | |
| `contentUrl` | `STRING` | the document itself, in object storage |
| `status` | ENUM | `DRAFT`, `UNDER_REVIEW`, `PUBLISHED`, `ARCHIVED` |
| `authorId` | `UUID` | |
| `publishedDate` | `DATE` | |
| `requiresTraining` | `BOOLEAN` | |

**No delete.** SOPs are archived, never removed. A withdrawn procedure still has to be producible, because work was done under it and an auditor will ask what the procedure said at the time.

## `sop_training_acknowledgments`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | |
| `documentId` | `UUID` | |
| `userId` | `UUID` | |
| `acknowledgedAt` | `DATE` | |
| `status` | ENUM | `PENDING`, `COMPLETED` |

Publishing an SOP with `requiresTraining` creates a `PENDING` row for every user who must read it.

This table is the personnel-competence evidence that ISO 17025 and ISO 13485 both require, and the thing an auditor asks for when they ask "how do you know your staff read this".

## `risks` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | |
| `title`, `description` | | |
| `category` | `STRING` | |
| `severity` | `INTEGER` | |
| `likelihood` | `INTEGER` | |
| **`rpn`** | **`VIRTUAL`** | derived, never stored (BR-12) |
| `status` | `STRING` | |
| `mitigationPlan` | `TEXT` | |
| `identifiedBy`, `assignedTo` | `UUID` | both **nullable** |
| `dueDate` | `DATE` | |

`rpn` is `VIRTUAL` rather than a generated column because generated-column syntax differs between PostgreSQL and MySQL.

Storing it would allow it to disagree with its own inputs after an edit, and there would then be no way to tell which is right.

### The invisible-risks defect

Risks with no assignee were completely invisible — absent from the list, 404 on get, update and delete.

`getRisks` and `getRiskById` included the optional `identifier` and `assignee` associations without `required: false`, and the `User` model carries a `defaultScope`. Both became INNER JOINs and every unassigned risk was dropped.

Same trap as `certificates`. Same trap latent in `maintenance_work_orders`.

## `vendors` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | |
| `name` | `STRING` | |
| `type` | ENUM | `CalibrationLab`, `PartsSupplier`, `Other` |
| `contactPerson`, `email`, `phone`, `address` | | |
| `rating` | `FLOAT` | |
| `approvalStatus` | ENUM | `APPROVED`, `PENDING`, `REJECTED`, **`CONDITIONAL`** |
| `scorecard` | `INTEGER` | |
| `lastAuditDate`, `nextAuditDate` | `DATE` | |
| `status` | ENUM | `Active`, `Inactive` |

`CONDITIONAL` is a real state, not a fudge: a supplier approved for one category of work and not another, or approved pending a corrective action. Forcing it into `APPROVED` or `REJECTED` discards the condition, and the condition is the whole content of the decision.

`nextAuditDate` drives the supplier-audit schedule the way `nextCalibrationDate` drives the device one.

Extended by migration `0008-extend-vendors-qualification`.

## `supplier_scorecards` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId`, `vendorId` | `UUID` | |
| `evaluationDate` | `DATE` | |
| `qualityScore`, `deliveryScore`, `serviceScore` | `INTEGER` | |
| **`overallScore`** | **`VIRTUAL`** | derived from the three |
| `status` | `STRING` | |
| `comments` | `TEXT` | |
| `evaluatedBy` | `UUID` | |
| `nextEvaluationDate` | `DATE` | |

Three components rather than one number, because "this vendor is a 7" is not actionable. A vendor scoring well on quality and badly on delivery needs a different conversation from one scoring the reverse.

## Workflow Tables

### `workflows` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | |
| `name` | `STRING` | |
| `resourceType` | ENUM | **`Certificate`, `StockTransfer`, `MaintenanceWorkOrder`** |
| `isActive` | `BOOLEAN` | |

A closed set of three. A generic "any resource" engine would need a generic permission model, and the menu-group model is not generic.

### `workflow_steps`

`workflowId`, `stepOrder`, `roleId`, `requiredApprovals`.

Gated by **role**, not by user. A step requiring a named person stops when that person is on leave.

### `workflow_instances` — `paranoid`

`tenantId`, `workflowId`, `resourceId`, `status` (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`), `currentStepOrder`.

`resourceId` is a **polymorphic reference with no foreign key** — the type discriminator lives on the parent workflow, not on the instance. A dangling reference here will not error; it will return nothing.

### `workflow_actions`

`instanceId`, `stepId`, `userId`, `action` (`APPROVED`, `REJECTED`), `comments`.

A step advance and its action row are written in **one transaction**. A decision without a record is unauditable.

### The `db` versus `sequelize` defect

`workflow.service` destructured `db` from the models barrel — which exports `sequelize`, not `db` — making `db.sequelize` undefined at `transaction()`. Every workflow create, update and submit-action 500ed until it was fixed in three places.

The rule: `const { sequelize } = require("../models")`.
