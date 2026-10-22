# P24-09d: the operator's invitations switch on the tenants page

**Date:** 2026-10-23 · **Card:** P24-09d · **ADR:** ADR-139 Am. 1 · **Status:** DONE (frontend only; the route existed).

## What was built

| | |
|---|---|
| `tenants/components/UpstreamInvitationsPanel.tsx` (new) | Shows the tenant's `upstream_invitations_open` flag, read fail-closed: only a JSON `true` is open, as the server reads it. Opening asks first and says it is the cutover act, to do once the pre-invitation checks are recorded; closing says that invitations already sent keep working. The state shown is the one the server answers. The tenant list is refreshed. A failure is shown in the server's words. ID/EN (16 keys each) |
| `TenantCard.tsx`, `TenantsClient.tsx` | An "Imported users' invitations" button on each card, **for the super admin only** (`canManagePlatform`) |
| `tenant.service.ts` (frontend) | `setUpstreamInvitationsOpen(tenantId, open)` calls `PATCH /admin/tenants/:id/flags` with `{ flags: { upstream_invitations_open } }`. That route is the existing operator route: super admin only, scalar flags (A-174), audited `UPDATE_TENANT_FLAGS` (A-165) |

## Tests (named; scoped — the full suites were not run)

- **New:**
  - `tenants/components/__tests__/UpstreamInvitationsPanel.p2409d`, 5 tests:
    - the flag read fail-closed;
    - open after confirming, then the list refreshed;
    - close, a failure in the server's words or without words, cancel and done;
    - the card offers the switch only with the handler;
    - Indonesian.
  - `api/services/tenant.invitations.p2409d`, 1 test.
- **With the existing suites:** the tenants page, 17 suites and 125 tests; the tenant service and i18n, 24 tests. All passed.
- **Coverage:** `UpstreamInvitationsPanel.tsx` 100% of lines and functions, 95.83% of branches.
- **Gates:** typecheck 0 errors; eslint on the changed files clean.
- **Not run:** `next build` and the browser suites.

## Files

- `frontend/src/app/(app)/dashboard/tenants/components/UpstreamInvitationsPanel.tsx` (new), `TenantCard.tsx`, `TenantsClient.tsx`
- `frontend/src/api/services/tenant.service.ts`, `frontend/src/i18n/messages/en.ts`, `id.ts`
- tests (new): `frontend/src/app/(app)/dashboard/tenants/components/__tests__/UpstreamInvitationsPanel.p2409d.test.tsx`, `frontend/src/api/services/tenant.invitations.p2409d.test.ts`
- `TASKS/PHASE-24-UPSTREAM-DATA-ETL.md`, `TASKS/PROGRESS.md`, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, this record
