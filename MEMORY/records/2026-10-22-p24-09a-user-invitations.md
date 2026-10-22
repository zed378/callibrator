# P24-09a: the invitation of an imported user (issue, revoke, accept)

**Date:** 2026-10-22 · **Card:** P24-09a (the first part of P24-09) · **ADR:** ADR-139 § 3 – § 4, Amendment 1 · **Status:** DONE (backend). P24-09b is the 30-day unclaimed job; P24-09c is the issue screen.

## What was built

| | |
|---|---|
| `@callibrator/contracts/userInvitations` (new) | the flag name `upstream_invitations_open`, the revoke reasons, the four codes, the params, issue (both names or neither) and answer schemas, and `isSharedAccountName` |
| Migration `0144-user-invitations` (new) | the table, the CHECKs, the global hash UNIQUE, one live invitation per user, append-mostly and same-tenant triggers (ENABLE ALWAYS), and the app role's column-level UPDATE; `down` refuses while rows exist |
| Model `UserInvitation` | registered in the barrel, the types and `UserInvitationId`; `tokenHash` in `SECRET_ATTRIBUTES` |
| `services/userInvitation.service.ts` (new) | `getInvitationState`, `issueInvitation` and `revokeInvitation` (one transaction each, locking the user, one audit row each; e-mail after commit); `openTenantName` (the operator's flag, fail-closed) |
| `services/invitation.service.ts` | `acceptInvitation` takes a `user_invitations` token first; it sets the password, verifies the e-mail, clears both flags and spends the invitation, with one audit row |
| Routes | `GET`, `POST` and `DELETE /users/:userId/invitation` (`user.route.ts`), documented in `user.openapi.ts`; `openapi.json` regenerated (561 operations); frontend `schema.d.ts` regenerated |
| Registries | `FACILITY_SCOPE_SKIPS` (`invitation.service.ts#acceptInvitation`); A-148 FK review (three `user_invitations` keys, RESTRICT); D-12 model count 89; A-127 `NOT_GUARDED` (`DELETE /:userId/invitation`, with reason); live manifest `p2409a` |

## Tests (named; scoped — the full suite was not run)

- **New:**
  - `routes/userInvitation.p2409a`: **25/25**, on `memoryDb` with the real routers, hooks and services:
    - the two-tenant suite on all three routes;
    - a facility-bound administrator refused;
    - issue, re-issue, revoke, the gate, the shared-account rule and the state;
    - the acceptance through the public route, and every one-400 refusal;
    - the service's own checks behind the gates.
  - `migrations/0144-user-invitations.p2409a`: 5/5.
  - contracts `userInvitations.p2409a`. The contracts package is 71 suites and 1,418 tests at 100%.
- **Live, PostgreSQL 18** (`npm run test:live -- --only=p2409a,p2402b,p2108`): **3/3 suites, 24 tests**. `p2409a` 10/10:
  - every CHECK, index and trigger, checked as `callibrator_app` and as the owner, with fail-before for both indexes;
  - the grants;
  - `schemaVerify`;
  - a reboot applies nothing.
- **Guards touched:** `skipFacilityScope.guard`, `associationForeignKeys.a148`, `includeRequired.d12`, `facilityScopedModels.guard`, `twoTenantRoutes.guard` (806 tests), and `denyPlatformAuthoring.a127`.
- **Coverage of the new files:** `userInvitation.service.ts`, `userInvitation.controller.ts`, `invitation.service.ts` and `0144-user-invitations.ts` are all at 100 / 100 / 100 / 100.
- **Flake found and fixed:** the 7-day assertion failed 1 run in 4, because `createdAt` was stamped on a different clock read. The issue now sets `createdAt` from the same instant as the expiry. After the fix the suite passed 6 runs out of 6.
- **Gates:**
  - typecheck 0 errors (backend and frontend)
  - `eslint` on the changed files: clean; ratchet 0 / 0
  - ts-ratchet 695
  - `build:dist`, then `load:check` OK in both modes
  - `openapi:check` current; `openapi:lint` no new error
  - `api:types:check` OK
- A broad `--findRelatedTests` (646 suites, 12,198 tests) also passed. **This is not a substitute for the full suite.**

## Left for later

- **P24-09b:** the nightly job that marks `INACTIVE` an account still awaiting its invitation 30 days after its first one (ADR-139 § 5).
- **P24-09c:** the issue / revoke screen on the users page, and the operator's switch shown on the tenant console.
- **P30-04:** the cutover batch (open the flag, then issue invitations).

## Files

- `packages/contracts/src/userInvitations.ts`, `packages/contracts/test/userInvitations.p2409a.test.ts`
- `backend/src/migrations/0144-user-invitations.ts`, `config/migrator.ts`
- `backend/src/models/userInvitation.model.ts`, `models/index.ts`, `models/secretAttributes.ts`, `types/models.ts`, `types/ids.ts`
- `backend/src/services/userInvitation.service.ts`, `services/invitation.service.ts`, `controllers/userInvitation.controller.ts`
- `backend/src/routes/api/user.route.ts`, `routes/api/user.openapi.ts`, `backend/openapi.json`, `frontend/src/api/generated/schema.d.ts`
- `backend/src/constants/facilityAccess.ts`, `backend/scripts/live-suites.ts`
- tests:
  - new: `routes/userInvitation.p2409a.test.ts`, `migrations/0144-user-invitations.p2409a.test.ts`, `migrations/userInvitations.p2409a.live.test.ts`
  - changed: `models/associationForeignKeys.a148.test.js`, `models/includeRequired.d12.test.js`, `routes/denyPlatformAuthoring.a127.test.js`
- docs and boards: `MEMORY/DECISIONS.md` (ADR-139 status, Am. 1), `docs/SECURITY/15` § 11 (G-33), `docs/UPSTREAM/05-DATA-MIGRATION.md` § 5, `TASKS/PHASE-24-UPSTREAM-DATA-ETL.md`, `TASKS/PROGRESS.md`, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, this record
