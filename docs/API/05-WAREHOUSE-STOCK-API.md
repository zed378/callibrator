# 05 — Warehouse and Stock API

Base: `/api/v1/warehouses`, `/api/v1/stocks`. Module `HDC-WH` (8). Menu group: `warehouse`.

---

## `/api/v1/warehouses` — 9 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | list warehouses |
| GET | `/:warehouseId` | one warehouse |
| POST | `/` | create |
| PATCH | `/:warehouseId` | update |
| DELETE | `/:warehouseId` | soft delete |
| GET | `/:warehouseId/locations` | locations in a warehouse |
| POST | `/locations` | create a location |
| PATCH | `/locations/:locationId` | update |
| DELETE | `/locations/:locationId` | delete |

### Location routes are flat

Reading locations is nested (`/:warehouseId/locations`); creating and updating them is **flat** (`/locations`, `/locations/:locationId`). The warehouse is supplied in the body on write.

Inconsistent, real, and documented rather than quietly changed — it is a breaking API change to fix.

### Tables

`warehouses`: `name`, `code`, `address`, `description`, `status` (`active` / `inactive`), `paranoid`. Indexed on `tenant_id`, `code`, `status`, `is_deleted`.

`storage_locations`: `warehouseId`, `name`, `code`, `description`, `isActive`. Indexed on `tenant_id`, `warehouse_id`, `code`, `is_active`.

### Deleting a warehouse does not delete devices

`calibration_devices.locationId` references `warehouses.id` with **`ON DELETE SET NULL`**. Losing a warehouse record nulls the device location; it never destroys device records.

That asymmetry is the layering rule from [`../PLAN/08-DOMAIN-MODEL.md`](../PLAN/08-DOMAIN-MODEL.md): operations data does not get to delete evidence.

## `/api/v1/stocks` — 15 endpoints

### Stock rows

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | list stock |
| GET | `/:stockId` | one row |
| POST | `/` | create |
| **PATCH** | `/:stockId` | update |
| DELETE | `/:stockId` | soft delete |

`stocks`: `warehouseId`, `locationId`, `itemName`, `sku`, `serialNumber`, `quantity`, `minQuantity`, `description`. Indexed on `tenant_id`, `warehouse_id`, `location_id`, `sku`, `serial_number`, `is_deleted`.

`minQuantity` drives the low-stock dashboard tile and `INVENTORY` notifications.

### Adjustments

| Method | Path | Purpose |
|---|---|---|
| POST | `/adjustment` | record an adjustment |
| GET | `/adjustment/history` | adjustment history |

`stock_adjustments`: `type` (`addition`, `subtraction`, `write_off`), `quantity`, **`reason`**, `adjustedBy`.

`reason` and `adjustedBy` are the point. An adjustment without them is an unexplained quantity change, which is exactly what an inventory audit is looking for.

### Transfers

| Method | Path | Purpose |
|---|---|---|
| POST | `/transfer` | create a transfer |
| **PATCH** | `/transfer/:transferId` | advance the state |
| GET | `/transfer/history` | history |

`stock_transfers`: `fromWarehouseId`, `toWarehouseId`, `itemName`, `quantity`, `requestedBy`, `approvedBy`, `transferDate`, `notes`.

```
pending ──▶ in_transit ──▶ completed
   │             │
   └── cancelled ┘
```

Quantity leaves the source when the transfer enters `in_transit`, and arrives at the destination on `completed` — each inside a transaction, never both at once and never neither (BR-10).

A transfer is one of three resource types the workflow engine can gate (`workflows.resourceType`); when a workflow is configured, approval routes through `workflow_instances`.

### Opname (physical count)

| Method | Path | Purpose |
|---|---|---|
| POST | `/opname` | schedule a count |
| **PATCH** | `/opname/:opnameId` | update or complete |
| GET | `/opname/history` | history |

`stock_opnames`: `warehouseId`, `status` (`draft`, `in_progress`, `completed`), `scheduledAt`, `completedAt`, `performedBy`, `notes`.

### Reports

| Method | Path | Purpose |
|---|---|---|
| GET | `/reports/summary` | stock summary |
| GET | `/reports/export` | export |

Large exports run as batch jobs, not synchronous responses.

## PATCH, Not PUT

Stock update, transfer advance and opname update all use **`PATCH`**. Warehouses also use `PATCH`. Devices and calibration records use `PUT`.

The API is not internally consistent on this. Check the table before assuming.

## Permissions

| Role | `warehouse` |
|---|---|
| `SUPERADMIN` | write |
| `HEALTHCARE ADMIN` | write |
| `WAREHOUSE STAFF` | **write** |
| `CALIBRATOR ADMIN` | read |
| `ENGINEERING MANAGER`, `SUPERVISOR`, `TECHNICIAN`, `HEALTHCARE TECHNICIAN`, `FACILITY MAINTENANCE`, `ROOM USER`, `USER` | read |

`WAREHOUSE STAFF` sits at level 4 and holds `write` where `SUPERVISOR` at level 6 holds only `read`. Level orders privilege escalation, not scope: a warehouse clerk is supposed to move stock, a supervisor is supposed to approve it. See [`../PLAN/03-USER-ROLES.md`](../PLAN/03-USER-ROLES.md).

## Frontend

`/dashboard/stock`, with local `components/` and `hooks/`.

Services: `stock.service.ts`, `warehouse.service.ts`. Their contract tests assert the flat location paths and the `PATCH` verbs — the tests document reality rather than the shape one might expect.

## Quantity Integrity

Every quantity change goes through a transaction, and every path writes a row that explains it:

| Path | Explanation row |
|---|---|
| Adjustment | `stock_adjustments` with `reason` and `adjustedBy` |
| Transfer | `stock_transfers` with the state transition |
| Opname | `stock_opnames` reconciliation |

A direct `PATCH /:stockId` that changes `quantity` without one of these bypasses the explanation. That is a real hole in the current API — the endpoint exists and does not force a reason. Tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).
