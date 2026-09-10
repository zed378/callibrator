# Phase 2 — Warehouse and Inventory

**Status: ✅ DONE**, with one integrity gap that remains open.

Written retrospectively from the code. Module `HDC-WH` (8).

---

### P2-01 — Warehouse and location models

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/DATABASE/05-WAREHOUSE-TABLES.md` |

**What shipped:** `warehouses` and `storage_locations`, both `paranoid`, both tenant-scoped.

**⚠ Divergence — ADR-023.** The plan specified a **hierarchical location model** — floor → section → bin → slot. What shipped is a **single level** below the warehouse, with deeper physical hierarchy expressed in `code` (`A-03-14`).

A deliberate simplification: a recursive location tree is correct on paper and unmanageable in a UI where a clerk needs to pick a location in two taps. Sari uses this screen continuously, and the model that reads best on a whiteboard is not the one that survives a shift.

**Deleting a warehouse nulls device locations rather than cascading.** `calibration_devices.locationId` uses `ON DELETE SET NULL` — losing a warehouse record must never destroy device records. That is the layering rule made concrete: operations data does not get to delete evidence.

---

### P2-02 — Stock tracking

| | |
|---|---|
| **Status** | ✅ DONE |

**What shipped:** `stocks` with `itemName`, `sku`, `serialNumber`, `quantity`, `minQuantity`, indexed on tenant, warehouse, location, sku, serial and `is_deleted`.

**A stock row carries both `sku` and `serialNumber`**, and which one is populated says whether the row counts interchangeable parts or tracks a single unit. The schema supports both and does not force a choice.

`minQuantity` drives the low-stock dashboard tile and `INVENTORY` notifications.

---

### P2-03 — Adjustments

| | |
|---|---|
| **Status** | ✅ DONE |

**What shipped:** `stock_adjustments` with `type` (`addition`, `subtraction`, `write_off`), `quantity`, **`reason`** and **`adjustedBy`**.

**`reason` and `adjustedBy` are the point of the table.** An adjustment without them is an unexplained quantity change, which is exactly what an inventory audit looks for.

**`write_off` is separate from `subtraction`** because the accounting treatment differs: stock consumed is not stock lost, and rolling them together makes shrinkage invisible.

The UI presents them as three separate actions rather than one form with a type dropdown, for the same reason.

---

### P2-04 — Transfers

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/PLAN/02-BUSINESS-RULES.md` BR-10 |

**What shipped:** `stock_transfers` referencing two warehouses, as a state machine.

```
pending ──▶ in_transit ──▶ completed
   │             │
   └── cancelled ┘
```

**Quantity moves exactly once**: it leaves the source at `in_transit` and arrives at the destination at `completed`, each inside a transaction. Never both at once, never neither.

**`in_transit` exists because stock in a van is neither at the origin nor the destination.** That is the truth, and a two-state transfer model produces phantom inventory. The UI shows transfer state **as a state**, never inferred from quantities — hiding it recreates exactly the problem the model was built to prevent.

Transfers are one of three `workflows.resourceType` values, so an approval chain can gate them.

---

### P2-05 — Opname

| | |
|---|---|
| **Status** | ✅ DONE |

**What shipped:** `stock_opnames` — `draft` → `in_progress` → `completed`, with `scheduledAt`, `completedAt` and `performedBy`.

The term **opname** is used throughout, inside English interface text, because that is what the people doing it call it.

**Three movement tables rather than one generic ledger**, because the three have genuinely different lifecycles: an adjustment is instantaneous, a transfer is a multi-step process spanning two locations, and an opname is a scheduled event reconciling many rows at once.

**The counting screen is the one warehouse surface that is spacious rather than dense.** Sari counts walking a shelf, one-handed, and a mis-tap writes a wrong figure into a reconciliation.

---

### P2-06 — Inventory reporting

| | |
|---|---|
| **Status** | ✅ DONE |

`GET /stocks/reports/summary` and `/reports/export`. Export runs as a **batch job**, because a full stock export can exceed the 30-second request timeout, and a report that dies halfway is worse than one that takes five minutes and says when it is ready.

---

### P2-07 — Warehouse UI

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/UI-UX/13-WAREHOUSE-UX.md` |

**What shipped:** `/dashboard/stock` — four tabs rather than four routes, because Sari moves between them constantly and a page load between "check stock" and "start a transfer" is friction repeated fifty times a shift.

**The UI does not offer a direct quantity edit**, deliberately. See the open gap below.

---

## API Shapes Worth Knowing

Documented rather than quietly changed, because changing them is a breaking API change.

| Shape | Reality |
|---|---|
| Location **reads** | nested — `GET /warehouses/:id/locations` |
| Location **writes** | **flat** — `POST /warehouses/locations` |
| Stock update, transfer, opname | **`PATCH`** — while devices and calibration records use `PUT` |

The API is not internally consistent on verbs. Check the table before assuming.

---

## Phase 2 — Retrospective

**What shipped:** the full inventory surface — warehouses, locations, stock, adjustments, transfers, opname, reporting.

**What diverged:**

| Planned | Actual |
|---|---|
| Hierarchical locations (floor → section → bin → slot) | a single level, with hierarchy in `code` |

**What remains open — P6-09:**

**`PATCH /api/v1/stocks/:stockId` can change `quantity` directly**, bypassing all three explanation paths. Every quantity change is supposed to route through an adjustment, a transfer or an opname, each of which captures a reason and an actor.

**The interface is currently the only thing preventing an unexplained quantity change.** That is a convention, not a control — the same shape as the append-only gap on calibration records, and it belongs in the same category of finding.

**What to watch:**

- `stock_transfers` has two nullable actor FKs (`requestedBy`, `approvedBy`). An include on either without `required: false` becomes an INNER JOIN and silently drops rows — the defect shape that has already hit risks and certificates twice.
- Transfer state must stay visible **as a state**. Any UI change that infers it from quantities reintroduces phantom inventory.
