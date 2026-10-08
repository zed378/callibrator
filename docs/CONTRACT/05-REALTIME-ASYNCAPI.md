# 05 — Realtime: Socket.IO Described in AsyncAPI 3 (TARGET)

> **TARGET — nothing here is built**, except where "as built" is stated. Owner decisions:
> **Socket.IO stays** (ADR-031, and the plain-WebSocket migration was reverted by decision).
> Its events are documented in **AsyncAPI 3** (`contracts/asyncapi/asyncapi.yaml`), and every port
> must prove **Socket.IO v4 protocol compatibility** (ADR-136).
> As built (read 2026-10-08): `backend/src/config/socket.ts` on `socket.io` ^4.8.4 with
> `@socket.io/redis-adapter` ^8.3.0, and `socket.io-client` ^4.8.4 in the frontend.

---

## 1. Why AsyncAPI, and What It Cannot Say

AsyncAPI 3 describes the channels (rooms), the messages (event names and payload schemas, which
reuse `contracts/openapi` components through `$ref`), the operations (who sends what), and the
security of the handshake. It cannot describe Socket.IO's **protocol**: Engine.IO transports, packet
encoding, acknowledgements, namespaces. Those are pinned by **version**: "Socket.IO protocol v5 as
implemented by `socket.io` 4.x" — stated once here: **"Socket.IO v4" in these documents means the
`socket.io` 4.x libraries, which speak Socket.IO protocol v5 over Engine.IO protocol v4**. They are proved by the conformance suite's realtime checks
([`06`](./06-CONFORMANCE-SUITE.md) § 3.5), not by the document. Socket.IO-specific facts (the
acknowledgement callback, the `auth` handshake object) are written as AsyncAPI bindings or `x-socketio`
extensions.

## 2. The Handshake (as built, B-RT-1)

1. The client gets a **short-lived socket token**: `POST /api/v1/auth/socket-token` (authenticated;
   the web goes through the Next proxy, because the app JWT lives in an httpOnly cookie).
2. It connects with `io(url, { auth: { token } })`. The token is read from **`handshake.auth` only**:
   a query-string token is refused. CORS never uses `origin: "*"`, because the handshake carries a
   credential.
3. The handshake applies the same principal checks as HTTP `auth` (account, tenant, facility).
4. **Re-check while open (P6-12, A-365):** every 60 s the server re-reads the principal. It disconnects
   on a tenant, super-admin or role change (as built), and — **target**, ADR-124 § 9 / P21-09 — on a facility
   or facility-status change.

## 3. Rooms (channels)

| Room | Joined | Isolation rule |
|---|---|---|
| `tenant_<tenantId>` | on connect, by the server (as built) | tenant-wide broadcasts. **Target** (ADR-124 § 9, P21-09): a facility-bound socket never joins it — today every socket joins it; there is no facility check in `config/socket.ts` |
| `user_<userId>` | on connect (as built) | direct messages, e.g. notifications |
| `super_admins` | on connect when the principal is a super admin (as built, `config/socket.ts`) | reserved for cross-tenant notifications to the platform operator — **nothing emits to it today** (`notification.service.ts` emits to user rooms); documented as an empty channel until an emitter exists |
| `board_<projectId>` | on the client's `kanban:join`, after `kanban.assertAccess(…, "viewer")` (as built) | kanban live updates; access is checked on join, and a refused join answers `{ ok: false }` |
| `facility_<tenantId>_<facilityId>` | target (ADR-124 § 9) | facility-scoped events for bound users |

Room names are **server-internal**. A client never names a room except through a documented join event
whose server handler checks access. The AsyncAPI document lists the rooms as channels with the join
rule in their description.

## 4. Events (as built, inventoried 2026-10-08)

| Direction | Event | Payload (to be schema'd in Phase 34) | Source |
|---|---|---|---|
| client → server | `kanban:join` | `projectId` (uuid) + ack callback → `{ ok: true }` or `{ ok: false, error }` | `config/socket.ts` |
| client → server | `kanban:leave` | `projectId` | `config/socket.ts` |
| server → client | `new_notification` | the transformed notification (the same shape as one row of `GET /notifications`) | `services/notification.service.ts` |
| server → client | `kanban:card:created`, `kanban:card:updated`, `kanban:card:moved`, `kanban:card:deleted`, `kanban:card:relations`, `kanban:cards:migrated` | the card (or ids) as the kanban REST operations return them | `emitToBoard` callers in the kanban services |
| server → client | `kanban:column:created`, `…:updated`, `…:deleted`, `…:reordered` | the column / the ordering | the same |
| server → client | `kanban:label:created`, `…:updated`, `…:deleted` | the label | the same |
| server → client | `kanban:sprint:created`, `…:updated`, `…:deleted` | the sprint | the same |
| server → client | `kanban:project:updated`, `kanban:project:deleted` | the project | the same |

Every payload **reuses the REST schema** of the same resource (`$ref` into `contracts/openapi`), so an
event can never show a field the REST read would hide. Event names are frozen within v1, like error
codes. New events are additive. The inventory above is the starting point: Phase 34's card re-derives
it from the code (every `emit(` and `socket.on(`) and fails on any event missing from the document.

## 5. Rules Every Engine Must Keep (B-RT)

- **B-RT-1** handshake as § 2. **B-RT-2** room isolation as § 3: no socket receives another tenant's
  events, and no bound socket receives another facility's. **B-RT-3** payloads are the REST schemas
  (§ 4). **B-RT-4** emission is best-effort: a realtime failure never fails the originating request
  (as built, `emitToBoard`). **B-RT-5** emission happens **after** the transaction commits, so no event
  describes a rolled-back change. **B-RT-6** multi-replica fan-out through the Redis adapter (A-54).
  An engine that serves realtime beside Node in the same deployment must use a **compatible adapter**
  (`@socket.io/redis-adapter`'s Redis channel format) or own realtime alone (§ 6).

## 6. Realtime Under the Strangler

Realtime is **one module** for the gateway ([`07`](./07-PORTING-PLAYBOOK.md) § 2): the `/socket.io/` path
goes to one engine. Events produced by modules served by **another** engine reach that socket server
through the shared Redis adapter: the engine serving the module publishes in the adapter's format.
Two ways:

| Option | When |
|---|---|
| **A — a port publishes through the Socket.IO Redis-adapter protocol** (an emitter library compatible with `@socket.io/redis-emitter`) | the default: Node keeps the socket server until the realtime module is ported; ports only emit |
| **B — the port owns the socket server** | when its Socket.IO server implementation passes the realtime conformance (§ 7) and the adapter interoperability check |

## 7. Proving Socket.IO v4 Compatibility (a port's obligation)

The conformance suite's realtime checks ([`06`](./06-CONFORMANCE-SUITE.md) § 3.5) use the **official
`socket.io-client` 4.x**, the same client the web uses:

1. connect with polling and with WebSocket upgrade; with and without `auth.token`; with a query-string
   token (refused);
2. the join/ack round trip of `kanban:join`, and a refused join;
3. two tenants and two facilities: events emitted for A never reach B's sockets;
4. the 60-second re-check: revoke the session or change the binding → disconnected within the window;
5. emission after commit: a request that rolls back emits nothing;
6. **adapter interoperability**: an event published by engine X through the Redis adapter reaches a
   socket held by engine Y.

A port's realtime is done only when all six pass, against the same Redis, beside the Node socket server.
