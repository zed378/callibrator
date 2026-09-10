# 13 — Notification System

Module: `HDC-NOTIF` (17). Route: `/notifications`. Surface: `/dashboard/notifications` plus a global realtime channel.

---

## Two Tables, One Notification

| Table | Holds | Cardinality |
|---|---|---|
| `notifications` | the content — `type`, `title`, `message`, `actionUrl`, `tenantId`, `userId` | one per event |
| `notification_states` | per-user read state — `isRead`, `readAt`, `deletedAt` | one per recipient |

The split exists so that one event fanned out to twelve technicians stores its body once, and so that one of them dismissing it does not affect the other eleven.

`notification_states.deletedAt` is a per-user dismissal, not a delete of the notification. The underlying row survives, which is what makes "why was I not told" answerable.

## Types

`notifications.type` is an ENUM with four values:

```
SYSTEM  CALIBRATION  INVENTORY  MAINTENANCE
```

A closed set rather than a free string, so the client can render an icon and route a click without a lookup table that drifts.

| Type | Typical trigger |
|---|---|
| `SYSTEM` | quota threshold, backup completed, tenant lifecycle change |
| `CALIBRATION` | device due soon, device overdue, certificate awaiting approval |
| `INVENTORY` | stock below `minQuantity`, transfer awaiting approval |
| `MAINTENANCE` | work order assigned, IoT anomaly detected |

`actionUrl` is what makes a notification useful rather than merely informative — it points at the screen where the thing can be dealt with.

## Delivery Channels

```
                    event in a service
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        notifications   Socket.IO      email
           row          tenant room   (nodemailer)
              │
              ▼
     notification_states
       per recipient
```

### In-app realtime — Socket.IO

Both ends use Socket.IO: `socket.io` on the backend, `socket.io-client` on the frontend (`frontend/src/lib/socket.ts`).

A migration to plain WebSockets was trialled and **reverted by decision** (ADR-031). Anyone reading old notes that describe a WebSocket hub is reading a path not taken.

Socket authentication uses a short-lived socket token minted by the API (`frontend/src/api/services/socketToken.service.ts`) rather than the access token itself, so a long-lived credential is never handed to a transport that keeps it in memory for the life of a connection.

Rooms are per tenant. A gotcha worth stating because it has bitten: **the room join takes a raw project or tenant id, not a prefixed room name.** Passing a prefixed string joins a room nobody publishes to, and the symptom is silence rather than an error.

### Email — nodemailer

Configured with `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`. Templates live in `backend/src/templates`.

Those templates are read from disk next to the binary, not from the embedded snapshot, which is why the Dockerfile copies `src/templates` into the runtime image explicitly. Forgetting that copy produces a working API that fails only when it first tries to send mail.

### Asynchronous fan-out — RabbitMQ

Bulk notification work runs through RabbitMQ (`RABBITMQ_URL`) rather than inline, so a calibration sweep that notifies four hundred users does not block a request. See [`../ARCHITECTURE/07-QUEUE-WORKER-ARCHITECTURE.md`](../ARCHITECTURE/07-QUEUE-WORKER-ARCHITECTURE.md).

## Idempotency

A notification worker must be idempotent. RabbitMQ redelivers on nack and on connection loss, and "check then mark" is racy: two workers can both pass the check before either marks, and the user gets the email twice.

The correct primitive is a single atomic operation — Redis `SET NX` on a delivery key — not a read followed by a write.

Equally important: a failed attempt must **release** its claim. Otherwise "retry three times" becomes "try once, no-op twice", with logs that look identical to three successful attempts.

## Sound and Presence

`frontend/src/lib/notificationSound.ts` plays an audible cue for high-priority arrivals. It respects the browser autoplay policy — the first sound after page load may be suppressed until a user gesture, and the code must not treat that as an error.

## Reading and Dismissal

| Action | Effect |
|---|---|
| Mark read | `notification_states.isRead = true`, `readAt` set |
| Mark all read | bulk update scoped to the calling user |
| Dismiss | `notification_states.deletedAt` set — per user only |

Nothing here deletes a `notifications` row.

## Usage Alerts Feed In

`usage_alerts` (see [`09-BILLING-AND-PLANS.md`](./09-BILLING-AND-PLANS.md)) carries its own `notificationChannels` JSONB. When a metered threshold is crossed, the alert raises a `SYSTEM` notification through this module rather than implementing its own delivery.

One delivery path, several producers. An alerting feature that grows its own email sender is how a system ends up with two spam problems and one unsubscribe mechanism.
