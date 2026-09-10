# 13 — Warehouse UX

`/dashboard/stock`. One screen, used continuously by one persona.

Sari holds **write** on `warehouse` — more than a `SUPERVISOR` at level 6 ([`03-PERSONAS.md`](./03-PERSONAS.md)). She is the one who moves things; a supervisor approves it.

---

## The Job

Continuous use, constant interruption, one screen. After week one there is no onboarding — the interface either fits the work or fights it every shift.

Dense (P7): this is scanning territory.

## Layout

```
Warehouses ▸ Locations ▸ Stock          ← navigation, not separate pages
─────────────────────────────────────────
Tabs:  Stock  ·  Transfers  ·  Adjustments  ·  Opname
```

Four tabs rather than four routes, because Sari moves between them constantly and a page load between "check stock" and "start a transfer" is friction repeated fifty times a shift.

## Stock List

| Column | Notes |
|---|---|
| Item | |
| SKU | mono |
| Serial | mono, **never truncated** |
| Quantity | tabular, right |
| Min | tabular, right |
| **Low** | badge when `quantity < minQuantity` |
| Warehouse / location | |

A stock row carries both `sku` (a fungible type) and `serialNumber` (a tracked unit). Which is populated says which kind of row it is — the UI shows both columns and lets them be empty rather than guessing.

## Every Quantity Change Has a Reason

The rule that governs this screen.

| Path | Records |
|---|---|
| Adjustment | `type`, `quantity`, **`reason`**, `adjustedBy` |
| Transfer | the state transition, two warehouses |
| Opname | a counted reconciliation |

**The UI must not offer a direct quantity edit.** `PATCH /api/v1/stocks/:stockId` can change `quantity` with no explanation recorded — a real hole in the API ([`../DATABASE/05-WAREHOUSE-TABLES.md`](../DATABASE/05-WAREHOUSE-TABLES.md)). The interface is currently the only thing preventing an unexplained quantity change, so it does not expose that path.

An adjustment without a reason is exactly what an inventory audit is looking for.

## Transfers — state is visible, never inferred

```
pending ──[Mark in transit]──▶ in_transit ──[Mark received]──▶ completed
   │                               │
   └────────[Cancel]───────────────┘
```

| Rule | |
|---|---|
| State is shown **as a state** | never inferred from quantities |
| Each transition confirms | quantity moves |
| The confirmation states what will be true afterwards | not "are you sure" (P4) |
| `in_transit` is prominent | this is where stock exists in a van |

`in_transit` exists precisely because stock in a van is neither at the origin nor the destination — which is the truth, and hiding it recreates the phantom inventory the model was built to prevent.

If Sari cannot see at a glance which transfers are in flight, stock lives in two spreadsheets and a van (J3).

**Quantity moves exactly once**: it leaves the source at `in_transit` and arrives at the destination at `completed`. The confirmation on each says which of those is happening.

Where a workflow is configured for `StockTransfer`, approval routes through the workflow engine and the UI shows the pending step and who it is waiting on.

## Adjustments

```
[ + Addition ]  [ − Subtraction ]  [ Write-off ]
       │
   quantity, reason (required), item, location
```

Three separate actions, not one form with a type dropdown. The three mean different things and `write_off` in particular has an accounting consequence — stock consumed is not stock lost, and a dropdown makes them look interchangeable.

`reason` is required at the field level, not validated on submit.

## Opname

```
draft ──▶ in_progress ──▶ completed
```

A scheduled physical count reconciling many rows at once.

The counting screen is the one place in the warehouse area that is **spacious** rather than dense: someone is walking a shelf with a phone, entering counts, and a mis-tap here writes a wrong figure into the reconciliation.

Large touch targets, numeric keyboards, and a visible running position in the list.

The term "opname" is used throughout, in English interface text, because that is what the people doing it call it.

## Low Stock

`quantity < minQuantity` raises an `INVENTORY` notification and appears as a dashboard tile.

On this screen it is a badge on the row, and a filter. Not a separate page — a low-stock list that lives elsewhere is a list nobody opens.

## Warehouses and Locations

`storage_locations` is a **single level** below the warehouse, not a floor/section/bin/slot tree. Deeper physical hierarchy is expressed in `code` (`A-03-14`).

That is a deliberate simplification: a recursive location tree is correct on paper and unmanageable in a UI where a clerk needs to pick a location in two taps.

**API shape to know:** reading locations is nested (`GET /warehouses/:id/locations`), but creating and updating them is **flat** (`POST /warehouses/locations`). Inconsistent, real, and documented rather than quietly changed.

Deleting a warehouse **nulls** device locations rather than deleting devices. The confirmation says so.

## Mobile

Sari is often on a phone or a shared tablet on a trolley.

| Rule | |
|---|---|
| Tables become cards below `sm` | a horizontally scrolling stock table is unusable one-handed |
| Touch targets 44×44 minimum | |
| Numeric keyboards on every quantity field | |
| Transfer actions reachable by thumb | bottom of the viewport |
| Opname counting is fully one-handed | it is done walking |

## Reports

`GET /stocks/reports/summary` and `/reports/export`.

Export runs as a **batch job**, not a download — a full stock export can exceed the 30-second request timeout. The UI sets that expectation at submit rather than showing a spinner that ends in a 408.
