# 07 — Calibration API

Base: `/api/v1/calibration-records`, `/api/v1/calibration-scheduler`. Module `HDC-CAL` (10).

Domain rules: [`../PLAN/07-CALIBRATION-PROGRAM.md`](../PLAN/07-CALIBRATION-PROGRAM.md).

---

## `/api/v1/calibration-records` — 5 endpoints

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/` | `equipment` read | list records |
| POST | `/` | `equipment` write | record a calibration |
| GET | `/:calibrationRecordId` | `equipment` read | one record |
| **PUT** | `/:calibrationRecordId` | `equipment` write | update — see below |
| DELETE | `/:calibrationRecordId` | `equipment` write | soft delete — see below |

### The two endpoints that contradict the rule

BR-7 says calibration records are append-only: a wrong result is corrected by writing a new record, never by editing the original.

`PUT` and `DELETE` exist anyway. They are the mechanism by which the stated rule can be broken.

**This is the widest gap between what the compliance documentation claims and what the API permits.** The rule is enforced by service-layer convention and review, not by the schema, and unlike `audit_logs` — which is protected by having no delete path at all — `calibration_records` has one.

Two things follow:

1. Anything routed through `PUT` or `DELETE` here must be treated as an exceptional, audited correction, not ordinary editing.
2. The fix is a database-level `REVOKE UPDATE, DELETE` for the application role, plus removing these routes. Tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md) and named in [`../PLAN/18-RISK-REGISTER.md`](../PLAN/18-RISK-REGISTER.md) as PR-2.

Documented rather than omitted, because a compliance claim the code does not support is worse than a named gap — it stops anyone looking again.

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
