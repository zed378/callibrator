# Frontend coverage past 70%: behaviour tests, a real-router check, and the defects they found

**Cards:** F-19 (new), ADR-067 Amendment 1 · **Agent:** frontend-coverage coordinator plus five helpers (`hooks`, `core-pages`, `admin-pages`, `ops-pages`, `shell`) · **Dates:** 2026-09-29 → 2026-09-30

## Result

| | Statements | Branches | Functions | Lines | Suites | Tests |
|---|---|---|---|---|---|---|
| Before (2026-09-29, `npx jest --coverage`) | 43.68% | 38.30% | 37.13% | 43.94% | 157 | 1,408 |
| After (2026-09-30, same command, whole tree) | **90.91%** | **81.62%** | **86.94%** | **91.61%** | 264 | 2,758 |
| Gate, `frontend/jest.config.js` | 41 → **90** | 35 → **81** | 34 → **86** | 41 → **91** | | |

The gate is each measured figure rounded down, so the margin is under one point. The 70% target is passed on
all four measures, so docs/FRONTEND/10's steps 1–3 are all passed at once. `testTimeout: 30000` was
added: full-page suites overran Jest's 5 s default in the parallel full run while passing alone.
It changes no assertion (ADR-067 Amendment 1).

**Caveat.** The tree was shared with other agents throughout: Phase 10 public pages, ADR-102
permissions, certificate PDF (M-11) and P9-22 contracts. The "after" figure includes their tests
and their new untested files. The biggest 0% files left are theirs:
- `request-access/components/RequestAccessForm.tsx`
- `forgot-password/components/ForgotPasswordForm.tsx`
- `invitation/components/InvitationForm.tsx`

`dashboard/qms` and `dashboard/workflows` (about 59%) are the lowest of the older screens.

## 1. Service paths against the real router

- **The dump.** `node --import tsx -r dotenv/config backend/src/tests/e2e/liveContract.smoke.test.js --dump-routes <out>`
  walks the real Express stack: 58 mounts, 454 routes.
  - Plain `node` no longer resolves the route modules (`validation.middleware.ts`, ADR-087), so the
    harness's `loadRoutes()` was failing with "Cannot find module".
  - It now spawns the child with `--import tsx` (one edit in `liveContract.smoke.test.js`; eslint clean).
- **The check.** The harness's own `extractFrontendCalls()` was matched against that dump (scratch
  script; not committed).
  - All **387** `api.*` calls in `frontend/src/api/services/*.ts` name a real method and path.
  - The 5 the extractor cannot resolve were checked by hand and are real: `iot.service`
    `base(deviceId)` (GET/PATCH `/iot/devices/:deviceId`, POST/DELETE `…/token`), and `auth.service`
    `getSsoMetadata` (`/auth/sso/metadata[/:tenantCode]`).
  - No service call reaches the API outside `src/api/services/`.
- **What it cannot prove.** It proves paths, not shapes, and every contract defect below was a wrong
  shape. Page tests were therefore written to mock only `@/api/client`, with the controller's real
  body, so the real service unwrap runs.

## 2. Tests added, by area (file counts from the helpers' reports)

| Area | Files | Tests | Highlights |
|---|---|---|---|
| Stores (coordinator) | 3 | 63 | `stores/__tests__/stockStore.contract.test.ts` (0 → 100%, under the shared store contract); `authStore.mfa.test.ts` (MFA step 1/2, recovery code, 401, impersonation refused, through the real `auth.service`); `writeStores.refetch.test.ts` (users/tenants/backups: re-read at the current page, 409 rethrown, failed read keeps rows) |
| Screen hooks (`hooks`) | 20 | 174 | 20 hooks 0–79% → 100% statements (useStock, useMenuGroups, useMenuGroupCrud, useWarehouse, useDevices, useTenants, useBilling, useRoles, useStorageSettings, useTickets, useScheduler, useKanbanProjects, useDashboardMetrics, useWebhooks, useTenantBackups, useAttachments, useAudit, useSsoSettings, `ticketPov`). *(`useRegisterForm` was also tested, but `src/app/register` was removed by Phase 10 in favour of request-access, so it is not counted.)* |
| Core business pages (`core-pages`) | 12 | 171 | devices, calibration (certificate modals mocked), users, tenants (+SSO panel, form fields), maintenance, e-signature (81 → 98%), roles, permissions, user-permissions; each with axe and loading/empty/failed |
| Compliance and admin (`admin-pages`) | 16 + 4 service tests extended | 247 | gdpr, tenant-lifecycle, network-security, oidc, scim, custom-domains, webauthn, tenant-hierarchy, feature-flags, metered-billing, sop, batch-jobs, finance, supplier-scorecard, risk, predictive-maintenance (all 0 → 93.9–100%); helper `tests/support/httpError.ts` |
| Kanban, stock, tickets, … (`ops-pages`) | 13 | ~219 | useBoard 52 → 100%, CardModal, board page and modals, stock, warehouse, tickets (detail/raise/response), notifications (+ bell), vendors; fixtures `tests/support/{kanban,ticket}Fixtures.ts` |
| Shell, auth-adjacent, content (`shell`) | see the tree | | layouts (Navigation, TopBar, DashboardLayout, GlobalSearch), login, sso-callback, oauth consent, content editor, blog, dashboard home, billing, reports, storage, api-keys, profile, ui controls. This helper reported to the coordinator directly; its defect list is not reproduced here |

After ADR-102 landed mid-batch (write actions from the effective permission, not role names), the
role-name permission tests in the hooks, core-pages and ops-pages suites were rewritten:
- write on the slug → offered;
- read → absent from the DOM;
- not loaded → absent;
- super admin → offered.

## 3. Defects

All fixed ones are listed on **F-19** (`TASKS/AUDIT-2026-09-FRONTEND.md`), each with the test that
fails without it. In short:
- **Contract.** Eleven screens or services read fields the backend never sends: gdpr, tenant-lifecycle,
  oidc, custom-domains (×2), feature-flags, tenant-hierarchy, sop, metered-billing, batch-jobs, and
  the user edit dropping names.
- **Data loss.** An SSO save over a failed load wiped the tenant's configuration (`useSsoSettings`).
- **Three states.** About 30 screens rendered the empty state on a failed load.
- **Silent failures.** Kanban had several.
- **Wrong wiring.** Three cases.
- **Accessibility.** axe findings: unnamed controls, heading order, colour-only state.
- **Sidebar icons.** `menuHelpers.tsx` lacked `Package` / `HardDrive`, which the in-flight ADR-102
  seed adds. The A-118 guard failed on it in the full run; the coordinator added both icons.

About 20 more are open on F-19, needing owners or decisions:
- role fields the API ignores;
- destructive actions without confirmation;
- silent 10-row truncation;
- the tenant-hierarchy super-admin call breaking the page for everyone else;
- a shared `calibrationStore` loading flag;
- kanban realtime gaps.

The ticket-description "stored HTML" report was checked and downgraded: `globalSanitizer` runs `xss()`
on every body string before any router.

## Evidence (final run)

- `cd frontend && npx jest --coverage` (whole tree, the gate evaluated): 264 suites, 2,752 of 2,758 tests pass; coverage 90.91 / 81.62 / 86.94 / 91.61, above the 90 / 81 / 86 / 91 gate. **6 failures in 3 suites, none in this batch's files:**
  - `tests/public/copyTruthfulness.p1011` (3) and `tests/public/publicTokens.contrast.p1001` (2) are Phase 10's own guards failing on Phase 10's in-progress copy (a "HIPAA" claim and an unsourced "12,000+") and palette (`--pub-text-subtle`);
  - `api/v1/[...path]/route.stream.f16` › F-14 abort (1) is a load-timing flake: 9/9 alone, re-run 2026-09-30.
  - The previous whole-tree run (same day, before those edits landed) had 1 failure, the A-118 icon guard, fixed here
- `npm run typecheck`: exit 0, no errors
- `npx eslint src`: 0 errors, 53 warnings (exit 0)
- `next build`: **fails, not from this batch.** Turbopack refuses `packages/contracts/src/contentHtml.ts` ("module format CommonJs … EcmaScript import/export"). It is imported by the new `frontend/src/lib/safeHtml.ts`, from `tickets/[ticketId]/page.tsx` and `blog/ArticleBody.tsx`. Both files are untracked, in-flight work of another agent (ticket-HTML sanitising). Reported to the coordinator, not touched

## Not done / not claimed

- Nothing here was run against a live backend or a browser. The contract fixes are proven against
  fixtures read from the controllers, not against a server (F-19 DoD).
- The certificate and PDF files were left to the M-11 agent, as instructed.
- No git state was changed.
