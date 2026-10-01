# 2026-09-30 — Stored-XSS hardening, API-key scope options, menu-group selection, role-name checks, dropdown clear

**Findings:** A-298 (high, wave 0), A-299, A-300, A-301, A-302 — `TASKS/AUDIT-2026-09-REMEDIATION.md`.
**Related:** ADR-097 (`@callibrator/contracts`: two data-only modules added), ADR-102 (effective permissions in the UI), ADR-071 (nonce CSP).
**Coordination:** the UI-correctness agent owns Home (`useDashboardMetrics`, the "Recent Activity" panel). Items 4 (dashboard metrics) and 5 (fabricated Recent Activity) of this task were handed to it, as agreed, and are **not** in this change. The P9-22 helper owns the contracts package wiring. It dropped `"type": "commonjs"` from `packages/contracts/package.json` so Turbopack can bundle a runtime import (see "Build" below).

## A-298 — Stored XSS in CMS bodies and ticket descriptions

**Defects**

1. `backend/src/services/content.service.ts` `SANITIZE_OPTS` allowed the `data:` scheme on `<a href>` and `<img src>`.
   - `<a href="data:text/html;base64,…">` survived sanitisation. Proved against the old options: sanitize-html returned the href intact.
2. `frontend/src/components/blog/ArticleBody.tsx` injected `contentHtml` and relied only on the write-time pass. A body stored under an older policy stayed live on the public blog and news pages.
3. `frontend/src/app/dashboard/tickets/[ticketId]/page.tsx` injected `ticket.description` with **no** sanitisation.
   - Any tenant user writes that field.
   - Responders read it, and responders include the cross-tenant super admin.

**Decisions**

- **One policy, in `@callibrator/contracts/contentHtml`.** The module is plain data (`contentHtmlPolicy()` returns a fresh copy on every call).
  - It lists the tags explicitly: sanitize-html 2.17's defaults plus `img`.
  - Links may use http, https and mailto. Images may use http and https. `data:` is allowed nowhere.
  - `data:` images are not needed: the editor uploads a pasted image and inserts its URL (`RichTextEditor`). Relative `/uploads/public/…` URLs have no scheme and are kept.
  - The backend and the frontend both build their sanitize-html options from this policy.
- **Stored content is re-sanitized at read time, not by a migration.** `content.service#transformPost` runs every served `contentHtml` through the policy.
  - This covers every read path: the public page, the editor's `getPostById`, and create/update answers.
  - The pass is idempotent, and no stored row is rewritten.
  - A migration would fix the rows once. Reading clean also covers any future policy change without a new migration, and it cannot be recorded as applied while doing nothing (the Traps table).
  - Cost: one sanitize pass per post read. Only single-post reads carry a body; the lists do not select `contentHtml`.
- **Defence in depth at render.** The new `frontend/src/lib/safeHtml.ts` applies the same contract with sanitize-html.
  - sanitize-html is DOM-free (htmlparser2), so it runs in the server component (blog, news) and in the client page (ticket).
  - It emits no `<script>` or `<style>`, so the nonce CSP is untouched.
  - `sanitize-html` is now a frontend dependency: the lockfile adds only the workspace entries.
  - The current htmlparser2 line is ESM-only, so `frontend/jest.config.js` transforms six packages (`transformIgnorePatterns`). This affects tests only; Next bundles them natively.

**Every `dangerouslySetInnerHTML` and `innerHTML` in `frontend/src`** (grep for `dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|outerHTML|document.write|srcDoc|createContextualFragment|__html`):

| Site | Verdict |
|---|---|
| `components/blog/ArticleBody.tsx` | **fixed**: `safeHtml(html)` |
| `app/dashboard/tickets/[ticketId]/page.tsx` | **fixed**: `safeHtml(ticket.description)` |
| `components/ThemeInitScript.tsx` | **justified**: `layout.tsx#themeInitScript` is a compile-time constant with no input, emitted with the request nonce (ADR-071) |
| `lib/securityHeaders.ts:9` | a comment, not a sink |

**Tests (fail-before named)**

- `packages/contracts/test/contentHtml.a298.test.ts`
  - Runs the attack (a `data:` link, data/js images, handlers, script, iframe) through the shared policy with the real sanitize-html.
  - Checks that each call returns a fresh copy.
  - Also covers the scope contract.
  - Package gate: 5 suites, 70 tests, 100%.
- `backend/src/tests/services/content.sanitize.a298.test.ts` (5 tests, real service and real sanitize-html).
  - **Fail-before:** `createPost` stored the `data:` href. `getPublishedPostBySlug` and `getPostById` served a stored `data:` link, an `onerror` handler and a `<script>` verbatim.
- `frontend/src/lib/__tests__/safeHtml.a298.test.ts` (2 tests).
- `frontend/src/app/blog/__tests__/publicContent.test.tsx`, "a body stored before the A-298 policy fix is sanitized at render".
  - **Fail-before:** the `data:` href rendered.
  - The file's header, which described client-side sanitisation as absent, is rewritten.
- `frontend/src/app/dashboard/tickets/[ticketId]/__tests__/page.test.tsx`, "renders the rich description sanitized (A-298)".
  - **Fail-before:** the `onerror` handler, the `<script>` and the `data:` link reached the DOM.

**Open (not done here):** `backend/src/services/ticket.service.js` still **stores** the description unsanitized. Render-time sanitisation closes the sink this page had. A write-time pass there would make the API safe for any future consumer. It is a `.js` service under Phase 9, so it is left for its owner and noted on A-298.

## A-299 — API-key dialog offered scopes the backend refuses

**Defect.** `CreateApiKeyModal.tsx` offered PascalCase resources ("CalibrationDevices", "Stocks", …) and `*` for both resource and action. `apiKey.service#assertScopes` accepts only lowercase `MENU_SLUGS` values with `read` or `write`, and refuses any wildcard (A-27). Only "Vendors" happened to lower-case to a slug, so nearly every key the dialog built was refused with 400.

**Fix**

- `@callibrator/contracts/apiKeyScopes` defines `API_KEY_SCOPE_RESOURCES` (the 44 `MENU_SLUGS` values), `API_KEY_SCOPE_ACTIONS` and `apiKeyScope()`.
- The dialog builds its options from them: `app/dashboard/api-keys/scopeOptions.ts`.
  - Labels are for people and sorted, e.g. "Supplier Scorecard" and "API Keys".
  - "Write" reads "Write (includes read)".
  - Both selects have an accessible name.
- A backend guard keeps the two in step.

**Tests**

- `backend/src/tests/services/apiKey.scopeContract.a299.test.ts`
  - Asserts the contract's resources equal `Object.values(MENU_SLUGS)`.
  - Sends **every** scope the dialog can build (88) through the real `createApiKey` and expects all accepted.
  - Asserts the old options are refused with 400.
  - It caught real drift on its first run: P10-07 had added the `access-requests` slug after the contract was written.
- `frontend/src/app/dashboard/api-keys/__tests__/scopeOptions.a299.test.tsx` checks that the options are the contract's, and that the rendered dialog has no wildcard and adds `qms:write`.
- The `__tests__/page.test.tsx` create flow now expects `vendors:read` and `vendors:write` (it asserted the PascalCase payload before).

**Noted, not changed.** Several `dynamicAccess` resource names are not in `MENU_SLUGS`, so no API key can be scoped to them (for example `maintenance` on the calibration scheduler, and `calibration`). That is `assertScopes`' allow-list, which the dialog now reports truthfully. Widening it is a backend decision.

**Superseded the same day by A-311** (P9 lead, [record](./2026-09-30-a311-api-key-scopes.md)):
- The contract is now the single source of scopes. `assertScopes` builds its allow-list from `API_KEY_SCOPE_RESOURCES`, not from `MENU_SLUGS`.
- The list grew to 49: `calibration`, `certificate`, `maintenance`, `notifications` and `reports` were added. This closes the limitation noted just above.
- `apiKey.scopeContract.a299` now checks a superset of `MENU_SLUGS`, not equality, and `Maintenance:read` is accepted. The "44" and "equals MENU_SLUGS" statements above describe this change as it was made, not the current code.
- `tests/guards/apiKeyScopeCoverage.a311.guard.test.ts` holds the list to every `dynamicAccess` resource.

## A-300 — Menu-groups bulk selection

**Defect**

- "Select All" was `() => {}`.
- There was no selection state at all.
- "Assign Selected" and "Revoke Selected" sent every group **assigned** to the role. "Revoke Selected" therefore revoked every assigned group, without asking.

**Fix**

- `useMenuGroups` holds a selection separate from assignment: `selectedGroupIds`, `toggleSelected`, `toggleSelectAll`, `allSelected`.
  - It is cleared when the role changes and after a successful bulk action.
  - It is kept after a failure, so the user can retry.
  - Only groups in the current list count.
- Each group row has a "Select menu group X" checkbox, next to (not instead of) the assignment checkbox.
- The bulk buttons show the count and are disabled while nothing is selected.
- A bulk revoke goes through a danger `ConfirmDialog` that names the count and the role.

**Tests**

- `menu-groups/__tests__/page.test.tsx` has five new or rewritten tests.
  - "Select All selects every group (not the assigned ones)…" is the **fail-before**: Select All selected nothing, and Revoke Selected was enabled with nothing selected.
  - Bulk assign and bulk revoke send only the selection, and the revoke asks first.
  - Changing the role clears the selection, and an empty role shows disabled buttons.
- `menu-groups/hooks/__tests__/useMenuGroups.test.ts`: the selection model, plus bulk assign and revoke on the selection. The old tests had encoded "sends the assigned groups" and were rewritten.

## A-301 — Role-name checks (ADR-102)

- `menu-groups/hooks/useMenuGroupCrud.ts`: `isSuperAdmin` was `user.role.name === "SUPERADMIN"`. It is now `usePermissions().superAdmin`. The API gates create, edit and delete with `rbac(["SUPERADMIN"])`.
- `calibration-scheduler/hooks/useScheduler.ts`:
  - "All tenants" uses `usePermissions().superAdmin` (the controller honours it for the super admin only).
  - The new `canRun = canWrite("maintenance")` matches the route (`dynamicAccess("maintenance", "create")`).
  - The page leaves the Run button out of the DOM without that grant.
- Tests:
  - `useMenuGroupCrud.test.ts`, "decides by the effective super-admin flag, not the role name (A-301)". **Fail-before:** a role *named* SUPERADMIN without the flag got the controls.
  - `useScheduler.test.ts`, "decides by the effective permissions…".
  - `calibration-scheduler/__tests__/page.test.tsx`, "read-only on maintenance: … the Run button is absent". **Fail-before:** the button rendered for everyone.
- Page and hook test helpers now set `useMenuStore.effectivePermissions`.
- `useDashboardMetrics` is **not** changed here: the UI-correctness agent owns it.

## A-302 — SearchableDropdown clear re-opened the list

`handleClear` dispatched a click on the trigger, which toggled the list open. It now sets the value to empty, closes the list, clears the search, and returns focus to the trigger, because the clear button it was on disappears.

Test: `components/ui/__tests__/SelectionControls.test.tsx`, "clearing leaves the list closed and focus on the trigger (A-302)". **Fail-before:** the listbox opened. A second test covers Delete while the list is open.

## Build

`next build` went red when `lib/safeHtml.ts` added the frontend's **first runtime (non-type) import** of `@callibrator/contracts`. Turbopack refused ES-module source in a package declaring `"type": "commonjs"`.

1. To unblock Phase 10 at once, both frontend modules briefly mirrored the contract, guarded by jest. The build went green.
2. The P9-22 helper then dropped `"type"` from `packages/contracts/package.json`. The compiled copy in `backend/dist` keeps its own. The helper proved it with the package tests, tsx, build:dist and next build.
3. The mirrors were then replaced by direct imports, and `next build` was run again: **green**, 82 pages generated, TypeScript OK.

## Verification (2026-09-30, a loaded shared tree)

- **Backend affected suites:** `content.sanitize.a298` (5), `content.envelope.a297` (8), `apiKey.scopeContract.a299` (7), `contentMedia` (3). All pass.
- **Backend `npm run test:coverage -- --ci`:** 736 suites passed and 27 failed; 13,972 tests passed and 35 failed.
  - `content.service.ts` and `apiKey.service.ts` are at **100%** on all four measures.
  - The global figure (99.89% statements) is below 100% because of **other lanes' in-flight work**.
  - The 27 failing suites are other agents' work, and none touches content, apiKey or contracts. They include:
    - `denyPlatformAuthoring.a127`: a new `auth.route.js POST /login` candidate;
    - timeouts under load: `scim.userAudit.a278`, `health.forceHttps.s09`, `password.test`;
    - `contracts/validation/*`, `routePermissionGuard.p604`, `swaggerValidatorAlignment.p608`;
    - migrations 0086, 0087, 0089;
    - `calibrationDevices.*`, `workflow.service` and others.
- **Backend eslint:** clean on `content.service.ts`, `content.sanitize.a298.test.ts` and `apiKey.scopeContract.a299.test.ts`.
  - Removing a stray double blank line in `content.service.ts` was part of making it lint clean.
- **Backend `npm run typecheck`:** one error, and it is in another lane's in-flight file: `src/tests/middlewares/requestBudget.a291.test.ts(55,1)` TS1128. There are none in the files this change touches.
- **Backend `npm run ratchet`:** passes. It lowered the floor from 926 to 923 because of other lanes' conversions, and rewrote `backend/.ts-ratchet.json`. That file is theirs to commit.
- **Contracts:** `npm test` passes: 5 suites, 70 tests, 100%. `npm run lint` is clean.
- **Frontend:**
  - `npm run typecheck` is clean. It needed one fix: `SummaryStats` `roles` accepts `nameToShow: string | null`, after another lane made `Role.nameToShow` nullable.
  - eslint on every changed file: 0 errors (2 pre-existing warnings in `RoleSelectionCard.tsx`).
  - Affected suites all pass: api-keys (20), menu-groups (45), calibration-scheduler (17), blog/news + ticket detail + safeHtml (55), SelectionControls (18).
  - Full `npx jest` run: 274 of 276 suites and 2,873 of 2,875 tests pass.
    - The 2 failing suites are `api/v1/[...path]/route.stream.f16` (a proxy timing flake) and `dashboard/tenant-hierarchy` (14 of 14 pass when run alone).
    - A run started a few minutes earlier, while other lanes were mid-edit, showed about 40 service suites red. They were all green on rerun.
  - `next build`: green (above).
