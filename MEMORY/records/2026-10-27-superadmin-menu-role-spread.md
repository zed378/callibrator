# The super admin's sidebar showed only its seeded grants: a spread lost the role's name

**Date:** 2026-10-27 · **Kind:** defect (found on the fresh VM deploy of `34ad0c4`) · **Spec refs:** ADR-102 (the sidebar shows what the API serves)

## Symptom

On the freshly deployed VM, the super admin's sidebar was missing a block of pages:

- Users, Roles, Tenants, Menu Groups, Access Requests and both Upstream imports.
- Kanban, Raise Ticket, Billing, Vendors, API Keys, Webhooks, Attachments, Storage and Audit.
- Permissions, User Permissions, Sessions and SCIM.

The pages shown were exactly those with a seeded `SUPERADMIN` grant, or one inherited one level
down, after their page gates. The API had answered `get-assignments` with 200. The menu was
complete for a plain role; the super admin was not being recognised.

## Cause

`menuGroup.service#getRoleMenuAssignments` built the requester's principal as
`role: { ...requester.role, id: roleId }`. `requester` is `req.user`, which
auth.middleware loads with `Users.findByPk(…, { include: Role })`, so `role` is a **Sequelize
instance**. Sequelize defines attribute accessors on the model's prototype, so a spread copies
`dataValues` and friends but not `name`. `isSuperAdmin(principal)` read `undefined` and the super
admin fell through to the role matrix.

The ADR-102 suite passed throughout. Its requester is a plain object, which a spread copies
whole: a mock proved the client, not the contract.

The same loss affected every role's own menu wherever the name matters: the bound-facility
ceiling (`BOUND_MENU_CEILING[role.name]`) and `rbac` page gates by name. `getMyPermissions`
passes `requester.role` through unspread and was not affected.

## Fix

[`backend/src/services/menuGroup.service.ts`](../../backend/src/services/menuGroup.service.ts)
now reads the role's fields one by one: `{ id, name: requester.role?.name ?? null, roleLevel:
requester.role?.roleLevel ?? null }`.

## Tests

| Suite | Result |
|---|---|
| `services/menuEffectiveAccess.adr102`, new case "SUPERADMIN through req.user as auth.middleware builds it" | The role is a class instance whose attributes are prototype getters, as Sequelize's are. **Fail-before:** 19 pages missing (`- Expected 19, + Received 0`). After: equal to the plain-object super-admin menu, with Users, Roles, Tenants, Sessions and SCIM present |
| `services/menuGroup.service.test.js` | One expectation updated for the principal's shape (`roleLevel: null` now present); no behaviour change |
| Menu suites: adr102, bound, menuGroup service and controller, `readGates.p604`, `rolesGlobal.d16` | 6 suites, 363 tests |
| Coverage of `menuGroup.service.ts` from its suites | The changed lines are covered. The uncovered lines (164–188, 531, 628–631) are unrelated, and other suites cover them |
| `npm run typecheck` | 0 errors |
| eslint | clean |

## Side note

During this work `node_modules/jest/bin/jest.js` vanished from the shared checkout, at 17:13
with no install running. It was restored from `npm pack jest@30.5.2`, the same version as the
lockfile. The cause is unknown.
