# 11 — Dashboard UX

`/dashboard`, backed by a single endpoint: `GET /api/v1/dashboard/metrics`.

---

## The Job

Rina opens this once a day and needs to know within **60 seconds** whether anything requires her today ([`04-USER-JOURNEYS.md`](./04-USER-JOURNEYS.md) J1).

That is the whole specification. Everything else follows from it.

## One Endpoint, Not Twelve

Tiles are computed server-side and returned together.

A dashboard that fans out to twelve endpoints is twelve chances to leak a tenant predicate and twelve round trips on a hospital network. It is also twelve independent failure modes on the screen people trust most.

## The Tiles

Ordered by how likely they are to require action.

| Tile | Source | Colour |
|---|---|---|
| **Calibrations overdue** | `nextCalibrationDate < today`, active devices | **red when > 0** |
| Due in 30 days | `nextCalibrationDate <= today + 30` | amber |
| Compliance rate | `calibration_records.isCompliant` over the period | green / amber / red |
| Open non-conformances | `non_conformances` | amber |
| Open CAPAs past due | `capas` | red when > 0 |
| Certificates awaiting approval | `certificates.status = 'pending_approval'` | neutral |
| Open work orders by priority | `maintenance_work_orders` | by priority |
| Low stock | `stocks.quantity < minQuantity` | amber |
| Devices by status | `calibration_devices.status` | mixed |

**Overdue is first and it is the only red thing on a healthy screen.** If everything urgent is red, nothing is.

## The Rule That Matters Most

**A tile that could not be computed shows as unavailable, not as zero.**

Rina will report the overdue count in a meeting with the hospital director. A `0` that is actually a failed query is the most dangerous single pixel in the product (P3).

```
loading      → skeleton, same size as the tile
ready        → the figure
unavailable  → "—" with "could not load" and a retry
```

Three visually distinct states. Never two.

## Tile Anatomy

One number, one label, one link. The number is the largest thing in the tile.

A tile carrying three figures is a table pretending to be a tile. Split it or move it below.

Every tile links to the filtered list that produced it — the overdue tile opens the device register already filtered to overdue. A figure you cannot drill into is trivia.

## Below the Tiles

Dense supporting lists (P7 — the tiles get space, the lists do not):

| Section | Shows |
|---|---|
| Due this week | device, serial, due date, assignee |
| Recent calibrations | device, performer, date, compliant |
| Awaiting your action | certificates to approve, workflow steps assigned to you |
| Recent activity | from `audit_logs`, if the viewer has `security` read |

"Awaiting your action" is the section that changes behaviour. Everything else is situational awareness; this is a queue.

## Role Shapes the Dashboard

The tiles a user sees follow their menu grants, resolved server-side.

| Role | Sees |
|---|---|
| `ENGINEERING MANAGER` | everything, read-only — this is their screen |
| `CALIBRATOR ADMIN` | calibration, certificates, quality, predictive |
| `HEALTHCARE ADMIN` | everything operational plus quality |
| `TECHNICIAN` | due work, their own recent calibrations |
| `WAREHOUSE STAFF` | low stock, in-flight transfers |
| `FACILITY MAINTENANCE` | **no dashboard at all** — the `dashboard` slug is not granted |

Pak Hendra has no dashboard. His landing surface is `home`. A dashboard is not a universal entitlement here, and pretending otherwise means designing tiles for someone who will never see them.

## Performance

| Target | |
|---|---|
| First meaningful paint | under 2s on hospital wifi |
| Tile figures | present on first paint, not after a second round trip |

Server-rendered where possible. A skeleton that resolves in 200ms is fine; a skeleton that resolves in 3s makes people stop trusting the page.

Dashboard aggregates are cached with a short TTL. **Every cache key includes the tenant id** — a key missing it serves one hospital's overdue count to another, and keeps doing so after the bug is fixed until the key expires.

## Realtime

The notification bell updates live over Socket.IO. **The tiles do not.**

Figures that shift while someone is reading them are harder to trust and harder to quote. A manual refresh, and a "as of HH:MM" timestamp, is more useful than live-updating numbers on a screen whose purpose is to be read once.

## What Is Deliberately Absent

| Absent | Why |
|---|---|
| A welcome banner | P1 — state before decoration |
| Onboarding checklists | Rina has used this for two years |
| Trend sparklines on every tile | a trend is a different question from "is anything wrong now" |
| Configurable tile layout | eleven roles already produce eleven dashboards; per-user layout produces support tickets |
| Animation | P9 — motion in the dashboard is a state signal only |

## Mobile

Tiles stack one per row. The overdue tile stays first.

Supporting lists become cards. The "awaiting your action" queue is the only section that must remain fully usable one-handed, because it is the only one that is a task list.
