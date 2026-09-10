# 05 — RBAC in the UI

**The frontend is not an authorization boundary.** Every backend route enforces independently ([`../SECURITY/04-AUTHORIZATION-RBAC.md`](../SECURITY/04-AUTHORIZATION-RBAC.md)).

What the frontend does is make the interface match what the user can actually do, so they never encounter a door that does not open.

---

## The Menu Tree Is the Navigation

```
sign in
  → GET /api/v1/menu-groups
      server resolves: role grants → per-user overrides → super-admin short-circuit
  → menuStore
  → sidebar rendered from the tree
```

**There is no client-side permission array.** No `can("devices", "write")` helper, no permission list in `authStore`, no `<IfPermitted>` wrapper around every button.

The server already resolved the question. Re-implementing the resolution in the client gives two implementations that can disagree, and the one that disagrees silently is the client.

## Absent, Not Disabled

An unauthorised surface **does not appear** in the navigation (P2).

| Wrong | Right |
|---|---|
| a greyed-out "Billing" menu item | no billing item |
| "Upgrade to unlock QMS" in the sidebar | no QMS item |
| a hidden `<div>` with `display: none` | the element is not rendered |

Two reasons:

1. **Greyed-out menus teach users the software is arbitrary.** They see options all day that they can never use.
2. **A hidden element is still in the DOM**, and its route is still reachable by typing the URL. Hiding is not a control; it is decoration that looks like one.

## The Exception: an action inside a screen you can see

P2 governs **navigation**. Inside a screen a user legitimately has access to, an action they cannot perform **on this particular record** is shown disabled, with the reason.

```
[ Approve ]  ← disabled
   "You cannot approve a certificate you calibrated."
```

That is useful. A missing button is not — the user knows approval exists and cannot tell whether the system is broken or they are not allowed.

The distinction: absent when the whole surface is not theirs; disabled-with-a-reason when the surface is theirs and this instance is not.

## Reaching a Route Anyway

Three ways it happens, all legitimate:

| Cause | |
|---|---|
| A stale menu tree | permissions changed since sign-in |
| A permission revoked mid-session | |
| A bookmarked or shared URL | |

`AccessDeniedModal` handles all three: explain what happened, offer a way back. A dead end is worse than a refusal.

**Do not enumerate the missing permission** in a way that maps the feature surface for someone probing.

## The Menu Tree Must Be Refetched, Not Just Cached

A revoked permission that stays in `menuStore` until the next sign-in is a stale menu, and the user hits `AccessDeniedModal` on a link that should not be there.

Refetch on:

- sign-in,
- any permission change the user makes to themselves,
- a 403 from a route the menu said was available — that is the signal the tree is stale.

The backend caches the resolved tree per role and **invalidates on permission change**. TTL alone would be a timed authorization bypass.

## Super-Admin

`SUPERADMIN` sees everything except `tickets-raise` — the platform operator answers tickets and never raises them (BR-13).

That will look like an omission on the sidebar. It is not.

A super-admin acting inside a tenant via `x-tenant-id` must have **domain stores cleared on the switch**, or they see the previous tenant's cached rows. That is a cross-tenant leak in the browser, and no backend IDOR test will find it ([`02-STATE-MANAGEMENT.md`](./02-STATE-MANAGEMENT.md)).

## Role Levels Are Not a Frontend Concern

`ROLE_LEVELS` gates privileged operations server-side. The frontend does not compare levels, because the comparison already happened — the menu tree reflects its outcome.

A frontend that reimplements level comparison will drift from `roleConstants.js`, and the drift will be invisible until someone with an unusual role gets the wrong interface.

## What the Frontend May Read from `authStore`

| Read for | Legitimate |
|---|---|
| Displaying the user's name and role | yes |
| Showing a "you are impersonating" banner | yes |
| **Deciding whether an action is permitted** | **no** |

The last one is the whole rule. Role in `authStore` is for display.

## Tenant Branding Is Not Authorization

`tenantBrandingStore` is populated **before** authentication for pinned builds, from the unauthenticated `GET /api/v1/tenants/public`.

That endpoint exposes branding only. It says nothing about what anyone may do, and nothing in the UI should treat it as if it did.

## Testing

| Assertion |
|---|
| the sidebar renders exactly the granted menu groups, for each role |
| an unauthorised item is **absent from the DOM**, not merely invisible |
| a route reached without permission shows `AccessDeniedModal` |
| a 403 triggers a menu refetch |
| domain stores clear on tenant switch |
| a per-user override changes the rendered menu |

The second is the one worth asserting explicitly. `toBeVisible()` passing is not the same as the element not existing, and the distinction is exactly what this design turns on.

## Summary

| Concern | Owner |
|---|---|
| What is permitted | the backend, on every route |
| What is navigable | the server-resolved menu tree |
| What is rendered | the frontend, from that tree |
| What is enforced | **never** the frontend |
