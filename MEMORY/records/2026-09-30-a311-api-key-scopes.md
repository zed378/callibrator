# 2026-09-30 — A-311: API-key scopes cover every resource a route gate checks

**Finding:** A-311, in `TASKS/AUDIT-2026-09-REMEDIATION.md`. The owner decision was delegated to the coordinator on 2026-09-30: the scope list must cover every resource a `dynamicAccess` gate uses, drawn from one source that the backend validation and the frontend dialog share, and a guard test must hold it there.

## What was wrong

- `apiKey.service#assertScopes` accepted only the values of `MENU_SLUGS`, which has 44 entries.
- `packages/contracts/src/apiKeyScopes.ts` (A-299) mirrored the same 44, and the create dialog offers that list.
- The `dynamicAccess` gates, however, check seeded menu slugs, and the seed has 63. Five gated resources were on neither list: `calibration`, `certificate`, `maintenance`, `notifications` and `reports`.
- A key could not be scoped to those five, and a gate on them passes a key only through its scopes. So no integration could ever read calibration, certificate, maintenance, notification or report routes.

## The fix

- **`packages/contracts/src/apiKeyScopes.ts`:** `API_KEY_SCOPE_RESOURCES` is now the one source, and it gains the five resources (49 in total). Its header states the rule and names both guards.
- **`backend/src/services/apiKey.service.ts`:** `ALLOWED_RESOURCES = new Set(API_KEY_SCOPE_RESOURCES)`, imported from `@callibrator/contracts/apiKeyScopes`. It no longer reads `MENU_SLUGS`.
- **The frontend** (`frontend/src/app/dashboard/api-keys/scopeOptions.ts`) already builds its options from the contract, so it offers the five with no change.
- **`dynamicAccess`** still authorizes a key through `apiKey.service#scopeAllows`. The resource vocabulary is tied to the list by the guard below, not by a runtime lookup, because a gate must keep rejecting a scope the key lacks whether or not the list names it.

## The guard

`backend/src/tests/guards/apiKeyScopeCoverage.a311.guard.test.ts` replaces `dynamicAccess` with a recorder and requires every route module, in the same way as A-07's `dynamicAccessSlugs`. It asserts:

- the scan saw more than 100 gates, so a scan that finds nothing cannot pass;
- every recorded resource is on the scope list;
- every scope on the list is a seeded menu slug (`seededMenuSlugs()`);
- the list holds no duplicates.

## Evidence

- **Fail-before:** the guard, run before the fix, failed 1 of 4 tests. The failing test listed exactly `calibration`, `certificate`, `maintenance`, `notifications` and `reports`. After the fix it passes 4 of 4.
- **`tests/services/apiKey.scopeContract.a299.test.ts`:**
  - "names exactly the MENU_SLUGS values" became a superset check.
  - The old-dialog case `Maintenance:read` is no longer refused, because it now names a gated scope. A new case asserts it is accepted as `maintenance:read`.
  - `Certificates:read` replaces it among the refused cases, since `certificates` is not a slug.
- **The related suites** (`npm test -- --testPathPatterns "apiKeyScopeCoverage|scopeContract\.a299|routePermissionGuard|apiKey\.service"`) passed 69/69.
- **The apiKey suites** passed 113/113, with `apiKey.service.ts` at 100 / 100 / 100 / 100.
- **`packages/contracts` tests** passed 70/70, and the frontend `api-keys` tests 20/20.
- **Lint** is clean on every changed file. **Typecheck** reports no error in any of them; the remaining errors belong to other lanes' in-flight files.

## Also in this change

- **`backend/src/constants/routeGateExemptions.ts`:** the `POST /impersonate` exemption's check now reads `services/auth.service.ts#impersonateUser`. The P9-12 conversion renamed the file, and `routePermissionGuard.p604` reported the stale path. It passes now.
