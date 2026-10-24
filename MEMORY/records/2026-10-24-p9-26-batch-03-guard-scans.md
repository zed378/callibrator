# P9-26 batch 3: rawSqlTenantPredicate.d05, associationForeignKeys.a148, includeRequired.d12 — .js to .ts, no assertion changed

**Date:** 2026-10-24 · **Card:** P9-26 · **Status:** DONE (batch 3) · **Spec refs:** ADR-087 Amendment 1 (ratchet), ADR-109 §5 (P9-26 rules)

## Hook

P9-26 converts a `.js` test when someone already edits it. These three guard/scanner suites were touched by recent work (the upstream-import CROSS_TENANT entries, the catalogue/actor UNCHANGED entries, the 89-model brand count). The conversion changes imports and types only: same case names, same count, same pass/fail.

## What changed

| | |
|---|---|
| `backend/src/tests/utils/rawSqlTenantPredicate.d05.test.js` → `.test.ts` | `require` → `import`; `CROSS_TENANT` typed `Readonly<Record<string, string>>`; `ModelLike`/`ModelFactory`/`Statement` interfaces; `Object.hasOwn` → `hasOwnProperty.call` (lib ES2025); 2-space indent via `eslint --fix` |
| `backend/src/tests/models/associationForeignKeys.a148.test.js` → `.test.ts` | `require` → default `import` for the three `export =` migrations (0037, 0105, 0030); `ModelLike`/`AssociationLike`/`Target` interfaces; `sequelize` cast to `Sequelize`, `queryGenerator.attributesToSQL` + `normalizeAttribute` via narrow casts (internal APIs, no public types) |
| `backend/src/tests/models/includeRequired.d12.test.js` → `.test.ts` | `require` → `import` + `jest.requireActual<typeof …>`; `TENANT` via `toTenantId` (the `TenantId` brand the services require); `espree` via `EspreeModule` interface; the AST visitor rewritten on `isNode`/`childNode`/`childString` guards with a `lineOf` that reads `loc.start.line` without requiring a `type` on `loc` (the shape that broke the bite test on the first run); `o.line` via `String()` in the template |
| ratchet | floor 695 → 690: the 3 batch-3 files plus batch 1–2's 2 files, whose `.ts` landed in an earlier commit without the floor rewrite |

No assertion changed: d05 7 cases, a148 89 + 1 + 180 + 3 + 1 + 1 + 150 + 1 cases, d12 19 + 2 + 3 cases — 788 total, same names, same expectations.

## Tests

- `rawSqlTenantPredicate.d05.test.ts`: 7/7 — sanity, readability, the tenant-predicate rule, the helper rule, the INSERT rule, the tripwire.
- `associationForeignKeys.a148.test.ts`: full A-148/A-149 matrix green (89 models, 180+ associations, 150+ foreign keys).
- `includeRequired.d12.test.ts`: 24/24 — behaviour, brand, and the source rule (the bite test failed once mid-conversion on `lineOf` returning 0, fixed, green).
- `npx eslint` (the three files, `--fix`): clean.
- `npm run typecheck`: clean.
- Baseline before: the three `.js` files 788/788; after: the three `.ts` files 788/788.

- **Not run:** the full suite — three test files converted, proved by their own suites.

## Definition of Done (P9-26 rules)

- [x] same case names, same count, same pass/fail
- [x] the ratchet floor lowered in the same change (the `.js` files deleted)
- [x] no new `.js` (the new files are `.ts`)

## Files

- `backend/src/tests/utils/rawSqlTenantPredicate.d05.test.ts` (new), `.test.js` (deleted)
- `backend/src/tests/models/associationForeignKeys.a148.test.ts` (new), `.test.js` (deleted)
- `backend/src/tests/models/includeRequired.d12.test.ts` (new), `.test.js` (deleted)
- `backend/.ts-ratchet.json` (floor 695 → 690)
- This record
