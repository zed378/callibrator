# 06 — Device API

Base: `/api/v1/calibration-devices`. Module `HDC-CDEV` (9). Menu group: `equipment`.

Domain model: [`../PLAN/06-DEVICE-LIFECYCLE.md`](../PLAN/06-DEVICE-LIFECYCLE.md).

---

## Endpoints

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/` | `equipment` read | list devices, paginated |
| POST | `/` | `equipment` write | create |
| GET | `/:calibrationDeviceId` | `equipment` read | one device |
| **PUT** | `/:calibrationDeviceId` | `equipment` write | update |
| DELETE | `/:calibrationDeviceId` | `equipment` write | soft delete |
| POST | `/bulk-import` | `equipment` write | bulk import as a batch job |

Note `PUT`, not `PATCH` — the opposite of the stock and warehouse routes. The API is not consistent on this; check before assuming.

## Create and Update

```json
{
  "name": "Infusion Pump B-Braun Perfusor",
  "serialNumber": "IP-2024-00871",
  "manufacturer": "B. Braun",
  "model": "Perfusor Space",
  "category": "Infusion",
  "status": "active",
  "locationId": "<warehouse uuid>",
  "installationDate": "2024-03-14",
  "calibrationIntervalDays": 365,
  "uncertaintyBudget": { },
  "readingTolerance": { },
  "iotEnabled": false,
  "remarks": "ICU bay 3"
}
```

`tenantId` is **never accepted from the body**. It is stamped from the `AsyncLocalStorage` context by the global hooks. A body-supplied tenant id is an obvious cross-tenant write, and the way to make that impossible is to never read it.

`nextCalibrationDate` is **derived**, not supplied: `installationDate + calibrationIntervalDays` on create, then `calibrationDate + calibrationIntervalDays` on each calibration write.

## Fields

| Column | Type | Notes |
|---|---|---|
| `name` | `STRING(255)` | required |
| `serialNumber` | `STRING(100)` | **unique**, indexed |
| `manufacturer`, `model`, `category` | `STRING` | optional |
| `status` | ENUM | `active`, `inactive`, `maintenance`, `retired` |
| `locationId` | `UUID` → `warehouses.id` | `ON DELETE SET NULL` |
| `installationDate` | `DATE` | |
| `nextCalibrationDate` | `DATE` | **indexed** — the most-queried column in the system |
| `calibrationIntervalDays` | `INTEGER` | |
| `uncertaintyBudget` | `JSONB` | ISO 17025 uncertainty model (migration `0009`) |
| `readingTolerance` | `JSONB` | bounds for IoT anomaly detection |
| `recommendedCalibrationInterval` | `INTEGER` | derived proposal |
| `recommendationReason` | `TEXT` | why — a bare number nobody can justify gets ignored |
| `iotEnabled`, `iotDeviceToken` | `BOOLEAN`, `STRING` | telemetry opt-in and credential (migration `0010`) |
| `remarks` | `TEXT` | |

Indexes: `tenant_id`, `serial_number`, `status`, `next_calibration_date`, `is_deleted`.

### `serialNumber` uniqueness

Declared `unique: true` on the column, which makes it **globally unique across all tenants**, not per tenant.

That is almost certainly not what was intended — two hospitals can legitimately own devices with the same manufacturer serial — and it means one tenant registering a serial blocks another from registering the same one, which is also a weak cross-tenant existence oracle.

The correct constraint is a composite unique on `(tenant_id, serial_number)`, ideally partial on `is_deleted = false` so a soft-deleted device does not hold its serial hostage. Recorded in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

## `iotDeviceToken`

The credential a physical device presents to `POST /api/v1/iot/ingest`. It must:

- never be returned in a list response,
- be regenerable without recreating the device,
- be treated as a secret in logs.

A device token in a list payload is a credential leak to every user who can read the device register.

## Bulk Import

`POST /bulk-import` creates a **batch job** rather than importing synchronously. A 5,000-row hospital inventory will exceed the 30-second request timeout, and a bulk import that times out halfway is worse than one that takes five minutes and reports when it is done.

Returns a job id; progress is polled at `/api/v1/jobs/:id`.

## Deletion

Soft delete (`paranoid` plus `isDeleted`). Calibration records, certificates, work orders and audit rows survive, because "was this device in calibration on the day it was used" outlives the device by years.

Retiring is different from deleting: set `status = 'retired'`. Retirement is a lifecycle state; deletion is an administrative correction.

## Filtering and Search

`GET /` accepts filters on `status`, `category`, `locationId`, and calibration-due windows, plus free text over `name`, `serialNumber`, `manufacturer` and `model`.

Every filter is applied **after** the mandatory tenant predicate. Global search across devices and other entities is at `/api/v1/search`.

## Related Endpoints

| Need | Endpoint |
|---|---|
| Calibration history for a device | `GET /api/v1/calibration-records?deviceId=` |
| What is due | `GET /api/v1/calibration-scheduler/due` |
| Maintenance orders | `GET /api/v1/maintenance?deviceId=` |
| Telemetry ingest | `POST /api/v1/iot/ingest` |
| Predictive analysis | `POST /api/v1/predictive-maintenance/analyze/:deviceId` |
| Finance and depreciation | `GET /api/v1/finance` |

## Frontend

`/dashboard/devices` with local `components/` and `hooks/`. Service: `device.service.ts`.
