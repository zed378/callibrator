# P9-26 batch 1: systemActors.a124 — .js to .ts, no assertion changed

**Date:** 2026-10-24 · **Card:** P9-26 · **Status:** DONE (batch 1 of the opportunistic conversions) · **Spec refs:** ADR-087 Amendment 1 (ratchet), ADR-109 §5 (P9-26 rules)

## Hook

P9-26 converts a `.js` test when someone already edits it — never as a drive-by that also changes
assertions. This file was touched by the recent work (it names every new system actor, including
the upstream import's). The conversion changes imports and types only: same case names, same
count, same pass/fail.

## What changed

| | |
|---|---|
| `backend/src/tests/constants/systemActors.a124.test.js` → `.test.ts` | `require` → `import`; `defineAuditLog(sequelize, DataTypes)` → `defineAuditLog(sequelize)` (the `.ts` model's signature); `DataType` casts through `unknown`; `matchAll` destructuring typed; 2-space indent via `eslint --fix` |
| ratchet | one fewer `.js` in the counted set (694 → 693) |

No assertion changed: 4 cases, same names, same expectations.

## Tests

- `systemActors.a124.test.ts`: 4/4 — actor types, model ENUM = migration = constant, closed frozen list, no invented actor.
- `npx eslint`: clean.

- **Not run:** the full suite — one test file converted, proved by its own suite.

## Definition of Done (P9-26 rules)

- [x] same case names, same count, same pass/fail
- [x] the ratchet floor lowered in the same change (the `.js` deleted)
- [x] no new `.js` (the new file is `.ts`)

## Files

- `backend/src/tests/constants/systemActors.a124.test.ts` (new), `.test.js` (deleted)
- This record
