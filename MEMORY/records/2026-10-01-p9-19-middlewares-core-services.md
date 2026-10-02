# 2026-10-01 — P9-19 middlewares, the batch-job worker and the five core services are TypeScript

**ADR:** ADR-087 **Amendment 27** · **Cards:** P9-19 (middlewares), P9-18 (core services: `redis`, `audit`, `mfa`, `rateLimiter.redis`, `emailQueue`), the worker · **By:** the P9-22 helper, assigned by the coordinator · **Tree:** HEAD `fb55605` plus the uncommitted work of many agents. DONE waits on the full gate on a quiet tree, like P9-12 and P9-13.

## What changed

| Area | Files (`.js` removed in the same atomic step, after `cmp` against a pre-conversion snapshot) |
|---|---|
| Middlewares, P9-19 (15) | `src/middlewares/{abac,auth,dynamicAccess,enforceQuota,bodyDefault,auditLog,webhookDeliveryScheduler,quarantineSweepScheduler,attachmentFileSweepScheduler,webhookDeliveryPurgeScheduler,backup,calibrationScheduler,retentionScheduler,sessionCleanup,tenantLifecycleScheduler}.middleware.ts`. **`src/middlewares/` holds no `.js` now** |
| Worker | `src/workers/batchJob.worker.ts` |
| Core services (5) | `src/services/{redis,emailQueue,mfa,rateLimiter.redis,audit}.service.ts`; their interim `.d.ts` twins deleted |
| New types | `src/constants/seededMenuSlugs.ts` (`SEEDED_MENU_SLUGS`, 63 slugs; `SeededMenuSlug`) — A-07 |
| New tests | `tests/constants/seededMenuSlugs.p919.test.ts`; `tests/middlewares/dynamicAccess.pins.p919.test.ts`; `tests/middlewares/bodyDefault.type.p919.test.ts`; `tests/services/rateLimiter.fixedWindow.redisAnswer.am5.test.ts` (4); `tests/services/audit.service.pins.p918.test.ts` (5); `tests/services/auditService.p918.live.test.ts` (6, opt-in `P918_PG_LIVE_TEST=1`) |
| File names only | `guards/apiKeyAuthorizedWriters.v05` (AUTHORIZERS → `dynamicAccess.middleware.ts`, self-exclusion → `auth.middleware.ts`); `guards/declarationDrift.p912` (sanity list → `config/{index,socket,migrator}.d.ts`); `utils/schedulerSwitch.w02` EXEMPT key → `webhookDeliveryScheduler.middleware.ts`; `jest.config.js` drops `src/middlewares/**/*.js` (it matched nothing: `coverageScope.p614`) |
| Findings | `TASKS/AUDIT-2026-09-REMEDIATION.md` **A-340**: `rateLimiter.redis.service#revokeTokenByHash` / `revokeAllUserTokens` write camelCase attributes the snake_case `Session` model does not have (no production caller; open) |

## Method and evidence

Every module: (a) an **identity harness** (`scratchpad/p922/p919/mod-identity.js`): the pre-conversion `.js` and the TypeScript 7 emit, both loaded with the same fakes, driven through the same scenarios with a deterministic clock (`Date.now` and, since this round, a no-argument `new Date()`) and `Math.random`. It compares results, every fake call and its arguments, the callbacks the fakes received, the export key order and the export types. Then planted **bites** in the emit, each of which must be reported different.

| Module | Scenarios | Fake calls | Different | Bites |
|---|---|---|---|---|
| abac | 20,790 | 13,056 | 0 | all caught |
| auth | 15,140 | 16,149 | 0 | all caught |
| dynamicAccess | 25,712 | 32,337 | 0 | all caught |
| enforceQuota | 1,120 | 960 | 0 | all caught |
| bodyDefault | 22 | 0 | 0 | all caught |
| backup / calibrationScheduler | 720 each | 45,620 / 54,570 | 0 | all caught |
| retention / sessionCleanup / tenantLifecycle schedulers | 960 each | 94,830 / 101,910 / 73,830 | 0 | all caught |
| quarantineSweep / attachmentFileSweep / webhookDeliveryPurge schedulers | 432 each | 6,318 each | 0 | all caught |
| webhookDeliveryScheduler | 972 | 89,024 | 0 | 7/7 (incl. the overlap guard) |
| auditLog | 2,121 | 670 | 0 | 7/7 |
| batchJob.worker | 324 | 947 | 0 | all caught |
| redis.service | 675 | 1,116 | 0 | all caught |
| emailQueue.service | 108 | 310 | 0 | all caught |
| mfa.service | 152 | 967 | 0 | all caught (incl. the ±30 s window) |
| rateLimiter.redis.service | 84 | 32,175 | 0 | 10/10 |
| audit.service | 462 | 1,119 | 0 | 13/13 |

**Coverage:** each module at 100% statements, branches, functions and lines under its related suites (`--findRelatedTests` / the suites naming it), e.g. audit.service over 466 suites (8,020 tests), rateLimiter.redis over 285, auditLog 10 suites (127 tests).

### The four gates (auth, dynamicAccess, abac — security-critical; audit.service — append-only, ADR-095)

1. **Identity**, above.
2. **Planted defects in a scratch mirror** (`bite-jest.py`: a copy of the `.ts` with the defect, mapped in by a scratch jest config; `src/` never written). auth / dynamicAccess / abac: every plant failed a suite but one equivalent mutant (`superAdminOnly` without `!req.user.role ||` — the role comparison that follows refuses the same principals). **audit.service:** 13 plants against the 49 suites that load the real module; 10 caught, **3 survived** and are now pinned (below).
3. **The authz and isolation suites:** auth at 100% across 2,880 tests; dynamicAccess across 1,626; audit.service across 466 suites.
4. **Live, PostgreSQL 18.6** (named containers, removed by name):
   - auth / dynamicAccess / abac over HTTP (`p919-live-pg`, `p919-live-redis`, backend from source): **17/17** — 401s, 403, cross-tenant 404 bodies equal to not-found, A-93 owner 404, abac 404, session revocation.
   - audit.service **as `callibrator_app`** (`p918-audit-pg`): `auditLogAppendOnly.q34.live` upgrade **7/7** and fresh **7/7**; `auditRollback.p611.live` **4/4**; `queryCount.p804.live` **4/4**; and the new `auditService.p918.live` **6/6**: recordAccountLock commits the lock with its ACCOUNT_LOCKED row as `system:auth-lockout` in the account's tenant, PLATFORM for a tenant-less account; fail-secure (row refused, lock persisted alone); the A-41 re-throw inside a transaction and `null` outside it; the written row refused UPDATE and DELETE for the app role, with a password in `changes` redacted; fetchAuditLogs lists the system-actor row (`user` NULL) and its raw count binds the context's tenant. Two plants run against that live suite (PLATFORM fallback removed; fail-secure fallback removed) each fail it.

### What the planted defects found

audit.service had three behaviours that no suite asserted. Each is now pinned in `audit.service.pins.p918.test.ts`, and each pin fails under its plant:
- **The A-126 fail-secure fallback** (`await persistLock(null)` after a failed lock transaction). Removing it switched brute-force locks off whenever audit writes fail, and all 835 tests stayed green.
- **`required: false` on both `User` includes of fetchAuditLogs** (CLAUDE.md, The Traps).
- **recordAccountLock calling the exported `logAction`** at call time, which spies (A-41 rollback tests) depend on.

### rateLimiter.redis branch coverage (the coordinator's 99.86% gap)

- The fixed-window Redis answer without `expiresAt` (falls back to `now + windowMs`) is covered by a real test, `rateLimiter.fixedWindow.redisAnswer.am5.test.ts`. That test fails 2 of 4 when the fallback is planted out.
- Two defensive arms could never be reached and were removed rather than ignored: `typeof previous.expiresAt === "number"` and `previous.count || 0` in the memory path. Every memory entry is written by `memorySet` (a numeric `expiresAt`) with a count ≥ 1, and `memoryGet`'s type says so.
  - An istanbul ignore was tried first. It took the A-32 ceiling from 30 to 31 (`istanbulIgnore.a32`, reported by the leaf helper), so it was removed.
  - Identity still 0 different (84 scenarios). Branches 100%.

### DoD items

- **A-07:** `dynamicAccess`'s `menuGroup` is `SeededMenuSlug | readonly SeededMenuSlug[]`, the union of the 63 slugs the seed writes. `seededMenuSlugs.p919.test.ts` pins it equal to `authorizationWiring#seededMenuSlugs()` and a superset of `MENU_SLUGS`.
- **bodyDefault:** an assertion signature (`asserts req is DefaultedBodyRequest`, body `object | string | number | boolean | null`, never `undefined`), pinned at compile time.

### Notes

- **auditLog.middleware has no production caller.** Only tests load `recordAudit` / `withAudit`. It is converted as it stands; whether to delete it is not decided here.
- **CRLF.** Python on Windows writes CRLF in text mode, and the p611 guard's `$`-anchored regexes then miss a method head. All generators now write `newline="\n"`; 35 of this helper's files and 9 of the leaf helper's were normalised.
- **Mirror defect, found and fixed.** The plant mapper keyed on `services/<name>`, so an importer writing `./audit.service` loaded the real file while the test spied on the plant (9 false failures on a no-op plant). It now keys on the basename; the baseline mirror is clean, 49/49. The P9-19 plants were unaffected: no same-directory importer of those middlewares exists.

## Gates (after the last swap)

`npm run typecheck` clean · `npm run build:dist` 569 TypeScript files compiled · `npm run load:check` OK (dist via node) and `-- --src` OK (src via tsx) · `npm run ratchet` floor lowered to 725 (commit `backend/.ts-ratchet.json`) · `npx eslint` clean on every changed file · guards: `src/tests/guards` plus `schedulerSwitch.w02` and `coverageScope.p614` pass.

Two transient reds from other lanes during this round: `ownSessions.createdAt.a339` (typecheck) and the `ai` controller/route swap (`build:dist`, `denyPlatformAuthoring.a127`). Both are green again.

## Round 3 (2026-10-01/02) — the last four services, A-340, auditLog removed (ADR-087 Amendment 29)

Assigned by the coordinator, with these decisions: remove A-340's pair; remove auditLog.middleware and its tests; convert `attachment`, `menuGroup`, `migration` and `maintenance` (the services helper confirmed it was not holding the last two).

| Change | Files | Evidence |
|---|---|---|
| A-340 (DONE), its own change | `rateLimiter.redis.service.ts`: the two revokers removed. Their 6 unit tests (`rateLimiter.service.coverage`) and their 2 `auditCoverage.p611` entries went too | `rateLimiter.deadRevokers.a340.test.ts`: 2/4 before, 4/4 after |
| auditLog.middleware removed | `middlewares/auditLog.middleware.ts`, `tests/middlewares/auditLog{,.recordAudit}.test.js` deleted (no permission refusal). The `jest.mock` of it is gone from 5 route tests, and its case from `auth.impersonator.f8`. Comments updated in `auditInTransaction.p611` and `user.routes`. 9 `docs/` files amended (API/12, BACKEND/02 and 10, DATABASE/10, DEVELOPER/07, OBSERVABILITY/01, PLAN/01 and 02, SECURITY/00) | 32 suites green (271 tests) |
| `menuGroup.service.ts` | `.js` removed | identity 552 scenarios, 0 different, 11 of 12 bites (the 12th, an infinite-loop mutant, hangs) |
| `migration.service.ts` | `.js` and `.d.ts` removed; `seedDemoData`'s type kept for `scripts/seedDemo.ts`; 14 istanbul ignores = HEAD | identity 3,888, 0 different, all bites; 100% over 19 suites |
| `maintenance.service.ts` | `.js` and `.d.ts` removed, types kept as the floor | identity 1,320, 0 different, 9/9 bites; 100% over 66 suites |
| `attachment.service.ts` | `.js` and `.d.ts` removed, types kept; listOrphans through `sql()` (bound `$1`…`$3`); `attachment.cascade.d22` asserts the bound form | identity 2,088 (statements compared with values substituted), 0 different, 9/9 bites; 100% over 73 suites (1,405 tests) |
| Guard lists | `unboundedFindAll.d24` keys `.js` → `.ts` for the four. `noSourceJs.p924` PENDING: maintenance and attachment out (now `checkMenu.util.js` only). `jest.config.js` `src/services/**/*.js` pattern removed by the services helper | guards 24/24 suites |
| New pins (planted defects that survived) | `migration.service.pins.p918.test.ts` (5): A-259 one record refuses, A-125 platform tenant first + `includePlatformTenant`, role seed `ignoreDuplicates`, demo flag count. `attachment.service.pins.p918.test.ts` (3): S-01 file removed after the commit, kept on rollback, an rm failure not an error | each pin fails under its plant |
| Live (PG18 18.6, `callibrator_app`) | `migrationService.p918.live.test.ts` (5) and `attachmentService.p918.live.test.ts` (6), both opt-in | 5/5; 6/6 (two tenants, real files: quarantine → uploads, cross-tenant 404 ×3 calls, orphans per tenant, cascade + restore, signed link, file removed); `authCards.a215.live` 8/8. A live plant (PLATFORM lookup) fails 3/5 |

**Harness fix.** Up to now the identity runner copied its two module copies into `src/<dir>/` for each run. An infinite-loop bite held them there until its timeout, and other lanes' build:dist and ratchet went red. The coordinator reported it. The runner now keeps the copies in the scratchpad, with relative requires rewritten to absolute src paths (`relocate.py`, NODE_PATH). menuGroup was re-verified through it. Also new in the harness:
- a no-argument `new Date()` follows the deterministic clock;
- an `esModule` flag on fakes of named-export TS modules;
- a `normalizeLog` hook.

**Bootstrap file.** A *planted* run of the migration live suite left `backend/.bootstrap/superadmin-password` (scratch DB, ignored path). The directory was empty before my runs. I removed the file; clean runs remove their own in `afterAll`.

**Also fixed (reported by the leaf helper):** 11 contract files in `packages/contracts/src` had a comment path mangled by Git Bash (`C:/Program Files/Git/api/…` → `/api/…`), from my earlier generator.

**Gates after the last swap:** typecheck 0 errors · build:dist OK · load:check dist and src OK · ratchet at the floor (695) · eslint clean on every changed file · containers `p918b-seed-pg` and `p918-audit-pg` removed by name.
