# No skipped test: the frontend and contracts workspaces, the `idb.ts` blocked-upgrade test, and the repository-wide guard

**Date:** 2026-10-10 · **Rule:** owner, 2026-10-10: no test may be skipped · **Agent:** A4 of 4. A1 (backend live suites), A2 (backend tool/OS unit tests) and A3 (backend e2e, `automate/`) removed the backend skips in parallel. · **Spec refs:** `docs/ENGINEERING/09-TESTING-CONVENTIONS.md` rule 7 (guards) and the new rule 11 · [P22-10b record](./2026-10-10-p22-10b-field-web-platform.md) § Not done

## Skipped before and after

| Workspace | Before | After |
|---|---|---|
| frontend (`npx jest --ci --coverage`) | 372 suites, 3,895 tests, **0 skipped**, 0 failed | **373 suites, 3,911 tests, 0 skipped, 0 failed** |
| packages/contracts (`npm test -- --ci`) | 66 suites, 1,401 tests, **0 skipped** | **66 suites, 1,401 tests, 0 skipped, 0 failed**, 100 / 100 / 100 / 100 |

Neither workspace had a static or conditional skip; the guard's scan of `frontend/src` and `packages/contracts` agrees. The frontend was missing something else: the `idb.ts` test P22-10b removed instead of fixing.

## `idb.ts`: the blocked-upgrade test, back and deterministic

New: `frontend/src/field/platform/__tests__/idb.test.ts`, 16 tests over `fake-indexeddb`. No timer anywhere.

- **Blocked upgrade:** the test opens v1 and keeps that connection open with an `onversionchange` that records the event and does not close. It then opens v2. The test asserts that the request rejects with "IndexedDB open blocked by another tab", that the recorded event is `{ oldVersion: 1, newVersion: 2 }`, and that no upgrade ran. Then it closes the old connection, lets the queued upgrade finish, and asserts that a reopen sees version 2, so nothing is left pending. Run 3 times in a row: 16/16 each time.
- **Blocked delete:** an open connection hears `versionchange` with `newVersion: null`, and `deleteDb` resolves.
- **Real failure paths:** a `VersionError` (opening below the stored version); a work that throws after writing (abort, nothing written); a `ConstraintError` inside a transaction whose work swallows the request error.
- **The `?? new Error(...)` fallbacks:** a real IndexedDB never reports these (an error event with `error === null`, or a transaction that completes after the work failed when `abort()` throws). Request and transaction doubles cover them, and the test fires their handlers itself.

**`idb.ts` coverage: 100 / 100 / 100 / 100** (it was at 30 % branch coverage).

**Finding (behaviour unchanged, now pinned):** a request that fails inside `tx` bubbles to the transaction's `onerror` before the transaction's `error` is set. `tx` therefore rejects with the generic "IndexedDB transaction failed", and the `ConstraintError` is lost. The test asserts what the code does. Keeping the request's error would be a small change to `idb.ts`, left to P22-10c.

## Kanban realtime flake: fixed, not retried

The first full run after the change failed 1 test: `useBoard.realtime.test.ts` › "re-joins the board room after a reconnect". Its first `waitFor` (connect plus join on a real Socket.IO server) used the 5 s default, and three other agents' jest runs had the machine loaded. P22-03's record shows the same flake. The fix:

- the two initial joins now wait up to 8 s, the same ceiling the test already gives the reconnect;
- the two tests' own ceilings go from 15 s to 30 s, the config's `testTimeout`.

No assertion changed. The suite passed alone 3/3 (twice in a row after the change), and the next full run passed.

## The guard: `backend/src/tests/guards/noSkippedTests.guard.test.ts`

It runs in the backend unit job (`npm test` / `test:coverage`).

- **Scope:** it **parses** every `.js/.jsx/.ts/.tsx/.mjs/.cjs/.mts/.cts` file (not `.d.ts`; it skips `node_modules`, `dist`, `coverage`, `.next`, `build`, `out`) under `backend/src`, `backend/__tests__`, `frontend/src`, `packages/contracts` and `automate`. It uses the TypeScript compiler API, so a pattern in a comment or a string does not count, and a pattern split across lines does.
- **What it flags:**
  - `.skip`, `.todo`, `.fixme` or `.skipIf` read off `describe`, `it` or `test` at any depth (`it.skip.each`, `test.describe.skip`, `test.concurrent.skip`), whether called or merely referenced. That covers conditional selection: `cond ? describe : describe.skip`, `? it.skip : it`, `(cond ? it : it.skip)(`;
  - `.skipIf` read off anything;
  - `xit`, `xdescribe` and `xtest`;
  - the element form `describe["skip"]`.
- **Self-test, planted samples:** 23 patterns, each flagged in both `.ts` and `.js`, plus a `.tsx` case with JSX and a line-number check. Seven look-alikes are not flagged: a comment, a string, `query.skip(10)`, a `todo` property, an `xit` property, `it.each`, and a plain suite. Every root must contain files, so an empty scan is not a pass.
- **Bite proof (rule 7):** a scratch `frontend/src/__noSkipPlant.ts` holding `process.env.X ? describe : describe.skip`. The guard failed on `"frontend/src/__noSkipPlant.ts:1  describe.skip"` (1 failed, 33 passed). The plant was then removed.
- **Limits, stated in the file:** the guard does not see a test that returns early from its own body, a `testPathIgnorePatterns` entry, or a jest global bound to another name.

**Hits by file:**
- **First run (2026-10-10, while A1–A3 were working): 8 hits in 6 files.**
  - `backend/src/tests/guards/prePushHook.a19.test.js:165, :177`
  - `backend/src/tests/services/clamAv.service.test.js:578`
  - `backend/src/tests/services/storage.s3.u09.live.test.ts:69, :70`
  - `backend/src/tests/services/upstreamSqlImport.p2406.live.test.ts:490`
  - `backend/src/tests/utils/bootstrapSecret.p1016.test.ts:114`
  - `backend/src/tests/utils/schedulerSwitch.w02.test.js:155`
- **At the end of this card: 0 hits.** The guard passes 34/34.

## Gates

| Gate | Result |
|---|---|
| frontend `npx jest --ci --coverage` | 373 suites, 3,911 tests passed, 0 skipped; **94.94 / 86.88 / 91.42 / 95.56** (gate 90 / 81 / 86 / 91) |
| contracts `npm test -- --ci` | 66 suites, 1,401 tests passed, 0 skipped; 100 % on all four |
| guard `noSkippedTests.guard.test.ts` | 34 / 34 |
| `npx eslint` on the three changed test files | 0 errors, 0 warnings |
| frontend `npm run typecheck` | 0 errors |
| backend `npm run typecheck` | 0 errors in this card's file. At the time it reported TS6133 (`env` unused) in eight `*.live.test.ts` files, all being edited by A1 |
| backend `npm run ratchet` | 695 `.js`, at the floor (the guard is `.ts`) |
