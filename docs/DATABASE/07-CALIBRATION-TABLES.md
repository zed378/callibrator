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

### The gap — closed as a constraint (P6-03, 2026-09-24)

Until P6-03 this table was `paranoid`, `PUT` / `DELETE` endpoints existed for it, and the append-only property was
a service-layer convention. It is now enforced by the database, twice over (ADR-062; migration `0057`):

1. **A trigger, for every role — the owner and a superuser included.** `calibration_records_append_only` refuses
   `DELETE`, and refuses any `UPDATE` that changes a column other than the lifecycle columns
   (`superseded_by_id`, `superseded_at`, `void_reason`, `voided_by`, `is_deleted`, `deleted_at`, `updated_at`).
   Each lifecycle column moves one way only: set once, never changed, `is_deleted` never back to false.
   `calibration_records_no_truncate` refuses `TRUNCATE`. Only DDL (dropping or disabling the trigger) or
   `session_replication_role = replica` gets past it — both owner/superuser acts, visible in the database log.
2. **A grant, for the application role.** `callibrator_app` (or `DB_APP_ROLE`) has DML on every table, but on this
   one `UPDATE`, `DELETE` and `TRUNCATE` are **revoked**, with `UPDATE` granted back on the lifecycle columns only.

**Why both.** The backend logs in as the database **owner** — in compose, `POSTGRES_USER`, a superuser — because it
runs `db.sync()` and the migrations at boot. A superuser bypasses every privilege check, so a `REVOKE` alone would
have protected nothing (A-240). The trigger is the guarantee in every deployment; the grant bites once the backend
runs as the application role, which it does after migrating when `DB_APP_ROLE` is set (the compose template sets it;
a deployment without it logs a warning at every boot). The stronger form — a separate LOGIN role with no path back to
the owner — needs a second credential in the deployment and is not built.

Both are **tested as the application role, not the owner**, with a mutation check that re-grants `DELETE` and
disables the trigger and shows each assertion then fails: `backend/src/tests/services/dataIntegrity.p6.live.test.js`
(PostgreSQL 16 and 18.6). `make migrate-verify` (P6-05) refuses a boot where the trigger is missing.

### Correct and void — the only writes after insert

| Operation | What happens |
|---|---|
| `POST /:id/corrections` | a **new** row with the corrected content, `supersedes_id` → the original, `correction_reason` (required); the original gains `superseded_by_id` / `superseded_at`. A record is corrected at most once (partial unique index on `supersedes_id`), so the history is a single line |
| `POST /:id/void` | `is_deleted`, `void_reason` (required — CHECK), `voided_by`. Final: no restore |

Lists show the records **in force** (`superseded_by_id IS NULL`); `?includeSuperseded=true` adds the originals.
Who *performed* a calibration is carried to its correction unchanged; who *corrected* it is the audit row's actor.

**Not changed by P6-03:** a correction does not move the device's `nextCalibrationDate` (the old `PUT` did not
either); correcting the date of the latest calibration leaves the device's due date to be fixed by the next record.

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
