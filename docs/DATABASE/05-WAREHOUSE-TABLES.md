# 05 — Warehouse Tables

`warehouses` · `storage_locations` · `stocks` · `stock_adjustments` · `stock_transfers` · `stock_opnames`

---

## `warehouses` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `name` | `STRING` | |
| `code` | `STRING` | indexed |
| `address` | `STRING` | |
| `description` | `TEXT` | |
| `status` | ENUM | `active`, `inactive` — indexed |
| `isDeleted` | `BOOLEAN` | indexed |

### Deleting a warehouse does not delete devices

`calibration_devices.locationId` references `warehouses.id` with **`ON DELETE SET NULL`**. The device location is nulled; the device survives.

This is the layering rule made concrete: operations data does not get to delete evidence.

## `storage_locations`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `warehouseId` | `UUID` | indexed |
| `name` | `STRING` | |
| `code` | `STRING` | indexed |
| `description` | `TEXT` | |
| `isActive` | `BOOLEAN` | indexed |

A single level below the warehouse — not a floor/section/bin/slot tree. Deeper physical hierarchy is expressed in `code` (`A-03-14`) rather than in rows.

That is a deliberate simplification. A recursive location tree is the kind of model that is correct on paper and unmanageable in a UI where a clerk needs to pick a location in two clicks.

## `stocks` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `warehouseId` | `UUID` | indexed |
| `locationId` | `UUID` | indexed |
| `itemName` | `STRING` | |
| `sku` | `STRING` | indexed |
| `serialNumber` | `STRING` | indexed |
| `quantity` | `INTEGER` | |
| `minQuantity` | `INTEGER` | low-stock threshold |
| `description` | `TEXT` | |
| `isDeleted` | `BOOLEAN` | indexed |

`minQuantity` drives the low-stock dashboard tile and `INVENTORY` notifications.

A stock row carries both `sku` (a fungible item type) and `serialNumber` (a specific unit). Which one is populated says whether this row is a count of interchangeable parts or a single tracked item — the schema supports both and does not force a choice.

## `stock_adjustments`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `warehouseId` | `UUID` | indexed |
| `locationId` | `UUID` | |
| `type` | ENUM | `addition`, `subtraction`, `write_off` — indexed |
| `quantity` | `INTEGER` | |
| **`reason`** | `STRING` | |
| **`adjustedBy`** | `UUID` | |

`reason` and `adjustedBy` are the point of the table. An adjustment without them is an unexplained quantity change, which is exactly what an inventory audit looks for.

`write_off` is separate from `subtraction` because the accounting treatment differs: stock consumed is not stock lost, and rolling them together makes shrinkage invisible.

## `stock_transfers`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `fromWarehouseId` | `UUID` | indexed |
| `toWarehouseId` | `UUID` | indexed |
| `status` | ENUM | `pending`, `in_transit`, `completed`, `cancelled` — indexed |
| `itemName` | `STRING` | |
| `quantity` | `INTEGER` | |
| `requestedBy`, `approvedBy` | `UUID` | |
| `transferDate` | `DATE` | |
| `notes` | `TEXT` | |

```
pending ──▶ in_transit ──▶ completed
   │             │
   └── cancelled ┘
```

**Quantity moves exactly once** (BR-10): it leaves the source when the transfer enters `in_transit`, and arrives at the destination on `completed`. Each transition happens inside a transaction. Never both at once, never neither.

`in_transit` exists precisely so stock in a van is neither at the origin nor at the destination — which is the truth, and the reason a two-state transfer model produces phantom inventory.

One of three `workflows.resourceType` values, so transfers can be gated by an approval chain.

## `stock_opnames`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `warehouseId` | `UUID` | indexed |
| `status` | ENUM | `draft`, `in_progress`, `completed` — indexed |
| `scheduledAt`, `completedAt` | `DATE` | |
| `performedBy` | `UUID` | |
| `notes` | `TEXT` | |

Opname is the Indonesian term for a physical stock count, used throughout the product because that is what the users call it.

Three tables for movement rather than one generic ledger, because the three have genuinely different lifecycles: an adjustment is instantaneous, a transfer is a multi-step process spanning two locations, and an opname is a scheduled event reconciling many rows at once.

## The Integrity Gap

Every quantity change is supposed to go through one of the three explanation paths:

| Path | Explanation row |
|---|---|
| Adjustment | `stock_adjustments` with `reason` and `adjustedBy` |
| Transfer | `stock_transfers` with the state transition |
| Opname | `stock_opnames` reconciliation |

**`PATCH /api/v1/stocks/:stockId` can change `quantity` directly**, bypassing all three. That is a real hole: the endpoint exists and does not force a reason.

Recorded rather than glossed over. Tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).
