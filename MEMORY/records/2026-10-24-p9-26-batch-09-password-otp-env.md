# P9-26 batch 9: password, otp, env — .js to .ts, no assertion changed

**Date:** 2026-10-24 · **Card:** P9-26 · **Status:** DONE (batch 9) · **Spec refs:** ADR-087 Amendment 1 (ratchet), ADR-109 §5 (P9-26 rules)

## Hook

P9-26 converts a `.js` test when someone already edits it. These three util suites were still `.js` and their modules are already `.ts` (P9-09): the bcrypt password helper, the OTP generator/hasher/verifier, and the dotenv side-effect loader. No database, no live stack, no fixtures. Conversion changes imports and types only: same case names, same count, same pass/fail.

## What changed

| | |
|---|---|
| `backend/src/tests/utils/password.test.js` → `.test.ts` | `require` → `import` for `password.util`; no types needed (both helpers fully typed `(string) => Promise<...>`); one local renamed (`plainPassword` → `longPassword` in the long-password case, the only shadowing the old file had) |
| `backend/src/tests/utils/otp.test.js` → `.test.ts` | `require` → `import` for `otp.util`; no types needed (all three helpers fully typed); `verifyOTP("123456", null)` passes as-is — the parameter is `string \| null \| undefined` |
| `backend/src/tests/utils/env.test.js` → `.test.ts` | `require` → `import` for path + `import type * as dotenvTypes` for the dotenv cast (the `typeof import("dotenv")` inline form trips `consistent-type-imports`); `require` kept with `no-require-imports` disables for the side-effect module and the `resetModules` re-reads (same pattern as `packaged.test.ts`/`appPath.test.ts`); `mockReturnValue({})` (the `.js` used `mockImplementation(() => {})`) |
| ratchet | floor 676 → 673 (the 3 batch-9 files; the `.js` files deleted) |

No assertion changed: password 7 cases, otp 8 cases, env 5 cases — 20 total, same names, same expectations. Baseline before: the three `.js` files 20/20; after: the three `.ts` files 20/20. One lint error mid-conversion, type-system only, fixed without touching an assertion: `consistent-type-imports` on the inline `typeof import("dotenv")`.

## Tests

- `password.test.ts`: 7/7 — hash defined/string/different, empty, long; compare true/false/empty.
- `otp.test.ts`: 8/8 — 6-digit default, custom length, numeric; hash defined/consistent; verify true/false/null.
- `env.test.ts`: 5/5 — loads without throw, module defined, `process.pkg` undefined in dev, absolute path, packaged execPath `.env` with the dotenv spy.
- `npx eslint` (the three files, `--fix`): clean.
- `npm run typecheck`: clean.

- **Not run:** the full suite — three test files converted, proved by their own suites (the 100% coverage gate fails on a scoped run by design; the suites themselves are 20/20 green).

## Definition of Done (P9-26 rules)

- [x] same case names, same count, same pass/fail
- [x] the ratchet floor lowered in the same change (the `.js` files deleted)
- [x] no new `.js` (the new files are `.ts`)

## Files

- `backend/src/tests/utils/password.test.ts` (new), `.test.js` (deleted)
- `backend/src/tests/utils/otp.test.ts` (new), `.test.js` (deleted)
- `backend/src/tests/utils/env.test.ts` (new), `.test.js` (deleted)
- `backend/.ts-ratchet.json` (floor 676 → 673)
- This record
