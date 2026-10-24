# `GET /admin/tenants` follows the list envelope: rows in `data`, paging in a top-level `meta`

**Date:** 2026-10-24 · **Card:** defect fix (house rule, CLAUDE.md § The Response Envelope; queued by the coordinator) · **Status:** DONE

## Hook

`GET /api/v1/admin/tenants` was the one admin list that still answered
`data: { total, page, limit, totalPages, tenants }`. That is the `data.rows` shape, which has
rendered empty lists with no error three times in this codebase. The route now answers like every
other list: `data` holds the rows, and `meta` holds `{ total, page, limit, totalPages }` as a
top-level sibling.

## What changed

| | |
|---|---|
| `backend/src/controllers/admin.controller.ts` | `getAllTenants` returns `data: tenants` and `meta: { total, page, limit, totalPages }`. The service is unchanged |
| `backend/src/routes/api/admin.openapi.ts` → `backend/openapi.json` | the 200 body is now `{ success, status, message, data: Tenant[], meta }` |
| `frontend/src/api/generated/schema.d.ts` | regenerated. **No frontend code consumes this route**: the tenant screens read `GET /tenants/all`. Frontend typecheck: 0 errors |
| `backend/src/tests/e2e/modules/p10-access-requests.e2e.test.ts`, `p21-upstream-flows.e2e.test.ts` | the two consumers now read the rows from `data` |

## Breaking change, recorded as a defect fix

`oasdiff 1.32.1 breaking` was run with docker (`tufin/oasdiff`), comparing `HEAD`'s `openapi.json`
with the new one. It reports **9 errors, all `GET /api/v1/admin/tenants`**: `data` changed from an
object to an array, and its five required properties were removed. This is intended. The route is
super-admin only, and its only callers are the two e2e specs above, both updated. A pull request's
`openapi:breaking` job fails on these 9 errors until this record is accepted. A direct push to
`main` passes, as with W-10's `POST /sop`. Locally, `npm run openapi:breaking` skips, because
`oasdiff` is not on PATH.

## Tests

- `controllers/admin.controller.test.js`: 9/9. The new case "answers the house list envelope: rows in `data`, paging in a top-level `meta`" asserts the whole JSON. It was run against `HEAD`'s controller and failed 1 of 9: `data` was the page object. With the fix it passes 9/9. The mocks now return the service's real page shape.
- `--findRelatedTests` over the controller and `admin.openapi.ts`: 9 suites, 143 tests. `admin.controller.ts` is at 100/100/100/100.
- `openapi:generate`, then `openapi:check` reports current. `openapi:lint` reports no new error. Frontend `api:types` was regenerated, and its typecheck has 0 errors.
- **Live:** the `s1p1707` stack backend was rebuilt from this tree. `e2e/modules/p10-access-requests` and `p21-upstream-flows` passed 30/30 against it, and both read `GET /admin/tenants` through the new envelope.

## Files

- `backend/src/controllers/admin.controller.ts`
- `backend/src/routes/api/admin.openapi.ts`
- `backend/openapi.json`
- `frontend/src/api/generated/schema.d.ts`
- `backend/src/tests/controllers/admin.controller.test.js`
- `backend/src/tests/e2e/modules/p10-access-requests.e2e.test.ts`
- `backend/src/tests/e2e/modules/p21-upstream-flows.e2e.test.ts`
- `MEMORY/CHANGELOG.md`
- `MEMORY/MEMORY-INDEX.md`
- this record
