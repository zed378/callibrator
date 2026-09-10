# 07 — Calibration Tables

`calibration_records`

One table, and the most important one in the schema.

---

## `calibration_records` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | PK |
| `tenantId` | `UUID` | indexed |
| `deviceId` | `UUID` | indexed |
| **`performedBy`** | `UUID` → `users.id` | **indexed** — 21 CFR Part 11 attribution |
| `calibrationDate` | `DATE` | indexed |
| `dueDate` | `DATE` | |
| `standard` | `STRING` | metrological traceability |
| `results` | `JSONB` | the measurements |
| `measurementUncertainty` | `FLOAT` | ISO 17025 |
| `isCompliant` | `BOOLEAN` | **indexed** — drives the compliance rate |
| `certificateNumber` | `STRING` | |
| `certificateFileUrl` | `STRING` | |
| `notes` | `TEXT` | conditions, deviations |
| `isDeleted` | `BOOLEAN` | indexed |

Indexes: `tenant_id`, `device_id`, `performed_by`, `calibration_date`, `is_compliant`, `is_deleted`.

## What Each Column Is For

### `performedBy`

The single most important column in the table. A calibration result with no named, authenticated person attached is not evidence — it is a number in a database.

Set from `req.user.id`, **never from the request body**. Attribution a client can supply is not attribution.

Indexed because "show me everything this technician calibrated" is a question asked during a competence investigation, and it needs to be fast enough that nobody avoids asking it.

### `standard`

What reference standard the measurement was traceable to. ISO 17025 requires metrological traceability, and traceability without naming the standard is a claim rather than a fact.

### `results` — JSONB, and why

An infusion pump, a defibrillator and a centrifuge do not have comparable measurement points. A normalised measurement table that accommodates all three accommodates none of them well: it ends up as a key-value bag with a foreign key, which is JSONB with extra steps and worse ergonomics.

**The accepted cost:** the database cannot validate measurement structure. Validation lives in the Joi validators and in `calibration_devices.uncertaintyBudget`. This is a real trade-off, taken knowingly.

### `measurementUncertainty`

A measurement without an uncertainty is not a measurement, it is a number.

"35.2 °C" tells an auditor nothing about whether the device is within tolerance. "35.2 ± 0.3 °C against a tolerance of ± 0.5 °C" does. The uncertainty is what makes the compliance verdict defensible.

Derived from the device `uncertaintyBudget` for a given calibration.

### `isCompliant`

The pass/fail verdict. Indexed because the compliance rate is on the dashboard, and the dashboard is loaded on every sign-in.

A `false` here does **not** automatically create a maintenance work order. A failed calibration may mean the device is broken, or that the reference standard drifted, or that the technician made an error — and which of those it is determines the right response. Only a person can tell.

### `notes`

Ambient conditions, deviations from procedure, anything a later auditor needs to interpret the result. Chronically under-filled and disproportionately valuable when it is not.

## Append-Only, and the Gap

BR-7: calibration records are append-only. A wrong result is corrected by writing a new record; the original stays, and the audit trail shows both.

The reason is not fastidiousness. A record that can be edited after the fact has no evidential value at all, because an auditor cannot distinguish "this was always the result" from "this became the result once somebody noticed the problem".

### The gap, stated plainly

**This table is `paranoid`, and `PUT` / `DELETE` endpoints exist for it.**

Contrast `audit_logs`, which is protected by having **no delete path at all** — the absence is the control. `calibration_records` has one, and the append-only property is enforced by service-layer convention and code review rather than by the schema.

Under 21 CFR Part 11 scrutiny this is the finding an auditor raises first.

**The fix:** `REVOKE UPDATE, DELETE ON calibration_records` for the application role, and remove the routes. Tested as the **application role**, not as the database owner — as the owner the test passes whether the grant is right or not, which makes it worthless.

Tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md), named as PR-2 in [`../PLAN/18-RISK-REGISTER.md`](../PLAN/18-RISK-REGISTER.md), and named again in [`../PLAN/15-COMPLIANCE-STANDARDS.md`](../PLAN/15-COMPLIANCE-STANDARDS.md).

Documented in three places on purpose. A compliance claim the code does not support is worse than a named gap — it stops anyone looking again.

## Write Side Effects

Creating a calibration record does four things, in one transaction:

```
INSERT calibration_records
UPDATE calibration_devices
   nextCalibrationDate = calibrationDate + calibrationIntervalDays
INSERT audit_logs (CREATE, with the after-state)
notification type CALIBRATION → Socket.IO tenant room
```

The device recalculation happens **here**, not in a nightly job. A due date computed by a sweep is stale between the calibration and the sweep, and that window is exactly when someone asks whether the device is current.

## Relationship to Certificates

One calibration record justifies at most one certificate. `certificates.calibrationRecordId` is the link, and `calibration_records.certificateNumber` denormalises it back.

Two directions for one relationship is redundancy, and redundancy can disagree. `certificates.calibrationRecordId` is authoritative; `calibration_records.certificateNumber` is a convenience for display.

## Queries This Table Serves

| Question | Filter |
|---|---|
| History for a device | `deviceId`, ordered by `calibrationDate` |
| Compliance rate for a period | `isCompliant` over a `calibrationDate` range |
| Everything a technician calibrated | `performedBy` |
| What was out of interval on a date | joined against `calibration_devices.nextCalibrationDate` |

Every one of these is a query against an operational table with an index chosen for it, not a report assembled by hand. That is the design goal of the whole system: evidence as a by-product of doing the work.
