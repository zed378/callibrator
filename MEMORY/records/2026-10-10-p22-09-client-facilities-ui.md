# P22-09: the client-facility administration page, account binding, and the `client-facilities` menu entry turned on

**Date:** 2026-10-10 · **Task:** P22-09 (Phase 22; F-13 … F-17) · **Specs:** [`P19-04`](../specs/P19-04-client-facilities.md) § 4.4 – § 4.6, § 6, § 10, § 13 (built by P21-09b/c/e); P18-03 § 13 (G-P8); ADR-124 Am. 5 § 2 (menu activation) · **Base:** `b5b97e2` and later

> Synthetic data only. `mozivid/` was not touched. `FACILITY_BINDING_ENABLED` is untouched and stays OFF: the page shows the binding route's 409 exactly as the server writes it. The backend change is approved by the coordinator and limited to the menu activation.

## Built

| Area | What |
|---|---|
| Page | `/dashboard/client-facilities`: a server `page.tsx` (`facilities.` namespace, language toggle) and the `FacilitiesClient` island (Indonesian / English). |
| Access | Reading needs `client-facilities` read; create, edit, status and delete need write; binding accounts also needs `users` write. **A facility-bound account is told that it does not administer facilities, and nothing is read.** Every route here answers such an account with 403 `FACILITY_ROUTE_REFUSED`. Delete and `ended → active` are reserved to the tenant administrator role by the server; a refusal is shown in the server's words. |
| List | `GET /client-facilities` through the generated client: search (`q`), status, kind and paging. Rows come from `data`, paging from the top-level `meta`. Columns: name and code, with "your own organisation" marked on the self facility, which is never offered for edit; kind; a status badge (new `statusTone` domain `clientFacility`) with its reason; city; contact. Every action is named after its facility. Loading, empty and failed are three distinct states. |
| Create / edit | One form. Before any request it is checked with the **contracts the routes use** (`clientFacilityCreate` / `clientFacilityUpdate`): reserved `SELF`, a malformed code or e-mail, a blank name. An edit sends **only the fields that changed** (a cleared field is sent as null; the code is compared case-insensitively), and an unchanged form says "Nothing has changed". A 409 for a duplicate code keeps the form as typed. |
| Status | Any other status can be chosen. A reason is required (3 – 500 characters, checked first). Moving a facility out of `active` warns that it signs out every account of the facility; the toast reports how many sessions were signed out. `ended` is explained ("takes no new records; only a tenant administrator can reactivate it"). |
| Delete | A confirmation step. A refusal (for example, the facility still holds devices) stays inside the dialog. |
| Accounts | `GET /client-facilities/:id/users` lists the accounts bound to a facility. **Bind**: search the tenant's users (`GET /users/all?find=`), pick one, give a reason; this calls `PUT /users/:id/client-facility { clientFacilityId, reason }`. **Unbind**: choose the role the account keeps across every facility (`GET /roles`) and give a reason; this calls `PUT … { clientFacilityId: null, roleId, reason }`. Each result reports the sessions revoked. Binding is not offered on the self facility. |
| Facility filter (F-17) | Already on the provider pages as a convenience filter that is never a boundary: the device register (P22-02), the IPM history (P22-04) and the exports (P22-06). Bound users never see it. |
| Restricted navigation | The sidebar is capped by the server (`BOUND_MENU_CEILING`, P21-09c). `usePermissions().facilityBound` hides route-refused actions on each page (P22-01 … P22-06, and this page). |
| Menu | `seedMenuGroups.util.ts` sets `client-facilities` to `is_active: true`. **Migration 0132** `0132-client-facilities-menu-active` has the same shape as 0130 / 0131: one idempotent `UPDATE … WHERE slug = $2 AND is_active IS DISTINCT FROM $1`, and `down` sets it back to false. **The manifest change in `config/migrator.ts` is the single `0132` line** (the other agent's `0133` follows it). The holders of the grant now see the entry in the sidebar: HEALTHCARE ADMIN, CALIBRATOR ADMIN, ENGINEERING MANAGER (read) and the super admin. Bound sidebars do not change, because the bound ceiling does not include the slug. |

## Evidence — tests named

**Frontend, new tests:**
- `app/(app)/dashboard/client-facilities/__tests__/FacilitiesClient.test.tsx` (9): access, including a bound account reading nothing; reader list, filters, paging and the read-only accounts view (axe); empty versus failed; Indonesian; create (contract problems, then 409 with the form kept, then saved); edit sends changes only and the self facility is never offered; status (reason, sign-out warning and count, 403); delete (refusal kept); bind and unbind (409 while the binding switch is off, then done; role required); no match and load failures.
- `__tests__/facilities.test.ts` (4).
- `__tests__/page.test.tsx` (1).
- `api/services/clientFacility.service.test.ts` (2).
- `lib/statusTone.test.ts` (+2 rows).

**Backend, new tests:**
- `tests/migrations/0132-client-facilities-menu-active.test.ts` (4).

**Backend, re-based tests:**
- `0130-…` / `0131-…` tests: the seed now has all three entries active.
- `menuEffectiveAccess.adr102`: HA, CA and EM see `/dashboard/client-facilities`, and so does the super admin.
- `effectivePermission.ud4b`.

## Gates (2026-10-10; per-card rule)

| Gate | Result |
|---|---|
| `node scripts/ci/eslint-ratchet.js` | 0 error(s), 0 warning(s); baseline 0 |
| `npx eslint` on every changed file (backend and frontend) | clean |
| backend `npm run typecheck` / frontend `npm run typecheck` | 0 / 0 |
| backend `npm test -- --ci --findRelatedTests <0132, seed> --coverage` | 18 suites, 545 tests passed. **0132 and `seedMenuGroups.util.ts` at 100 / 100 / 100 / 100.** The `menuEffectiveAccess*`, `effectivePermission.ud4b` and `013x` migration suites ran separately: 56 / 56 |
| backend `npm run load:check` | OK |
| `npm run test:live -- --only=p2004,p2002,uifix,p2006` | **4 of 4 passed**: the migration-sequence suites, with every migration including 0132, then the seed. Throwaway container `p2209-pg18` at 127.0.0.1:55220, removed by name |
| frontend `npx jest --ci --findRelatedTests <changed>` | 166 suites, 1,819 tests passed |
| `next build` | OK (`ƒ /dashboard/client-facilities`) |
| `node scripts/bundle-budget.mjs` | 10/10 within budget, exit 0 (`/` at 150.0 / 152 gzip after the coordinator's P23-02 decision) |

## Not done / open

- **`FACILITY_BINDING_ENABLED` stays OFF**, so a binding is refused with 409 until the owner switches it on (the pre-invitation gate).
- The users page (`/dashboard/users`) does not show a user's binding. The binding lives on the facility's accounts dialog.
- A running deployment shows the entry only after the menu cache's TTL expires or after a flush of `<prefix>menu*` / `<prefix>permissions:*`.
- No live browser run.
