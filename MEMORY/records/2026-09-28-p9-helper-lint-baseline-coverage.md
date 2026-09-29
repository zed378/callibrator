# 2026-09-28 — Phase 9 helper 1: lint at zero, one ESLint config, the P9-00 baseline, the coverage config

**Cards:** P9-00 (done), P9-02 (done), P9-02a (started: errors done, warnings open), P9-03a (done), plus five docs moved off `node src/…` · **ADR:** ADR-092 · **Tree:** `HEAD` `35ebd76` plus the shared working tree. The Phase 9 lead and helper 2 were editing it at the same time. · **Baseline record:** [`P9-00.md`](./P9-00.md)

## What changed

| Card | Change | Files |
|---|---|---|
| P9-02 | `backend/.eslintrc.js` deleted (the permission system allowed it this time) | — |
| P9-02 | global `ignores` moved into their own config object | `backend/eslint.config.js` |
| P9-02 | root Prettier file scoped by a header comment; `backend/.prettierrc` governs `backend/` | `.prettierrc.js` |
| P9-02a | 1,050 lint errors fixed (formatting only), 12 unused `eslint-disable` directives removed; baseline 950 → **0** | the 137 files below, `backend/.eslint-baseline.json` |
| P9-03a | the A-32 guard also scans `.ts`; ceiling 31 → 30 | `backend/src/tests/utils/istanbulIgnore.a32.test.js` |
| docs | `node src/…` command lines → the npm-script or tsx form; the CI doc's lint row updated for the zero baseline; the lint/format doc's as-built sections | `docs/DEVOPS/01-CI-CD.md`, `docs/SECURITY/03-AUTHENTICATION-SECURITY.md`, `docs/STORAGE/04-TENANT-STORAGE.md`, `TASKS/AUDIT-2026-09-INFRA.md`, `TASKS/AUDIT-2026-09-REMEDIATION.md`, `docs/ENGINEERING/10-TOOLING-LINT-FORMAT.md` |
| cards | P9-00, P9-02, P9-02a, P9-03a; PROGRESS; ADR-092 | `TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`, `TASKS/PROGRESS.md`, `MEMORY/DECISIONS.md` |

## Evidence

| Check | Result |
|---|---|
| `node scripts/ci/eslint-ratchet.js`, before | `1050 error(s), 300 warning(s); baseline 950` → FAIL, 100 new |
| …after | `0 error(s), 287 warning(s); baseline 0` → exit 0 |
| `npm run lint` (backend) | exit 0: 0 errors, 287 warnings (263 `no-unused-vars`, 19 `no-console`, 6 `prefer-arrow-callback`, before the directives went: 300) |
| Errors by rule, before | curly 335 · indent 299 · quotes 190 · comma-dangle 169 · no-trailing-spaces 41 · eol-last 11 · no-multiple-empty-lines 3 · prefer-const 1 · space-infix-ops 1 |
| AST identity, espree, working copy vs `git show HEAD:` (positions, `raw`, `curly` block, expression-free templates normalised) | 115 + 12 formatted files: **126 of 127 identical**; `meteredBilling.service.js` differs by the one hand `prefer-const`. 12 directive files: **12 of 12 identical** |
| …the comparer is not vacuous | before template normalisation it reported 3 files as different (`meteredBilling`, `dataLayer.dbC.live`, `reporting.service` tests) |
| Global ignores, `ESLint#isPathIgnored` over every `.js`/`.ts` under `backend/` | before: `dist/` 474 visited, `coverage/` 6 visited, `jest.config.js` visited with `curly` off; after: all ignored, `src/` 1,206 visited before and after |
| `npx prettier --find-config-path backend/index.js` | `backend/.prettierrc` |
| `npm run typecheck` | exit 0 |
| A-32 guard, `npm test -- src/tests/utils/istanbulIgnore.a32.test.js` | 3 passed; with a probe `src/scripts/zzP903aProbe.ts` holding a bare `istanbul ignore next`: **2 failed** (it named the probe); probe deleted, 3 passed |
| Models coverage, `npm run test:coverage -- --ci --collectCoverageFrom="src/models/**/*.js" --coveragePathIgnorePatterns=/node_modules/ --coveragePathIgnorePatterns=/tests/ --coverageThreshold={}` | 93.5% statements, 65.58% branches, 93.17% functions, 93.39% lines; 62 of 72 models at 100%. (That run had 5 failures of its own: 2 timeouts under the extra instrumentation in `password.test.js` / `user.passwordReset.a162.test.js`, and the A-32 guard while a probe was present. The figure is informative, not a gate) |
| Docs: `npx tsx src/scripts/breakGlassMfaReset.js` (no arguments) | loads, answers "Break-glass refused: identifier, requestedBy and ticket are all required", exit 1 by design, no database touched. Plain `node src/scripts/breakGlassMfaReset.js`: `Cannot find module './packaged.util'` |
| Docs: `npm run migrate:storage -- --dry-run` | loads through tsx, prints "Storage migration (dry-run)…", then fails at the database (no PostgreSQL on this machine). Plain `node`: `Cannot find module './packaged.util'`. **Not run end to end** |
| Docs: `node --import tsx -e "require('./src/constants')"` | loads the converted constants. A full `node --import tsx index.js` boot was not run locally (no database). CI's `boot-and-migrate` uses this form |
| **Full gate, `npm run test:coverage -- --ci`** (started 15:59:21 +07:00, Node 26.10.0) | **683 suites passed, 24 skipped (707); 12,890 tests passed, 155 skipped; 100% statements (19,090), branches (10,303), functions (2,825), lines (18,426)**; 141 s; exit 0 |
| P9-00 | see [`P9-00.md`](./P9-00.md): 53/53 specs twice on `35ebd76` |

## Left open

- **P9-02a:** 263 `no-unused-vars` and 19 `no-console` to triage by hand (A-42 for the console sites); then `no-unused-vars` → `error`. The ratchet script could then be replaced by plain `eslint`.
- **Commit the 137 formatted files on their own** (P9-02a abuse case 1). They are listed below.
- **`CLAUDE.md` § "Two Things Currently Failing"** still says backend lint is red (1,083 / baseline 950). It was being edited by another agent; that row is now false.
- **The root `.prettierrc.js`** (`singleQuote`) contradicts a double-quoted frontend — the frontend owner's call.
- **P9-01b's last box** ("the binary behaves identically: the P9-00 baseline set still passes against the new image") is now runnable — the set exists; it has not been run against a converted image.
- **`E2E_MFA_STATE_FILE`** is a trap for multi-identifier runs (ADR-092).
- **Lead's files not touched:** `jest*.config.js`, tsconfig, `build-dist.ts`, `ts-ratchet.ts`, `src/types/**`, `constants/*`, the lead's utils. `utils/migrationLock.util.js` carries someone else's diff, not mine.
- **Free for conversion:** `utils/fileValidation`, `otp`, `response`, `ssrf` — my formatting edits there are finished and lint-clean.

## The 137 formatted files (commit alone)

- `backend/src/controllers/ai.controller.js`
- `backend/src/controllers/auth.controller.js`
- `backend/src/controllers/certificate.controller.js`
- `backend/src/controllers/eSignature.controller.js`
- `backend/src/controllers/predictiveMaintenance.controller.js`
- `backend/src/controllers/risk.controller.js`
- `backend/src/controllers/supplierScorecard.controller.js`
- `backend/src/controllers/vendor.controller.js`
- `backend/src/migrations/0004-add-mfa-fields.js`
- `backend/src/migrations/0006-add-capas.js`
- `backend/src/migrations/0007-add-sop-documents.js`
- `backend/src/migrations/0010-add-iot-fields.js`
- `backend/src/migrations/0012-enable-rls-policies.js`
- `backend/src/models/batchJob.model.js`
- `backend/src/models/capa.model.js`
- `backend/src/models/iotReading.model.js`
- `backend/src/models/nonConformance.model.js`
- `backend/src/models/risk.model.js`
- `backend/src/models/sopDocument.model.js`
- `backend/src/models/sopTrainingAcknowledgment.model.js`
- `backend/src/models/supplierScorecard.model.js`
- `backend/src/models/workflow.model.js`
- `backend/src/models/workflowAction.model.js`
- `backend/src/models/workflowInstance.model.js`
- `backend/src/models/workflowStep.model.js`
- `backend/src/routes/api/audit.route.js`
- `backend/src/routes/api/maintenance.route.js`
- `backend/src/routes/api/predictiveMaintenance.route.js`
- `backend/src/routes/api/tenantHierarchy.route.js`
- `backend/src/routes/api/vendor.route.js`
- `backend/src/services/auth.service.js`
- `backend/src/services/billing.service.js`
- `backend/src/services/certificate.service.js`
- `backend/src/services/content.service.js`
- `backend/src/services/dashboard.service.js`
- `backend/src/services/dataRetention.service.js`
- `backend/src/services/eSignature.service.js`
- `backend/src/services/featureFlag.service.js`
- `backend/src/services/kanban.service.js`
- `backend/src/services/meteredBilling.service.js`
- `backend/src/services/notification.service.js`
- `backend/src/services/oidcJwks.js`
- `backend/src/services/oidcProvider.service.js`
- `backend/src/services/predictiveMaintenance.service.js`
- `backend/src/services/risk.service.js`
- `backend/src/services/supplierScorecard.service.js`
- `backend/src/services/tenantLifecycle.service.js`
- `backend/src/services/ticket.service.js`
- `backend/src/services/userPermission.service.js`
- `backend/src/services/vendor.service.js`
- `backend/src/services/workflow.service.js`
- `backend/src/tests/controllers/ai.controller.test.js`
- `backend/src/tests/controllers/eSignature.controller.test.js`
- `backend/src/tests/controllers/roles.controller.test.js`
- `backend/src/tests/controllers/scim.controller.test.js`
- `backend/src/tests/controllers/search.controller.test.js`
- `backend/src/tests/controllers/session.controller.test.js`
- `backend/src/tests/controllers/sop.controller.test.js`
- `backend/src/tests/controllers/supplierScorecard.controller.test.js`
- `backend/src/tests/e2e/authz.e2e.test.js`
- `backend/src/tests/e2e/http.e2e.test.js`
- `backend/src/tests/e2e/liveContract.smoke.test.js`
- `backend/src/tests/e2e/modules/api-keys.e2e.test.js`
- `backend/src/tests/e2e/modules/audit.e2e.test.js`
- `backend/src/tests/e2e/modules/certificates.e2e.test.js`
- `backend/src/tests/e2e/modules/content.e2e.test.js`
- `backend/src/tests/e2e/modules/custom-domains.e2e.test.js`
- `backend/src/tests/e2e/modules/finance.e2e.test.js`
- `backend/src/tests/e2e/modules/kanban.e2e.test.js`
- `backend/src/tests/e2e/modules/maintenance.e2e.test.js`
- `backend/src/tests/e2e/modules/menuGroups.e2e.test.js`
- `backend/src/tests/e2e/modules/meteredBilling.e2e.test.js`
- `backend/src/tests/e2e/modules/predictive-maintenance.e2e.test.js`
- `backend/src/tests/e2e/modules/qms.e2e.test.js`
- `backend/src/tests/e2e/modules/risk.e2e.test.js`
- `backend/src/tests/e2e/modules/roles.e2e.test.js`
- `backend/src/tests/e2e/modules/sessions.e2e.test.js`
- `backend/src/tests/e2e/modules/sop.e2e.test.js`
- `backend/src/tests/e2e/modules/stock.e2e.test.js`
- `backend/src/tests/e2e/modules/supplier-scorecard.e2e.test.js`
- `backend/src/tests/e2e/modules/tenant-hierarchy.e2e.test.js`
- `backend/src/tests/e2e/modules/tenant-lifecycle.e2e.test.js`
- `backend/src/tests/e2e/modules/tenants.e2e.test.js`
- `backend/src/tests/e2e/modules/userPermissions.e2e.test.js`
- `backend/src/tests/e2e/modules/users.e2e.test.js`
- `backend/src/tests/e2e/modules/vendors.e2e.test.js`
- `backend/src/tests/e2e/modules/webhooks.e2e.test.js`
- `backend/src/tests/e2e/setup.js`
- `backend/src/tests/middlewares/activityLog.redaction.a228.test.js`
- `backend/src/tests/middlewares/auditLog.recordAudit.test.js`
- `backend/src/tests/middlewares/createFolder.test.js`
- `backend/src/tests/middlewares/sessionCleanup.test.js`
- `backend/src/tests/middlewares/validation.test.js`
- `backend/src/tests/routes/attachments.route.test.js`
- `backend/src/tests/routes/audit.routes.test.js`
- `backend/src/tests/routes/content.routes.test.js`
- `backend/src/tests/routes/menuGroups.route.test.js`
- `backend/src/tests/routes/migration.route.test.js`
- `backend/src/tests/services/auth.service.test.js`
- `backend/src/tests/services/customDomains.service.test.js`
- `backend/src/tests/services/dashboard.service.test.js`
- `backend/src/tests/services/dataLayer.dbC.live.test.js`
- `backend/src/tests/services/dataRetention.service.test.js`
- `backend/src/tests/services/esignature.service.test.js`
- `backend/src/tests/services/iot.service.test.js`
- `backend/src/tests/services/predictiveMaintenance.service.test.js`
- `backend/src/tests/services/quota.service.test.js`
- `backend/src/tests/services/rabbitmq.service.test.js`
- `backend/src/tests/services/rateLimiter.service.coverage.test.js`
- `backend/src/tests/services/reporting.service.test.js`
- `backend/src/tests/services/risk.service.test.js`
- `backend/src/tests/services/scim.service.test.js`
- `backend/src/tests/services/session.service.test.js`
- `backend/src/tests/services/storage.config.test.js`
- `backend/src/tests/services/storage.local.test.js`
- `backend/src/tests/services/supplierScorecard.service.test.js`
- `backend/src/tests/services/tenantHierarchy.service.test.js`
- `backend/src/tests/services/userPermission.service.test.js`
- `backend/src/tests/services/workflow.service.test.js`
- `backend/src/tests/utils/checkMenu.test.js`
- `backend/src/tests/utils/circuitBreaker.test.js`
- `backend/src/tests/utils/controllerWrapper.test.js`
- `backend/src/tests/utils/env.test.js`
- `backend/src/tests/utils/fileValidation.test.js`
- `backend/src/tests/utils/jwt.env.test.js`
- `backend/src/tests/utils/jwt.test.js`
- `backend/src/tests/utils/seedMenuGroups.test.js`
- `backend/src/tests/validators/dataRetention.validator.test.js`
- `backend/src/tests/validators/finance.validator.test.js`
- `backend/src/tests/validators/gdpr.validator.test.js`
- `backend/src/tests/validators/meteredBilling.middleware.test.js`
- `backend/src/tests/validators/webauthn.validator.test.js`
- `backend/src/utils/fileValidation.util.js`
- `backend/src/utils/otp.util.js`
- `backend/src/utils/response.util.js`
- `backend/src/utils/ssrf.util.js`
- `backend/src/validators/workflow.validator.js`

Also changed (not formatting): `backend/.eslint-baseline.json`, `backend/eslint.config.js`, `backend/src/tests/utils/istanbulIgnore.a32.test.js`, `.prettierrc.js`; deleted: `backend/.eslintrc.js`.
