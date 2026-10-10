# 2026-10-11: the three unit guards P24-01 broke, the `POST /roles/menus` 500, and the 46 envelope findings

**Owner rule:** every suite is green and nothing is skipped. This record covers the backend fixer's work. A frontend fixer worked in parallel under `frontend/src`. Decisions: **ADR-129 Amendment 2** (the guards) and **ADR-137** (the envelope).

## 1. Unit guards: D-05, G-14, D-24

**Cause.** `transform/ledger.ts` and `transform/runner.ts` (P24-01) interpolate `upstream_import` table names. Six statements tripped D-05 and two files tripped G-14. Two unbounded `findAll`s, in `upstreamSqlTransform.service.ts` and `upstreamImport/importKey.ts`, tripped D-24.

**Fix (Option A, ADR-129 Am. 2).** The code is made provably safe, and the guards gain reviewed entries. No guard rule changes.

- `stagedTable()` refuses any name that is not on `tablePolicy.ts STAGED_TABLES`.
- `countSource()` calls `stagedTable()` before any statement.
- Step 4 of the runner binds the candidate names in its catalogue query (`tablename = ANY($2)`) and interpolates only allow-list entries. It never interpolates catalogue text.
- Reviewed entries:
  - D-05 `CROSS_TENANT`: `…/transform/ledger.ts#${table}` and `…/transform/runner.ts#${table}`.
  - `RAW_SQL_UNREACHABLE_BY_BOUND`: the same two keys, as system work.
  - D-24: both reads CLOSED, each with a written cap.

**Tests.**

- `transform.p2401.test.ts`:
  - New: "ADR-129 Am. 2: a staged table reaches SQL text only from the staging allow-list".
  - New: "… a catalogue name off the allow-list never reaches a statement; a step source off it is refused before its count".
  - The runner cases now use allow-listed tables. They assert that step 4's bound list holds the unclaimed allow-listed tables, sorted.
- The three guards pass.

## 2. `POST /roles/menus` → 500

**Root cause.** `createMenuSchema` was `z.looseObject({})`, so it declared nothing. A body without `name` reached `RolesService.createMenu`'s `data.name.trim()`, which threw `TypeError` → 500.

**Fix.** `packages/contracts/src/roles.ts` declares `name: z.string().trim().min(1).max(255)`; 255 is the column's length. The object stays open, so other keys still pass through.

**Test (fails before the fix).** `validators/roles.validator.test.js`, "a menu create requires a non-blank name of at most 255 characters (it 500'd without one)". With the contract file stashed, the run gives 1 failed / 17 passed. With the fix, it passes.

## 3. Envelope: 46 findings → 0 (ADR-137)

| Cause | Routes | Fix |
|---|---|---|
| `sanitizeError()` (global error handler) had no `data` | 32: every 403 from `rbac()`, the backups routes, the IoT ingest 401, the predictive 409, … | `data: null` in `fileValidation.util#sanitizeError` (one central fix) |
| Hand-written refusals | `dynamicAccess` 400/401/500, `userPermission` 400, `user.controller` 400 ×2, billing webhook 400 | `status` + `data: null` |
| `roles.controller` used its own shape | 7 with no `message`, plus the `{ success, message }` removals | the house envelope through one `answer()` helper; every success `data` unchanged |
| OIDC 404 sent through `success()` | `GET /oidc/authorize/request/:requestId` | `error(res, …, 404)` |
| Documents holding an array | search, IPM session create/discard, template version, depreciation report | named by route and key in the smoke's `DOCUMENT_ARRAYS` (A-343's mechanism); billing's 2xx is `PROTOCOL_SUCCESS` (Stripe) |

**Contract and OpenAPI changes.**

- `@callibrator/contracts/roles` answer schemas.
- `roles.openapi.ts` and `oidc.openapi.ts`.
- `backend/openapi.json` regenerated.
- `frontend/src/api/generated/schema.d.ts` regenerated with `npm run api:types`. It is generated from `openapi.json`, so it would otherwise be stale and fail `api:types:check`. No hand edit was made under `frontend/src`.

**Tests updated** (the asserted shapes change only by the added `status`, `message` and `data: null`):

- `roles.controller.test.js`;
- `dynamicAccess.test.js`;
- `dynamicAccess.noLogger.test.js`;
- `oidcProvider.controller.test.js`, which now asserts `error()`, not `success()`;
- `packages/contracts/test/roles.test.ts`, which also proves that the old shapes no longer parse.

## Evidence

**Full backend unit run.** `npm run test:coverage -- --ci`, Node 26.10.0, with ClamAV `clamav/clamav:1.4` as `fixb-clamd` on 127.0.0.1:13312 (`CLAMAV_LIVE_HOST=127.0.0.1`, `CLAMAV_LIVE_PORT=13312`):

- **1,025 suites passed, 17,473 tests passed, 0 failed, 0 skipped.**
- **100 / 100 / 100 / 100** (statements, branches, functions, lines).
- 632 s.
- The container was removed by name afterwards.

**Contracts.** `npm test` in `packages/contracts`: 66 suites, 1,402 tests, 100%.

**Contract smoke.** `npm run test:contract`: **5 passed of 5**.

- 553 routes and 27 frontend calls.
- **5xx 0, envelope 0**, cross-tenant 2xx 0, frontend missing 0, frontend shape 0. 15 cross-tenant 403s were reported; the smoke does not fail on them.
- Stack:
  - project `fixb-stack`, `BUILD_TAG=fixb`, built from this tree;
  - `docker-compose.yml` + `docker-compose.build.yml` + `docker-compose.e2e.yml`;
  - ports 127.0.0.1:27430/27431/27432;
  - env file from `scripts/ci/e2e-env.sh` plus `SEED_DEMO=true`, with `E2E_NODE_ENV=development` and `SSRF_DEV_ALLOW_HOSTS=host.docker.internal`.
- Steps: `GET /migration/seeding` → `npm run test:e2e -- auth.e2e.test.js` (bootstrap + MFA, 32/32) → `GET /migration/seed-demo` → `test:contract` with `LIVE_CONTRACT_BASE_URL`.
- The baseline run on the unfixed tree showed exactly the 1 × 500 and the 46 findings.
- Teardown: `down -v --rmi all`. No `fixb` container, image, volume or network remains.

**Two harness traps met (no code change).**

- **`E2E_MFA_STATE_FILE` is one file for EVERY identifier.** With it set, `auth.e2e`'s signer sign-in reused the operator's cached session, and all 32 tests failed. Leave it unset: the default file is keyed per stack and per identifier.
- **`callibrator-live-contract-mfa.json` is shared across stacks.** A stale secret there makes the contract's MFA fail. Set `LIVE_CONTRACT_MFA_STATE` to a fresh path.

**Static gates.**

- Lint ratchet: 0 errors, 0 warnings, baseline 0.
- `npm run typecheck`: backend 0, contracts 0, frontend 0.
- `npm run ratchet`: 695 `.js`, at the floor.
- `build:dist`, then `load:check`: OK under node (dist) and under tsx (`--src`).
- `openapi:check` current. `openapi:lint`: no new error.
- `api:types:check` current.

**`openapi:breaking`.** Run with oasdiff 1.32.1 in a container (`tufin/oasdiff:v1.32.1`, pulled for this check and removed by name) against `HEAD`: **3 errors**, recorded in ADR-137 as the deprecation note.

- `POST /roles/menus`: `name` is now required.
- The OIDC 404's `success` goes from `true` to `false`, on both mounts.

Both correct a defect, and no working request changes outcome. Every `data: null` addition is additive.

## Not done

- `PATCH /roles/menus/:id` still has no body schema. A non-string `name` there would still throw. The smoke does not reach it.
- The live suite `upstreamImportGrants.p2401.live` was not re-run. Its tables are allow-listed (`mst_faskes`, `trx_inventory`).

## Files

- Backend source:
  - `backend/src/services/upstreamImport/transform/ledger.ts`
  - `backend/src/services/upstreamImport/transform/runner.ts`
  - `backend/src/constants/facilityAccess.ts`
  - `backend/src/utils/fileValidation.util.ts`
  - `backend/src/middlewares/dynamicAccess.middleware.ts`
  - `backend/src/controllers/roles.controller.ts`
  - `backend/src/controllers/oidcProvider.controller.ts`
  - `backend/src/controllers/user.controller.ts`
  - `backend/src/controllers/userPermission.controller.ts`
  - `backend/src/controllers/billing.controller.ts`
- Backend contract docs:
  - `backend/src/routes/api/roles.openapi.ts`
  - `backend/src/routes/api/oidc.openapi.ts`
  - `backend/openapi.json`
- Backend tests:
  - `backend/src/tests/services/upstreamImport/transform.p2401.test.ts`
  - `backend/src/tests/utils/rawSqlTenantPredicate.d05.test.js`
  - `backend/src/tests/services/unboundedFindAll.d24.test.js`
  - `backend/src/tests/validators/roles.validator.test.js`
  - `backend/src/tests/controllers/roles.controller.test.js`
  - `backend/src/tests/controllers/oidcProvider.controller.test.js`
  - `backend/src/tests/middlewares/dynamicAccess.test.js`
  - `backend/src/tests/middlewares/dynamicAccess.noLogger.test.js`
  - `backend/src/tests/e2e/liveContract.smoke.test.js`
- Contracts:
  - `packages/contracts/src/roles.ts`
  - `packages/contracts/test/roles.test.ts`
- Frontend (generated): `frontend/src/api/generated/schema.d.ts`
- Records:
  - `MEMORY/DECISIONS.md` (ADR-129 Am. 2, ADR-137)
  - `MEMORY/CHANGELOG.md`
  - `MEMORY/MEMORY-INDEX.md`
  - this record
