# P9-26 batch 10: appError, validateUuid, certificateNumber.d40 — .js to .ts, no assertion changed

**Date:** 2026-10-24 · **Card:** P9-26 · **Status:** DONE (batch 10) · **Spec refs:** ADR-087 Amendment 1 (ratchet), ADR-109 §5 (P9-26 rules)

## Hook

P9-26 converts a `.js` test when someone already edits it. These three suites were still `.js` and their modules are already `.ts` (P9-09, P9-19, P9-10): the error-class helper, the UUID path-param middleware, and the D-40 certificate-number generator. No database, no live stack, no fixtures. Conversion changes imports and types only: same case names, same count, same pass/fail.

## What changed

| | |
|---|---|
| `backend/src/tests/utils/appError.test.js` → `.test.ts` | `require` → `import` for the ten error exports; `process.env` reads through `environment()` (`config/env.ts`, the lint-mandated path — `no-restricted-properties` bans raw `process.env` outside `src/config/`); no other types needed (all helpers fully typed) |
| `backend/src/tests/middlewares/validateUuid.test.js` → `.test.ts` | `require` → `import` for `validateUuid` + type-only express imports; `FakeReq`/`FakeRes` interfaces (`params` record, `jest.Mock` status/json); `Handler` type with an explicit `unknown` return; `run()` casts through `unknown`; `expect.stringContaining(...) as unknown` (the `no-unsafe-assignment` pattern other `.ts` suites use); `jest.mock("uuid")` factory unchanged |
| `backend/src/tests/models/certificateNumber.d40.test.js` → `.test.ts` | `require` → `import` for sequelize + `defineCertificate` (default import, `export =`); `findOne` as `jest.fn(() => Promise.resolve(...))` (typed, no `async` wrapper); the `models` double cast through `Parameters<typeof Certificate.generateCertificateNumber>[1]` (the `CertificateModels` interface is module-local, so the cast names the parameter type instead of redeclaring it) |
| ratchet | floor 673 → 670 (the 3 batch-10 files; the `.js` files deleted) |

No assertion changed: appError 25 cases, validateUuid 16 cases, certificateNumber.d40 2 cases — 43 total, same names, same expectations. Baseline before: the three `.js` files 43/43; after: the three `.ts` files 43/43. One lint error mid-conversion, type-system only, fixed without touching an assertion: `no-unsafe-assignment` on two `expect.stringContaining` values inside `objectContaining` (fixed with `as unknown`, the pattern `upstreamSqlImport.service.p2406` and `pathParams.a273` use).

## Tests

- `appError.test.ts`: 25/25 — constructor/status/operational/details/stack, toJSON with/without details by environment, all eight subclasses, formatErrors single/multiple/empty/null/undefined.
- `validateUuid.test.ts`: 16/16 — valid/invalid/undefined/empty, multi-param, second-param failure, 5 × P6-02 pass-through shapes, 5 × refusal shapes.
- `certificateNumber.d40.test.ts`: 2/2 — cross-tenant highest-number lookup with `paranoid: false` + `skipTenantScope: true`, 0001 start on empty prefix.
- `npx eslint` (the three files, `--fix`): clean.
- `npm run typecheck`: clean.

- **Not run:** the full suite — three test files converted, proved by their own suites (the 100% coverage gate fails on a scoped run by design; the suites themselves are 43/43 green).

## Definition of Done (P9-26 rules)

- [x] same case names, same count, same pass/fail
- [x] the ratchet floor lowered in the same change (the `.js` files deleted)
- [x] no new `.js` (the new files are `.ts`)

## Files

- `backend/src/tests/utils/appError.test.ts` (new), `.test.js` (deleted)
- `backend/src/tests/middlewares/validateUuid.test.ts` (new), `.test.js` (deleted)
- `backend/src/tests/models/certificateNumber.d40.test.ts` (new), `.test.js` (deleted)
- `backend/.ts-ratchet.json` (floor 673 → 670)
- This record
