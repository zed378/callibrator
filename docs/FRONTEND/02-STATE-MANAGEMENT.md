# 02 — State Management

Zustand 5. `frontend/src/stores/`.

---

## The Rule

**A store is for state that outlives a page.** Data fetched for one screen belongs in that screen's hook.

A domain store created because one page needed it is a memory leak with a nice API: it holds stale data for the rest of the session, nothing invalidates it, and the next page to read it gets yesterday's answer.

## The Stores

| Store | Holds | Lifetime |
|---|---|---|
| `authStore` | session, user, token, role | the session |
| `menuStore` | the server-resolved menu tree | the session |
| `tenantBrandingStore` | logo, name, colour | **pre-auth** for pinned builds |
| `notificationStore` | live arrivals from Socket.IO | the session |
| `toastStore` | transient feedback | seconds |
| `deviceStore`, `calibrationStore`, `stockStore`, `warehouseStore`, `userStore`, `roleStore`, `tenantStore`, `tenantBackupStore`, `kanbanStore` | domain caches | varies |

The first five are unambiguously correct. The domain stores are a judgement call, and each should be able to answer "what reads this from a different page?" If the answer is nothing, it is a hook, not a store.

## `authStore`

The session, the user and their role. Populated by `AuthInitializer` on mount, cleared on logout or a 401.

**It does not hold permissions.** Permissions are the menu tree, and the menu tree is `menuStore`. Storing a permission list in `authStore` invites a component to check it, which is the pattern this codebase deliberately avoids ([`05-RBAC-IN-UI.md`](./05-RBAC-IN-UI.md)).

## `menuStore`

The tree returned by `GET /api/v1/menu-groups`, already resolved server-side against the caller's role and per-user overrides.

The sidebar renders from it directly. **It is navigation, not authorization** — every backend route enforces independently.

It must be **refetched on any permission change**, not merely on login. A revoked permission that stays in the store until the next sign-in is a stale menu, and the user hits `AccessDeniedModal` on a link that should not be there.

## `tenantBrandingStore`

The only store populated **before authentication**.

For a build pinned with `NEXT_PUBLIC_TENANT_ID`, `GET /api/v1/tenants/public` supplies the logo, name and colour so the login page is already branded.

That endpoint is unauthenticated and must expose branding only — anything else on it is a pre-auth disclosure.

## `notificationStore`

Fed by the Socket.IO connection ([`06-REALTIME.md`](./06-REALTIME.md)) and by the initial `GET /api/v1/notifications`.

Two sources for one list, which means arrivals must be **deduplicated by id**. A socket push that races the initial fetch otherwise shows the same notification twice.

## `toastStore`

Transient feedback. A toast is **never the only signal for anything important** — it is missed by anyone not looking at that corner, and by a screen reader that has moved on.

Anything consequential is also reflected in the page.

## What Does Not Go in a Store

| Not a store | Where instead |
|---|---|
| One screen's list data | the screen's hook |
| Form state | the form |
| Sort, filter, pagination | **the URL** — a filtered view is a link someone sends |
| Modal open/closed | local component state |
| Anything derivable from other state | derive it during render |

The URL one matters most. A filtered device register is a message: "here is the overdue list" should be a link. Component or store state cannot be shared, bookmarked, or survive a refresh.

## Stale Data

A store that caches domain data must invalidate on mutation. Two rules:

1. **Invalidate on write.** After creating a device, the device cache is stale — refetch or update it, do not wait for a remount.
2. **Never cache across a tenant switch.** A super-admin using `x-tenant-id` to move between tenants must not see the previous tenant's cached rows. Clear domain stores on any tenant change.

The second is a **cross-tenant leak in the browser**, and it does not show up in a backend IDOR test.

## Selectors

Subscribe to the slice a component needs, not the whole store:

```ts
const user = useAuthStore((s) => s.user);          // ✓
const { user } = useAuthStore();                    // ✗ re-renders on every change
```

React 19's compiler handles a great deal of memoisation, but it cannot narrow a store subscription for you.

## Testing

`authStore.test.ts` and `userStore.test.ts` exist; `src/stores/__tests__/` holds more.

What to assert:

- initial state
- each action's effect
- **clearing on logout** — a store still holding a user after logout is a real leak
- clearing on tenant switch, for domain stores

## Server State Is Not Client State

There is no React Query or SWR here. Fetching lives in hooks, and caching lives in stores where it is genuinely needed.

That is a deliberate smaller footprint, and it comes with a cost: **invalidation is manual**, and manual invalidation is forgotten. Anywhere a store caches domain data, the invalidation path should be as visible as the write path.
