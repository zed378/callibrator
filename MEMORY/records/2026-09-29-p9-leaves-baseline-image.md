# 2026-09-29 — Phase 9: the released leaves, the last constant, `ApiResponse<T>`, and the baseline against a converted image

**ADR:** [ADR-087 Amendment 5](../DECISIONS.md) · **Cards:** P9-01b done, P9-08 done, P9-09 advanced, P9-05 advanced · **Tree:** HEAD `35ebd76` plus the working tree. I was the only agent running. Continues [`2026-09-28-p9-guard-sweep-tenantscope.md`](./2026-09-28-p9-guard-sweep-tenantscope.md).

## What changed

| Area | Files |
|---|---|
| Converted (`.js` removed) | `src/utils/otp.util.ts`, `ssrf.util.ts`, `fileValidation.util.ts`, `response.util.ts`, `controllerWrapper.util.ts`, `upload.util.ts`; `src/constants/routeGateExemptions.ts` |
| Shared types | `src/types/apiResponse.ts` (`ApiResponse<T>`); `src/types/express.d.ts` (+ `apiKeyAuthorized`, `uploadFolder`, `allowedMimes`, `allowedExtensions`, `uploadFilename`, and `isApiKey` on the principal) |
| Tooling | `backend/eslint.config.js`: `non-nullable-type-assertion-style` off (it demands the `!` that `no-non-null-assertion` bans); two directives it had needed removed (circuitBreaker, tenantScope). `backend/jest.config.js`: the phantom `src/constants/**/*.js` coverage pattern removed (`coverageScope.p614`) |
| New devDependency | `@types/multer` ^2.3.0 (backend) |
| Docs | ADR-087 Amendment 5; the P9-01b, P9-05, P9-08 and P9-09 cards; `TASKS/PROGRESS.md`; the standards banner; `CLAUDE.md` |

The identity baseline for every converted file was the **working-copy** `.js`, not `HEAD`: helper 1's lint edits were in them. Each was snapshotted to scratch `p9/wc/` and confirmed unchanged (`cmp`) at the moment it was removed.

## Evidence

**Lint and type checks**

| Check | Result |
|---|---|
| `npm run typecheck` (TypeScript 7) | exit 0 |
| `npx eslint` on `src/utils`, `src/constants`, `src/types`, the two middlewares and `eslint.config.js` | 0 errors |
| `node scripts/ci/eslint-ratchet.js` | 0 errors, baseline 0 |

**Identity checks**

| Module | Result |
|---|---|
| otp, ssrf, fileValidation, response, controllerWrapper | **695 checks identical** (`p9/compare7.js`) |
| upload | **41 checks identical** (`p9/compare8.js`). 14 real multipart requests went through the real multer; the quarantine directory contents were compared too |
| routeGateExemptions | exports, deep values, freeze state and per-file key order (24 files), and `publicRoutes()` (41), all identical |

**Tests and ratchet**

| Check | Result |
|---|---|
| Own suites | 11 suites, 273 tests, all converted files at 100% apart from lines covered by other suites (controllerWrapper's `Retry-After`, a260; upload's public guard, s01) |
| `npm run ratchet` | 1179 → **1172**, at the floor |
| Full run, first try | 1 failure: `coverageScope.p614` › "every collectCoverageFrom pattern … matches at least one file". `src/constants/**/*.js` now matched nothing. The pattern was removed |
| **Full run at the boundary** | `npm run test:coverage -- --ci --forceExit` exit 0. 698 of 722 suites passed (24 skipped), 13,052 tests (155 skipped), **100/100/100/100** |

**The P9-00 baseline against a converted image (P9-01b's last item)**

| Step | Result |
|---|---|
| Stack | Helper 1's P9-00 stack (compose files identical to `deploy/compose` except for the build context), pointed at the working tree. Project `callib-p9e2e`, backend on `127.0.0.1:25000` |
| Image | `backend/Dockerfile`, Node 26.10.0-alpine: "build-dist: 438 JavaScript files copied, 44 TypeScript files compiled" |
| Boot | `/health` 200; `[schema-verify] OK: 72 tables, 867 columns and 8 control objects match the models`; the application role in effect. Templates, `swagger.json`, `docs` and `public` present |
| Seed | `seeding` 200, `seed-demo` 200 |
| Run A (12:11:43 +07:00) | 53 of 54 suites passed (1 skipped), 392 tests passed (5 skipped), 0 failed, 19.3 s |
| Run B (12:13:23) | the same, 17.3 s |
| Run C (12:15:38, JSON report) | the same 53 specs with **the same per-spec pass counts as `MEMORY/records/P9-00.md`**, from `auth` 32 to `workflows` 5; `liveContract.smoke` skipped (opt-in) |
| Access log (A and B) | 1,042 requests: 554 × 200, 138 × 400, 116 × 401, 110 × 404, 104 × 201, 10 × 409, 4 × 403, 2 × 422, 2 × 204, **0 × 429**, and 2 × 500, both `POST /api/v1/ai/query` (no AI provider; the same as the baseline) |
| Teardown | `down -v`, image `callib-p9conv-backend:p9conv` removed, the stack's `.env` deleted |

This image build and boot is also the end-of-round Docker proof.

## Next

- `utils/authorizationWiring`, `jobContext`, `publicBaseUrl`, `schedulerSwitch`: every module they import is TypeScript now. `jobContext` stamps `isSystemTask: true`, so it converts under the same isolation gates as `tenantContext`.
- `utils/migrationLock`: ADR-086 kept it as `.js` because its live test spawned plain `node`; that test now launches with `--import tsx` (ADR-087 Amendment 4), so it can convert, with the live test run against PostgreSQL.
- `jsonShape` + `validators/iot.validator` (the ordering gap before P9-10).
- P9-06 (typed configuration), which retires every `process.env` directive written so far.
