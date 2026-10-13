# `GET /ipm/sessions` gains an `unsigned` filter (the field app's "to sign" list)

**Date:** 2026-10-12 · **Card:** a backend gap found by the coordinator while P22-10c was being built (not a numbered card) · **ADR:** none. The filter follows the existing signing rules and records no new decision.

## Gap

The field app's "to sign" list read `GET /api/v1/ipm/sessions`, so it showed every submitted visit the user had, signed or not.

## Change

- **`@callibrator/contracts/inspectionSessions` `ipmSessionListQuery`:** adds `unsigned: booleanish().optional()`. A value other than a boolean (or its text form) gets a 400.
- **`ipmSession.service#listSessions`:** with `unsigned`, the list keeps only the caller's **signable** reports, using `ipmSignature.service`'s own rules: submitted, not superseded, not imported (`legacy_key` null), and performed by the caller.
  - `true`: those **without** the caller's performer signature.
  - `false`: those **with** it.
  - A performer signature is only ever the performer's, so the caller's own performer signatures (`signatureFilter`, one user's rows, the D-24 `PARENT` entry) are exactly the signed set.
  - An empty signed set adds no `NOT IN`, never `NOT IN (NULL)`.
  - No caller (a system path) lists nothing.
- **Facility scope:** the tenant and facility hooks still apply. A bound principal sees only its facility's reports, another tenant's never appear, and `clientFacilityId` narrows further.
- **OpenAPI:** code-first. `backend/openapi.json` and `frontend/src/api/generated/schema.d.ts` are regenerated.

## Tests (named)

- `routes/ipmSessions.unsigned.test.ts` (new): 5/5. It runs the REAL chain and hooks over memoryDb and covers:
  - staff `true` gives F2's unsigned report; `false` gives the signed F1 report;
  - superseded, voided and imported reports, and another performer's, never appear;
  - `clientFacilityId` narrows;
  - a bound F1 caller gets only its own F1 report; tenant B gets only its own;
  - `maybe` is a 400;
  - no person gives an empty list.
- `packages/contracts/test/inspectionSessions.unsigned.test.ts` (new): 2/2.
- Every non-live suite that reaches the sessions route or service (16 suites, 343 tests) passes. `ipmSession.service.ts` is at 100 / 100 / 100 / 100. `--findRelatedTests` reaches only 4 of them, because the route suites load the router through `jest.requireActual`.
- `services/unboundedFindAll.d24` gained one reviewed entry: `ipmSession.service.ts::signatureFilter::models.InspectionSessionSignature`, `PARENT`.
- Guards: 44 suites, 335 tests.
- Contracts: 1,408 tests, 100%.
- Gates:
  - `eslint` on the changed files: clean
  - `eslint-ratchet`: 0 / 0
  - `typecheck`: 0 errors (backend and contracts)
  - `ratchet`: 695
  - `load:check`: OK in dist and src
  - `openapi:check`: current
  - `openapi:lint`: no new error
  - `api:types:check`: OK
- **Not run:** a live PostgreSQL case for the new filter. The SQL is Sequelize's standard `IN` / `NOT IN`, but only memoryDb exercised it here. **Run since, 2026-10-13:** `ipmSubmit.p2104.live` [live verification record](./2026-10-13-live-verification-debt.md).

## Files

- `packages/contracts/src/inspectionSessions.ts`, `packages/contracts/test/inspectionSessions.unsigned.test.ts` (new)
- `backend/src/services/ipmSession.service.ts`
- `backend/src/tests/routes/ipmSessions.unsigned.test.ts` (new), `backend/src/tests/services/unboundedFindAll.d24.test.js`
- `backend/openapi.json`, `frontend/src/api/generated/schema.d.ts` (regenerated)
- `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, this record
