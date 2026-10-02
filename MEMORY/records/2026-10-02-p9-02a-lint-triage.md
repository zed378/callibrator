# 2026-10-02 — P9-02a: the lint warnings at zero; `no-unused-vars`, `no-console` and `prefer-arrow-callback` raised to `error`

**ADR:** ADR-087 Amendment 30 · **Card:** P9-02a · **By:** the P9-22 helper, assigned by the coordinator

## Starting point
`npx eslint src` in `backend/` gave:
- **4 errors**: `scripts/seedDemo.ts:33`, `Object.values` of an interface read as `any`;
- **126** `no-unused-vars`, **30** `no-console` and **6** `prefer-arrow-callback` warnings;
- **4** unused `eslint-disable` directives.

Every `no-unused-vars` was in a test file; production source had none.

## What changed

| Item | Resolution |
|---|---|
| `seedDemo.ts` errors | Fixed at the source: `migration.service`'s `DemoCounts` gained an index signature, so `Object.values(result.created)` is `number[]` |
| 126 `no-unused-vars` (tests) | Applied by `scratchpad/p922/fix_unused.py`, one rule per shape and checked against the lint positions:<br>• **positional parameter → `_` prefix**: arity and position are the signature (Express 4-argument error handlers in `fileValidation.test`, mock signatures, `fakeAmqp#nack`);<br>• **name omitted by rest-destructuring → `name: _name`**: removing it would put the key in the rest (`billing.subscriptionOverride.a225`, `tenant.service.coverage`);<br>• **unused name in a destructuring pattern → removed**, with the right-hand side kept;<br>• **unused binding of a call/require/await → the binding removed**, the statement kept;<br>• **pure values → deleted**; eleven were edited by hand (`ROLE_ID`, `start`, `mockWrite`, the write-only `mockArchiverInstance`/`mockWriteStreamInstance` with their assignments, `originalCreateDecipheriv`, `tenantRow`, `mockZipLoadAsync`, `AppError = MockAppError`, `makeEditableUser`; the empty `normalizePermission` pattern became a bare `require`) |
| 6 `prefer-arrow-callback` | `eslint --fix --fix-type suggestion,layout` on the four files (none of the callbacks reads `this`) |
| 4 unused directives | Removed: `attachmentFileSweep.service`, `auth.service`, and `keyRotation.service` ×2. They became unused when the modules they referred to were typed |
| 30 `no-console` | Cross-checked against A-42: **no runtime site**. A reasoned allow-list in `eslint.config.js`:<br>• `src/scripts/**`: operator CLIs; CLAUDE.md says `console.*` only there;<br>• `src/tests/e2e/setup.js`: the live harness's readiness lines;<br>• `src/utils/checkMenu.util.js`: dead, deletion awaits the owner (A-18) |
| Rule levels | `no-unused-vars`, `no-console` and `prefer-arrow-callback` raised from `warn` to `error` |

## Evidence
- `npx eslint src`: **0 errors, 0 warnings**. `node scripts/ci/eslint-ratchet.js`: `0 error(s), 0 warning(s); baseline 0`.
- **The tests prove the edits:** full backend suite, 860 suites passed, 0 failed (14,779 tests). The 8 touched e2e and fixture files pass `node --check` (the live e2e suite was not run).

## DoD
All boxes of P9-02a are ticked except one: the formatting sweep is still waiting to be committed on its own. That is the owner's commit, not this change.
