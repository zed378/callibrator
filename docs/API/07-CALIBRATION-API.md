# 07 — Calibration API

Base: `/api/v1/calibration-records`, `/api/v1/calibration-scheduler`. Module `HDC-CAL` (10).

Domain rules: [`../PLAN/07-CALIBRATION-PROGRAM.md`](../PLAN/07-CALIBRATION-PROGRAM.md).

---

## `/api/v1/calibration-records` — 5 endpoints

As-built since P6-03 (2026-09-24, ADR-PENDING-data). Source: `backend/src/routes/api/calibrationRecords.route.js`.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/` | `calibration` read | list the records **in force** (`?includeSuperseded=true` adds the corrected originals) |
| POST | `/` | `calibration` write | record a calibration |
| GET | `/:calibrationRecordId` | `calibration` read | one record, superseded or not |
| POST | `/:calibrationRecordId/corrections` | `calibration` write | **correct** — writes a NEW record that supersedes this one |
| POST | `/:calibrationRecordId/void` | `calibration` write | **void** a record entered in error — final |

There is **no `PUT` and no `DELETE`**. Both existed until P6-03 and were the mechanism by which BR-7 (append-only)
could be broken.

### Correct

```json
{ "reason": "reference standard was out of calibration", "isCompliant": false }
```

`reason` is required (3–2000 characters after trimming; blank is refused). Any content field may be sent — omitted
fields are carried over from the original. The response is **201 with the new record**; the original is kept,
gains `supersededById`, and drops out of the default list. Two audit rows are written in the same transaction: the
new record's `CREATE` and the original's `UPDATE` (superseded).

| Status | When |
|---|---|
| 404 | not found — including another tenant's record |
| 409 | the record was voided, or already corrected (the message names the correction to correct instead) |

### Void

```json
{ "reason": "entered against the wrong device" }
```

Sets `isDeleted`, `voidReason`, `voidedBy` once. The record is hidden from ordinary reads and **kept**. There is no
restore. 409 if already voided, or if it has been corrected (void the latest correction).

### Why these are the only writes — the database says so

Migration 0057 installs a trigger that refuses, **for every role including the owner**, a `DELETE`, a `TRUNCATE`,
and any `UPDATE` that changes a content column; the lifecycle columns (`superseded_by_id`, `superseded_at`,
`void_reason`, `voided_by`, `is_deleted`, `deleted_at`, `updated_at`) may each be set once, one way. It also
creates the application role (`DB_APP_ROLE`, default `callibrator_app`) with `UPDATE`, `DELETE` and `TRUNCATE` on
the table revoked and `UPDATE` granted back on the lifecycle columns only; the backend drops to that role after
migrating when `DB_APP_ROLE` is set. Proved as the application role on PostgreSQL 16:
`backend/src/tests/services/dataIntegrity.p6.live.test.js`.

## Create

```json
{
  "deviceId": "<uuid>",
  "calibrationDate": "2026-09-10",
  "dueDate": "2027-09-10",
  "standard": "ISO 17025 / JIS T 0601",
  "results": { },
  "measurementUncertainty": 0.31,
  "isCompliant": true,
  "notes": "Ambient 22.4 C, 48% RH"
}
```

`performedBy` is taken from `req.user.id`, **never from the body**. Attribution that a client can set is not attribution.

`tenantId` is stamped by the tenant hooks.

Side effects, all in one transaction:

```
INSERT calibration_records
UPDATE calibration_devices
   nextCalibrationDate = calibrationDate + calibrationIntervalDays
INSERT audit_logs (CREATE)
notification type CALIBRATION → Socket.IO tenant room
```

`nextCalibrationDate` is recalculated from the calibration write, not by a nightly job, so the due date is never stale relative to the record that determines it.

## Fields

| Column | Type | Notes |
|---|---|---|
| `deviceId` | `UUID` | indexed |
| `performedBy` | `UUID` → `users.id` | indexed — 21 CFR Part 11 attribution |
| `calibrationDate` | `DATE` | indexed |
| `dueDate` | `DATE` | |
| `standard` | `STRING` | metrological traceability |
| `results` | `JSONB` | the measurements |
| `measurementUncertainty` | `FLOAT` | ISO 17025 |
| `isCompliant` | `BOOLEAN` | indexed — drives the compliance rate |
| `certificateNumber` | `STRING` | |
| `certificateFileUrl` | `STRING` | |
| `notes` | `TEXT` | conditions and deviations |

### Why `results` is JSONB

An infusion pump, a defibrillator and a centrifuge do not have comparable measurement points. A normalised measurement table that fits all three fits none well.

The accepted cost: the database cannot validate measurement structure. Validation lives in the Joi validators and in the device `uncertaintyBudget`.

## Filtering

`GET /` accepts `deviceId`, `performedBy`, `isCompliant`, and a `calibrationDate` range. All applied after the mandatory tenant predicate.

## `/api/v1/calibration-scheduler` — 2 endpoints

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/due` | `equipment` read | devices due, overdue and upcoming |
| POST | `/run` | `equipment` write | run the sweep now |

```
nextCalibrationDate <  today            → OVERDUE
nextCalibrationDate <= today + 30 days  → DUE SOON
otherwise                               → OK
```

Devices in `inactive`, `maintenance` or `retired` are excluded — an out-of-service device is not overdue, it is out of service.

`POST /run` triggers the sweep manually; it normally runs on a schedule. On more than one backend replica, exactly one must run schedulers, or every sweep notifies twice.

Being overdue does **not** change device status (BR-11). It is a computed reportable state. The platform makes the fact impossible to miss; the decision to stop using an overdue device belongs to the facility.

## Interval Recommendation

Derived from calibration history and written to `calibration_devices.recommendedCalibrationInterval` with `recommendationReason`.

**Never applied automatically.** Changing a calibration interval is a quality decision with regulatory weight; the system proposes, a human with the right role disposes.

## Downstream

A calibration record is the input to a certificate. See [`08-CERTIFICATE-ESIGNATURE-API.md`](./08-CERTIFICATE-ESIGNATURE-API.md).

## Reports

| Endpoint | Answers |
|---|---|
| `GET /api/v1/reports/compliance` | which devices were in and out of interval over a period |
| `GET /api/v1/reports/overdue-devices` | what is overdue now |
| `GET /api/v1/reports/calibration-workload` | forecast workload |
| `GET /api/v1/dashboard/metrics` | the dashboard tiles |

## Frontend

`/dashboard/calibration` and `/dashboard/calibration-scheduler`, each with local `components/` and `hooks/`. Services: `calibration.service.ts`, `calibrationScheduler.service.ts`.
