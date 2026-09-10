# 03 — RBAC API

Base: `/api/v1/roles`, `/api/v1/menu-groups` (and its alias), `/api/v1/user-permissions`. Module `HDC-RBAC` (3).

The model this implements is in [`../PLAN/03-USER-ROLES.md`](../PLAN/03-USER-ROLES.md). Enforcement is in [`../SECURITY/04-AUTHORIZATION-RBAC.md`](../SECURITY/04-AUTHORIZATION-RBAC.md).

---

## `/api/v1/roles` — 14 endpoints

### Roles

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | list roles |
| GET | `/:id` | one role |
| POST | `/` | create |
| PATCH | `/:id` | update |
| DELETE | `/:id` | delete — refuses built-in roles |

`roles` is **global**, not tenant-scoped. Every tenant draws from the same catalogue. `isSystem` marks the eleven seeded roles; `BUILTIN_ROLES` is the delete guard.

`roleLevel` is the numeric privilege used by `rbac()` gates. A role created through this API without a sensible `roleLevel` will authenticate, resolve menus, and then fail every privileged gate — failing closed, but silently.

### Menu groups, served from the roles router

| Method | Path | Purpose |
|---|---|---|
| GET | `/menus` | list menu groups |
| GET | `/menus/:id` | one menu group |
| POST | `/menus` | create |
| PATCH | `/menus/:id` | update |
| DELETE | `/menus/:id` | delete |

Menu-group CRUD appears here **and** on `/api/v1/menu-groups`. Two surfaces, overlapping responsibilities. Historical, and worth knowing before assuming one is authoritative.

### Role-permission wiring

| Method | Path | Purpose |
|---|---|---|
| POST | `/:roleId/permissions` | grant a menu group to a role |
| DELETE | `/:roleId/permissions/:menuGroupId` | revoke |
| POST | `/assign` | assign a role to a user |
| DELETE | `/assign/:userId` | unassign |

Writes `role_menu_permissions` with `permissionType` of `read` or `write`. `write` implies `read`.

## `/api/v1/menu-groups` — 14 endpoints

Also mounted at `/api/v1/menu-group-roles` — **the same router**, not a different resource.

| Method | Path | Purpose |
|---|---|---|
| POST | `/filter` | filtered menu-group query |
| POST | `/get-assignments` | current role assignments |
| GET | `/menu-groups` | list |
| GET | `/menu-groups/admin` | admin view |
| GET | `/roles` | roles with their menu assignments |
| POST | `/create` | create |
| POST | `/update` | update |
| POST | `/delete` | delete |
| POST | `/assign` | assign menu groups to a role |
| POST | `/revoke` | revoke |
| POST | `/assign-item` | assign one |
| POST | `/revoke-item` | revoke one |
| POST | `/bulk-assign` | assign many |
| POST | `/bulk-revoke` | revoke many |

### Two shapes to know

**Almost everything is POST**, including reads and deletes. It is not REST-shaped and it is what the router does.

**The doubled path.** `GET /menu-groups/menu-groups/admin` is reachable, because the router mounted at `/api/v1/menu-groups` itself defines a `/menu-groups/admin` route. The frontend `menuGroupRole.getAdminMenuGroups` calls exactly that, and its contract test asserts the doubled path — the test documents reality rather than the intent.

## `/api/v1/user-permissions` — 3 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/:userId` | effective permissions for a user |
| POST | `/:userId` | grant an override |
| DELETE | `/:userId/:menuGroupId` | remove an override |

Writes `user_menu_permissions`, carrying `grantedBy` and `notes` so an exception is attributable and explicable.

`GET /:userId` returns the **resolved effective** permission set — role grants with overrides applied — not the raw override rows. That is the set the sidebar is built from and the set a permission question should be answered with.

## Resolution Order

```
SUPERADMIN?  ──yes──▶  allow everything, stop
      │ no
      ▼
role_menu_permissions for the user role
      │
      ▼
user_menu_permissions for this user  ──overrides──▶  effective set
      │
      ▼
required action ('read' | 'write') satisfied?   write implies read
      │
   no ──▶ 403
```

## Menu Group Catalogue

31 slugs in `MENU_SLUGS`:

```
home  dashboard  account  management  security  profile  warehouse  equipment
content  risk  supplier-scorecard  predictive-maintenance  feature-flags
tenant-lifecycle  data-retention  oidc  webauthn  network-security  scim
qms  sop  workflows  finance  metered-billing  gdpr  custom-domains
batch-jobs  tenant-hierarchy  kanban  tickets-raise  tickets-response
```

`menu_groups` is a tree via `parentId`, ordered by `sortOrder`, filtered by `isActive`.

`profile` contains the profile page and change-password as **sub-routes**, not separate menu groups. Granting `write` on `profile` grants both.

## What the Frontend Consumes

The sidebar is rendered from the resolved menu tree, so an unauthorised surface is **absent, not hidden**. There is no client-side permission array driving `display: none` — a hidden element is still in the DOM, and its route is still reachable by typing the URL.

Every backend route enforces independently regardless. The menu tree is navigation, not authorization.

## Cache Invalidation

The resolved menu tree is cached per role. A permission change **must** invalidate it.

TTL alone is not sufficient: a revoked permission that stays effective for five minutes is a five-minute authorization bypass, and five minutes is long enough to matter.

## Adding a Menu Group

1. Add the slug to `MENU_SLUGS` in `roleConstants.js`.
2. Add it to the relevant `ROLE_MENU_ASSIGNMENTS` entries — a menu group nobody is granted is invisible.
3. Seed the `menu_groups` row.
4. Gate the backend routes with `dynamicAccess("<slug>", "read" | "write")`.
5. Add the frontend surface.
6. Test both the positive and the **negative** case. A permission test that only proves the allowed role can get in proves nothing about the ones that should not.
