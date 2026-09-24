# 04 — Authorization and RBAC

The model is in [`../PLAN/03-USER-ROLES.md`](../PLAN/03-USER-ROLES.md); the tables are in [`../DATABASE/04-RBAC-TABLES.md`](../DATABASE/04-RBAC-TABLES.md). This document is enforcement.

---

## The Three Gates

| Middleware | Gates on | Use for |
|---|---|---|
| `dynamicAccess(resource, action)` | menu-group permission (`read` / `write`) | almost everything |
| `rbac([roles])` | numeric `roleLevel` | "tenant administrator or above" |
| `abac` | attribute rules | ownership and contextual conditions |

`dynamicAccess` is the default. `rbac` exists for operations expressed as a privilege floor rather than a surface — tenant backups, for instance, gated at `TENANT_ADMIN` (level 8) so both admin roles satisfy one check.

## Resolution

```
SUPERADMIN?  ──yes──▶  allow, stop
      │ no
      ▼
role_menu_permissions for the user role
      │
      ▼
user_menu_permissions for this user  ──overrides──▶  effective set
      │
      ▼
required action satisfied?   write implies read
      │
   no ──▶ 403
```

`SUPERADMIN` short-circuits before anything else. There is no second gate behind it — which is why that account is the highest-value credential in the system (PR-3).

## Two Levels, Not Five

`permissionType` is `read` or `write`. There is no separate create / update / delete granularity.

That is deliberate. A permission model with five verbs per surface across 58 surfaces is 290 switches, and a model nobody configures correctly is not a security control — it is a configuration surface that ships with whatever the defaults happened to be.

## Role Level Is Numeric

```js
ROLE_LEVELS = {
  SUPER_ADMIN: 10, TENANT_ADMIN: 8, HEALTCARE_ADMIN: 8, CALIBRATOR_ADMIN: 8,
  ENGINEERING_MANAGER: 7, SUPERVISOR: 6, TECHNICIAN: 5, HEALTHCARE_TECHNICIAN: 5,
  FACILITY_MAINTENANCE: 4, WAREHOUSE_STAFF: 4, ROOM_USER: 3, USER: 1,
};
```

Comparing numbers rather than matching names means adding a role does not require touching every gate.

### The silent failure

**A role absent from this map resolves to the lowest privilege.** That fails closed — correct — but *silently*: the role authenticates, resolves menus, and then fails every privileged gate with nothing explaining why.

A new role must be added to `ROLE_LEVELS` at the same time as `ROLE_NAMES`. Missing that step produces a role that looks configured and does nothing.

### Level orders escalation, not scope

`WAREHOUSE STAFF` at level 4 holds `write` on `warehouse`; `SUPERVISOR` at level 6 holds only `read`.

That is correct, not a bug. A warehouse clerk is supposed to move stock; a supervisor is supposed to approve it. Level is a privilege ceiling, not a superset relation.

Any `rbac()` gate that assumes higher level implies broader scope is wrong.

## Per-User Overrides

`user_menu_permissions`, carrying `grantedBy` and `notes`.

Those two columns are the control. An override with neither is an unexplained privilege that nobody can justify at review, and the person who granted it will have forgotten.

Use it for the individual exception. Reaching for it repeatedly for the same shape of exception means a role is missing, and the right response is a new role, not thirty overrides.

## Cache Invalidation

The resolved menu tree is cached per role. **A permission change must invalidate it immediately.**

TTL alone is not sufficient: a revoked permission that stays effective for five minutes is a five-minute authorization bypass, and five minutes is long enough to matter during an incident where someone is being locked out on purpose.

Every cache key in tenant-scoped territory also includes the tenant id — a key missing it serves one tenant's resolved permissions to another, and keeps doing so after the bug is fixed until the key expires.

## The Client Is Not the Enforcement Point

The frontend renders its sidebar from the server-resolved menu tree, so an unauthorised surface is **absent** rather than hidden. There is no client-side permission array driving `display: none` — a hidden element is still in the DOM, and its route is still reachable by typing the URL.

`AccessDeniedModal` handles a route reached anyway: a stale menu, a permission revoked mid-session, a bookmarked URL.

**Every backend route enforces independently regardless.** The menu tree is navigation.

## The Failure Mode — And The Guard Against It

**A new route with no permission gate is authenticated-but-unauthorized-by-omission.** The route works, for everyone with a token — every role, and every API key whatever its scopes.

Since 2026-09-24 (P6-04, ADR-058) a test fails the build when that happens:
`backend/src/tests/routes/routePermissionGuard.p604.test.js`. It requires every module under
`src/routes` (`api/` **and** `internal/`), walks each router's Express layer stack — the chain
Express actually runs, `router.use` layers included — and requires every route to carry a gate:
`dynamicAccess`, `rbac`, `checkRoleLevel`, `abac` or `superAdminOnly`. `auth` is authentication, not a
gate; `denyApiKey` narrows who may call, it is not a gate either. The routes `index.js` and
`docs/swagger.js` register directly on the app are read from source and must all be listed.

A route that is ungated **on purpose** is listed in `backend/src/constants/routeGateExemptions.js`
with a kind and a reason: `public` (no `auth`; its own defence named), `self` (acts on the caller
only), `service` (authorized below the route — the entry names `file#function`, and the guard fails
if that function does not exist), `inline` (a guard function defined in the router — the guard fails
if it is not in the chain), `pending` (names the card that closes it) or `accepted` (names the
decision). The guard also fails on a **stale** entry — a route now gated, or gone — so the list can
only shrink by being edited. Its `public` entries are the one list P9-21's `public()` marker is to read.

The guard also checks that every `dynamicAccess` resource on a route is a **seeded** menu slug: a gate
naming no menu grants nobody but SUPERADMIN and is the same hole with a longer line of code (A-07).

It runs under `npm test`, so under `make verify`. It does **not** run on its own in a hook or CI
pipeline — none exists (A-19); that half of P6-04 is still open.

## Cross-Tenant Failures Return 404

Not 403. A 403 for "this exists and you may not have it" turns id enumeration into a tenant-membership oracle.

Non-existent, soft-deleted and not-yours must be indistinguishable — see [`05-MULTI-TENANCY-SECURITY.md`](./05-MULTI-TENANCY-SECURITY.md).

A **403 is correct** for a permission failure inside your own tenant, where the resource's existence is not a secret from you.

## The Two Tenant Headers

| Header | Honoured for | Effect |
|---|---|---|
| `x-tenant-id`, `x-tenant-code` | `SUPERADMIN` only | act inside that tenant |
| `X-Tenant-ID` | tenant-pinned frontend builds | sent on every call |

For a non-super-admin the override headers are **ignored, not rejected**. A probe therefore returns the caller's own data rather than an error confirming the header means something.

## Testing

A permission test that only proves the allowed role can get in proves nothing.

```
for each gated route:
  ✓ the granted role succeeds
  ✓ a role without the grant gets 403
  ✓ read-only role gets 403 on a write action
  ✓ a per-user override changes the outcome as documented
  ✓ a different tenant gets 404, not 403
  ✓ SUPERADMIN succeeds
```

The negative cases are the test. The positive case is a smoke test wearing a security test's clothes.

## Adding a Gated Surface

1. Add the slug to `MENU_SLUGS`.
2. Add it to the relevant `ROLE_MENU_ASSIGNMENTS` entries — a menu group nobody is granted is invisible.
3. Seed the `menu_groups` row.
4. Gate every backend route with `dynamicAccess("<slug>", "read" | "write")`. A route you deliberately leave ungated goes in `constants/routeGateExemptions.js` with its reason, or the P6-04 guard fails the build.
5. Add the frontend surface.
6. Write the negative tests above.
7. Confirm cache invalidation covers the new grant.
