# Q-55: work-order schedule, costs and resolution are stored — DONE

**Date:** 2026-10-24 · **Item:** BACKLOG Q-55 · **Status:** DONE (status reconciled; no code changed) · **Spec refs:** ADR-097 Amendment 4, `packages/contracts/src/maintenance.ts`

## Hook

BACKLOG Q-55 carried a working decision — add the columns — with "IMPLEMENTED 2026-10-01" in its
own text, but the row was never marked DONE. The migration, the model, the contract bounds, and
the fail-before tests all exist. The backlog row said "implemented" and "not DONE" at once.

## What was verified (no code changed)

| | |
|---|---|
| migration `0107-work-order-schedule-cost.ts` | `scheduled_date` / `completed_date` TIMESTAMPTZ, `estimated_cost` / `actual_cost` NUMERIC(14,2) CHECK ≥ 0, `resolution_notes` TEXT CHECK ≤ 5000; NOT VALID + VALIDATE; no index |
| `models/maintenanceWorkOrder.model.ts` | the five attributes with the Q-55 comment; costs read as numbers (D-21) |
| `routes/maintenance.scheduleCost.q55.test.ts` | POST stores, GET returns, PATCH updates, bounds are 400s, audit carries values (notes' length only) |
| `migrations/0107-work-order-schedule-cost.test.ts` | manifest, columns, idempotence, no blanket catch, down removes |

## Tests

- `maintenance.scheduleCost.q55` + `0107-work-order-schedule-cost`: 13/13 (2026-10-24).

- **Not run:** the full suite — this card changes no code.

## Definition of Done

- [x] schedule, costs and resolution round-trip through create, read, and update
- [x] the backlog row marked DONE with this record

## Files

- `TASKS/BACKLOG.md` (Q-55 row)
- This record
