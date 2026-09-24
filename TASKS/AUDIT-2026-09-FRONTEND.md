# Audit 2026-09 — Frontend

Findings from a read-through of `frontend/` on **2026-09-23**: 69 pages under `src/app`, 79
components, 51 services, `proxy.ts`, the four Next route handlers under `src/app/api/v1/`, and the
70 Jest suites.

Companion to [`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md) (`A-nn`, almost all
backend). Ids here are `F-nn`. Where a finding is the **frontend half** of an existing `A-nn`, the
card says so instead of restating it.

**Evidence standard.** Every card names a file and a line. Three claims are backed by commands that
were actually run in this audit and whose output is quoted:

| Command | Result |
|---|---|
| `npx eslint src` (in `frontend/`) | **146 problems — 85 errors, 61 warnings** |
| `npx tsc --noEmit -p tsconfig.json` | **exit 0 — clean** |
| `npx jest --coverage` | **70 suites, 687 tests, all pass; 12.51% statements against a declared 70% threshold → gate fails** |

Nothing was exercised against a running server or a browser. Every claim about runtime behaviour
below is read from code, and the cards say where that leaves a doubt.

## Summary

| Id | Finding | Severity | Area | Status |
|---|---|---|---|---|
| F-01 | **Logout never closes the socket** — the next user in the same tab inherits the previous user's authenticated Socket.IO connection | **high** | realtime / tenancy | **DONE** 2026-09-24 |
| F-02 | The dashboard's "System Health — All Systems Go" panel is **hardcoded**; it has never called `/health` | **high** | integrity | **DONE** 2026-09-24 |
| F-03 | **`make verify` cannot pass, and never checked the frontend**: 85 lint errors, `typecheck` type-checks nothing, `test` never runs the coverage gate | **high** | gate | TODO |
| F-04 | **0% coverage above the service layer** — every page, every hook, `client.ts`'s interceptors, `proxy.ts` and `socket.ts` | **high** | tests | TODO |
| F-05 | **Token refresh is dead end to end**, and the 401 path races a redirect against the cookie clear | **high** | auth | TODO |
| F-06 | `x_tenant_id` **survives logout** — a super admin's next session is silently scoped to the tenant they last impersonated | medium | tenancy | **DONE** 2026-09-24 |
| F-07 | No error boundary, no 403/404/409/429/offline handling, no `X-Request-Id`; `AccessDeniedModal` is rendered nowhere | medium | errors | TODO |
| F-08 | **Two `proxy.ts` files** with different auth logic | medium | routing | TODO |
| F-09 | `POST /api/v1/auth/sso-session` writes the auth cookie from an **unverified request body** | medium | auth | TODO |
| F-10 | Global search is shown to every role and 403s on **every keystroke** for roles A-04 now excludes | medium | ux / authz | TODO |
| F-11 | The public certificate-verification PDF link prefixes the backend origin onto an already same-origin path | medium | public surface | TODO |
| F-12 | ~142 of 156 `<label>`s are unassociated; 16 modals, zero `role="dialog"`; `axe` is not installed | medium | accessibility | TODO |
| F-13 | Two endpoints return `data.rows`/`data.meta` and the frontend is **coded to match** | medium | envelope | TODO |
| F-14 | The client timeout equals the server timeout, so the user never sees the backend's 408 | medium | errors | TODO |
| F-15 | `menuStore` falls back to the **full static menu** when `roleId` is missing | low | rbac-in-ui | TODO |
| F-16 | The proxy buffers every request and response whole; uploads and downloads are held twice in the Next process | low | performance | TODO |
| F-17 | Unread badge drifts; two unused dependencies | low | hygiene | TODO |
| F-18 | the webhook screen cannot show a server-generated or rotated secret | **high** | 0 | **DONE** 2026-09-24 |

---

## High

### F-01 — Logout never closes the socket

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code. Not reproduced in a browser — the hand-off depends on the tab not reloading, which is argued from the navigation calls below, not observed |
| **Evidence** | `frontend/src/lib/socket.ts:64` defines `disconnectSocket()`. `grep -rn "disconnectSocket" frontend/src` returns **only that definition** — zero callers. `frontend/src/stores/authStore.ts:315-336` (`logout`) clears the menu store and three cookies and does not touch the socket; `exitImpersonation` (`:292-313`) does not either. `frontend/src/components/layouts/Sidebar.tsx:110-113` and `Navigation.tsx:39-42` both do `await logout(); router.push("/login")` — a **client-side** navigation. `frontend/src/app/login/hooks/useLoginForm.ts:41` and `:55` return with `router.push(callbackUrl)` — client-side again. `frontend/src/lib/socket.ts:10` holds `socket` at module scope and `:21` returns it unconditionally: `if (socket) return socket;` |
| **Spec refs** | `docs/FRONTEND/06-REALTIME.md` § Connection · `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` |

**Why it matters here.** Nothing in the sign-out path unloads the page, so the module singleton in
`socket.ts` survives logout and the subsequent login. The new user's first `getSocket()` returns the
**old** socket, still authenticated with the previous user's socket token and still joined to the
previous user's tenant room and Kanban rooms. `useLiveNotifications` (`frontend/src/hooks/useLiveNotifications.ts:48`)
then toasts the previous tenant's notifications — title and message body — into the new user's
screen, and `useBoard` patches the previous tenant's cards into the store. On a shared workstation,
which is the normal case on a hospital ward, that is a cross-tenant disclosure through a channel the
backend cannot re-check, because the backend already authorised that connection.

The same file holds the frontend half of **A-53**: `useBoard.ts:59` emits `kanban:join` once, inside
the mount effect. Socket.IO issues a new socket id on reconnect and rooms do not survive it, and
there is no `socket.on("connect", …)` re-join and no refetch, so after any network blip the board
silently stops updating. `docs/FRONTEND/06-REALTIME.md:73` ("on reconnect, **refetch**") describes
behaviour that is not implemented anywhere.

**Fix direction.** Call `disconnectSocket()` from `logout`, `exitImpersonation` and the
`initialize()` failure path, before the cookies are cleared. Re-join rooms from a `connect` handler
rather than from the mount effect, and refetch the board and the notification list on reconnect. Key
the singleton by user id so a stale socket can never be handed to a different principal even if a
disconnect is missed.

**Definition of Done**
- [ ] `disconnectSocket()` is called on every sign-out path, and a test asserts it (name the test)
- [ ] `getSocket()` refuses to return a socket minted for a different user id
- [ ] room joins are emitted from a `connect` handler; a forced `socket.disconnect()`/reconnect in a test leaves the board receiving updates again
- [ ] reconnect triggers a refetch of the board and of the notification list
- [ ] a two-account, same-tab manual reproduction is recorded: user A logs out, user B logs in, and B receives **no** event belonging to A's tenant

**Abuse cases**
- Disconnecting only in the sidebar handler and leaving `exitImpersonation` and the 401 path connected
- Asserting the function is called rather than asserting no cross-tenant event arrives

---

**What was changed (2026-09-24)** — logout disconnects the socket **first**, before the logout
request is sent, so no event for the departing user can land while it is in flight. The same happens
on `exitImpersonation` and on a failed session restore. Two races that the fix would otherwise have
left open are closed in `lib/socket.ts`: a connection **still being set up** when the session ends is
now discarded rather than handed to the next user, and a late `connect_error` on a dead socket can no
longer re-authenticate the next session's socket.

**Proof** — `stores/__tests__/authStore.session.test.ts` and `lib/socket.test.ts` use the **real**
socket singleton; only `io` and the HTTP layer are faked. Against the old code: *"logout disconnects
the socket and the next login gets a fresh connection with the new token"* → `Received number of
calls: 0`.

**Not covered:** the real two-users-same-tab case over a live Socket.IO server was not reproduced;
the tests prove A's socket closes and B's is new, not that B receives nothing of A's tenant end to
end. Room re-join on reconnect is A-53, still open.

### F-02 — The "System Health" panel is hardcoded

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code — the component takes no props, makes no call, and imports no service |
| **Evidence** | `frontend/src/app/dashboard/components/DashboardSystemHealth.tsx:25-30` renders a pulsing green dot and the literal text `All Systems Go`; `:34-57` render four `HealthIndicator`s with `status="healthy"` and the literal strings `"99.9% uptime"`, `"Connected • 2ms"`, `"Active • 1ms"`, `"3 messages pending"`. `:20-22` labels the block `Real-time infrastructure status`. It is mounted unconditionally at `frontend/src/app/dashboard/page.tsx:159`. `grep -rn "api/v1/health" frontend/src` returns nothing |
| **Spec refs** | `CLAUDE.md` § Distinguish "Renders" From "Works" · `docs/UI-UX/11-DASHBOARD-UX.md` · A-15 (aggregate `/health`), A-06 (`GET /api/v1/health` per-dependency, super-admin only) |

**Why it matters here.** This is the landing screen of a system used to decide whether a medical
device may stay in service. The panel asserts, in the product's own voice and labelled *real-time*,
that PostgreSQL, Redis and RabbitMQ are up and quotes latencies for them. All four indicators stay
green with the database down. A-15 and A-06 landed on 2026-09-23 and gave the backend both an
aggregate `/health` that 503s when a dependency is down and a gated `GET /api/v1/health` that names
which one — and neither is called from anywhere in the frontend. An operator who trusts this tile
during an incident is being actively misled, which is worse than having no tile.

**Fix direction.** Either wire the panel to `GET /api/v1/health` (super-admin only, so render the
card only for that role and show the three real dependency verdicts plus the aggregate), or delete
the component. Do not keep a decorative version. If it is kept, the three states from
`docs/FRONTEND/08-ERROR-BOUNDARIES.md:27-31` apply: skeleton, verdict, `—` plus "could not load".

**Definition of Done**
- [ ] no literal `"healthy"`, uptime or latency string remains in `DashboardSystemHealth.tsx`
- [ ] a stopped dependency turns its indicator red in a manual check, and the check is recorded
- [ ] a 403 (non-super-admin) renders the card as absent, not as green
- [ ] a sweep for the same shape elsewhere: every other dashboard tile is traced to the field that feeds it

**Abuse cases**
- Fetching `/health` and still defaulting to `healthy` when the fetch fails
- Leaving "All Systems Go" as a static header above dynamic indicators

---

**What was changed (2026-09-24)** — the panel is **wired to the real data**, not removed. It calls
`GET /api/v1/health` (super-admin only) through a new `health.service.ts`, treats **503 as an answer**
— it carries the breakdown, and it is the answer that matters most — and renders exactly what comes
back. An unhealthy dependency shows red with the backend's own error text; `not configured` and
`unknown` show **neutral grey, never green**; a failed request shows "could not load", not a status.
A non-super-admin gets **no panel and no request**, and a 403 removes the panel rather than showing
green. The static "All Systems Go", the invented "Connected • 2ms" and "3 messages pending", and the
fake uptime are gone.

`react-hooks/set-state-in-effect` fired on the first version and **was right**; the component was
restructured instead of the rule being disabled.

**Not covered:** a real dependency stopped behind a live backend. The 503 case is proven with a
response body copied from the real `readinessDetail` shape, not from a running stack.

### F-03 — `make verify` cannot pass, and never checked the frontend

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | **run in this audit.** `npx eslint src` → `✖ 146 problems (85 errors, 61 warnings)`. `npx tsc --noEmit` → exit 0. `npx jest --coverage` → 70 suites / 687 tests pass, then four `does not meet "global" threshold` lines |
| **Evidence** | `Makefile:255` — `verify: lint typecheck test build`. `Makefile:222-230` — `lint: pnpm lint`, `typecheck: pnpm typecheck`. `package.json:15-17` maps those to `turbo run lint` / `turbo run typecheck`. **`frontend/package.json:6-14` has no `typecheck` script** — turbo skips a package that does not define the task, silently, so the one TypeScript workspace the target exists for is not type-checked. `frontend/package.json:12` — `"test": "jest"`, no `--coverage`, so `frontend/jest.config.js:29-36`'s `coverageThreshold` of 70% is never evaluated by the gate. Lint error breakdown: 42 × `react-hooks/set-state-in-effect` across 38 files, 41 × `@typescript-eslint/no-explicit-any` across 10 files, 2 × `react-hooks/purity` (`app/dashboard/api-keys/components/ApiKeysTable.tsx:37` and `:46`, `Date.now()` during render) |
| **Spec refs** | `docs/FRONTEND/00-FRONTEND-STANDARDS.md:15` (no `any`), `:18` and `:142-147` (`pnpm typecheck`), `:32` (do not disable the compiler rules) · `CLAUDE.md` § Commands · A-34 (the backend half of exactly this) |

**Why it matters here.** A-34 recorded that the backend lint gate had never run. The frontend gate is
in the same condition and for three separate reasons: `lint` fails, `typecheck` is a no-op, and
`test` runs without the threshold that makes it a gate. `CLAUDE.md` describes `make verify` as
*the* gate; today it cannot return green from a clean tree, so anyone who runs it learns to ignore
it, which is how the backend reached 1,319 suppressed errors.

A-22 records this as "**one** React Compiler lint error in `GlobalSearch.tsx`". The measured figure
is **85 errors in 38+ files**; `GlobalSearch.tsx:100-104` is one of them. A-22 understates the scope
by nearly two orders of magnitude and should be superseded by this card.

The eight in-source suppressions are separate from the 85 and are the pattern
`docs/FRONTEND/00-FRONTEND-STANDARDS.md:32` names specifically:
`app/dashboard/page.tsx:53`, `app/dashboard/content/page.tsx:72`,
`app/dashboard/components/real-time-clock.tsx:15`, `components/auth/AuthBrandingPanel.tsx:14`,
`components/layouts/Footer.tsx:14`, `components/motion/Counter.tsx:57` suppress
`react-hooks/set-state-in-effect`; `hooks/useLiveNotifications.ts:64`,
`app/dashboard/reports/hooks/useReports.ts:87`, `app/dashboard/user-permissions/hooks/useUserPermissions.ts:66`
and `components/motion/Counter.tsx:67` suppress `react-hooks/exhaustive-deps`.

**Fix direction.** Add `"typecheck": "tsc --noEmit"` to `frontend/package.json` (it already passes —
this costs nothing and stops the silent skip). Point `test` at the coverage run or add a separate
gated task. Then work the 85 errors down in their own PR, not inside feature work; most of the 42
`set-state-in-effect` hits are the same "fetch in an effect that sets loading first" shape and can be
fixed once in a shared hook. Correct A-22's count in the remediation file.

**Definition of Done**
- [ ] `frontend` defines a `typecheck` script and `turbo run typecheck` actually runs it
- [ ] `npx eslint src` exits 0 from a clean tree, with no new `eslint-disable` added to get there
- [ ] the coverage threshold is either enforced by the gate or lowered to the truth and raised on a schedule — not left at a number nothing checks
- [ ] A-22 is corrected to the measured count and cross-referenced here
- [ ] `make verify` is run end to end once and its output pasted into the change record

**Abuse cases**
- Adding `// eslint-disable-next-line` to reach a green gate
- Deleting the `coverageThreshold` block instead of deciding what it should be

---

### F-04 — Zero coverage above the service layer

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | **run in this audit** — `npx jest --coverage` |
| **Evidence** | `All files 12.51% statements / 15.17% branches / 15.26% functions / 12.4% lines`. Per directory: `src/api/services` **92.7%**; `src/app` **0%** — including `src/app/api/v1/[...path]` 0%, `src/app/api/v1/auth/login` 0%, `.../logout` 0%, `.../sso-session` 0%, and every one of the 69 dashboard pages and their hooks; `src/api/client.ts` **21.87%**, uncovered lines `25-33, 38-64, 71-92` — i.e. the FormData interceptor and the whole error interceptor including the 401 branch; `src/proxy.ts` **0%** (lines 1-24); `src/lib/socket.ts` **0%** (lines 6-69). 70 suites, 687 tests, all passing |
| **Spec refs** | `docs/FRONTEND/10-TESTING.md` · `docs/FRONTEND/03-API-CLIENT.md:79-83` · `CLAUDE.md` § Evidence |

**Why it matters here.** 687 green tests is the number a reader sees. What they cover is 51 service
modules calling `api.get`/`api.post` against a `jest.mock("../client")` — see
`frontend/src/api/services/search.service.test.ts:4-12`, which is representative. Those tests prove
the URL string and the params object. They cannot fail when the endpoint is missing, when the
envelope shape changes, or when the component that consumes the service reads the wrong field.
`docs/FRONTEND/03-API-CLIENT.md:81` says this in as many words and the repository then relies on the
number anyway.

The specific gaps that matter most: **the four Next route handlers that mint and clear the httpOnly
auth cookies have no test at all**, and neither does `proxy.ts`, which decides who may reach
`/dashboard`. F-05, F-08 and F-09 are all defects in that untested surface, and each of them is the
kind a single handler test would have caught. `client.ts`'s 401 branch — the app's entire session-
expiry behaviour — is in the uncovered range.

**Fix direction.** Test the four route handlers directly (they are plain functions over
`NextRequest`): cookie set on login, cookie cleared on logout, token rotation on a refresh-shaped
body, and the header-injection behaviour of the catch-all. Test `proxy.ts`'s two redirects. Test
`client.ts`'s interceptors. Then a small number of page-level tests for the screens that carry a
compliance figure. Do not chase the 70% number with more service mocks — that raises the percentage
and proves nothing new.

**Definition of Done**
- [ ] every file under `src/app/api/v1/**` has a handler test, each named in the change record
- [ ] `client.ts` is above 90%, with the 401 branch asserted
- [ ] `proxy.ts` has a test per redirect
- [ ] a written statement of what the 51 service tests do and do not prove, linked from `docs/FRONTEND/10-TESTING.md`
- [ ] the coverage figure quoted anywhere in `docs/` matches a run, with the date

**Abuse cases**
- Raising the percentage with more mocked service tests
- Counting the 687 passing tests as evidence that the auth flow works

---

### F-05 — Token refresh is dead end to end, and 401 races the cookie clear

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | the dead refresh is verified from code on both sides. The redirect race is **reasoned, not reproduced** — it depends on whether a `window.location` assignment outlives an in-flight `fetch`, which I could not test without a browser |
| **Evidence** | **(a)** `frontend/src/app/api/v1/[...path]/route.ts:95` rotates the cookie only when the parsed body has `data.token` or `data.session?.id` at the **top level**. `backend/src/controllers/auth.controller.js:243` answers refresh with `success(res, result.data, …)`, and `backend/src/services/auth.service.js:586-594` puts `token`, `refreshToken` and `session` **inside** `data`. So the condition is never true for a refresh and the rotated token is discarded. **(b)** `grep -rn "authService.refresh\|\.refresh(" frontend/src` finds only `router.refresh()` and `ScrollTrigger.refresh()` — `authService.refresh` (`frontend/src/api/services/auth.service.ts:212-231`) has **no caller**. **(c)** its signature requires a `refreshToken` argument, and the client never receives one: the login response carries only `token` and `session`. **(d)** `backend/src/utils/jwt.util.js:202` defaults the access token to `15m`; the cookie is written with `maxAge: 7 * 24 * 60 * 60` at `route.ts:101`, `login/route.ts:45` and `sso-session/route.ts:32`. **(e)** `frontend/src/api/client.ts:47-52` handles 401 with `window.location.href = "/login"` and clears nothing; `frontend/src/proxy.ts:19-21` then redirects `/login` **back** to `/dashboard` whenever the `auth_token` cookie exists |
| **Spec refs** | `docs/FRONTEND/03-API-CLIENT.md:26` and `:100` ("a 401 handler that clears the session") · `docs/FRONTEND/08-ERROR-BOUNDARIES.md:65` and `:86` ("401 must not loop") · A-48 |

**Why it matters here.** There is no session continuity. With the default 15-minute access token, a
user loses their session every fifteen minutes, mid-form, to a hard navigation that discards unsaved
input. The refresh machinery that would prevent it exists on both sides and is connected on neither:
the endpoint works, the service function is written, nothing calls it, the client holds no refresh
token, and if it did the proxy would drop the rotated one on the floor because it reads `body.token`
where the backend writes `body.data.token`.

The 401 path is then the only exit, and it is a hard redirect that clears no cookie. Whether it loops
depends on a race: `authStore.initialize()`'s catch (`stores/authStore.ts:96-102`) does call
`authService.logout()`, which clears the cookies server-side — but `client.ts:51` has already begun a
navigation, and `DashboardPage` calls `fetchUser()` concurrently (`app/dashboard/page.tsx:45`), whose
catch (`stores/authStore.ts:358-368`) clears **nothing**. If the navigation wins, the stale
`auth_token` is still in the jar when `proxy.ts:19` sees `/login`, and the user is sent back to
`/dashboard` to do it again. This is the loop `docs/FRONTEND/08-ERROR-BOUNDARIES.md:86` forbids by
name, and it is the first thing to check before the refresh work, because it is cheap to reproduce.

**Fix direction.** Make the proxy read the rotated token from `data.token`/`data.session.id` as well
as the top level — or better, have it read one documented location and fix whichever side disagrees,
with an ADR if the envelope is the thing that changes. Give the client a refresh path: either a
refresh cookie the proxy owns end to end, or a proxy-side silent refresh on a 401 from the backend so
the browser never sees one. Replace `window.location.href` with a route that clears the cookies
first and only then navigates (`@next/next/no-location-assign-relative-destination` already warns on
this line). Align the cookie's `maxAge` with the refresh window rather than with seven days.

**Definition of Done**
- [ ] a 401 from the backend either refreshes transparently or lands the user on `/login` **once**, with the cookies gone — asserted by a handler test, named
- [ ] the rotated token from `POST /auth/refresh` reaches the cookie; a test asserts the exact body shape the backend sends
- [ ] `auth_token`'s `maxAge` is justified in a comment against the token's actual lifetime
- [ ] a manual run with `JWT_ACCESS_EXPIRED=60s` confirms no redirect loop and no lost form input
- [ ] `docs/FRONTEND/03-API-CLIENT.md:26` and `:100` are corrected or the code is made to match them

**Abuse cases**
- "Fixing" the loop by removing the `/login` → `/dashboard` redirect in `proxy.ts`, which hides it rather than clearing the cookie
- Adding a refresh call in a component instead of in the client or the proxy

---

## Medium

### F-06 — `x_tenant_id` survives logout

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Verified** | from code. Not reproduced against a live super-admin account |
| **Evidence** | `frontend/src/stores/authStore.ts:272-274` — `impersonate` sets `x_tenant_id` to the impersonated tenant. `:301-303` — `exitImpersonation` deletes `impersonating`, `auth_logged_in` **and** `x_tenant_id`. `:326` — plain `logout` deletes **only** `impersonating`. `frontend/src/app/api/v1/auth/logout/route.ts:26-28` deletes `auth_token`, `auth_session` and `auth_logged_in` — not `x_tenant_id`. `frontend/src/app/api/v1/[...path]/route.ts:19-20` then reads that surviving cookie and `:50` sends it as `X-Tenant-ID` on every later request. `backend/src/middlewares/auth.middleware.js:144-164` honours the header for `SUPER_ADMIN`/`SUPERADMIN` and rebinds `req.tenantId` to it. Plain password login never sets the cookie (`authStore.ts:117-164`), so the stale value is not overwritten |
| **Spec refs** | `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` · `docs/MULTI-TENANCY/08-CROSS-TENANT-PROTECTION.md` · A-01 |

**Why it matters here.** A super admin impersonates a user in tenant B, then leaves by the normal
sign-out button rather than "exit impersonation" — or their session simply expires and the 401 path
takes over. `x_tenant_id=<B>` stays in the jar. They sign back in as themselves and every request
carries `X-Tenant-ID: B`, which the backend honours because they are a super admin. The
`impersonating` cookie **was** deleted, so `ImpersonationBanner` does not render: the one signal that
they are not in their own tenant is gone. Writes made in that state are stamped into tenant B and
audited as the super admin acting normally.

Secondary, same shape, lower stakes: `tenant_branding` is written to `localStorage`
(`stores/tenantBrandingStore.ts:31`), read unconditionally on mount
(`hooks/useTenantBranding.ts:22-30`), and cleared only on a 401 (`:58-61`) — never on logout. The
next user on a shared browser sees the previous tenant's name, logo and primary colour in the
chrome until their own branding resolves.

**Fix direction.** Delete `x_tenant_id` in `logout` and in the Next logout route, and clear the
branding store there too. Better: have the proxy send `X-Tenant-ID` only when an explicit
tenant-switch is active, and make that state derive from something the server confirmed rather than
from a client-writable cookie.

**Definition of Done**
- [ ] every sign-out path clears `x_tenant_id`, `tenant_branding` and `impersonating`
- [ ] a test asserts the cookie set after `impersonate` is gone after `logout`, not only after `exitImpersonation`
- [ ] a manual two-tenant run: impersonate B, plain logout, log back in, confirm the tenant badge and the data are the super admin's own
- [ ] if the header is kept, a visible indicator whenever `X-Tenant-ID` differs from the token's tenant

**Abuse cases**
- Clearing the cookie in `authStore.logout` only, and leaving the server route — the 401 path uses the server route
- Testing that the banner is hidden rather than that the tenant is right

---

**What was changed (2026-09-24)** — logout deletes `x_tenant_id`, `impersonating` and
`auth_logged_in` in a `finally`, so they go even when the logout request fails; resets the current
tenant; and clears the cached tenant branding. The server-side logout route deletes the same two
cookies. A password `login()` also clears any stale `x_tenant_id` first — this covers the 401 path,
where the API client reloads straight to `/login` and never runs logout at all. Against the old
code, *"logout after impersonation removes x_tenant_id…"* received `["auth_logged_in", "x_tenant_id"]`.

**Adjacent defect found, not fixed:** `tenantStore.fetchTenantById` and `updateTenant` **set**
`x_tenant_id` whenever a super-admin merely views or edits a tenant — silently switching their tenant
context. Recorded here so it is not lost.

### F-07 — No error boundary and no status handling below 401

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, by exhaustive grep over `frontend/src` |
| **Evidence** | `find frontend/src/app -name "error.tsx" -o -name "global-error.tsx"` → **nothing**; only `app/not-found.tsx` exists. `grep -rn "status === 4\|status === 5" frontend/src` → the only HTTP branch in the app is `client.ts:47` (401) and `app/api/v1/auth/login/route.ts:32` (202). `grep -rn "409" frontend/src` → one false positive (`eSignature.service.ts:28`, a key-size type). `AccessDeniedModal` exists at `frontend/src/components/AccessDeniedModal.tsx` and `grep -rn "AccessDenied" frontend/src` finds **no import of it** — it is dead code. No `EmptyState` or `ErrorState` component exists. `grep -rni "request-id" frontend/src` → nothing, although `backend/index.js:317` sets `X-Request-Id` on every response. Swallowed failures: `frontend/src/app/dashboard/session-management/page.tsx:62`, `:71`, `:93`, `:99` are all `catch { /* ignore */ }` — covering the session list load, the stats load, **revoke** and **delete**; `:103` (`handleRevokeAll`) has no catch at all |
| **Spec refs** | `docs/FRONTEND/08-ERROR-BOUNDARIES.md:19`, `:41-43`, `:55`, `:66`, `:68`, `:71`, `:103` · `docs/FRONTEND/00-FRONTEND-STANDARDS.md:113-115` · `CLAUDE.md` § Status Codes That Carry Meaning |

**Why it matters here.** `docs/FRONTEND/00-FRONTEND-STANDARDS.md:115` calls "a failed request must
never render as empty data" the single most important frontend rule in the product. The session-
management screen breaks it four times: a failed load renders an empty session table — which reads
as "no active sessions" — and a **failed revoke silently does nothing** while the row disappears
from the local array, so the operator is told the session is gone when it is not. That is a security
screen.

The partial credit is real and worth stating: `client.ts:39-43` lifts the backend's `message` onto
the `Error`, and most pages show `err.message` in a toast — so the descriptive 409 strings the
backend actually sends (`backend/src/services/eSignature.service.js:222`, and 27 others) do reach the
user, as a toast. `docs/FRONTEND/08-ERROR-BOUNDARIES.md:103` says a failure the user must act on
belongs in the page, not only in a toast, and a 409 is exactly that class.

What is entirely absent: any route-level boundary (an uncaught render error takes the whole route to
Next's default page), any 403 treatment (`docs/…:66` specifies `AccessDeniedModal` plus a menu
refetch — neither happens, and the modal has never been rendered), any 404/cross-tenant not-found
state, any 429 or offline state, and any surfacing of `X-Request-Id`, which the backend sets
specifically so a user can quote it.

**Fix direction.** Add `app/error.tsx` and `app/dashboard/error.tsx` first — that is one file each
and removes the blank-page failure mode. Centralise status handling in `client.ts` into one
normalised error carrying status, message and request id, then branch once: 403 → render
`AccessDeniedModal` and invalidate `menuStore`; 404 → not-found state; 409 → an in-page state
explanation with the backend message; 429 and network → retry states. Replace the four
`catch { /* ignore */ }` in session management with error states and re-throw the revoke failure.

**Definition of Done**
- [ ] `app/error.tsx` and `app/dashboard/error.tsx` exist and are exercised by a test that throws
- [ ] `client.ts` attaches `status` and the `X-Request-Id` response header to every rejection
- [ ] `AccessDeniedModal` is rendered on a 403, and the menu is refetched
- [ ] no `catch { /* ignore */ }` remains on a path that loads or mutates data; a failed revoke shows an error and leaves the row
- [ ] one screen per status (403/404/409/429/offline) is demonstrated manually and named in the record

**Abuse cases**
- Adding a boundary that renders "Something went wrong" and calling the 409 requirement met
- Showing the request id only in the console

---

### F-08 — Two `proxy.ts` files with different auth logic

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | both files read; **which one Next 16 loads was not verified** — no build was run |
| **Evidence** | `frontend/proxy.ts` and `frontend/src/proxy.ts` both export `proxy` and a `config.matcher`. They differ: the root copy treats a client-supplied `Authorization: Bearer …` header as authentication (`frontend/proxy.ts:14-16`), and on a failed dashboard check it **clears** `auth_token` and a `session` cookie with `sameSite: "strict"` (`:21-38`); the `src/` copy (`frontend/src/proxy.ts:6-22`) checks only the cookie, clears nothing, adds a `callbackUrl` query parameter, and also guards `/register`. Neither is a superset of the other |
| **Spec refs** | `docs/FRONTEND/01-ROUTING.md` |

**Why it matters here.** Next 16 renamed middleware to `proxy.ts` and resolves it from the project
root *or* from `src/`. With both present, which one runs is a property of the toolchain, not of the
repository, and the two disagree about whether an expired session's cookie gets cleared — which is
precisely the behaviour F-05's redirect loop turns on. It is also a maintenance trap: a reader
fixing the redirect logic has an even chance of editing the dead file and concluding the fix did not
work.

The root copy has its own defect worth noting before it is deleted: accepting an `Authorization`
header as proof of session for a *page* navigation is meaningless (a browser cannot set one on a
top-level navigation) and would be wrong if it could.

**Fix direction.** Delete one. Keep the `src/` copy — it is the one consistent with `src/app` — and
fold in the cookie-clearing the root copy does, since F-05 needs it. Record the deletion.

**Definition of Done**
- [ ] exactly one `proxy.ts` remains in the repository
- [ ] its behaviour on a dashboard route with no token, with an expired token, and on `/login` with a token is asserted by tests, named
- [ ] the build is run once to confirm the surviving file is the one Next loads

**Abuse cases**
- Deleting the file that was actually live and assuming the redirects still work because the tests mock the module

---

### F-09 — `sso-session` writes the auth cookie from an unverified body

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code. Whether the route is reachable cross-origin depends on CORS and was **not** tested |
| **Evidence** | `frontend/src/app/api/v1/auth/sso-session/route.ts:12-46`: the handler reads `body.token`, checks only that it is present (`:18`), and writes it straight into the httpOnly `auth_token` cookie (`:35`) plus `auth_logged_in=true` (`:41-44`). It never calls the backend, never verifies a signature, and there is no CSRF token, no origin check and no state parameter tying the call to an SSO flow it started. Called from `frontend/src/stores/authStore.ts:206-210` |
| **Spec refs** | `docs/SECURITY/03-AUTHENTICATION.md` · `docs/FRONTEND/03-API-CLIENT.md:113-120` |

**Why it matters here.** This is a session-fixation primitive sitting on the app's own origin. Any
script that runs same-origin — an XSS, a malicious dependency, a compromised CMS-rendered blog post
under `app/blog/[slug]` — can pin the browser to a session of the attacker's choosing, and because
the cookie is httpOnly the victim's own code cannot notice or undo it. The victim then works inside
the attacker's account and everything they type goes to the attacker's tenant. The JSON content type
makes a trivial cross-site form POST unlikely to succeed, which is why this is medium and not high,
but that is a side effect of the content type rather than a control.

The second-order cost is quieter: because nothing validates the token, a malformed or expired one is
accepted and persisted, and the user then gets a 401 on every request with no explanation of why.

**Fix direction.** Have the route verify the token with the backend before writing any cookie —
`POST /api/v1/auth/verify` with the candidate token, and write the cookie only on a 200. Bind the
call to the SSO flow with a `state` value the route itself issued and stores, and reject a token that
does not match. Reject any request whose `Origin`/`Sec-Fetch-Site` is not same-origin.

**Definition of Done**
- [ ] no cookie is written unless the backend confirms the token
- [ ] the route requires a `state` it minted, single-use
- [ ] cross-origin and missing-origin requests are refused
- [ ] handler tests for: valid token, forged token, replayed state — each named

**Abuse cases**
- Decoding the JWT locally to "verify" it — an unverified signature check is not a check
- Accepting the token because it parses

---

### F-10 — Global search 403s on every keystroke for the roles A-04 excluded

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code on both sides. The exact 403 message string a user would see was **not** captured from a live call |
| **Evidence** | `frontend/src/components/layouts/TopBar.tsx:47` renders `<GlobalSearch />` unconditionally for every authenticated role. `frontend/src/components/layouts/GlobalSearch.tsx:108-110` fires a search 300 ms after the input stops changing, for any query of two characters or more (`:98`). `:80-85` puts any failure — including a 403 — into `error` and `:198-201` renders it as red text in the dropdown. There is no status branch and no capability check anywhere in the component. Backend: `backend/src/routes/api/search.route.js:43-48` now gates the route with `dynamicAccess(SEARCH_MENUS, "read")`, so a role holding read on **none** of device, stock or certificate is refused at the gate (A-04, landed 2026-09-23) |
| **Spec refs** | `docs/FRONTEND/05-RBAC-IN-UI.md` · `docs/FRONTEND/00-FRONTEND-STANDARDS.md:105-107` · A-04, A-23 |

**Why it matters here.** A-04 tightened `/search` correctly. The frontend was not told. A role such
as a maintenance-only or finance-only user now sees a search box inviting them to "Search devices,
stock, certificates…", and gets a red permission error in a dropdown after every two characters they
type. Beyond looking broken, each keystroke burst is a request against the rate limiter that A-30
made durable, so a user who types a long query can lock themselves out of the limiter budget for
reasons unrelated to anything they did wrong.

`docs/FRONTEND/00-FRONTEND-STANDARDS.md:107` is explicit that an unauthorised surface must be
**absent**. This one is present, prominent and actively failing.

**Fix direction.** Derive whether the search box renders from the resolved menu tree already in
`menuStore` — if none of the three searchable menus is present, do not render the input at all. As
defence in depth, treat a 403 from `/search` as "hide the control for this session" rather than as a
message. While there, `GlobalSearch.tsx:100-104` is one of the 85 lint errors in F-03.

**Definition of Done**
- [ ] `GlobalSearch` renders only when the menu tree contains at least one searchable menu
- [ ] a 403 from `/search` removes the control rather than rendering an error
- [ ] a test per role shape (all three menus, one menu, none) — named
- [ ] manual check with a role holding none of the three: no search box, no requests in the network tab

**Abuse cases**
- Hiding the error text and leaving the requests firing
- Hard-coding a role list in the component instead of reading the server-resolved menu

---

### F-11 — The public certificate PDF link prefixes the backend origin

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code. Whether the backend origin is browser-reachable in a given deployment was **not** verified — on a deployment where it is, the link works |
| **Evidence** | `frontend/src/app/verify/[certificateNumber]/page.tsx:159-160` — `const pdfUrl = data?.documentUrl ? `${API_BASE_URL}${data.documentUrl}` : null`. `backend/src/services/certificatePdf.service.js:205` writes `filePath = "/uploads/certificates/<file>.pdf"` and `:313` returns it as `documentUrl` — an already-root-relative path. `frontend/next.config.ts:14-21` rewrites `/uploads/:path*` to the backend, and `frontend/src/lib/uploadUrl.ts:19-30` exists solely to **strip** an origin off such a path for exactly this reason. Same pattern at `frontend/src/app/dashboard/tenants/hooks/useTenants.ts:141`, which builds a tenant logo URL as `${NEXT_PUBLIC_API_BASE_URL \|\| ""}/uploads/${tenant.logo}` |
| **Spec refs** | `docs/FRONTEND/07-MEDIA-HANDLING.md` · `docs/UI-UX/14-PUBLIC-SURFACES-UX.md` · `MEMORY` note "Deployment gotchas" (`/api/` is served by the **frontend**) |

**Why it matters here.** `/verify/<certificateNumber>` is the one page an external auditor or a
hospital's quality department reaches from the QR code on a printed calibration certificate. The
page itself is well built — it distinguishes a verification failure from a network failure
(`:143-148`) — and then offers a "download the PDF" link built against `NEXT_PUBLIC_API_BASE_URL`.
On the documented deployment, where the browser reaches the app through the frontend origin and the
backend container is not published, that origin is not resolvable from the auditor's browser and the
link is dead. The fix already exists in the codebase and is not applied here.

**Fix direction.** Use `toSameOriginUpload(data.documentUrl)` — it is a one-line change and the
function was written for this. Apply the same to `useTenants.ts:141`. Then grep for any other
concatenation of `API_BASE_URL` with a path that came from the API.

**Definition of Done**
- [ ] `verify/[certificateNumber]/page.tsx` and `useTenants.ts` both route uploads through `toSameOriginUpload`
- [ ] no remaining client-side `${API_BASE_URL}` concatenation outside `lib/socket.ts` and the server-side proxy handlers
- [ ] the verification page is opened against a deployment where the backend origin is not published, and the PDF downloads

**Abuse cases**
- Adding the backend origin to `images.remotePatterns` instead of making the path same-origin
- Testing only on a local stack where both origins happen to be reachable

---

### F-12 — Form labels, dialogs and the missing `axe`

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | by grep over `frontend/src`. **No screen reader and no automated a11y scan was run** — `axe` is not installed, so this is a static review of markup, not an audit against assistive technology |
| **Evidence** | **Labels:** 156 `<label>` elements in the codebase, **14** with `htmlFor`. The shared primitives are the problem: `frontend/src/components/ui/Input.tsx:31-35` renders `<label>` with no `htmlFor` and `:43-59` renders the `<input>` with no `id`; `frontend/src/components/ui/FormField.tsx:22-27` does the same for every field built on it. **Error text:** `grep -rn "aria-invalid\|aria-describedby" frontend/src` → **0 matches**, so `Input.tsx`'s `error` prop and `FormField.tsx:29-31`'s error paragraph are visual only. **Dialogs:** 16 components render a `fixed inset-0` overlay; `grep -rn 'role="dialog"\|aria-modal' frontend/src` → **0 matches**. `frontend/src/components/ui/Dialog.tsx:32-53` has no `role`, no `aria-modal`, no `aria-labelledby` pointing at its own `<h2>` (`:38`), no Escape handler, no focus trap, no focus restore, no scroll lock, and its close control (`:41-48`) is an icon-only button with no accessible name. **Skip link:** none. **Tooling:** `axe` appears nowhere in `frontend/package.json` or in any test |
| **Spec refs** | `docs/FRONTEND/00-FRONTEND-STANDARDS.md:134-138` ("every control labelled… `axe` runs in the component and browser suites") · `docs/UI-UX/17-ACCESSIBILITY.md` · `docs/UI-UX/18-UX-ACCEPTANCE-CRITERIA.md` |

**Why it matters here.** The two unlabelled primitives are used by essentially every form in the
product, so a screen-reader user moving through a calibration entry form hears "edit text" with no
field name, and a validation failure is invisible to them — the field is not marked invalid and the
message is not associated. That is WCAG 1.3.1, 3.3.1, 3.3.2 and 4.1.2 together, on data entry that
feeds a compliance record. The dialogs compound it: focus is never moved into the overlay and never
trapped, so a keyboard user tabs through the page behind the modal and cannot close it without a
mouse.

What is done right and should not be undone: `components/ui/ToastContainer.tsx:36-37` carries
`role="alert"` and `aria-live`, and its close button has an `aria-label` (`:54`);
`prefers-reduced-motion` is honoured in `app/globals.css:73`, `:405`, `:447`, `:608` and through
`components/motion/useReducedMotionSafe`. The one nit on the toasts is that `aria-live="assertive"`
is used for `info` toasts too, which interrupts a screen reader for something that is not urgent.

**Fix direction.** Fix the two primitives first — a generated `id`, `htmlFor`, `aria-invalid` and
`aria-describedby` in `Input.tsx` and `FormField.tsx` fixes most of the product in one change. Give
`Dialog.tsx` `role="dialog"`, `aria-modal`, `aria-labelledby`, an Escape handler, a focus trap and
focus restore, then migrate the other 15 overlays onto it. Add a skip link to the dashboard layout.
Install `axe` and wire it into the component suite so the standards document stops being aspirational.

**Definition of Done**
- [ ] `Input`, `FormField`, `Select`, `Textarea`, `DateField`, `MultiSelect` and `SearchableDropdown` associate label, control and error
- [ ] `Dialog` is keyboard-complete, and the other overlays use it
- [ ] `axe` runs in the component suite and the run is named in the record
- [ ] one form and one dialog are walked with a screen reader and the result written down
- [ ] `docs/FRONTEND/00-FRONTEND-STANDARDS.md:138` is corrected until the tooling exists

**Abuse cases**
- Adding `aria-label` to the input and leaving the visible `<label>` unassociated
- Counting a passing `axe` run on a page with no dialog open as covering the dialogs

---

### F-13 — Two endpoints break the envelope, and the frontend is coded to match

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code on both sides |
| **Evidence** | **Sessions:** `backend/src/controllers/session.controller.js:99-110` calls `success(res, { sessions, meta: { total, page, limit, totalPages } }, …)` — rows and pagination both **inside** `data`. `frontend/src/api/services/session.service.ts:37-43` types it that way and `frontend/src/app/dashboard/session-management/page.tsx:48`, `:52`, `:53`, `:56` read `response.data.sessions` and `response.data.meta`. **Metered billing:** `backend/src/services/meteredBilling.service.js:523-535` returns `{ rows, meta }` and `backend/src/controllers/meteredBilling.controller.js:41` passes it through as `data`; `frontend/src/api/services/meteredBilling.service.ts:158-172` reads `response.data.rows` and `response.data.meta`, with a comment at `:154` stating the endpoint "genuinely nests { rows, meta } inside `data`" |
| **Spec refs** | `CLAUDE.md` § The Response Envelope · `docs/FRONTEND/03-API-CLIENT.md:34-40` · `docs/FRONTEND/00-FRONTEND-STANDARDS.md:68` · `docs/API/00-API-STANDARDS.md` |

**Why it matters here.** `CLAUDE.md` states the rule three times and the frontend documents state it
twice more: rows in `data`, pagination in a **top-level** `meta`. Two live endpoints violate it, and
the frontend has been written around the violation rather than the violation being fixed — including
a comment that records it as intentional. That is the deviation protocol skipped: the code now
encodes a second, undocumented envelope, and the next person who "fixes" either backend endpoint to
match `CLAUDE.md` will silently empty the session-management table and the billing history, with no
error, which is the exact failure mode the rule exists to prevent.

The rest of the frontend is in good shape on this point and deserves saying: `device.service.ts:92-107`,
`calibration.service.ts:228-236` and `attachment.service.ts:73-78` all read the top-level `meta`
first and fall back defensively, and `qms.service.ts:20`, `sop.service.ts:106` and
`batchJob.service.ts:17` document the named-key shapes (`documents`, `jobs`) rather than guessing.
`grep -rn "data\.rows\|data\.items\|data\.meta"` over the whole frontend finds no case other than
the two above.

**Fix direction.** This is a backend fix with a frontend follow-up, and it needs an ADR because it
changes a response shape: move `sessions` → `data`, `meta` → top level for `GET /api/v1/sessions`,
and the same for `GET /api/v1/metered-billing/history`. Update both services and the session page in
the same change. If the decision is instead to accept the nesting, that is a deviation and
`CLAUDE.md` plus both frontend documents must be amended to describe the exception.

**Definition of Done**
- [ ] an ADR records which way the two endpoints go
- [ ] backend and frontend land in the same commit; the session table and the billing history are both loaded manually afterwards
- [ ] a contract test asserts the chosen shape for both endpoints, named
- [ ] `docs/API/00-API-STANDARDS.md` lists the outcome

**Abuse cases**
- Changing the backend and relying on the mocked service tests, which assert the frontend's belief and will keep passing
- Adding another defensive fallback instead of deciding

---

### F-14 — The client gives up at exactly the moment the server answers 408

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code. The race was **not** measured |
| **Evidence** | `frontend/src/constants/index.ts:42` — `API_TIMEOUT = 30000`, used as the axios `timeout` at `frontend/src/api/client.ts:7`. `backend/index.js:291` — `app.use(timeout("30s"))`, and `:299-307` answers `408` with `{ status: "Error", message: "Request timeout" }`. Every browser request also traverses the Next proxy (`frontend/src/app/api/v1/[...path]/route.ts`), which adds a hop and imposes no timeout of its own |
| **Spec refs** | `docs/FRONTEND/08-ERROR-BOUNDARIES.md:128` · `docs/FRONTEND/03-API-CLIENT.md:104-105` |

**Why it matters here.** The two budgets are identical and the client's starts earlier, so on any
request that actually reaches the server's limit the browser aborts first. The user sees axios's
`timeout of 30000ms exceeded` instead of the backend's "Request timeout", and no `X-Request-Id`,
which is the one thing `docs/FRONTEND/08-ERROR-BOUNDARIES.md:55` says an error state must carry.
Because the proxy imposes no timeout, the upstream request keeps running in the Next process after
the browser has given up — so a slow report can be executing twice while the user retries.

Separately: the 408 body is not in the standard envelope (`status: "Error"` instead of
`success: false`), so even if it did arrive, `client.ts:36-38`'s message extraction would find it
only by luck.

**Fix direction.** Set the client budget above the server's — 35 s against 30 s — so the server's
408 is what the user sees. Give the proxy's `fetch` an `AbortSignal` slightly above the backend's so
an abandoned request does not outlive the client. Put the 408 body in the standard envelope. Surface
`X-Request-Id` on every error (see F-07).

**Definition of Done**
- [ ] client timeout > proxy timeout > server timeout, with the numbers in one place and commented
- [ ] a deliberately slow endpoint produces the backend's 408 message in the UI, demonstrated
- [ ] the 408 response uses the standard envelope
- [ ] the proxy aborts its upstream fetch when its own budget expires

**Abuse cases**
- Raising the client timeout without bounding the proxy, so an abandoned request runs to completion server-side

---

## Low

### F-15 — The menu falls back to the full static tree

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code. The fallback path was **not** observed firing — `verifyUserSession` does return `roleId` (`backend/src/services/auth.service.js:434`), so in the normal case the server-resolved menu is used |
| **Evidence** | `frontend/src/stores/menuStore.ts:46-52`: `if (roleId) { … getAvailableMenuGroups(roleId) } else { menuGroups = DASHBOARD_MENU }`. `frontend/src/components/layouts/DashboardLayout.tsx:38-43` passes `user?.roleId` and calls the no-argument form when it is missing. `frontend/src/constants/index.ts:80` defines `DASHBOARD_MENU`, which includes Menu Group Assignment (`:112`), **Tenants** (`:117`), **Roles** (`:122`), **Users** (`:127`) and Session Management (`:154`) |
| **Spec refs** | `docs/FRONTEND/00-FRONTEND-STANDARDS.md:103-109` ("there is no client-side permission array"; "an unauthorised surface is **absent**") · `docs/FRONTEND/05-RBAC-IN-UI.md` |

**Why it matters here.** The failure mode of a permission-derived menu should be *less* menu, not
*all* of it. Any condition that leaves `roleId` unset — a change to the `verify` payload, a
mid-load render, a user record whose role was removed — hands every authenticated principal the full
administrative navigation. The backend still refuses the requests (A-01, A-02, A-27 all landed), so
this is disclosure and confusion rather than escalation, but it also means a stale `roleId` produces
a menu nobody chose. And `DASHBOARD_MENU` is, literally, the client-side permission array the
standards document says does not exist.

**Fix direction.** Make the no-`roleId` case render an empty menu and a visible "could not load your
menu — retry" state. Keep `DASHBOARD_MENU` only if something else needs it; if not, delete it.

**Definition of Done**
- [ ] a missing `roleId` yields an empty menu plus a retry, never the static tree
- [ ] a menu-fetch failure is visible rather than silent (`menuStore.ts:60-69` currently only stores the message)
- [ ] a test covers both branches — named. `menuStore.ts` is currently at 37.5% statement coverage

**Abuse cases**
- Trimming `DASHBOARD_MENU` down to "safe" entries rather than removing the fallback

---

### F-16 — The proxy buffers every request and response whole

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code. No memory measurement was taken |
| **Evidence** | `frontend/src/app/api/v1/[...path]/route.ts:56` — `body = await req.arrayBuffer()` for every non-GET; `:66` — `const responseData = await res.arrayBuffer()` for every response; `:115` returns the buffer. Nothing streams. Attachment downloads go through this path (`frontend/src/api/services/attachment.service.ts:119-123`) as do uploads (`:94-105`). Also at `:25-35`: incoming headers are copied wholesale and `Authorization` is overwritten **only if** the `auth_token` cookie exists (`:38-40`), so a client-supplied `Authorization` header reaches the backend unchanged when it does not |
| **Spec refs** | `docs/FRONTEND/09-PERFORMANCE.md` · `docs/FRONTEND/07-MEDIA-HANDLING.md` |

**Why it matters here.** Every byte of every upload and download is held in the Next process, twice
for an upload (once as the incoming buffer, once as the outgoing body), with no size ceiling on the
frontend side. A handful of concurrent attachment downloads is enough to matter on a small container,
and the failure mode is the whole frontend, not one request. The header passthrough is not an
escalation — a caller could present the same bearer token to the backend directly — but it quietly
contradicts `docs/FRONTEND/03-API-CLIENT.md:120`, and a proxy that forwards a credential it did not
mint should be doing so on purpose.

The clean half: the header filter correctly drops `set-cookie`, `content-encoding`, `content-length`
and `transfer-encoding` from the response (`:77-84`), each with a comment explaining the bug it
fixed, and the upload failure path gives an actionable message rather than "fetch failed"
(`:119-136`).

**Fix direction.** Stream: pass `req.body` through as a `ReadableStream` with `duplex: "half"`, and
return `res.body` directly instead of buffering. The token-rotation check at `:88-113` is the only
reason the response is read, so gate that on a JSON content type and a small size, or move rotation
to the dedicated auth routes where it belongs. Decide explicitly whether a client `Authorization`
header should be stripped, and comment the decision.

**Definition of Done**
- [ ] request and response bodies stream through the proxy; a large attachment round-trips without the buffer
- [ ] token rotation no longer requires reading every response body
- [ ] the `Authorization` passthrough is either removed or documented as intentional at the line
- [ ] `docs/FRONTEND/03-API-CLIENT.md:113-120` is corrected to describe what the proxy actually does

---

### F-17 — Unread badge drift, and two dependencies nothing imports

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code and by grep |
| **Evidence** | **Badge:** `frontend/src/stores/notificationStore.ts:12-17` holds a **count**, not ids, so `docs/FRONTEND/06-REALTIME.md:58` ("deduplicate by id, **always**") cannot be satisfied by this store. `frontend/src/hooks/useLiveNotifications.ts:36` increments on every `new_notification` push while the notifications page independently sets the count from `meta.unread` (`app/dashboard/notifications/hooks/useNotifications.ts`), so the two writers race; a push arriving between the initial fetch and its `setUnreadCount` is counted twice. Neither subscriber refetches on reconnect, so pushes missed while disconnected leave the badge permanently low — `docs/FRONTEND/06-REALTIME.md:73` and `:92` require a refetch. **Dependencies:** `framer-motion` and `@lottiefiles/dotlottie-react` are in `frontend/package.json:29` and `:19`; `grep -rl` over `frontend/src` finds **0** files importing either (all 24 animation imports use `motion/react`) |
| **Spec refs** | `docs/FRONTEND/06-REALTIME.md:54-58`, `:68-73` · A-18 (the backend equivalent) |

**Why it matters here.** The bell is the one always-visible number in the chrome and it drifts in
both directions with nothing reconciling it until a full page load. `framer-motion` and `motion` are
the same library under two names; shipping both in the dependency tree invites a duplicate copy in
the bundle and makes the lockfile lie about what the app uses.

**Fix direction.** Keep the last N notification ids in the store and dedupe on arrival, or drop the
increment entirely and refetch the count on every push — the page already refetches, so the
increment buys nothing. Refetch the count on `connect`. Remove the two unused dependencies.

**Definition of Done**
- [ ] the unread count cannot double-count a notification that arrives during the initial fetch, asserted by a test — named
- [ ] a socket reconnect refetches the count
- [ ] `framer-motion` and `@lottiefiles/dotlottie-react` are removed and the app builds

---

## Documentation the Code Contradicts

Recorded here rather than amended, because `CLAUDE.md`'s deviation protocol wants a decision per
item — several of these are the *document* being right and the code being wrong, and fixing the
document would be the wrong repair.

| Document | Claim | What the code does |
|---|---|---|
| `docs/FRONTEND/03-API-CLIENT.md:21` | base URL is `NEXT_PUBLIC_API_BASE_URL` + `NEXT_PUBLIC_API_VERSION` | `frontend/src/api/client.ts:6` — `baseURL: ""` |
| `docs/FRONTEND/03-API-CLIENT.md:22` | `client.ts` owns the `Authorization` header, from `authStore` | `client.ts:13-16` says the opposite; the proxy injects it (`app/api/v1/[...path]/route.ts:38-40`) |
| `docs/FRONTEND/03-API-CLIENT.md:23` | `client.ts` owns `X-Tenant-ID` | set by the proxy from a cookie (`route.ts:19-20`, `:50`) |
| `docs/FRONTEND/03-API-CLIENT.md:24`, `:38`; `00-FRONTEND-STANDARDS.md:57`, `:70` | "`client.ts` unwraps `data` and surfaces `meta` separately. A service that reaches past the unwrap is doing it wrong" | `client.ts:70-93` returns `res.data` — the whole envelope — and **all 51 services** unwrap it themselves |
| `docs/FRONTEND/03-API-CLIENT.md:26`, `:100`; `08-ERROR-BOUNDARIES.md:65` | the 401 handler "clears the session" | `client.ts:47-52` navigates and clears nothing (F-05) |
| `docs/FRONTEND/03-API-CLIENT.md:101`; `08-ERROR-BOUNDARIES.md:66` | 403 → `AccessDeniedModal`, and refetch the menu | `components/AccessDeniedModal.tsx` has no importer; no 403 branch exists (F-07) |
| `docs/FRONTEND/03-API-CLIENT.md:103`; `08-ERROR-BOUNDARIES.md:68` | 409 surfaces as a state explanation | no `409` branch anywhere in `frontend/src`; the message reaches a toast only (F-07) |
| `docs/FRONTEND/03-API-CLIENT.md:109-111`; `08-ERROR-BOUNDARIES.md:55` | "always surface `X-Request-Id`" | never read; `grep -rni "request-id" frontend/src` → nothing (F-07) |
| `docs/FRONTEND/03-API-CLIENT.md:117-120` | two transport paths; "the proxy forwards the caller's credentials and **adds none of its own**" | there is one path (`baseURL: ""`), and the proxy adds `Authorization`, `X-Session` and `X-Tenant-ID` from cookies (`route.ts:38-51`) |
| `docs/FRONTEND/03-API-CLIENT.md:126` | downloads go through signed URLs "built client-side by `src/lib/uploadUrl.ts`" | `lib/uploadUrl.ts:19-81` only strips origins for `next/image`; `attachment.service.ts:119-123` downloads through the session-authed proxy |
| `docs/FRONTEND/00-FRONTEND-STANDARDS.md:15` | no `any` | 41 `@typescript-eslint/no-explicit-any` errors across 10 files (F-03) |
| `docs/FRONTEND/00-FRONTEND-STANDARDS.md:18`, `:142-147` | `pnpm typecheck` must pass | `frontend/package.json` has no `typecheck` script; `turbo run typecheck` skips the package (F-03) |
| `docs/FRONTEND/00-FRONTEND-STANDARDS.md:32` | do not disable the React Compiler rules | 6 `set-state-in-effect` and 4 `exhaustive-deps` suppressions in source, plus 42 unsuppressed errors (F-03) |
| `docs/FRONTEND/00-FRONTEND-STANDARDS.md:105-107` | "the sidebar is built from the menu tree the **server** resolved. There is no client-side permission array" | `constants/index.ts:80` is one, and `stores/menuStore.ts:51` falls back to it (F-15) |
| `docs/FRONTEND/00-FRONTEND-STANDARDS.md:113`; `08-ERROR-BOUNDARIES.md:19` | `EmptyState` and `ErrorState` are separate components | neither exists anywhere in `frontend/src` |
| `docs/FRONTEND/00-FRONTEND-STANDARDS.md:136-138` | every control labelled; "`axe` runs in the component and browser suites" | 14 of 156 labels associated, 0 `aria-invalid`; `axe` is not a dependency (F-12) |
| `docs/FRONTEND/08-ERROR-BOUNDARIES.md:41-43` | `app/error.tsx`, `app/dashboard/error.tsx`, per-domain `error.tsx` | none of the three exists (F-07) |
| `docs/FRONTEND/08-ERROR-BOUNDARIES.md:71` | network failure → offline state with retry | no offline state; axios's message is shown verbatim |
| `docs/FRONTEND/08-ERROR-BOUNDARIES.md:86` | "401 must not loop" | `client.ts:51` → `/login` → `proxy.ts:19-21` → `/dashboard`, while the cookie survives (F-05) |
| `docs/FRONTEND/08-ERROR-BOUNDARIES.md:128` | the backend returns 408 for a long request | it does (`backend/index.js:299-307`), but the client aborts at the same 30 s and never sees it (F-14) |
| `docs/FRONTEND/06-REALTIME.md:58` | "deduplicate by id, **always**" | `notificationStore` holds only a count — no ids to dedupe on (F-17) |
| `docs/FRONTEND/06-REALTIME.md:73`, `:92`, `:115` | on reconnect, refetch | no `connect` handler refetches, and no room is re-joined (F-01) |
| `docs/FRONTEND/06-REALTIME.md:113-120` | six named socket test assertions | `lib/socket.ts` is at **0%** coverage; none of the six exists (F-04) |
| `docs/FRONTEND/03-API-CLIENT.md:34-40`; `00-FRONTEND-STANDARDS.md:68` | there is no `data.rows`, no `data.meta` | `GET /sessions` and `GET /metered-billing/history` return both, and the frontend reads them (F-13) |

Accurate and worth keeping as-is: the 51 services / 51 contract tests count
(`03-API-CLIENT.md:3`, `:60`), the mock-versus-live warning (`:79-83`), the `PATCH`-versus-`PUT` and
doubled-`/menu-groups` oddities (`:70-75` — all confirmed present in the routers), and the WinNAT
port-3000 note (`00-FRONTEND-STANDARDS.md:149-153`).

---

## Checked and Found Clean

Stated so nobody re-audits them.

| | |
|---|---|
| **Endpoint existence** | Every URL literal in `frontend/src` was extracted and matched, by method and path shape, against all 416 routes registered in `backend/index.js` and defined in `backend/src/routes/**`. **263 calls, 0 mismatches.** The historical "services written against imagined endpoints" problem is gone. Method and path are right; body and query *field names* were not systematically compared |
| **Type checking** | `npx tsc --noEmit` exits 0 under `strict: true` (`frontend/tsconfig.json:7`) |
| **Token storage** | No JWT in `localStorage` or `sessionStorage` anywhere. The only `localStorage` uses are the theme preference (`app/layout.tsx:36`, `contexts/ThemeContext.tsx:35`) and `tenant_branding` (`stores/tenantBrandingStore.ts:31`) |
| **Envelope reads** | `grep -rn "data\.rows\|data\.items\|data\.meta"` over the whole frontend finds only the two endpoints in F-13. `device.service.ts:98-104`, `calibration.service.ts:228-236` and `attachment.service.ts:73-78` prefer the top-level `meta` and fall back safely |
| **Bundle** | `jspdf` and `qrcode` are dynamically imported (`lib/certificatePdf.ts:43-44`), not in the main chunk. `NEXT_PUBLIC_*` values are build-time-inlined and the Makefile says so (`Makefile:267-268`) |
| **Public verification page** | `app/verify/[certificateNumber]/page.tsx:133-152` distinguishes a verification failure from a network failure and renders both — the only screen in the app that gets error states right. Its PDF link is F-11 |
| **Uploads** | `api/client.ts:25-33` strips `Content-Type` for `FormData` so the browser sets the multipart boundary, with the reason in a comment |
| **Reduced motion** | Honoured in `app/globals.css:73`, `:405`, `:447`, `:608` and via `components/motion/useReducedMotionSafe` |
| **Toasts** | `components/ui/ToastContainer.tsx:36-37`, `:54` — `role="alert"`, `aria-live`, labelled close button |
| **Server/client boundary** | `lib/content.api.ts` fetches the backend directly from Server Components with `use cache` / `cacheTag`, correctly avoiding the proxy at build time (`:1-8`). No client store is imported into a Server Component |
| **API-key scoping (2026-09-23)** | The attachment, e-signature and risk reads now authorising API keys by scope have **no frontend consequence** — the browser authenticates by session cookie through the proxy and never presents an API key. Checked, no change needed |
| **`/health` shape change (2026-09-23)** | The removal of `database` from the public `/health` breaks nothing, because the frontend has never called it. That is F-02, not a regression |

---

## Not Checked, and Why

- **Live behaviour of anything.** No dev server, no browser, no requests to a running backend. Every
  runtime claim above is read from code. The ones most worth confirming live, in order: the 401
  redirect loop (F-05), the socket hand-off between two users in one tab (F-01), and the 403 message
  a search-less role actually sees (F-10).
- **Which `proxy.ts` Next 16 loads** (F-08) — needs a build.
- **Whether the app builds at all.** `next build` was not run, so `cacheComponents: true`
  (`next.config.ts:54`) and the Server/Client boundaries were reviewed by reading, not by compiling.
  A green `tsc` is not a green build.
- **Request and response *field* names.** The endpoint inventory matched method and path only. A
  service sending `{ userId }` where the Joi validator expects `{ user_id }` would not have been
  caught here; that needs either generated types or the live suite.
- **Accessibility against assistive technology** (F-12). `axe` is not installed and no screen reader
  was used. What is reported is a static markup review — real, but not an audit.
- **Visual, responsive and motion behaviour** against `docs/UI-UX/06-DESIGN-SYSTEM.md`,
  `15-RESPONSIVE-DESIGN.md` and `16-MOTION-MICROINTERACTION.md`. Nothing was rendered.
- **Bundle sizes.** No build output, so the duplicate-animation-library concern in F-17 is inferred
  from the dependency list, not measured.
- **The Kanban, tickets, QMS, SOP, GDPR, SCIM and OIDC screens** were read only where an endpoint,
  an envelope or an error path took the audit through them. None was walked end to end.

---

## Found 2026-09-24 — the frontend coverage gate has never been green

`frontend/jest.config.js` sets a **70 %** coverage threshold. With `jest --coverage` the frontend sits
at **about 14 %**, so the command exits 1 — and it did before any change made today. `make verify`
never ran it: `frontend/package.json`'s `test` script is `jest` without `--coverage`, so the
threshold is never evaluated.

`CLAUDE.md` describes only the backend's 100 % gate. The frontend's gate exists in configuration,
has never passed, and has never been run by anything that would notice. That is the same shape as
the backend lint gate (A-34): a gate that looks enforced because it is written down.

---

### F-18 — The webhook screen cannot show the secret the backend now generates

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** — a webhook created from the UI is unusable |
| **Verified** | from the backend change, 2026-09-24 (A-51) |

Since A-51, the backend generates each webhook's signing secret and returns it **exactly once**, in
the create response and in `POST /webhooks/:id/rotate-secret`. Changing the URL rotates it as well.
It also **rejects** a `secret` field in the request body.

*(Corrected 2026-09-24: this card first said a sent `secret` fails with a 400. It does not — the
validator strips unknown keys.)* The create flow already showed the secret once. The secret returned
by a URL-changing edit was discarded, and there was no rotate action.

**Definition of Done**
- [x] the modal sends no `secret`
- [x] after create, rotate, or a URL change, the returned secret is shown once, with a copy button and a
      clear "you will not see this again"
- [x] a rotate action, behind a confirmation
- [x] a test against the **real** response shape, not an invented one

**What was changed (2026-09-24).** A new `SecretRevealDialog` handles create, rotate and URL change
in one place: the secret is shown once, with a copy button and *"You will not see this secret
again"*. `WebhookModal` warns before saving a changed URL that a new secret will be issued. The table
has a rotate button behind a `ConfirmDialog`, which says the old secret stops working immediately.
Two `set-state-in-effect` lint errors that were already in `useWebhooks.ts` are fixed without
disabling the rule.

**Tests:** `webhooks/__tests__/page.test.tsx` › *"WebhooksPage — signing secret (F-18)"* (5 tests), and
3 new tests in `webhook.service.test.ts`, with fixtures built from `publicWebhook()`'s real shape.
**These are mocked-client tests** — nothing has been verified against a live backend yet.
