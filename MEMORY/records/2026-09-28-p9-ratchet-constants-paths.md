# 2026-09-28 — Phase 9: the ratchet, the rest of `constants/`, the path utilities, and a fixed test transform

**ADR:** [ADR-087 Amendment 1](../DECISIONS.md) · **Cards:** P9-04 done; P9-08 15 of 16; P9-05a started (two utils); P9-05 unchanged · **Tree:** HEAD `35ebd76` plus the shared working tree (the Phase 8 agent was running during part of it; the helper agent started near the end). Continues [`2026-09-28-p9-toolchain-and-first-leaves.md`](./2026-09-28-p9-toolchain-and-first-leaves.md).

## What changed

| Area | Files |
|---|---|
| Ratchet (P9-04) | `backend/scripts/ts-ratchet.ts`, `backend/.ts-ratchet.json` (the floor: a sorted list of 1,199 `.js` paths), `backend/package.json` (`ratchet`), `Makefile` (`ts-ratchet`, in `verify`), `.github/workflows/ci.yml` (backend-lint job), `scripts/git-hooks/pre-push` |
| Test transform | `backend/jest.transform.js` (new — Babel 8 core), `backend/jest.config.js` and `backend/jest.e2e.config.js` point at it |
| Converted (P9-08) | `src/constants/{appConstants, attachmentResources, roleConstants, index, rateLimitConstants, systemActors, tenantSecretSettings}.ts` |
| Converted (P9-05a) | `src/utils/{storagePath, appPath}.util.ts` |
| Test change (named) | `src/tests/middlewares/activityLog.a14.stdout.test.js`: its child now starts with `node --import tsx -e …`; the script is unchanged |
| Reverted | `src/middlewares/tenantContext.middleware.js` restored byte for byte from HEAD (`git status` shows it unmodified) |
| Docs | ADR-087 Amendment 1; `TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md` (header, P9-04, P9-05, P9-05a, P9-08); `TASKS/PROGRESS.md`; `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` (as-built banner); `CLAUDE.md` (scale row) |

Every converted file had no uncommitted change when it was converted (`git status --porcelain`).

## The failure the Phase 8 agent saw, and its cause

Mid-change, a full run failed 240 suites with 446 × "Jest encountered an unexpected token" and coverage 79%. The cause: `tenantContext.middleware.ts` had `new AsyncLocalStorage<TenantContextStore>()`. babel-jest loads the root `@babel/core` **7.29.7** with the backend's **Babel 8** presets. Babel 7's parser and Babel 8's TypeScript plugin disagree about where a call's type arguments live, so `<TenantContextStore>` stayed in the output. Every suite that loads that module failed to parse.

- **Probe:** the same source through the backend's own `@babel/core` **8.0.6** comes out clean (`new AsyncLocalStorage()`, `g(1)`).
- **Fix:** `jest.transform.js` calls that Babel 8 core. After the fix, `tenantContext.middleware.ts` passed its own suite at 100% coverage under the new transform.
- **Why nothing caught it:** no earlier converted file used an explicit type argument.

## Evidence

| Check | Result |
|---|---|
| `npm run typecheck` (TypeScript 7) | exit 0 after each step |
| `npx eslint src/constants/*.ts src/utils/{packaged,storagePath,appPath}.util.ts scripts/ts-ratchet.ts` | 0 problems |
| `ROLE_LEVELS` failing direction | `P9_PROBE_ROLE` added to `ROLE_NAMES` → `TS2741: Property 'P9_PROBE_ROLE' is missing …`; removed → exit 0 |
| Ratchet failing direction | `src/utils/zzRatchetProbe.a087.js` → exit 1, "1 new .js file(s)", named; removed → exit 0 |
| Ratchet lowering | 1208 → 1204 → 1203 → 1201 → 1202 (the reverted file put back, by hand, visibly) → 1199 |
| Identity, constants + `packaged.util` (scratch `p9/compare.js`, originals from `git show HEAD:`, against `dist/`) | **402 checks identical**: export names and order, deep-equal values, freeze state at every depth, each exported function over 28 inputs. `SUPER_ADMIN_ROLE_ID` identical with the variable unset, empty and set |
| Identity, `storagePath`/`appPath` (scratch `p9/compare2.js`) | identical across `APP_STORAGE_PATH` unset/empty/set × packaged/not (60 calls), plus 15 checks on the tenantContext draft (13 request shapes: store, `next` calls, return value) |
| The a14 child under `--import tsx` | `activityLog.a14.stdout.test.js`, `storagePath.test.js`, `appPath.test.js`, `runtimeDirs.p602.test.js`: 4 suites, 32 tests passed |
| Full run with `tenantContext` converted | **1 failure**: `tenantHierarchy.visibility.q05.test.js` › "the request tenant context never reads the hierarchy" — ENOENT on `tenantContext.middleware.js`, which the test reads as text. Everything else passed at 100% |
| Full run after reverting `tenantContext` | exit 0 — 642/666 suites (24 skipped), 12,808 tests (155 skipped), 100/100/100/100 |
| Full run after the last three constants (final tree) | exit 0 — 642/666 suites (24 skipped), 12,808 tests (155 skipped), **100/100/100/100**, 178 s |
| `node dist/index.js` on plain Node 26, no database | every module loaded; "Authorization wiring validated: 171 dynamicAccess gate(s), 11 role-menu assignment(s), 12 role name(s)" (the converted `roleConstants` through the converted barrel); then "Initializing database connection" |
| Docker image | **not rebuilt** for this change (it was built and booted for the first nine modules earlier the same day) |

## Decisions and open items

- **tenantContext was reverted, not kept.** It is the root of tenant isolation. Converting it also means changing an isolation guard that reads it as text. The draft `.ts` and its two types (`express.d.ts`, `ids.ts`) are kept in the session scratch (`p9/deferred/`), not in the tree. They land together with the guard-test change in P9-05a's own reviewed change.
- **Tests are counted by the ratchet.** From now on, any agent adding a new test file must write it as `.ts`. With 14 agents writing tests, that will surface quickly. It is ADR-038's rule, and the coordinator should announce it.
- **`routeGateExemptions.js`** still carries another agent's uncommitted change.
- The P9-05a DoD line asking the tenant store to hold `NO_TENANT_UUID` conflicts with rule 3; recorded on the card.
