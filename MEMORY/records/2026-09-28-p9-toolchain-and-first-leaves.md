# 2026-09-28 — Phase 9 starts: the TypeScript toolchain, and the first nine modules

**ADR:** [ADR-087](../DECISIONS.md) (amends ADR-038; works with ADR-076) · **Cards:** P9-01, P9-01a, P9-03 done; P9-01b done except two items; P9-02, P9-05, P9-08 started · **Tree:** HEAD `35ebd76` plus the working tree of 2026-09-28 (other agents' uncommitted work included). Partial edits from 2026-09-27 had been committed unverified in `a31c601`; they were re-read and re-checked, not redone.

**Runtime:** Node 26.10.0 (the machine default), TypeScript 7.0.2 (`@typescript/native`), Babel 8 presets under babel-jest 30.5.2, typescript-eslint 8.70.1 on the TypeScript 6 API package.

## What changed

| Area | Files |
|---|---|
| Compiler | `backend/tsconfig.json` (strict + every ADR-038 flag, ES2025), `backend/tsconfig.build.json` (`allowJs: false`) |
| Build | `backend/scripts/build-dist.ts` (copy JS, compile TS, refuse `x.js`+`x.ts`), `backend/package.json` (`bin`/`main` → `dist/index.js`, `pkg.scripts` → `dist/src/**/*.js`, `build`, `build:dist`, `typecheck`, tsx for `start`/`dev`/scripts; `nodemon` removed) |
| Gates | `Makefile` (`typecheck` runs both workspaces directly; `seed-demo` under tsx), `scripts/git-hooks/pre-push` (backend typecheck), `.github/workflows/ci.yml` (backend typecheck step; both boots `node --import tsx`) |
| Tests | `backend/jest.config.js`, `backend/jest.e2e.config.js` (babel-jest for `.ts`, `.ts` in `testMatch`/`collectCoverageFrom`/`moduleFileExtensions`) |
| Lint | `backend/eslint.config.js` (typescript-eslint strict + stylistic type-checked for `**/*.ts`; the standards' rules as errors; `process.env` ban outside `src/config/`; shared-types guard) |
| Shared types | `backend/src/types/node-process.d.ts`, `backend/src/types/README.md` |
| Converted (`.js` deleted, `.ts` added) | `src/utils/packaged.util.ts`; `src/constants/{auditActions, platformTenant, qmsConstants, tenantAdminSettings, tenantConstants, tenantLogo, tenantStatus, webhookEvents}.ts` |
| Docs (deviation protocol, ADR-087) | `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` (as-built banner, ES2025, `tsconfig.build.json`, `no-namespace`, § Where Types Live), `09-TESTING-CONVENTIONS.md` (babel-jest), `10-TOOLING-LINT-FORMAT.md` (dev, typecheck rows), `backend/README.md` (scripts table), root `tsconfig.json` comment and `TASKS/00-TASK-CONVENTIONS.md` § Build (both cited superseded ADR-030) |
| Board | `TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md` (header, P9-01/01a/01b/02/03/05/08), `TASKS/PROGRESS.md` (Phase 9) |

Every converted file had **no uncommitted change** (`git diff --stat -- <file>` empty) when it was converted, and **no test file was changed**.

## Evidence

| Check | Command / probe | Result |
|---|---|---|
| Type check | `npm run typecheck` (backend) | exit 0 |
| …fails when it must | `src/utils/zzP9probe.a087.ts` with `const p9probe: number = "x"` | exit 1, TS2322; probe deleted, exit 0 again |
| Rule 1 in the build | a `.ts` probe importing `../constants/appConstants` (`.js`) → `npm run build:dist` | exit 1, TS7016; probe deleted |
| Duplicate module refused | `zzBoth.a087.js` + `zzBoth.a087.ts` → `npm run build:dist` | exit 1, "a module exists as both .js and .ts"; probes deleted |
| `dist/` assembly | `npm run build:dist` | "471 JavaScript files copied, 9 TypeScript files compiled -> dist/"; `diff -rq src dist/src` differs only by the 9 converted modules (and `src/tests`, not copied) |
| Behaviour identity | scratch `p9/compare.js`: each original from `git show HEAD:` against its compiled `dist/` module | 60 checks identical: export names and order, deep-equal values, freeze state at every depth, and every exported function over 15 sample inputs |
| `.ts` tests are collected | `src/tests/p9probe/probe.a087.test.ts` asserting `expect(true).toBe(false)` | `FAIL`, "Expected: false, Received: true"; probe deleted |
| Converted modules' own tests (unchanged) | `src/tests/utils/packaged.test.js`, `appPath.test.js`, `storagePath.test.js`, `src/tests/utils/env*` | 30 passed |
| Lint on the converted files | `npx eslint src/constants/*.ts src/utils/packaged.util.ts src/types/node-process.d.ts scripts/build-dist.ts` | 0 problems |
| Shared-types guard fails when it must | a probe in `src/utils/` with `declare global { … }` and `interface ListEnvelope` | 2 errors, "Shared types live in src/types/"; probe deleted |
| No `any` | grep of the 10 new `.ts` files | none |
| Image build | `docker build -f backend/Dockerfile .` from the repository root, builder `node:26.10.0-alpine` (pinned digest) | exit 0. `swagger:generate` under tsx; `build:dist` "9 TypeScript files compiled" (TypeScript 7 on alpine); pkg `node26-linux-x64` |
| Container boot | the image on a disposable network with `pgvector/pgvector:pg18`, `redis:8.6-alpine`, `rabbitmq:3.13-management-alpine` (CI's digests), CI's boot env and random secrets | `GET /health` **200 `{"status":"ok"}` after 5 s**; 63 migrations; "Server running on port 3000"; PLATFORM tenant row `00000000-0000-4000-8000-000000000001` seeded by migration 0034 from the converted `platformTenant`; `enum_audit_logs_action` = the eight `AUDIT_ACTIONS` |
| Assets in the container | `ls` inside it | `/app/src/templates` (4 templates), `/app/swagger.json`, `/app/docs`, `/app/public` present |
| Clean-up | `docker rm -f` the 4 containers, `docker network rm`, `docker rmi callib-p9-check:local` | done |
| Full suite, before the `src/types` step | `npm run test:coverage -- --ci --forceExit` | 642 passed / 24 skipped suites (666); 12,808 passed / 155 skipped tests; 100% on all four measures; `packaged.util.ts` 100/100/100/100; 173 s |
| Full suite, final tree | same, after `npm run typecheck` (exit 0) | **642 passed / 24 skipped suites (666); 12,808 passed / 155 skipped tests; 100% statements, branches, functions and lines**; 227 s |

## Findings

- **The committed image did not build** until `build:dist` ran before pkg (found by ADR-076's build; fixed there).
- **`turbo run typecheck` does not run at all at the root** — "Missing `packageManager` field". `make typecheck` no longer depends on it. The root `build`, `lint`, `test` scripts go through turbo too and are presumably broken the same way — not checked here, left open.
- **ESLint matched no `.ts` file** before this change, so every conversion would have left the lint gate unnoticed.
- **The lint ratchet was already red** on the shared tree: 1,051 errors against a baseline of 950 (`node scripts/ci/eslint-ratchet.js`), from in-flight changes elsewhere. The nine originals had 0 lint errors, so the conversions do not move it.
- **`activityLog.a14.stdout.test.js` spawns plain `node`** on source; it blocks converting `storagePath.util` and `activityLog.middleware` until it launches its child with `--import tsx` (P9-05a).
- **The coordinator cited an open question "Q-29"** for the types placement. No Q-29 exists in the repository; ADR-087 records the placement as decided.
- **Docs that still show `node src/…` commands:** `docs/DEVOPS/01-CI-CD.md`, `docs/SECURITY/03-AUTHENTICATION-SECURITY.md`, `docs/STORAGE/04-TENANT-STORAGE.md`, `TASKS/AUDIT-2026-09-INFRA.md`, `TASKS/AUDIT-2026-09-REMEDIATION.md`. Not edited here.
- `docker image prune -f` was run after removing the image; it removes dangling images only.

## Not done

- **P9-00** baseline, hence P9-01b's last item and every "baseline still passes" check.
- **P9-01b**'s staging `/health` with its dependency block.
- **P9-02**: `backend/.eslintrc.js` deletion, the global-`ignores` fix, one Prettier config.
- **P9-03**: suite duration before/after was not measured against a pre-change run.
- **P9-04** (the ratchet script) — the board orders it before Stage B; the owner's instruction put the first conversions first.
- **P9-08**: 8 of 16 `constants/` files remain; `ROLE_LEVELS` compile-time check not started.

## Final coverage run

On the final tree (after `src/types/`, the lint guard and the `nodemon` removal): `npm run typecheck` exit 0, then `npm run test:coverage -- --ci --forceExit` exit 0 — 642 of 666 suites passed (24 skipped), 12,808 of 12,963 tests passed (155 skipped), **All files 100 / 100 / 100 / 100**, `packaged.util.ts` 100 / 100 / 100 / 100, 226.6 s. The tree was shared with the Phase 8 agent during the run.
