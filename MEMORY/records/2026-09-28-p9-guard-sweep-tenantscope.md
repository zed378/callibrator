# 2026-09-28 — Phase 9: every source-scanning guard reads `.ts`; `tenantScope` is TypeScript

**ADR:** [ADR-087 Amendment 4](../DECISIONS.md) · **Cards:** P9-09 (`tenantScope`), plus notes on P9-10 and P9-11 · **Tree:** HEAD `35ebd76` plus the shared working tree. Helper 1 had finished; helper 3 and the docs-and-authz agent were running. Continues [`2026-09-28-p9-05a-logger-tenant-context.md`](./2026-09-28-p9-05a-logger-tenant-context.md).

## What changed

| Area | Files |
|---|---|
| The guard sweep (20 suites) | `src/tests/constants/systemActors.a124`, `guards/auditInTransaction.p611`, `migrations/0019-signature-crypto-fields.d29`, `models/includeRequired.d12`, `models/unscopedModels.d17`, `routes/denyPlatformAuthoring.a127`, `routes/dynamicAccessSlugs.a07`, `routes/routePermissionGuard.p604`, `routes/swaggerValidatorAlignment.p608`, `routes/uploadAfterGate.a78`, `services/migration.service`, `services/signatureEvidence.d18`, `services/unboundedFindAll.d24`, `services/webhookEmit.a11`, `utils/jobContext.w12`, `utils/rawSqlTenantPredicate.d05`, `utils/schedulerSwitch.w02`, `validators/bodylessBody.a09` and `utils/jsonShape.d27` (all `.test.js`). The 20th, `utils/istanbulIgnore.a32`, was already done by helper 1 (ADR-092) and left as it was |
| A live test (named) | `src/tests/utils/migrationLock.p803.live.test.js` starts its child with `--import tsx`. The test was not run live here |
| New devDependency | `@typescript-eslint/typescript-estree` ^8.70.1 (backend), used by the four guards that parse source |
| Converted | `src/utils/tenantScope.util.ts` (the `.js` was removed) |
| Docs | ADR-087 Amendment 4; the P9-09, P9-10 and P9-11 cards (the jsonShape → iot.validator ordering gap; the D-12 follow-up; the orchestrator's P9-11 decisions); `TASKS/PROGRESS.md`; the standards banner; `CLAUDE.md` |

`denyPlatformAuthoring.a127.test.js` carried another agent's uncommitted `NOT_GUARDED` entry (`session.route.js POST /mine/:id/revoke`). My edit changes only its file filter, in a different hunk.

## Evidence

| Check | Result |
|---|---|
| The 20 guards on the clean tree | `jest` on the 20: 369 tests passed |
| Bite proof, per guard | For each guard, a scratch `.ts` plant in the scanned tree made it FAIL, and the plant was removed (table in ADR-087 Amendment 4; `p9/bite.js`, `p9/bite-results.json`). webhookEmit.a11 needed a two-step proof. d12 also caught an import-aliased model (`import { User as U }`) |
| tenantScope gate (a) | Planted text in `tenantScope.util.ts` fails q05 (a hierarchy helper) and d05 (raw SQL on `kanban_projects`). The file was restored (`cmp` equal) |
| tenantScope gate (b) | 2,810 identity checks identical (`p9/compare6.js`) |
| tenantScope gate (c) | 40 isolation suites, 1,196 tests passed; `tenantScope.util.ts` at 100/100/100/100 |
| tenantScope gate (d) | 18/18 on live PostgreSQL 18.6 as `callibrator_app` (`p9/live-two-tenant.js`). The database was migrated by booting the backend from source. The new checks cover LEFT and INNER includes across tenants, `count`, and the `bulkCreate` refusal. The containers were removed afterwards |
| Lint | `npx eslint` on every touched file: 0 errors (one pre-existing warning in migration.service.test). `node scripts/ci/eslint-ratchet.js`: 0 errors, baseline 0 |
| Type check | `npm run typecheck` exit 0 |
| Ratchet | `npm run ratchet`: 1182, at the floor |
| Full run | `npm run test:coverage -- --ci --forceExit`: exit 0, 683 of 707 suites passed (24 skipped), 12,890 tests (155 skipped), **100/100/100/100** |

## Not done here

- **Next conversions:** `fileValidation`, `otp`, `response`, `ssrf`, `controllerWrapper`, then `upload`. Their identity baseline is the working-copy `.js`, which includes helper 1's uncommitted lint edits.
- **`routeGateExemptions`:** still has another agent's uncommitted change, and the docs-and-authz agent is editing route gates.
- **P9-01b:** the P9-00 baseline against a converted image is still unrun.
- **Docker image:** not rebuilt in this round. It was rebuilt and booted at the end of the previous one.
