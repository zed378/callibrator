# 2026-11-04 — The backend lint gate is back at zero (ADR-092 Amendment 1)

**Task:** the backend lint ratchet, red since P9-26 batches 03 and 04 (2026-11-02 record) · **ADR:** ADR-092 Amendment 1 · **Branch:** `fix/backend-lint`, from `main` at `3ca5ec89`

## What was wrong

On `3ca5ec89`, `node scripts/ci/eslint-ratchet.js` found **78,365 errors against baseline 0**:
- Every error was in one of **335 test files** that P9-26 converted from `.js` to `.ts`. There were none in `src/` proper.
- The conversion had moved those files from the base rules they ran under as `.js` to the `**/*.ts` blocks (`strictTypeChecked` + `stylisticTypeChecked`).
- 61,289 errors came from type-aware rules: `no-unsafe-member-access` 26,435, `no-unsafe-call` 17,256, `no-unsafe-assignment` 10,952, and others.

## What changed

- **`backend/.eslint-legacy-tests.json`** is new: the 335 paths, a frozen list that only shrinks.
- **`backend/eslint.config.js`**: the files on the list get `disableTypeChecked`, and the TypeScript-only rules a `.js` test never ran under are off for them. The rules and the reasoning are in ADR-092 Am. 1.
  - Those files are also excluded from the `process.env` restriction.
  - `@typescript-eslint/no-unused-vars` takes the base rule's `^_` options for them.
  - Every base rule still applies.
- **235 test files reformatted:**
  - ESLint's fixers rewrote 11,448 errors.
  - The nine `no-cond-assign` in `liveContract.smoke.test.ts` got their double parentheses back.
  - 145 dead `eslint-disable` directives were removed.
- No assertion, test name or test count changed.

## Evidence

- **AST identity:** 235 of 235 changed files are AST-identical to `HEAD`. The method: `ts.transpileModule` erases types, espree parses the result, and positions, `raw`, comments, one-statement `if`/loop blocks and template `cooked` values are normalised. The comparer was probed with one changed literal in `jwt.test.ts` and flagged it (234 of 235).
- **`node scripts/ci/eslint-ratchet.js`:** "backend eslint: 0 error(s), 0 warning(s); baseline 0." The baseline is unchanged at 0.
- **Typecheck and unit suite:** see § Gates.

## Gates

- **`npm run typecheck`:** exit 0.
- **`node scripts/ci/eslint-ratchet.js`:** 0 errors, 0 warnings, baseline 0.
- **`npm test -- --ci`** (whole unit tree, Node 26.10.0, on the branch): **1,070 of 1,077 suites passed; 18,136 of 18,149 tests passed, 13 failed.** None of the seven failing suites is caused by this change, which touches only test files, the ESLint config and docs:
  - **`roles.audit.a41`, `tenantLifecycle.w01`, `prePushHook.a19` and `auditLedger.fixture`** also fail on `main` (the P21-15 and 2026-11-02 records).
  - **`clamAv.service`** needs a running ClamAV (`CLAMAV_LIVE_PORT`); none was started.
  - **`auditCoverage.p611`** reports two new unaudited source entry points, `services/mfa.service#checkCode` and `services/workflow.service#deleteWorkflow`. Neither file is in this diff, so this is a defect on `main`.
  - **`pkgBasePin.a325`** reads `backend/Dockerfile`, changed by audit Wave 1 (INF-01). The file is not in this diff, so this is also a defect on `main`.
- **A first run of the same suite was void:** 433 suites failed to load because the worktree had no `backend/.env`.

## Not done

- The 335 files are not type-linted. Shrinking the list file by file is the remaining work, and nobody has been assigned to it.
