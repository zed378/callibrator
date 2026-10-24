# Q-52: vendors.notes is stored — DONE

**Date:** 2026-10-24 · **Item:** BACKLOG Q-52 · **Status:** DONE (status reconciled; no code changed) · **Spec refs:** ADR-109 §6, `packages/contracts/src/vendor.ts`

## Hook

BACKLOG Q-52 carried a working decision — add `vendors.notes` — with "Not yet implemented". It is
implemented: the migration, the model, and the round-trip test all exist. The backlog row was
never updated when the work landed.

## What was verified (no code changed)

| | |
|---|---|
| migration `0106-vendor-notes.ts` | adds `vendors.notes` TEXT, nullable |
| `models/vendor.model.ts` | declares `notes` with the Q-52 comment |
| `routes/vendor.notes.q52.test.ts` | POST stores, GET returns, 2,000 bound, PATCH updates, null clears |
| `migrations/0106-vendor-notes.test.ts` | manifest, column, idempotence, no blanket catch, down removes |

## Tests

- `vendor.notes.q52` + `0106-vendor-notes`: 10/10 (2026-10-24).

- **Not run:** the full suite — this card changes no code.

## Definition of Done

- [x] `notes` round-trips through create, read, and update
- [x] the backlog row marked DONE with this record

## Files

- `TASKS/BACKLOG.md` (Q-52 row)
- This record
