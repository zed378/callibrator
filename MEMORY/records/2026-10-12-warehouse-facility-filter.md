# `GET /warehouses` gains a `clientFacilityId` filter (the field app's rooms per facility)

**Date:** 2026-10-12 · **Card:** backend gap found by the coordinator while P22-10c was being built (not a numbered card) · **ADR:** none. This adds a filter and its implementation detail; no decision is recorded.

## Gap

The field app downloads a facility's rooms with `GET /api/v1/warehouses?kind=room`. The list contract had no `clientFacilityId`, so a provider technician's working set took in every room of the tenant (every facility's).

## Change

- **`@callibrator/contracts/warehouse` `getWarehousesQuery`:** adds `clientFacilityId: uuid().optional()`. A malformed id gets a 400.
- **`warehouse.controller#getAllWarehouses`:** passes the filter on.
- **`warehouse.service#fetchWarehouses`:** applies the filter **AND-ed** (`[Op.and]: [{ clientFacilityId }]`), under the tenant predicate.
  - It is not a top-level key because the facility hook *replaces* a bound principal's top-level `clientFacilityId` with its own (FT-10).
  - With replacement, a bound F1 user naming F2 would have been answered with F1's rooms.
  - With the AND, that request lists nothing, as G-22 expects of every list filter.
  - Another tenant's facility lists nothing. Neither case is an error.
- **OpenAPI** is code-first (the query schema is the contract). `backend/openapi.json` and `frontend/src/api/generated/schema.d.ts` are regenerated.

## Tests (named)

- `routes/warehouse.facilityFilter.test.ts` (new): 4/4, using REAL chains, hooks and memoryDb over `fixtures/ipmSeed`. It covers:
  - staff get exactly F1's or F2's room, with `meta.total` counting only those;
  - another tenant's facility, or a principal of tenant B, gets an empty list;
  - bound F1 naming F2 gets an empty list; naming F1, it gets its own room;
  - a malformed id is a 400.
- `packages/contracts/test/warehouse.facilityFilter.test.ts` (new): 2/2.
- The warehouse suites (routes, services, controllers, validators) and `deviceRegister.isolation.p2102`: 7 suites, 122 tests passed.
  - `warehouse.service.ts` and `warehouse.controller.ts` are at 100 / 100 / 100 / 100.
  - `--findRelatedTests` misses the new route test, because it loads the router through `jest.requireActual`. The run therefore names the suites.
- Contracts: 68 suites, 1,406 tests, 100%.
- Guards (`src/tests/guards`, `utils/rawSql*`, `services/unboundedFindAll`): 44 suites, 335 tests.
- Gates:
  - `eslint` on the changed files: clean
  - `eslint-ratchet`: 0 / 0
  - `typecheck`: 0 errors (backend and contracts)
  - `ratchet`: 695
  - `load:check`: OK in dist and src
  - `openapi:check`: current
  - `openapi:lint`: no new error
  - `api:types:check`: OK

## Files

- `packages/contracts/src/warehouse.ts`, `packages/contracts/test/warehouse.facilityFilter.test.ts` (new)
- `backend/src/controllers/warehouse.controller.ts`, `backend/src/services/warehouse.service.ts`
- `backend/src/tests/routes/warehouse.facilityFilter.test.ts` (new)
- `backend/openapi.json`, `frontend/src/api/generated/schema.d.ts` (regenerated)
- `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, this record
