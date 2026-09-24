# 10 — Realtime Architecture

Socket.IO, both ends (ADR-031). What authorizes a connection, which rooms exist, which events cross the wire, who emits them, and what happens when the connection drops.

Tenant isolation over a socket is a separate document: [`../MULTI-TENANCY/06-REALTIME-ISOLATION.md`](../MULTI-TENANCY/06-REALTIME-ISOLATION.md). This one is the mechanism; that one is the boundary.

> **Target standard: TypeScript, strict (ADR-038).** The backend realtime hub is **JavaScript/CommonJS as built** — `backend/src/config/socket.js` is a `.js` file today. The frontend client is already TypeScript. Conversion of the backend is tracked in [`../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md) and changes no behaviour.

**Sources.** `backend/src/config/socket.js` (rewritten 2026-09-23 under A-05), `backend/src/controllers/auth.controller.js`, `backend/src/routes/api/auth.route.js`, `backend/src/services/notification.service.js`, `backend/src/services/kanban.service.js`, `frontend/src/lib/socket.ts`, `frontend/src/api/services/socketToken.service.ts`, `frontend/src/hooks/useLiveNotifications.ts`, `frontend/src/app/dashboard/kanban/[projectId]/hooks/useBoard.ts`.

---

## The Shape Of It

There is **one** Socket.IO server, created in `backend/src/config/socket.js#initSocket` and attached to the same `http.Server` as Express at `backend/index.js:674`. There is **one** client, a module-level singleton in `frontend/src/lib/socket.ts`. Every realtime feature in the product shares them.

```
POST /api/v1/auth/socket-token      cookie-authenticated, returns a 300 s JWT
        │
        ▼
io(API_BASE_URL, { auth: { token } })        frontend/src/lib/socket.ts:28
        │
        ▼
io.use(authenticateHandshake)                socket.js:184
        │  verify → load user → status checks → build socket.tenantContext
        ▼
connection: join tenant_<id>, user_<id>, [super_admins]      socket.js:192-201
        │
        ▼
socket.on("kanban:join", withTenantContext(...))             socket.js:207-223
```

The exported surface of the hub is three functions: `initSocket`, `getIo`, `emitToBoard` (`socket.js:174`, `237`, `248`). A fourth export, `__testables` (`socket.js:258`), exposes the handshake gate and the CORS policy because they are the security surface of the module and are asserted directly.

## The Handshake, And What Authorizes It

### The token is minted, not read from the cookie

The app JWT lives in an **httpOnly cookie that browser JS cannot read**, so the browser cannot put it in the handshake. Instead the client calls `POST /api/v1/auth/socket-token` through the cookie-authenticated proxy and gets a short-lived token back.

`backend/src/routes/api/auth.route.js:333` mounts it as `router.post("/socket-token", auth, socketToken)` — `auth` and nothing else; any authenticated principal may mint one for itself.

`backend/src/controllers/auth.controller.js#socketToken` (since 2026-09-24, A-52 / A-59):

```js
const token = generatePurposeToken(
  { id: req.user.id, sid: req.sessionId },
  "socket",
  { expiresIn: 300 },
);
```

- The payload carries `id` and the caller's session id `sid`. No tenant, role or permissions: everything the connection is authorized with is re-read from the database at handshake time.
- It is signed as `typ: "socket"` through the same key registry as every other token (`jwt.util.js#generatePurposeToken`). `verifyAccessToken` refuses it, so **a socket token is not an HTTP access token**. The handshake calls `verifyPurposeToken(token, "socket")`, so **an access token is not a handshake token**. Before 2026-09-24 the claim was `purpose: "socket"` and nothing read it.

### What the handshake gate does

`authenticateHandshake` (`socket.js:102-161`) is installed as the single `io.use` middleware and **deliberately mirrors `backend/src/middlewares/auth.middleware.js#auth`** — same loader, same checks, in the same order:

| Step | Line | Rejects when |
|---|---|---|
| read the token | `socket.js:89-95`, `107-115` | absent; **or supplied in the query string**, which is refused with its own log line before the token is ever parsed |
| `verifyPurposeToken(token, "socket")` | `socket.js` | signature, algorithm or expiry fails, or the token is not `typ: "socket"` |
| session check | `socket.js` | the token's `sid` names a revoked or expired session (`session.service.js#isSessionLive`) — connect-time only |
| `authService.getAuthUserWithTenant` | `socket.js:125` | the user does not exist |
| `user.isActive` | `socket.js:131` | the user is banned |
| `user.status` | `socket.js:135` | `INACTIVE` or `SUSPENDED` |
| tenant status | `socket.js:139-146` | the tenant is `suspended` or `deleted` (compared lowercased) |

A query-string token is refused **on purpose**: query strings are written to proxy and access logs, so a token there is a credential at rest in plaintext (`socket.js:12-15`).

Every rejection returns the same constant, `AUTH_ERROR = "Authentication error"` (`socket.js:44`), through `deny()` (`socket.js:46-50`), which logs the real reason to the server console only. An unauthenticated socket is never told whether the user, the account status or the tenant was the reason — the handshake is not an oracle.

On success the gate sets two things on the socket:

```js
socket.user = user;
socket.tenantContext = {                    // socket.js:151-155
  tenantId: user.tenantId || null,
  isSuperAdmin: isSuperAdminRole(user.role && user.role.name),
  isSystemTask: false,
};
```

`socket.tenantContext` has the same shape `tenantContext.middleware.js` builds for an HTTP request. What it is for is [`../MULTI-TENANCY/06-REALTIME-ISOLATION.md`](../MULTI-TENANCY/06-REALTIME-ISOLATION.md).

### CORS

`corsOrigin` (`socket.js:67-82`) mirrors the HTTP policy in `backend/index.js:154-192`: no `Origin` header is allowed (server-to-server), a configured origin is allowed, and everything else is allowed **outside** production and rejected **in** production. The allow-list is read from `CORS_ORIGIN` per call (`socket.js:56-60`) so a test or a reload sees the current environment.

`origin: "*"` is never used, because the server is configured with `credentials: true` (`socket.js:179`) — and because the handshake carries a credential.

## Rooms

Every room name is a string built from an id. There is no room registry; membership is decided at join time and lives in the Socket.IO server's in-memory adapter.

| Room | Joined at | Who is in it | What is sent to it |
|---|---|---|---|
| `tenant_<tenantId>` | `socket.js:192`, on connect, unconditionally | every socket of that tenant | tenant-wide notifications (`notification.service.js:64`) |
| `user_<userId>` | `socket.js:195`, on connect, unconditionally | that user's sockets | user-addressed notifications (`notification.service.js:62`) |
| `super_admins` | `socket.js:200`, on connect, when `socket.tenantContext.isSuperAdmin` | super-admin sockets | **nothing, today** — see below |
| `board_<projectId>` | `socket.js:213`, on the `kanban:join` event, **after an access check** | whoever passed `kanban.assertAccess(user, projectId, "viewer")` | every `kanban:*` event (`emitToBoard`) |

Three notes that will otherwise cost you an afternoon:

- **`super_admins` is a room nothing emits to.** `notification.service.js:52-57` records that the fan-out to it was removed deliberately: it pushed every user's notification to super admins, so their bell badge incremented for items that were not theirs and never appeared in their list — a phantom unread count plus a leak of other users' notification content. The join at `socket.js:200` remains and is asserted by a test (`src/tests/config/socket.test.js:394`). It is a live room with no publisher.
- **A principal with no tenant joins the literal room `tenant_null`.** `socket.js:192` interpolates `socket.user.tenantId` without a guard. Nothing emits to it either, because `notification.service.js:61-65` only builds a room name when `userId` or `tenantId` is truthy.
- **Board rooms are the only rooms with an access check.** The tenant and user rooms are derived from the authenticated principal, so they need none.

## Events

### Server → client

| Event | Emitted by | Room | Payload |
|---|---|---|---|
| `new_notification` | `notification.service.js:68` (`emitNotification`) | `user_<id>` if the row has a `userId`, else `tenant_<id>` if it has a `tenantId`, else **nothing is emitted** | the transformed notification row |
| `kanban:project:updated` | `kanban.service.js:525`, `553`, `565`, `586` | `board_<projectId>` | `{ project }` |
| `kanban:project:deleted` | `kanban.service.js:533` | `board_<projectId>` | `{ projectId }` |
| `kanban:column:created` / `:updated` / `:deleted` | `kanban.service.js:626`, `652`, `670` | `board_<projectId>` | `{ column }` / `{ column }` / `{ columnId }` |
| `kanban:column:reordered` | `kanban.service.js:704` | `board_<projectId>` | `{ columns }` |
| `kanban:card:created` / `:updated` / `:moved` | `kanban.service.js:791`, `848`, `909` | `board_<projectId>` | `{ card }` |
| `kanban:card:deleted` | `kanban.service.js:929` | `board_<projectId>` | `{ cardId, columnId }` |
| `kanban:label:created` / `:updated` / `:deleted` | `kanban.service.js:945`, `960`, `971` | `board_<projectId>` | `{ label }` / `{ label }` / `{ labelId }` |
| `kanban:sprint:created` / `:updated` / `:deleted` | `kanban.service.js:1012`, `1028`, `1040` | `board_<projectId>` | `{ sprint }` / `{ sprint }` / `{ sprintId }` |
| `kanban:cards:migrated` | `kanban.service.js:1087` | `board_<projectId>` | the migration result |
| `kanban:card:relations` | `kanban.service.js:1131`, `1155` | `board_<projectId>` | `{ cardId, relations }` |

Every `kanban:*` emission goes through `exports.emitToBoard` (`socket.js:248-254`), which is **best-effort and never throws**: a realtime hiccup must not fail the originating HTTP request. A failure is a `console.warn` and nothing else — and in production `console.*` output is written to no log file (see [`../OBSERVABILITY/01-LOGGING.md`](../OBSERVABILITY/01-LOGGING.md)).

`notification.service.js:59` calls `getIo()` inside its own `try/catch` for the same reason; the notification **row** is still stored when the emit fails.

### Client → server

| Event | Handler | Authorization | Ack |
|---|---|---|---|
| `kanban:join` | `socket.js:207-223` | `kanban.assertAccess(socket.user, projectId, "viewer")` — the same check the REST layer runs | optional. `ack({ ok: true })` or `ack({ ok: false, error })` when the client passed a callback |
| `kanban:leave` | `socket.js:225-227` | none — leaving a room you are not in is a no-op | none |
| `disconnect` | `socket.js:229-231` | — | logs only |

`kanban.service` is required **lazily inside the handler** (`socket.js:211`) to avoid a require cycle: `kanban.service` requires `config/socket` at its own module top (`kanban.service.js:28`).

There are **no other client-to-server events**. Anything else a client emits is ignored.

## The Client

`frontend/src/lib/socket.ts` is a singleton with three pieces of state: the socket, an in-flight `connecting` promise that deduplicates concurrent `getSocket()` calls, and a `refreshAttempts` counter.

```ts
socket = io(API_BASE_URL, {
  auth: { token },
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionDelay: 2000,
});
```

It connects to **the backend origin, not the Next proxy** (`API_BASE_URL` from `@/constants`).

Consumers:

| Hook | File | Listens for |
|---|---|---|
| `useLiveNotifications` | `frontend/src/hooks/useLiveNotifications.ts` | `connect`, `disconnect`, `new_notification` → unread badge, toast, sound |
| `useNotifications` | `frontend/src/app/dashboard/notifications/hooks/useNotifications.ts` | `new_notification` → prepends to the feed |
| `useBoard` | `frontend/src/app/dashboard/kanban/[projectId]/hooks/useBoard.ts` | twelve `kanban:*` events → patches the Zustand board store, or calls `reload()` for column and migration events |

Each hook removes **only its own listeners** on unmount; the singleton socket stays connected.

## Reconnection

| Concern | Behaviour | Where |
|---|---|---|
| transport drop | Socket.IO's own reconnection, enabled, 2 s base delay | `socket.ts:31-32` |
| handshake failure | on `connect_error`, fetch a **fresh** socket token, replace `socket.auth`, call `socket.connect()` | `socket.ts:41-51` |
| retry cap | 3 attempts (`MAX_REFRESH_ATTEMPTS`), reset to 0 on a successful `connect` | `socket.ts:13`, `35-37` |
| token refresh failure | swallowed; the socket is left disconnected | `socket.ts:48-50` |

The expected failure this handles is the 300-second token expiring while the tab is open: the reconnect attempt fails the handshake, the client mints a new token and retries.

**Room membership is not restored on reconnect, and this is a real gap.** A reconnect produces a new socket id and empty room membership on the server, but `useBoard.ts:59` emits `kanban:join` exactly once, from a `useEffect` keyed on `projectId` — there is no `connect` listener that re-joins. After a reconnect the board's REST data is still correct and its live updates have silently stopped until the effect re-runs (a navigation or a reload). `useLiveNotifications` is unaffected: the `user_` and `tenant_` rooms are re-joined by the server on every connection.

`useBoard.ts:59` also emits `kanban:join` **without an ack callback**, so a refused join is indistinguishable from a successful one on the client. The backend tolerates the missing callback explicitly (`socket.js:214`, and the test at `src/tests/config/socket.test.js:440`).

`disconnectSocket()` is exported from `socket.ts:64` and **called from nowhere in `frontend/src/`**. Logging out does not close the socket; see § Known Gaps.

## Scaling

**There is no Socket.IO adapter configured.** `new Server(server, { cors })` (`socket.js:175-181`) uses the default in-memory adapter, and neither `@socket.io/redis-adapter` nor `socket.io-redis` appears in the dependencies. `io.to(room).emit(...)` therefore reaches only the sockets held by **this** process.

That is consistent with the deployment as configured — `deploy/helm/callibrator/values.yaml:30` sets the backend `replicaCount: 1` (the frontend, at line 141, runs 2) — and it is a hard constraint on ever raising it: a second backend replica would deliver a notification or a board update to whichever half of the users happened to be connected to the emitting process. Sticky sessions do not fix it; an adapter does.

This has not been tested with more than one replica. It is stated from the code and the chart, not from an experiment.

## Known Gaps

Stated here rather than smoothed over; each one is real as of 2026-09-24. The line numbers in this document were taken on 2026-09-23 and may have moved; `socket.js` was edited under A-59.

| Gap | Detail |
|---|---|
| **Checks are connect-time only** | nothing re-evaluates a live socket. See [`../MULTI-TENANCY/06-REALTIME-ISOLATION.md`](../MULTI-TENANCY/06-REALTIME-ISOLATION.md) § Residual Risk |
| **Session revocation is checked at connect only** | since A-48/A-59 (2026-09-24) the handshake refuses a socket token whose session is revoked; a socket already connected is not disconnected when its session is revoked |
| **Board rooms are not re-joined after a reconnect** | `useBoard.ts:59`; live board updates stop silently |
| **`disconnectSocket` is never called** | `socket.ts:64`; the connection outlives a logout in the same tab |
| **`super_admins` is a publisher-less room** | `socket.js:200` |
| **`config/` is excluded from the coverage gate** | `socket.js` does not count toward the 100 % backend gate; its coverage figure comes from an explicit override run (A-05 residual, A-32) |
| **Not verified live** | the A-05 work is verified by `backend/src/tests/config/socket.test.js` (39 tests). No claim here rests on a browser session against a running server |

## Related

| For | Read |
|---|---|
| tenant isolation over a socket | [`../MULTI-TENANCY/06-REALTIME-ISOLATION.md`](../MULTI-TENANCY/06-REALTIME-ISOLATION.md) |
| the mandatory isolation document | [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) |
| what the hub's `console.*` output does and does not reach | [`../OBSERVABILITY/01-LOGGING.md`](../OBSERVABILITY/01-LOGGING.md) |
| the decision to use Socket.IO rather than plain WebSocket | ADR-031, [`../../MEMORY/DECISIONS.md`](../../MEMORY/DECISIONS.md) |
| the remediation card behind the 2026-09-23 rewrite | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-05 |
