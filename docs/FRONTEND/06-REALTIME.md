# 06 — Realtime

**Socket.IO both ends.** `socket.io-client` on the frontend, `socket.io` on the backend, sharing the Express server's port.

A migration to plain WebSockets was trialled and **reverted by decision** (ADR-031). Anyone reading older notes describing a WebSocket hub is reading a path not taken.

Client: `frontend/src/lib/socket.ts`.

---

## Connection

```
1. authenticated
2. POST /api/v1/auth/socket-token   → a short-lived token
3. connect with that token
4. join the tenant room — RAW id, not a prefixed name
5. arrivals → notificationStore
```

### Why a separate socket token

The access token is **not** handed to the transport.

A long-lived credential in a connection that lives for hours is a long-lived exposure: it sits in client memory, it may appear in a connection URL, and it cannot be revoked independently of the session.

The socket token is short-lived and scoped to this purpose.

## The Room-Join Gotcha

**The room join takes a raw id — a tenant id, or a `projectId` for Kanban — not a prefixed room name.**

Passing `"tenant:" + id` or `"project-" + id` joins a room nobody publishes to. There is no error. The client connects successfully, reports healthy, and receives nothing.

Silence is the symptom, which is why this costs an afternoon the first time.

## Rooms

| Room | Carries |
|---|---|
| tenant | notifications for everyone in the tenant |
| `projectId` | Kanban board updates |

Rooms are the isolation mechanism for realtime. A publish to the wrong room is a cross-tenant leak that no backend IDOR test will find, because it never goes through an HTTP route.

## What Arrives

| Event | Effect |
|---|---|
| Notification | into `notificationStore`, bell count updates |
| Kanban card moved, created, updated | board updates in place |
| Batch job progress | the job row advances |

## Deduplication

`notificationStore` is fed from **two** sources: the initial `GET /api/v1/notifications` and live socket pushes.

A push that races the initial fetch shows the same notification twice. **Deduplicate by id**, always.

## The Dashboard Does Not Move

The bell count updates live. **The dashboard tiles do not.**

A compliance figure that shifts while someone is reading it is harder to trust and harder to quote — and Rina is about to say the overdue count out loud in a meeting.

A manual refresh with an "as of HH:MM" timestamp is more useful than a number that changes underneath the reader.

## Reconnection

Socket.IO reconnects automatically with backoff. Two things the application must handle:

1. **The socket token expires.** On reconnect, mint a fresh one rather than replaying the old.
2. **Messages sent while disconnected are lost.** Socket.IO does not replay. On reconnect, **refetch** the notification list — do not assume the store is current.

The second is the one that produces a quietly wrong UI: everything looks connected, and the user is missing an hour of notifications.

## Sound

`frontend/src/lib/notificationSound.ts`.

Respects the browser autoplay policy: the first sound after page load may be suppressed until a user gesture. **That is not an error** and must not be logged or surfaced as one.

Sound is optional and never the only signal.

## Failure Behaviour

Realtime is an enhancement, not a dependency.

| Failure | Behaviour |
|---|---|
| Socket cannot connect | the app works; notifications arrive on navigation |
| Socket drops | reconnect, then refetch |
| Token expired | mint a new one |

**Nothing in the compliance path depends on the socket.** A calibration record is saved by an HTTP request that returns a result; the socket only tells other people about it.

## Reverse Proxy

nginx must pass the WebSocket upgrade headers for `/socket.io/*`.

Without them, Socket.IO silently falls back to **long-polling**. It works — well enough that nobody notices — until connection counts matter, at which point the server is holding far more open requests than anyone expected.

This is the deployment mistake most likely to go undetected. See [`../DEVOPS/03-REVERSE-PROXY.md`](../DEVOPS/03-REVERSE-PROXY.md).

## Scaling

With more than one backend replica, **Socket.IO needs the Redis adapter**. Without it a notification reaches only the replica holding that client's connection, and which users hear about an event becomes a function of load balancing.

This is one of the three hard prerequisites for horizontal scaling, alongside object storage off local disk and single-replica schedulers ([`../ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md`](../ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md)).

## Testing

| Assertion |
|---|
| the socket token is requested, not the access token reused |
| the room join uses the **raw** id |
| a duplicate arrival is deduplicated by id |
| reconnection refetches rather than assuming the store is current |
| the app is fully usable with the socket unavailable |
| autoplay suppression is not treated as an error |

The last two are the ones that matter for reliability: realtime failing must degrade, never break.
