# The OpenAPI document states A-369's two refusal codes

**Date:** 2026-10-13 · **Card:** line A card 4 (the A-369 record's open item) · **ADR:** ADR-075 Am. 1 (no new decision) · **Status:** DONE.

The [A-369 record](./2026-10-13-a369-tenantless-accounts.md) left the contract unwritten. The services throw a `CodedError` whose code is sent as the top-level `code`, but the OpenAPI document did not name either code. It now does.

| Operation | Status | Top-level `code` |
|---|---|---|
| `POST /api/v1/users/create` (`createUser`) | 400 | `TENANT_REQUIRED` |
| `POST /api/v1/users/role-update` (`updateUserRole`) | 400 | `TENANT_REQUIRED` |
| `POST /api/v1/auth/login` (`login`) | 403 | `ACCOUNT_HAS_NO_TENANT` |
| `POST /api/v1/auth/passkey/verify` (`passkeySignIn`) | 403 | `ACCOUNT_HAS_NO_TENANT` |

- **The schema.** Each response is the error envelope extended with an **optional** `code` enum. The same status's other refusals (a validation 400; the policy or suspension 403s) carry no code. The example is the coded refusal.
- **One source for the texts.** The codes and messages are imported from `utils/tenantRequired.util`, so the document and the services cannot drift.
- **Descriptions.** The operations' descriptions now name the codes.
- **Other routes.** No other route reaches these refusals. The MFA step and the first-sign-in password change come after `loginUser`'s check.

## Tests (named)

- `docs/tenantRequiredErrors.a369` (new, 5 tests): each of the four operations in the generated `openapi.json` has its `code` enum and example. The bodies accept the coded refusal and the uncoded ones, and refuse another code.
- `routes/apiDocs.p925`, `routes/swaggerValidatorAlignment.p608`, `services/tenantRequired.a369`, guards, `utils/rawSql*` and `unboundedFindAll`: 49 suites, 372 tests passed. `user.openapi.ts`, `auth.openapi.ts` and `authPublic.openapi.ts` are at 100 / 100 / 100 / 100. `docs/` is outside the coverage scope (`coveragePathIgnorePatterns`).
- **OpenAPI:**
  - `openapi:generate` wrote 558 operations, all code-first. Only the four responses changed (8 hunks).
  - `openapi:check` is current, and `openapi:lint` shows no new error.
  - `api:types` regenerated `schema.d.ts`; `api:types:check` is current.
  - `openapi:breaking` was **skipped locally** because `oasdiff` is not installed; CI runs it. The change only adds an optional property to error responses.
- **Gates:**
  - Backend and frontend `typecheck`: 0 errors.
  - `npm run ratchet`: 695, at the floor.
  - `load:check`: OK in both modes.
  - ESLint ratchet: 0, baseline 0.

## Files

- `backend/src/docs/openapi/tenantRequiredErrors.ts` (new), `backend/src/routes/api/user.openapi.ts`, `backend/src/routes/api/auth.openapi.ts`, `backend/src/routes/api/authPublic.openapi.ts`
- `backend/openapi.json`, `frontend/src/api/generated/schema.d.ts`
- `backend/src/tests/docs/tenantRequiredErrors.a369.test.ts` (new)
- this record, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`
