# 2026-10-13 — A-369: a tenant-less non-super-admin account is refused at creation and at sign-in

**Card:** A-369 (bug, line D) · **Decision:** ADR-075 Amendment 1 · **Base:** `f2a2d70`

## The defect

When a super admin called `POST /users/create` without a `tenantId`, the account was created with `tenant_id` NULL. Its holder could sign in, but every later request answered **401 "Invalid session"**. The log said "LOGIN not audited: the user has no tenant".

The root cause is confirmed in code; line A's read-only diagnosis said the same.

1. `user.service#userCreate` set `effectiveTenantId = actorIsSuperAdmin ? tenantId : actorTenantId`. For a super admin who named no tenant, that value is `undefined`, whatever the role.
2. `auth.service#openLoginSession` issues the session and skips the LOGIN row for a tenant-less user (`audit_logs.tenant_id` is NOT NULL).
3. On the next request, `auth.service#verifyUserSession` runs `Users.findByPk` under the principal's own context. `utils/tenantScope.util#resolveScope` skips scoping only for a super admin. A tenant-less principal with any other role gets `deny`, so its predicate matches `NO_TENANT_UUID` and the query cannot see its own row. Result: 401.

`user.service#userRoleUpdate` could reach the same state: giving a tenant-less super admin a tenant role.

## The fix

- **`backend/src/utils/tenantRequired.util.ts`** (new) holds the one rule:
  - `isPlatformRole` is true for the super admin, by role id or by name.
  - `assertTenantForRole` throws 400 `TENANT_REQUIRED`.
  - `tenantlessSignInRefusal` returns 403 `ACCOUNT_HAS_NO_TENANT`.
  - Both use `CodedError`, so `controllerWrapper#sendCaughtError` puts the code at the top level.
- **`user.service.ts`:**
  - `userCreate` calls `assertTenantForRole` after `resolveCreateBinding`, so G-17's "super admin naming no tenant finds no facility" stays a 404.
  - `userRoleUpdate` calls it after the inactive-role check.
  - Both catch blocks now rethrow a `CodedError` unchanged. They used to rebuild it as `{ status, message }`, which dropped the code.
- **`auth.service.ts`:** `assertMaySignIn` (password and passkey) refuses a tenant-less non-platform account. The check sits after the suspended and locked checks and before the tenant-state check. That means it runs before the one-time password is spent (`firstSignIn`), before the MFA token, and before the session or LOGIN row. It logs `Sign-in refused: the account has no tenant`.

A super admin with no tenant is still allowed to be created, to have its role kept, and to sign in.

## Evidence

- **New:** `backend/src/tests/services/tenantRequired.a369.test.ts`, 14 tests. It uses the real models and tenant hooks over `fixtures/memoryDb`. It also pins the mechanism: `verifyUserSession` answers 401 in the orphan's own context and 200 in the operator's.
  - **Fail-before:** the same file run with `user.service.ts` and `auth.service.ts` restored from `f2a2d70` gives 5 failed, 9 passed. The failing tests:
    - "refuses a tenant-less TECHNICIAN with 400 TENANT_REQUIRED and writes nothing"
    - "a blank tenantId is no tenant either"
    - "refuses with 400 TENANT_REQUIRED and leaves the role as it was"
    - "refuses with 403 ACCOUNT_HAS_NO_TENANT after the password, with no session and no LOGIN row"
    - "does not spend a one-time password it refuses"
- **Existing tests changed to match the decision.** Their fixtures used a tenant-less non-super-admin who signed in:
  - `auth.service.coverage` ("returns a null role…"): the fixture is given a tenant.
  - `auth.rateLimit.a67`: the fixture is given a tenant.
  - `user.service.test.js` (two `userRoleUpdate` cases): the fixtures are given a tenant.
  - `auth.loginAudit.a72` ("a user with no tenant logs in with an error log…"): the fixture is now a super admin.
  - `auth.signInStatus.a83` ("an active tenant and a tenant-less user both sign in"): the fixture is now a super admin.
  - `passkeyLogin.service.p1010` ("a tenant-less account's counter regression is audited under PLATFORM…"): the fixture is now a super admin.
  - **`auth.emailVerificationPolicy.a60`:** the assertion changed by decision. The case "a self-registered account (no tenant) … signs in — into nothing" is now `it.each([false, true])` "… is refused for having no tenant, not for its address". That takes the file from 1 test to 2.
- **Related run with coverage:** `npm test -- --ci --findRelatedTests` over the three changed sources, plus every suite that loads them through `jest.requireActual`, plus the passkey and SCIM suites. Coverage scope was `--collectCoverageFrom` on the three changed files.
  - `auth.service.ts` and `tenantRequired.util.ts` are at 100/100/100/100. `user.service.ts` is at 100% statements, functions and lines and 99.72% branches; the one uncovered branch is line 418 (`apiKeyId ?? null` in `recordIdentityConflict`), which this change does not touch.
  - 303 suites ran: 298 passed and 5 failed. None of the 5 failures is this change:
    - `routePermissionGuard.p604`, `includeRequired.d12` and the A-127 regulated-route guard fail on line B's uncommitted public-device route and model.
    - `user.passwordReset.a162` hit a 10 s timeout and `alertRouting.p702` failed under load.
  - The two load failures, the fixed passkey suite, `sso.refusalTiming.a292` (a timing flake in the first run), `userBinding.massAssignment` and the new suite were re-run alone: 6 suites, 81 tests, all passed.
- **Guards:** `npm test -- --ci src/tests/guards src/tests/utils/rawSql src/tests/services/unboundedFindAll`: 45 suites; 348 tests passed and 1 failed. The failure is G-13, on line B's `publicDevicePage.service.ts#resolveToken:59`.
- **Lint and types:**
  - `npx eslint` on all 11 changed files: clean.
  - `node scripts/ci/eslint-ratchet.js`: 0 errors, 0 warnings, baseline 0.
  - `npm run typecheck`: 0 errors.
  - `npm run ratchet`: 695 `.js` files, at the floor.
  - `npm run load:check -- --src`: OK, 757 modules.

## Not done / open

- An account already created tenant-less cannot be repaired through the API. `editUser` does not take `tenantId`, and the role change now refuses. It has to be deleted and recreated, or fixed with a reviewed database update.
- The descriptions in `user.openapi.ts` for `/create` and `/role-update` do not yet name `TENANT_REQUIRED`. `openapi.json` would have picked up line B's in-flight routes on regeneration, so it was not regenerated.
  **Done 2026-10-13** ([record](./2026-10-13-a369-openapi-codes.md)): the four operations name their codes; `openapi.json` and `schema.d.ts` regenerated.
- The frontend user-create form shows the message as it is. It does not branch on `code`.
