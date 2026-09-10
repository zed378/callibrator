# 08 — Error Boundaries and Failure States

**The most important frontend rule in this product: a failed request must never render as empty data.**

Rendering "0 devices overdue" when the query failed is a lie about a compliance figure, and someone will repeat it in a meeting (P3).

---

## Three States, Never Two

Every list, every tile, every detail view:

```
loading      → Skeleton, matching the final layout's dimensions
empty        → EmptyState   "No devices yet" + the create action
failed       → ErrorState   "Could not load devices" + retry + X-Request-Id
```

`EmptyState` and `ErrorState` are **separate components**. Not one component with a variant prop — separate, so conflating them requires a deliberate act.

This exists because the failure has happened: the QMS and SOP screens rendered empty for weeks after a response-envelope change, with no error anywhere and nothing in the logs. The list simply looked like there was no data.

## Dashboard Tiles

The highest-stakes instance of the same rule (UX-2).

| State | Renders |
|---|---|
| loading | skeleton, tile-sized |
| ready | the figure |
| **unavailable** | `—` plus "could not load" and a retry |

`0` and `—` must be visually unmistakable. Rina reports the overdue count to the hospital director.

## Route-Level Boundaries

`error.tsx` per route segment in the App Router.

| Level | Catches |
|---|---|
| `app/error.tsx` | anything uncaught |
| `app/dashboard/error.tsx` | dashboard failures, keeping the sidebar usable |
| `app/dashboard/<domain>/error.tsx` | one domain, leaving the rest of the app navigable |

Domain-level boundaries matter: a crash in `/dashboard/kanban` should not take out the sidebar and strand the user.

`loading.tsx` per segment, with skeletons sized to the real layout so nothing jumps when data arrives.

## What an Error State Must Contain

| Element | Why |
|---|---|
| What failed, in the user's terms | "Could not load devices", not "Request failed" |
| A retry | most failures are transient |
| **The `X-Request-Id`** | the one thing a user can safely quote in a bug report |
| A way out | never a dead end |

`X-Request-Id` is exposed through CORS specifically so the client can read it. It is the only thing tying a client-side symptom to a server-side log line.

## Status Handling

| Status | UI |
|---|---|
| 400 | field errors mapped back to fields |
| 401 | clear session, redirect to login — **once**, not in a loop |
| 403 | `AccessDeniedModal`, and **refetch the menu tree** — it is stale |
| 404 | not-found state; **includes cross-tenant**, deliberately indistinguishable |
| **409** | **a state explanation**, never a generic error |
| 429 | "too many requests", with the window |
| 5xx | error state with retry and the request id |
| network | offline state with retry |

### 409 is the one most often mishandled

```
✗  "Something went wrong"
✓  "This certificate is in draft and must be submitted for approval first."
```

A 409 is a conflict with the current state, and the state is knowable. Surfacing it generically hides a real design gap behind a shrug — which is exactly what happened when approving a draft threw a 500 and made approval unreachable ([`../API/08-CERTIFICATE-ESIGNATURE-API.md`](../API/08-CERTIFICATE-ESIGNATURE-API.md)).

### 403 means the menu is stale

A 403 on a route the menu tree offered is the signal that permissions changed since sign-in. Refetch `GET /api/v1/menu-groups` alongside showing `AccessDeniedModal`.

### 401 must not loop

Clear the session and redirect once. A redirect that itself 401s produces an infinite loop and a browser that hangs.

## Cross-Tenant Is a 404, on Purpose

A resource belonging to another tenant returns **404**, identical to one that does not exist.

The UI must not "helpfully" distinguish them. Rendering "you do not have access to this device" where the server said not-found reintroduces the existence oracle the status code exists to prevent ([`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md)).

## Toasts Are Not Error Handling

A toast is missed by anyone not looking at that corner, and by a screen reader that has moved on.

| Outcome | Treatment |
|---|---|
| Transient success | toast is fine |
| **A failure the user must act on** | persisted in the page, not only a toast |
| A failure that lost their input | persisted, with the input preserved |

A form submit that fails must leave the form filled in. Losing a calibration record someone typed standing up at the end of a shift is not recoverable by a retry button.

## Realtime Failures Degrade

The Socket.IO connection is an enhancement, not a dependency.

| Failure | Behaviour |
|---|---|
| Cannot connect | app works; notifications arrive on navigation |
| Drops | reconnect, then **refetch** — Socket.IO does not replay |
| Sound suppressed by autoplay policy | **not an error**; never logged as one |

Nothing in the compliance path depends on the socket.

## Batch Jobs

A job in `PROCESSING` past a threshold is surfaced as **stalled**.

`PROCESSING` is not a resting state. A permanent spinner is indistinguishable from work in progress, and a worker that crashed leaves exactly that.

## Long-Running Requests

The backend times out at 30s and returns **408**. Anything that could legitimately take longer belongs in a batch job.

A 408 in the UI is a bug signal, not a normal outcome, and should be reported as such rather than retried silently.

## Logging

Client errors are reported with the `X-Request-Id`. **No personal data, no tokens, no request bodies** — a client error report that carries a form payload is a data leak with good intentions.

## Testing

| Assertion |
|---|
| a failed list request renders `ErrorState`, **not** `EmptyState` |
| a genuinely empty list renders `EmptyState` |
| a failed tile renders `—`, not `0` |
| a 409 renders a state-specific message |
| a 403 triggers a menu refetch |
| a 401 redirects **once** |
| a failed form submit preserves the input |
| the request id is visible in every error state |

The first two are the pair that matters. They are also the pair most easily written as one test that passes for the wrong reason.
