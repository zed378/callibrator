# 2026-09-29 — A-285 … A-294: role and menu fields that silently did nothing, fixed

**Findings:** A-285 (medium), A-286, A-287 (low), exposed by the TypeScript compiler in the P9-12 conversion (ADR-087 Amendment 13); and A-294 (medium), found while fixing them. **This is its own change, separate from the conversion.**

## What was wrong

| Id | Defect | Effect |
|---|---|---|
| A-285 | `roles.service` read `role.is_system`, but the attribute is `isSystem` | `DELETE /roles/:id` **destroyed** a system role instead of deactivating it; `updateRole`'s "System roles cannot be deleted" guard never fired |
| A-286 | `createRole` wrote `is_system` | Sequelize dropped it: a system role could not be created, even internally |
| A-287 | `createMenu` / `updateMenu` wrote `sort_order` / `is_active` | Both were dropped: a menu's order and active flag could not be set through `/roles/menus`, and CREATE_MENU audited `is_active` as absent |
| A-294 | `roles.controller#createRole` passed only `name` and `description` | The validated `roleLevel` (1–8) was dropped, so every API-created role had level 1 and failed every privileged `rbac()` gate |

The unit suites passed throughout. They mocked rows as plain objects carrying `is_system: true` and asserted `is_system` / `sort_order` in the written values, so they encoded the bug.

## The fix

- `src/services/roles.service.ts`:
  - `role.isSystem` is read in both guards.
  - `createRole` writes `isSystem`.
  - The menus write `sortOrder` / `isActive`.
  - CREATE_MENU audits the stored `isActive`, under its existing key `is_active`.
  - Each `@ts-expect-error` the conversion had placed is gone. In their place, the create values are typed through a variable, as the model's creation type requires.
- `src/controllers/roles.controller.js`: `createRole` passes `roleLevel`.
- **Audit shape change:** an UPDATE_MENU row now records attribute names (`sortOrder`, `isActive`) in `before` / `after`, as it already did for `parentId` (A-148).

## Evidence

- **New regression test:** `src/tests/services/roles.attributes.a285.test.ts`, 10 tests. It runs on the REAL Role / MenuGroup / AuditLog models, the tenant hooks and the real roles router over `fixtures/memoryDb`; only Redis is doubled.
  - **Before the fix: 7 failed and 3 passed.** The 3 passes are the controls: a non-system role is destroyed; no `is_system` gives false; no `roleLevel` gives 1. The log is in scratch `p9/a285-before.log`.
  - **After the fix: 10 of 10 pass.**
- **Test updates, all reading the real attribute where the tests had encoded the bug:**
  - `roles.service.test.js`: 17 lines, either mock rows `is_system` → `isSystem`, or expectations `is_system` / `sort_order` / `is_active` → the attributes. The `where` filters on the `is_system` / `is_active` COLUMNS are unchanged, since they are correct.
  - `roles.audit.a41.test.js`: 2 lines.
  - `roles.menuAudit.a165.test.js`: 3 lines, for the audit shape.
- **Every roles-related suite** (43 suites, with `audit.platform.a125` excluded because it was already red from another agent's change) passes, with `roles.service.ts` and `roles.controller.js` at 100 / 100 / 100 / 100.
- **Typecheck:** clean. **ESLint:** 0 on the three changed source and test files.
