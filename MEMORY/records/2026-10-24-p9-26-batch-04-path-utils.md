# P9-26 batch 4: packaged, appPath — .js to .ts, no assertion changed

**Date:** 2026-10-24 · **Card:** P9-26 · **Status:** DONE (batch 4) · **Spec refs:** ADR-087 Amendment 1 (ratchet), ADR-109 §5 (P9-26 rules)

## Hook

P9-26 converts a `.js` test when someone already edits it. These two path-utility suites sit beside the converted source (`packaged.util.ts`, `appPath.util.ts` — both P9-05a, `export =`) and are small enough to convert without touching an assertion: 6 + 5 cases, no fixtures, no database.

## What changed

| | |
|---|---|
| `backend/src/tests/utils/packaged.test.js` → `.test.ts` | `require` → `require` + type (`{ isPackaged: boolean }`); `global.Bun` via `Record<string, unknown>` casts (the `Bun` global is declared only in the module under test); `load()` typed `boolean`; eslint-disable for `no-require-imports` (re-reads the module under a mutated `process` shape) |
| `backend/src/tests/utils/appPath.test.js` → `.test.ts` | `require` → top-level `require` + `AppPathFn` type (the module is `export =`, so no `import` — ADR-087 Am. 15); packaged case re-reads under `require` with the same disable; 2-space indent via `eslint --fix` |
| ratchet | floor 690 → 688 (the 2 batch-4 files; the `.js` files deleted) |

No assertion changed: packaged 6 cases, appPath 5 cases — 11 total, same names, same expectations.

## Tests

- `packaged.test.ts`: 6/6 — pkg set, plain node, bun launcher, bun binary, windows node.exe, missing execPath.
- `appPath.test.ts`: 5/5 — single segment, multiple segments, no segments, absolute, packaged.
- `npx eslint` (the two files, `--fix`): clean.
- `npm run typecheck`: clean.

- **Not run:** the full suite — two test files converted, proved by their own suites (the 100% coverage gate fails on a scoped run by design; the suites themselves are 11/11 green).

## Definition of Done (P9-26 rules)

- [x] same case names, same count, same pass/fail
- [x] the ratchet floor lowered in the same change (the `.js` files deleted)
- [x] no new `.js` (the new files are `.ts`)

## Files

- `backend/src/tests/utils/packaged.test.ts` (new), `.test.js` (deleted)
- `backend/src/tests/utils/appPath.test.ts` (new), `.test.js` (deleted)
- `backend/.ts-ratchet.json` (floor 690 → 688)
- This record
