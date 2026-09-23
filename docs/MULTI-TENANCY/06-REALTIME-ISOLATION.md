# 06 — Realtime Isolation

How tenant isolation works over a Socket.IO connection — and the two places it does not.

This document **extends** [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md), which is mandatory reading and is not repeated here. Read it first. What follows assumes you know what the global Sequelize hooks are, what `NO_TENANT_UUID` is for, and why deny-by-default is the whole point.

The transport itself — handshake, rooms, events, reconnection — is [`../ARCHITECTURE/10-REALTIME-ARCHITECTURE.md`](../ARCHITECTURE/10-REALTIME-ARCHITECTURE.md).

> **Target standard: TypeScript, strict (ADR-038).** The code described here is **JavaScript/CommonJS as built**: `backend/src/config/socket.js`, `backend/src/utils/tenantScope.util.js`, `backend/src/middlewares/tenantContext.middleware.js`, `backend/src/services/kanban.service.js`. Conversion is tracked in [`../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md) and changes no behaviour.

---

## The One Thing To Know

**A socket event is not an HTTP request, and it does not inherit an HTTP request's tenant context.**

Isolation in this system is installed once, globally, and reads an `AsyncLocalStorage` store. An HTTP request enters that store in `tenantContext.middleware.js:32`:

```js
tenantStorage.run({ tenantId, isSuperAdmin, isSystemTask }, () => { next(); });
```

Everything downstream of that `next()` — controller, service, every `await` — runs inside the store, because `AsyncLocalStorage` propagates along the async continuation chain.

A socket event handler is on a **different** chain. It is invoked by the Socket.IO server from the connection's own async context, which never passed through Express middleware at all. `tenantStorage.getStore()` inside it returns `undefined`.

And `undefined` does not mean "deny". It means **skip**:

```js
// backend/src/utils/tenantScope.util.js:50-60
const resolveScope = (options) => {
  if (options && options.skipTenantScope) return { mode: "skip" };

  const ctx = tenantStorage.getStore();
  if (!ctx) return { mode: "skip" };            //  ← here
  if (ctx.isSystemTask) return { mode: "skip" };
  if (ctx.isSuperAdmin) return { mode: "skip" };
  if (ctx.tenantId) return { mode: "filter", tenantId: ctx.tenantId };

  return { mode: "deny" };
};
```

`mode: "skip"` makes `applyTenantWhere` return before it touches `options.where` (`tenantScope.util.js:68`). **No predicate is added at all.** Not a denying predicate — none.

That branch is not a bug. It is what lets login, registration, public endpoints, migrations and schedulers run: they are genuinely not user-tenant requests, and denying them would break the system. The deny branch is reserved for a principal that *has* a context and no tenant in it.

The consequence for sockets is exact: **until 2026-09-23, every query a socket handler issued ran with the hooks skipped.** The surviving `kanban:join` handler called `kanban.assertAccess`, whose queries were therefore unscoped by the global mechanism.

## The Fix

Two pieces, both in `backend/src/config/socket.js`.

**1. The handshake builds a context.** On a successful handshake (`socket.js:151-155`):

```js
socket.tenantContext = {
  tenantId: user.tenantId || null,
  isSuperAdmin: isSuperAdminRole(user.role && user.role.name),
  isSystemTask: false,
};
```

Same three keys, same meanings, as `tenantContext.middleware.js:32`. The values come from `authService.getAuthUserWithTenant`, the same loader the HTTP `auth` middleware uses — not from anything the client sent.

**2. Handlers run inside it.** `socket.js:167-170`:

```js
const withTenantContext = (socket, handler) => {
  return (...args) =>
    tenantStorage.run(socket.tenantContext, () => handler(...args));
};
```

`socket.js:207-223` wraps `kanban:join` in it. Inside that handler `resolveScope` now returns `{ mode: "filter", tenantId }` for an ordinary principal, exactly as it does on an HTTP request, and every hook-scoped model gets its predicate.

`kanban:leave` (`socket.js:225`) and `disconnect` (`socket.js:229`) are **not** wrapped. Neither issues a query. If either ever does, it must be wrapped — see § Residual Risk.

The connection-level `console.log` at `socket.js:187` and the room joins at `192-201` are outside any context too; they issue no queries either.

## What The Gap Actually Cost

Document the mechanism, not the anecdote — but do not overstate the anecdote either. Two accidents limited the blast radius of the missing context, and neither is a control:

1. **`resolveAccess` carries its own predicate.** `kanban.service.js:88-90` loads the project as
   `KanbanProject.findOne({ where: { id: projectId, tenantId: user.tenantId } })` — an explicit tenant term in the `where`, independent of the hooks. A cross-tenant project id therefore returned 404 even with the hooks skipped.
2. **The child table was never hook-scoped anyway.** The second query in that path is `KanbanProjectMember.findAll({ where: { projectId, … } })` (`kanban.service.js:105-113`). Only `kanbanProject.model.js` and `kanbanCard.model.js` declare a `tenantId` attribute; `kanbanProjectMember.model.js` does not, so `tenantKeyOf` returns `null` and the hooks skip it whether or not a context exists. (This is the "Kanban child tables" row in [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) § Where The Hooks Do Not Reach.)

So the known exploitable leak through `kanban:join` was, on inspection, none. **That is not the point.** The mechanism the entire system's isolation rests on was silently inactive on an entire transport, and it was inactive in the `skip` direction — the fail-open one. Any handler added to that transport, or any predicate removed from `resolveAccess` as a cleanup, would have leaked with nothing to catch it: no error, no log line, no failing test.

The rule from `SECURITY/05` applies verbatim: *an isolation mechanism whose "no context" branch permits rather than denies is not an isolation mechanism.* Over sockets, that branch was the only one being taken.

## Isolation On The Emit Side

Inbound queries are one half. The other half is who receives a broadcast.

| Room | How the tenant boundary is drawn | Where |
|---|---|---|
| `tenant_<tenantId>` | the room name is built from `socket.user.tenantId`, read from the database at handshake time; a client cannot ask to join another tenant's room because it cannot ask to join at all | `socket.js:192` |
| `user_<userId>` | same, from `socket.user.id` | `socket.js:195` |
| `board_<projectId>` | joined **on request**, and only after `kanban.assertAccess(socket.user, projectId, "viewer")` succeeds — the same check the REST layer runs, and it resolves the project with an explicit `tenantId` term | `socket.js:207-223` |
| `super_admins` | joined only when `socket.tenantContext.isSuperAdmin`; nothing emits to it today | `socket.js:199-201` |

The emitters choose the room from **server-side data**, never from a socket payload:

- `notification.service.js:61-65` derives the room from the notification row's `userId`, else its `tenantId`, else emits nothing at all.
- `kanban.service.js` calls `emitToBoard(projectId, …)` with the `projectId` the already-authorized REST request operated on (`socket.js:248`).

`kanban:leave` takes a `projectId` from the client and leaves that room (`socket.js:225-227`). Leaving a room you are not in is a no-op, so it needs no check.

One cosmetic wart with no known leak: a principal with no tenant joins the literal room `tenant_null` (`socket.js:192` interpolates without a guard). Nothing emits to it, because `notification.service.js:61-65` only builds a room name from a truthy id.

## Residual Risk

These are open as of 2026-09-23. None of them is softened.

### 1. The checks are connect-time only

**A tenant suspended after the handshake keeps its live socket until it disconnects.**

`authenticateHandshake` runs once, in `io.use` (`socket.js:184`). Nothing re-evaluates the connection afterwards: there is no periodic revalidation, no `tenants.status` watcher, no server-side disconnect on suspension. `socket.tenantContext` is a snapshot taken at connect time and reused by `withTenantContext` for the life of the connection.

The same applies to every other principal-state change the handshake checks:

| Changed after connect | HTTP | Socket |
|---|---|---|
| tenant suspended or deleted | next request is refused (`auth.middleware.js`, BR-3) | **existing connection survives**; `new_notification` and `kanban:*` keep flowing |
| user set `INACTIVE` / `SUSPENDED` / `isActive: false` | next request is refused | **existing connection survives** |
| role changed | next request uses the new role | `socket.tenantContext.isSuperAdmin` keeps the **old** value |
| session revoked | not checked over HTTP either | not checked |

A reconnect closes the window — and the client's token is only good for 300 seconds, so a dropped connection will be re-gated. A connection that never drops is never re-gated.

Making sockets stricter than HTTP is a decision the owner has not made. A-05 records it as an **Open Question**, not a judgement call. Do not fix it in a bug fix.

### 2. Only one handler is wrapped, and nothing enforces it

`withTenantContext` is applied at exactly one call site (`socket.js:209`). A new `socket.on(...)` handler that issues a query and forgets the wrapper gets `mode: "skip"` — silently, with no error and no empty result to notice. This is the socket-layer twin of the route-without-a-permission-gate problem, and it has no equivalent of the P6-04 guard.

**Every new socket event handler that touches the database must be wrapped in `withTenantContext`, and must have a two-tenant test.**

### 3. `config/` is outside the coverage gate

`backend/src/config/` is in `coveragePathIgnorePatterns`, so `socket.js` does **not** count toward the 100 % backend coverage gate. Its reported 100 % comes from an explicit override run (A-05 residual; see also A-32).

### 4. None of this is verified live

The evidence is `backend/src/tests/config/socket.test.js` — 39 tests, including `"runs the handler inside this connection's tenant context"` (`socket.test.js:315`), `"joins a kanban board room inside the tenant context after an access check"` (`socket.test.js:406`), which asserts the CLS store seen *inside* `assertAccess`, and `"does not join the board room when the access check fails"` (`socket.test.js:428`). A two-tenant reproduction against a running server has not been done.

## Testing Realtime Isolation

`SECURITY/05` § Testing Isolation defines the two-tenant test for HTTP. The socket equivalent, which no suite currently runs end to end:

```
1. createTwoTenants(); a user in A, a user in B
2. as A, create a kanban project; note its id
3. connect a socket as B with a valid socket token
4. emit kanban:join with A's project id, WITH an ack callback
5. assert ack.ok === false and that B never receives a kanban:* event for that board
6. as A, mutate a card; assert B's socket receives nothing
7. suspend a DISPOSABLE tenant — never the default tenant (SECURITY/05 § Suspension) —
   and assert what its already-open socket does. Today: it keeps receiving. That is
   the documented residual, and the test should assert the behaviour that exists.
```

Step 4 matters: the production client (`useBoard.ts:59`) emits `kanban:join` **without** an ack, so a refused join is invisible to it. A test that omits the ack asserts nothing.

## Related

| For | Read |
|---|---|
| the mandatory isolation document this one extends | [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) |
| the transport: handshake, rooms, events, reconnection | [`../ARCHITECTURE/10-REALTIME-ARCHITECTURE.md`](../ARCHITECTURE/10-REALTIME-ARCHITECTURE.md) |
| the controls that stop one tenant reaching another over HTTP | [`./08-CROSS-TENANT-PROTECTION.md`](./08-CROSS-TENANT-PROTECTION.md) |
| the remediation card | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-05 |
