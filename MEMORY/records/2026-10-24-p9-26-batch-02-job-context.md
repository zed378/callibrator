# P9-26 batch 2: jobContext.w12 — .js to .ts, no assertion changed

**Date:** 2026-10-24 · **Card:** P9-26 · **Status:** DONE (batch 2) · **Spec refs:** ADR-087 Amendment 1 (ratchet), ADR-109 §5 (P9-26 rules)

## Hook

P9-26 converts a `.js` test when someone already edits it. This file was touched by recent work.
The conversion changes imports and types only: same case names, same count, same pass/fail.

## What changed

| | |
|---|---|
| `backend/src/tests/utils/jobContext.w12.test.js` → `.test.ts` | `require` → `import`; `DynamicModel` interface for the `sequelize.define` model; `registerTenantScopeHooks` cast; sync callbacks return `Promise.resolve`; 2-space indent via `eslint --fix` |
| ratchet | one fewer `.js` in the counted set (693 → 692) |

No assertion changed: 12 cases, same names, same expectations.

## Tests

- `jobContext.w12.test.ts`: 12/12 — runForTenant/runAsSystem, closed opt-out list, isolation hooks.
- `npx eslint`: clean.

- **Not run:** the full suite — one test file converted, proved by its own suite.

## Definition of Done (P9-26 rules)

- [x] same case names, same count, same pass/fail
- [x] the ratchet floor lowered in the same change (the `.js` deleted)
- [x] no new `.js` (the new file is `.ts`)

## Files

- `backend/src/tests/utils/jobContext.w12.test.ts` (new), `.test.js` (deleted)
- This record
