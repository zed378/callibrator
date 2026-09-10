# 09 — Maintenance API

Base: `/api/v1/maintenance`, `/api/v1/predictive-maintenance`, `/api/v1/iot`. Module `HDC-MNT` (12), `HDC-IOT` (25).

---

## `/api/v1/maintenance` — 5 endpoints

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/` | `equipment` read | list work orders |
| GET | `/:orderId` | `equipment` read | one order |
| POST | `/` | `equipment` write | create |
| **PATCH** | `/:orderId` | `equipment` write | update or advance |
| DELETE | `/:orderId` | `equipment` write | soft delete |

### `maintenance_work_orders`

| Column | Values |
|---|---|
| `deviceId` | the device under maintenance |
| `title`, `description` | what and why |
| `type` | `Preventative`, `Breakdown`, `Repair` |
| `status` | `Open`, `InProgress`, `Completed`, `Cancelled` |
| `priority` | `Low`, `Medium`, `High`, `Critical` |
| `vendorId` | external service provider, optional |
| `assignedTo` | internal technician, optional |

`vendorId` and `assignedTo` are both optional and both nullable, which makes them a classic INNER JOIN trap: an include on either without `required: false` silently drops every order that has no vendor or no assignee. That is most of them.

This exact shape has produced two separate list-returns-empty defects elsewhere in the codebase. Assume it applies here.

### Type semantics

| Type | Origin |
|---|---|
| `Preventative` | scheduled, or proposed by predictive maintenance |
| `Breakdown` | the device stopped working |
| `Repair` | corrective work following a fault or a failed calibration |

`Preventative` is the one the platform can propose. `Breakdown` and `Repair` are always human-initiated.

### Relationship to calibration

A failed calibration (`isCompliant: false`) does not automatically create a work order. It is a signal for a human.

Automatic order creation from a failed calibration sounds helpful and is not: a failed calibration may mean the device is broken, or that the reference standard drifted, or that the technician made an error. Which of those it is determines whether a repair order is the right response, and only a person can tell.

### Workflow gating

`MaintenanceWorkOrder` is one of the three `workflows.resourceType` values. Where a workflow is configured, transitions route through `workflow_instances` with ordered, role-gated steps.

## `/api/v1/predictive-maintenance` — 3 endpoints

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/analyze/:deviceId` | `predictive-maintenance` write | run analysis for a device |
| GET | `/recommendations` | `predictive-maintenance` read | current recommendations |
| POST | `/recommendations/:deviceId/approve` | `predictive-maintenance` write | accept a recommendation |

**There is no predictive-maintenance table.** The module computes over `iot_readings`, `maintenance_work_orders` and `calibration_records`. Worth knowing when looking for a model that does not exist.

Outputs:

- a proposed preventative work order,
- a revised calibration interval written to `calibration_devices.recommendedCalibrationInterval` with `recommendationReason`.

**Everything is a proposal.** `POST /recommendations/:deviceId/approve` is the human gate. Nothing here changes an interval or dispatches a technician on its own, because changing a calibration interval is a quality decision with regulatory weight.

`recommendationReason` exists because a bare number nobody can justify gets ignored. A recommendation that cannot be explained will not be accepted, and an unaccepted recommendation is wasted computation.

### Permissions

| Role | `predictive-maintenance` |
|---|---|
| `SUPERADMIN`, `CALIBRATOR ADMIN` | write |
| `HEALTHCARE ADMIN`, `ENGINEERING MANAGER` | read |
| everyone else | none |

The calibrator admin holds write and the healthcare admin holds read. That matches who owns the interval decision: the calibration provider proposes and adjusts, the facility reviews.

## `/api/v1/iot` — 1 endpoint

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/ingest` | **device token** | submit a telemetry reading |

Authenticated with `calibration_devices.iotDeviceToken`, gated by `iotEnabled`. Not a user session — the caller is a device.

Also ingested over MQTT via the **embedded `aedes` broker** inside the Express process (`MQTT_HOST`, `MQTT_PORT`). Embedding it means a hospital deployment does not need a separate broker, which matters where every additional service is a procurement conversation.

### `iot_readings`

| Column | Notes |
|---|---|
| `deviceId` | |
| `timestamp` | |
| `metrics` | JSONB — the reading |
| `isAnomaly` | computed **at ingest**, not at query time |

Indexed on `tenant_id`, `device_id`, `timestamp`, and the pair `(device_id, timestamp)` — every query is "this device, this window".

`isAnomaly` is evaluated against `calibration_devices.readingTolerance` at write time. Anomaly detection that runs at read time cannot alert, which defeats the purpose.

### Telemetry is not a calibration result

A device reporting itself within tolerance has not been calibrated. It has reported.

Calibration requires a traceable reference standard and a competent human who signs for the result. Treating telemetry as calibration would produce a certificate nobody can defend at audit, which is worse than no certificate at all.

### Volume

`iot_readings` is the highest-volume table in the system and the only one purged by retention policy rather than soft-deleted. Telemetry is operational data; calibration history is evidence, and they are managed differently on purpose.

Partitioning is the correct next step when retention alone stops being enough. Tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

## Related

| Need | Endpoint |
|---|---|
| Vendors for external service | `/api/v1/vendors` |
| Vendor performance | `/api/v1/supplier-scorecard` |
| Non-conformance from a maintenance outcome | `/api/v1/qms/nc` |
| Device register | `/api/v1/calibration-devices` |

## Frontend

`/dashboard/maintenance` and `/dashboard/predictive-maintenance`. Services: `maintenance.service.ts`, `predictiveMaintenance.service.ts`.
