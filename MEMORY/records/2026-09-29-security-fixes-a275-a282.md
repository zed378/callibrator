# 2026-09-29 — Security fixes A-275 to A-282 (ADR-094)

**Cards:** A-275, A-276, A-277, A-278, A-279, A-280, A-281, A-282 (and A-288, Q-38 opened) · **ADR:** ADR-094 · **Agent:** security-fixes, alongside the P9-12 lead, the fixes agent, the P9-11 helper and the conventions-docs agent · **Nothing committed** (the lead commits).

The findings came from recent agent reports and were not on the board. Each was added as a card first (`TASKS/AUDIT-2026-09-REMEDIATION.md`), then fixed. The decisions are argued in ADR-094.

## What changed

| Card | Change | Files |
|---|---|---|
| A-275 | An OIDC consent request is readable and decidable only by a signed-in user of the client's own tenant (home tenant, not the x-tenant-id override). Missing, expired and foreign are one 404, and a foreign attempt consumes nothing. A decision writes an `APPROVE`/`UPDATE` row in the client's tenant; the code is minted inside that row's transaction, and a code Redis will not store is a 503 | `services/oidcProvider.service.js`, `controllers/oidcProvider.controller.js` |
| A-276 | Dunning suspends only an active tenant, marked `suspension_reason = "billing:dunning"` with no `suspended_by`. A payment lifts only that suspension; an operator's suspension and an offboarding are kept, and the payment is recorded against them. The operator's suspension replaces a dunning one. Every decision writes two rows (PLATFORM and the tenant) as `system:billing-webhook`, naming the Stripe event | `services/stripeWebhook.service.js`, `constants/tenantSuspension.ts` (new), `services/tenantLifecycle.service.js`, `constants/systemActors.ts` |
| A-277 | A ticket's `assignedTo`, a kanban member's `userId`, a card's `assigneeIds` and a risk's `assignedTo` must be users of the record's tenant. Missing, deleted and foreign users are one 404, and nothing is written | `services/ticket.service.js`, `services/kanban.service.js`, `services/risk.service.js` |
| A-278 | Audit rows inside the write's transaction: SCIM user create/replace/patch/delete; API-key create/revoke; e-signature key create/delete; vendor, risk, scorecard and asset-finance create/update/delete (and vendor qualify); tenant suspend/resume/grace-period/cancel-offboarding (two rows each). The webhook PATCH was already audited (stale finding) | `services/scim.service.js`, `controllers/scim.controller.js`, `services/apiKey.service.js`, `controllers/apiKey.controller.js`, `services/eSignature.service.js`, `controllers/eSignature.controller.js`, `services/{vendor,risk,supplierScorecard,finance}.service.js` and their controllers, `services/tenantLifecycle.service.js`, `controllers/tenantLifecycle.controller.js` |
| A-279 | `cancelOffboarding` of a tenant that is not offboarded is 409 naming the state; suspend/resume of an offboarded tenant is 409. Cancel also returns `lifecycle_status` to `ACTIVE` | `services/tenantLifecycle.service.js` |
| A-280 | New `superAdminOnly` routes that name the tenant in the path: `GET/PUT /network-security/tenants/:tenantId/{ip-allowlist,geofence}`; `GET/POST /oidc/tenants/:tenantId/clients`, `POST …/:clientId/rotate-secret`, `DELETE …/:clientId`. A missing tenant is 404. Every allowlist, geofence and OIDC-client write is audited under PLATFORM and the tenant | `routes/api/networkSecurity.route.js`, `controllers/networkSecurity.controller.js`, `services/networkSecurity.service.js`, `routes/api/oidc.route.js`, OIDC controller and service, `tests/guards/twoTenantRoutes.guard.test.ts` (entries) |
| A-281 | `POST /ai/query` and `/ai/ocr`: no provider → **409** naming the settings; the provider failed → **502** | `controllers/ai.controller.js` |
| A-282 | An API key is audited as `system:api-key` with `changes.apiKeyId` (the key's id in `user_id` fails the FK) — in the modules A-278 touches | `utils/auditPrincipal.util.ts` (new), `constants/systemActors.ts` |

Docs amended under the deviation protocol: `docs/MULTI-TENANCY/01` § Lifecycle (the transitions table, the "what the code does" list, the Stripe path) and `docs/MULTI-TENANCY/07` (the lifecycle, network-security, OIDC and billing-webhook rows).

## Evidence — tests, named

New suites:
- `routes/oidc.consent.twoTenant.a275.test.ts`: 7 tests, with the `@two-tenant` marker for `GET /authorize/request/:requestId`. The guard's `capability` entry for that route was removed.
- `services/stripeWebhook.suspension.a276.test.ts`: 7 tests.
- `routes/tenantMembers.a277.test.ts`: 11 tests (tickets, kanban, risk).
- `routes/scim.userAudit.a278.test.ts`: 4 tests.
- `routes/crudAudit.a278.test.ts`: 8 tests (vendor by an API key, risk, scorecard, finance).
- `utils/auditPrincipal.a282.test.ts`: 3 tests.

Extended suites:
- `services/tenantLifecycle.w01.test.js`, describe "A-278 / A-279 — operator lifecycle transitions are audited, and conflicts are 409": 12 tests.
- `services/oidcProvider.service.test.js` (A-275/A-280 blocks), `controllers/oidcProvider.controller.test.js` ("A-280 — the tenant named in the path").
- `services/apiKey.service.test.js`, `services/esignature.*` (key audit), `services/networkSecurity.service.test.js`, `controllers/networkSecurity.controller.test.js`, `controllers/ai.controller.test.js` (409/502), `controllers/scim.controller.test.js`, `services/tenantLifecycle.service.test.js` (409), `services/stripeWebhook.service.coverage.test.js`, `constants/systemActors.a124.test.js`.

Existing suites adapted to the new signatures (transaction and audit doubles, the actor argument):
- `readGates.p604`, `routeGuards.a28`, `ai.gate.a94`, `bodyless.a09`, `signingKeyWrap.s08`;
- the vendor, risk, scorecard and finance unit suites; `scim.service`, `kanban.service`, `ticket.service`;
- `stripeWebhook.service`, `stripeWebhook.upsert.a25`, `tenantLifecycle.gracePeriod.w21`, `tenantLifecycle.controller`.

**Fail-before.** In a `git worktree` at `HEAD`, the current tree was copied in and my edits were reverse-applied, which reproduced the pre-fix sources exactly: `diff --strip-trailing-cr` against `HEAD` is 0 lines for every file no other agent had touched. Of 318 tests in the 14 suites above, **79 failed**, and every new behaviour test was among them:
- A-275: all 6 decision/foreign tests. The owner-reads positive control passed.
- A-276: 7 of 7.
- A-277: 6 of 6 foreign probes. Both positive controls passed.
- A-278: SCIM 4 of 4, CRUD 8 of 8, and the lifecycle audit tests.
- A-279: the three 409 tests.
- A-280: the network-security and OIDC client tests.
- A-281: the 409 and 502 tests.
- A-282: the vendor-by-API-key rows.

The worktree's junctions were removed with `rmdir` on the link (their targets are intact), then the worktree was deleted and pruned. The risk `assignedTo` check was added after that run; its fail-before is by reading only (the pre-fix `createRisk`/`updateRisk` had no lookup).

**Guards.** `guards/auditInTransaction.p611` is green: every new `logAction(` passes `{ transaction }`. `guards/twoTenantRoutes.guard` gained the six A-280 platform entries.

**Static checks.** `npm run typecheck` is clean. `npx eslint` on every touched file reports 0 errors (the warnings are pre-existing unused imports).

**Full gate.** See the last section. The `npm run test:coverage` figure is quoted there as run.

## Decisions (short — the argument is ADR-094)
- A consent belongs to the client's tenant. A platform client lives in the operator's home tenant, so the same rule covers it.
- A payment lifts only dunning's own suspension, recognised by two marks and no migration.
- A foreign user named in a body gets the same 404 as a missing one (the A-129 convention).
- Operator changes to a tenant are audited under PLATFORM and the tenant (A-165), and the operator names the target in the path.
- A missing AI provider is 409; an upstream failure is 502.
- An API key is `system:api-key`.

## Left open
- **A-282 is partial.** Other audited services a key can reach still pass `auditActor(req)`.
- **A-288:** the allowlist and geofence are not enforced at sign-in.
- **Q-38:** may tenant administrators set their own allowlist?
- `offboardTenant` writes one audit row, not two. The Stripe plan change is unaudited.
- No frontend screen exists for the new `/tenants/:tenantId/…` routes.
- The OIDC consent page (frontend) now receives a 404 for a foreign or expired request, where the decision used to answer 400. Nothing in the frontend keyed on the 400.

## Full gate — `npm run test:coverage`, 2026-09-29 (busy tree; four other agents editing)

- **Result: 742 suites (709 passed, 7 failed, 26 skipped); 13,615 tests (13,428 passed, 21 failed, 166 skipped).**
- **Coverage:** statements, functions and lines 100%; branches 99.99%. Every file this change touched is at 100% on all four measures (targeted run: the 13 services, 11 controllers, `auditPrincipal.util.ts`). The one uncovered branch is `validators/fields.ts:9` (P9-11's file).
- **None of the 21 failures is in this change's code.** Each is in a file another agent had in flight:
  - `roles.service` and its `roles.audit.a41` / `roles.menuAudit.a165` suites: the P9-12 lead's conversion.
  - `audit.platform.a125`: `audit.service` / `audit.controller` edited for P8-04 (ADR-096).
  - `migrations/manifestNames.p923` and `0019-signature-crypto-fields.d29`: a migration now exists twice, as `.js` and `.ts` (a conversion in flight).
  - `kanban.twoTenant` › GET sprints: the grouped count that another change added to `kanban.service#listSprints`/`listProjects`, which memoryDb cannot evaluate. This change's kanban edits are `addMember`/`createCard`/`updateCard` only, and their probes are green.
- An earlier run, before these fixes' tests were finished, also failed `signingKeyWrap.s08` (this change's `generateKeyPair` actor). It was adapted and passes in this run.
- The gate is therefore **not green on this tree**. This change's own suites all pass.
