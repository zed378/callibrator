# 2026-09-29 — UI correctness fixes: certificate flow + separation of duties, effective-permission navigation, confirmations, orphans, search, kanban keyboard

**Docs amended (deviation protocol):** `docs/FRONTEND/05-RBAC-IN-UI.md` (write actions from the effective permissions; menu built from the API's rule), referencing ADR-102. **Decisions:** [ADR-101](../DECISIONS.md) (certificate separation of duties), [ADR-102](../DECISIONS.md) (sidebar and write actions from the effective API permission). **Audit rows:** A-312 … A-317 in `TASKS/AUDIT-2026-09-REMEDIATION.md`. **Input:** `docs/UI-UX/research/01-current-ui-audit.md`, `03-personas-and-flows.md`. Bug fixing only — the visual design is unchanged (the Phase 11 redesign is on hold).

## What changed

### 1. Certificates can be completed; the author cannot approve (A-312, ADR-101)
- **Backend.** `certificate.service.js`: `approveCertificate` guard refuses the drafter (`createdBy`) or submitter (`submittedBy`) with **403** and the rule named, under the row lock, before re-authentication — no certificate change, signature record or APPROVE audit row. `refuseSelfApprovalInWorkflow` applies it at every approving workflow step (`workflow.service.js#submitAction`). `submitCertificateForApproval` stamps `submittedBy` and records it in the audit `after`.
- **Model / migration.** `certificate.model.ts` `submittedBy` (P9 lead's lane, done on its instruction). Migration **0095-certificate-submitted-by.ts**: column (uuid, nullable, FK users RESTRICT), index `certificates_submitted_by` (D-20), back-fill from the latest SUBMIT_FOR_APPROVAL audit row, own tenant only; no try/catch.
- **Frontend.** `CertificatesTable.tsx` follows the state machine: Submit on draft (new `calibrationService.submitCertificate` / store `submitCertificate`), Approve on pending_approval, E-Sign on approved, Revoke until revoked; for the author, Approve disabled with the reason (`aria-describedby`). `ApproveCertModal` shows a refusal (409 state explanation or the 403) inside the dialog (`role="alert"`). `useCalibration` gates on `calibration` / `certificate` write.
- **A-282 (for the security agent, ADR-100):** certificate create / update / delete / submit now audit through `auditPrincipal(req)` (an API key → `system:api-key`, never in `user_id`; `createdBy`/`updatedBy`/`submittedBy` null for a key). The four PENDING_OWNER entries were removed from `guards/apiKeyAuditPrincipal.a282.guard.test.ts`.

### 2. One effective permission for API, sidebar and pages (A-313, ADR-102)
- `services/effectivePermission.service.ts` (new, TS); `constants/menuPageAccess.ts` (new, TS: page gates quoted from route files); `types/ids.ts` `toUserId`.
- `dynamicAccess.middleware.js#checkMenuPermission` reads it (behaviour unchanged).
- `menuGroup.service.js#getRoleMenuAssignments(roleId, requester)` shows a leaf only when read on its slug + its page gates pass; overrides apply to the requester's own menu; top-level links deduplicated. `getMyPermissions` + `GET /api/v1/menu-groups/my-permissions` (exemption kind `self`).
- Frontend: `menuStore.effectivePermissions` (loaded with the menu), `hooks/usePermissions.ts`; hard-coded role lists removed from `devices`, `calibration`, `stock`, `warehouse`, `maintenance`, `vendors`, `billing` hooks.
- Seed `ROLE_MENU_ASSIGNMENTS` + migration **0097-menu-effective-access.ts**: Stock and Object Storage entries; grants that keep reachable pages visible, only where the page's API gate already passes (none of the granted slugs is a `dynamicAccess` gate — tested).

### 3. Confirmations and honest error states (A-314)
- `ConfirmDialog` gains `confirmPhrase` (type-to-confirm; the phrase resets on every open).
- Tenant backup: Restore requires typing the backup's name (the tenant's name is not available on that page; the backup name identifies what is restored); Delete asks once; buttons named after the backup. `useTenantBackups` `pendingAction` / `request*` / `confirmPendingAction`.
- E-signature: key-pair and workflow Delete ask first (naming the object); a failed load of key pairs, workflows or "to sign" shows the failure + Try again, never the empty-list message.

### 4. Orphans, Home (A-315)
- Stock (top level) and Object Storage (Management › Content) menu entries; `/dashboard/warehouse` → `/dashboard/warehouses` (`frontend/src/lib/redirects.ts`, read by `next.config.ts`); `home` → `/dashboard`.
- Crossed slugs: **not renamed** (each slug shows the page its API guards; ADR-102 §6). The Calibration Scheduler mismatch (`maintenance`-gated page) is a page gate.
- Home: quick actions by permission (Add User on `users` write; New Tenant and Roles for the super admin; Notifications on `notifications` read); `/users/all` fetched only with `users` read; the "Recent Activity" panel, which listed users ordered by first name with every time "Recently", is now "Users" with join dates. (Taken over from the XSS agent by agreement; `useDashboardMetrics`' `isSuperAdmin` left as is — it only picks the global/tenant display, which the backend decides.)

### 5. Global search (A-316) and kanban keyboard move (A-317)
- No detail pages exist: a result opens its list filtered to that record (`stores/searchHandoffStore.ts`, read once at mount, cleared in an effect).
- Kanban: "Move to…" select per card for editors (`useBoard.moveCardToColumn`, `moveCard` now resolves `true`/`false`), polite live-region announcement; the card title is a button.

### 6. Q-37 (coordinator request)
- The vendor create form offers no rating (edit keeps it); `vendors/__tests__/page.test.tsx` asserts it; `backend/swagger.json` POST /vendors no longer lists `rating`. (`openapi.json`, which P9-25 made the served contract, already documented it.)

## Evidence (tests named; fail-before where the change is a fix)

| Test | Result |
|---|---|
| `backend/src/tests/services/certificate.separationOfDuties.adr101.test.ts` | 9/9; with the guard line removed **3 fail** (author/submitter approve → 200) |
| `backend/src/tests/services/menuEffectiveAccess.adr102.test.ts` (real seed, real `getRolePermissionsMatrix`, real `principalHasMenuPermission`, per seeded role) | 22/22; against the pre-change `menuGroup.service.js` **18 fail** |
| `backend/src/tests/services/effectivePermission.adr102.test.ts` (rbac parity vs `rbac()` for every seeded role; page gates vs route source; 0097 slugs are no gate) | 15/15 |
| `backend/src/tests/routes/certificates.lifecycle.twoTenant.test.ts` (approve owner control as a second same-tenant admin; new self-approval 403 case) | pass |
| `backend/src/tests/migrations/uiCorrectness.adr101adr102.live.test.ts` on **PostgreSQL 18 (pgvector/pgvector:pg18)**, fresh DB, boot path + real role and menu seeds, as the owner | 3/3: 0095 column/FK/index; back-fill takes the latest submitter, leaves drafts, idempotent; 0097 on a pre-ADR-102 database restores exactly the new seed's grants, idempotent. psql: `schema_migrations` holds 0095 and 0097; `certificates_submitted_by` exists; stock 11 / storage 3 grants |
| updated: `menuGroup.service.test.js`, `menuGroup.controller.test.js` (+ getMyPermissions), `menuGroups.route.test.js` (15 routes), `readGates.p604` (G-06), `rolesGlobal.d16`, `workflow.service.test.js`, `associationForeignKeys.a148` (`certificates.submitted_by → users RESTRICT`), `0067` D-20 list, `unboundedFindAll.d24` (getMyPermissions: CLOSED), `certificate.controller.test.js` (auditPrincipal) | pass |
| frontend `calibration/components/__tests__/CertificatesTable.adr101.test.tsx` | new; fails on the old table (Approve on draft, nothing on pending) |
| frontend `calibration/hooks/__tests__/useCalibration.test.ts` (ADR-102 gates; submit + 409 text; dialog clears old error), `calibration/__tests__/page.test.tsx` | pass |
| frontend `tenants/[tenantId]/backup/__tests__/page.confirm.test.tsx`, updated `page.a156.test.tsx` | new; fails on the one-click Restore/Delete |
| frontend `esignature/__tests__/page.confirm.test.tsx`, updated `page.test.tsx`, `page.cov.test.tsx` | new 6/6 |
| frontend `dashboard/__tests__/page.test.tsx` (two ADR-102 cases), `lib/redirects.test.ts`, `components/layouts/__tests__/GlobalSearch.s6.test.tsx`, `kanban/[projectId]/__tests__/page.keyboardMove.test.tsx` (incl. axe) | pass |
| frontend full `npx jest` | **280 suites / 2,911 tests passed** |
| frontend `npm run typecheck`; `npx eslint` on every changed file | clean (warnings only, pre-existing) |
| backend `npm run typecheck` | no error in any file of this change; errors remain in other agents' in-flight files (`certificateDocument.service.ts`, `notificationChannels.service.ts`, some a282/a296 tests) |
| backend `npx eslint` on every changed file; `npm run ratchet` | 0 errors; ratchet at the floor |

**Full backend gate** (`npm run test:coverage -- --ci`, Node 26, 2026-09-30, shared tree with other agents mid-change): 771 suites run, 756 passed / **15 failed** (59 tests), 14,145 tests passed; **every file of this change at 100 %** statements/branches/functions/lines (effectivePermission.service, menuGroup.service/controller/route, certificate.service/controller, dynamicAccess, workflow.service). All 15 failing suites belong to other agents' in-flight work (below); the global figure is 98.51 % because of them. An earlier run on this change's tree surfaced 7 suites of mine (menuGroup service/controller/route, G-06, d16, a148, D-24, workflow mock) — all updated and passing.

## Failures that are not this change (as seen on the shared tree)
Closing run: `twoTenantRoutes.guard` and `unboundedFindAll.d24` (new webauthn routes / findAlls), `associationForeignKeys.a148`, `tenantForeignKeys.a88`, `includeRequired.d12`, `unscopedModels.d17`, `jsonShape.d27`, `schemaVerify.p605` (new `api_key_id` columns), `calibrationRecords.service`, `stock.service`, `passkeyLogin.p1010`, `webauthn.service`, `webauthn.disable.a213`, `swaggerValidatorAlignment.p608`, `manifestNames.p923`. Earlier runs also showed: `routePermissionGuard.p604` (auth.service#impersonateUser, P9-12 conversion), `denyPlatformAuthoring.a127` / `accessRequest.p1005` / `appRoutes.a253` / `admin.route` (access requests, P10), `swaggerValidatorAlignment.p608` (openapi.json regeneration, P9-25), `certificateDocument.snapshot.q50` (ADR-107), `auditInTransaction.p611` (contentMedia.service.ts), `unboundedFindAll.d24` (signInPolicy / webhookDeliveryPurge entries), migration suites 0086/0087/0089, `password.test`, `user.passwordReset.a162`, `scim.userAudit.a278`, contracts validation, gdpr, webhook delivery, clamAv, queryShape, content.media, attachments.twoTenant, activityLog stdout.

## Open
- Pages outside this change still show write actions to read-only roles (01 §5.4, ~24 pages); adopt `usePermissions` as they are touched.
- Search should open detail pages once they exist (Phase 11).
- A single-admin tenant cannot issue certificates alone any more (ADR-101 consequence); an owner decision if a lab asks.
- Flush Redis `permissions:*` after migration 0097 on a deployed database.

## Round 2 (2026-09-30) — the remaining pages adopt `usePermissions` (ADR-102)

Each page below takes write access from the slug its write API is gated on (or the super admin, where the API is `superAdminOnly`). An unauthorised control is **absent from the DOM**, and nothing is writable before the permissions load. Tests grant permissions through the menu store with the new `frontend/src/tests/support/permissions.ts` (`grantPermissions`, `grantSuperAdmin`, `clearPermissions`), not by role name. Each page's test file gains an "ADR-102" block with a reader case, a not-loaded case and a super-admin case.

| Page | Gate (route file) | Controls now gated |
|---|---|---|
| qms | `qms` write | Raise NC / New CAPA, row status select, Root cause, + CAPA |
| risk | `risk` write | Add Risk, Edit, Delete |
| workflows | `workflows` write; decisions on `certificate`/`warehouse`/`maintenance` write | New Workflow, Enable/Disable, Delete; Approve/Reject |
| finance | `finance` write | Record Asset, Delete |
| supplier-scorecard | `supplier-scorecard` write | New Evaluation, Edit, Delete |
| batch-jobs | `batch-jobs` write | Queue Test Job (Result download stays: a read) |
| predictive-maintenance | `calibration` write | Run Analysis card, Approve |
| metered-billing | `metered-billing` write | New Alert, alert Delete |
| content | `content` write | Categories, New post, Edit, Delete |
| attachments | delete on `equipment` write (upload/download are `equipment` read) | Delete |
| esignature | `qms` write (manage), `esignature` write (sign) | Generate Key Pair, key Delete, New Workflow, Cancel, workflow Delete; Sign |
| ai-assistant | OCR on `certificate` write | Upload certificate → the permission notice up front |
| feature-flags | `superAdminOnly` | Enable/Disable, Reset, Initialize Defaults |
| tenant-lifecycle | `superAdminOnly` | Suspend, Resume, Grace, Offboard, Cancel, Export |
| data-retention | `superAdminOnly` | window inputs + Save, Enable/Release Hold, Privacy Operations card |
| oidc | `superAdminOnly` | Register Client, Rotate, Delete |
| tenant-hierarchy | `platformOnly` | already gated; the flag now comes from `usePermissions().superAdmin`, not a role-name set |

**Menu gap found and fixed:** `/dashboard/scim` is served only to the super admin or a SCIM-scoped API key (`scim.route.js requireApiKeyOrAdmin`, reads included), so HEALTHCARE ADMIN's `scim` read showed a page that 403'd. `scim: [SUPER_ADMIN_ONLY]` was added to `constants/menuPageAccess.ts` (its source line is checked by `effectivePermission.adr102.test.ts`), and `menuEffectiveAccess.adr102` expects no SCIM entry for HA (37/37).

**Skipped: another lane had uncommitted, recent changes in these files:**
- `tenants/*` (page, hooks, modals: P10 / multipart-sanitizer lane, 16:55)
- `users/*` (17:42)
- `network-security/page.tsx` (security-followups agent, 18:00)
- `custom-domains/page.tsx` and `sop/page.tsx` (F-19 agent, per the coordinator)
- `menu-groups` and `calibration-scheduler` hooks (the XSS agent took them by agreement)

These still show write actions to read-only roles.

**Pages with no gating needed, and why:**
- **The page's read and write share one gate** (whoever can load it can write): `roles` and `menu-groups` (rbac SUPERADMIN), `api-keys`, `webhooks` and `storage` (rbac TENANT_ADMIN), `scim` (super admin or SCIM key).
- **No write API:** `reports`, `audit`.
- **Acts only on the caller's own records:** `profile`, `change-password`, `mfa`, `webauthn`, `session-management` (own sessions), `gdpr` (own rights), `notifications` (own inbox; "Send test" is caller-scoped and open to every role).
- **Own access model:**
  - `kanban`: board membership, `canEdit`.
  - `tickets`: service-level responder roles.
- **Reached only from gated controls:** `content/new` and `content/[id]/edit`.

**Evidence:**
- Every page's suite passes with its new ADR-102 cases.
- Fail-before shown on finance: with the gate forced open, 2 of 16 fail (the reader and not-loaded cases).
- Frontend `npm run typecheck`: clean. `npx eslint` on every changed dir: 0 errors.
- Full `npx jest --coverage`: 283/284 suites, 2,977/2,978 tests; coverage 93.43 / 84.21 / 89.31 / 94.13 against the 90/81/86/91 gate (passes).
  - The one failure is `app/blog/__tests__/publicContent.test.tsx`, in another lane's uncommitted public-blog work.

## Round 3 (2026-09-30): the pages skipped in Round 2

Before each edit I checked mtime and `git diff` to confirm the other lanes had finished. The last edits were several hours old.

| Page | Gate (route file) | Change |
|---|---|---|
| tenants | edit, SAML SSO and MFA policy on `management` write (`tenant.route.js` `dynamicAccess("management", "update")`); backups on rbac TENANT_ADMIN, which on the seeded roles is exactly the `management` writers; create and delete for the super admin | `useTenants` returns `canEditTenant`/`canManagePlatform` from `usePermissions`. `TenantCard` makes `onEdit`/`onSsoConfig` optional and adds `canManageBackups`. Which LIST to read (platform vs own tenant) is still decided from the principal, because it must be known before the permissions load; it is not a write control |
| users | create, edit, delete and credential resets on `users` write (`user.route.js`); impersonation for the super admin (was a role-name list in `UserRow`) | Add User, Edit, Delete, reset actions |
| custom-domains | `custom-domains` write (`customDomains.route.js domainWrite`) | Add Domain, Verify, Make default, Remove. DNS stays (a read) |
| sop | `sop` write (`sop.route.js`) | New Document, Publish. "I have read this" and Open stay for every reader |
| menu-groups, calibration-scheduler | no change: the XSS agent had already converted both to `usePermissions` (A-301) | — |

**Still skipped:** `network-security/page.tsx`. The security agent is still editing it (adding `currentLocation`), so it still shows write actions to read-only roles.

**Tests:**
- Each converted page's suite now grants permissions through `tests/support/permissions`.
- Each gains ADR-102 cases for a reader and for not-loaded permissions (plus super admin via the shared block).
- `components/ui/a11y.adr090.test.tsx` now passes `canManageBackups` to `TenantCard`.
- `npm run typecheck` is clean; eslint shows 0 errors.
- Full `npx jest --coverage` after the a11y fix: 284/284 suites. Coverage is 93.44 / 84.29 / 89.32 / 94.15 against the 90/81/86/91 gate.
- The blog `publicContent` suite, which failed in Round 2, passed in this run. It belongs to the Phase 10 lead's public work either way.
