# 14 — Analytics and Reporting

Modules: `HDC-RPT` (23), `HDC-IOT` (25), `HDC-AI` (26), and the predictive half of `HDC-MNT` (12).

---

## Dashboard

`/api/v1/dashboard` → `/dashboard`. The landing surface after sign-in.

Tiles are computed server-side, tenant-scoped, and answer the questions a compliance officer is asked first:

| Tile | Source |
|---|---|
| Devices by status | `calibration_devices.status` |
| Calibrations overdue | `nextCalibrationDate < today` on active devices |
| Calibrations due in 30 days | `nextCalibrationDate <= today + 30` |
| Compliance rate | `calibration_records.isCompliant` over the period |
| Open work orders by priority | `maintenance_work_orders` |
| Open non-conformances and CAPAs | `non_conformances`, `capas` |
| Low stock | `stocks.quantity < stocks.minQuantity` |
| Certificates awaiting approval | `certificates.status = 'pending_approval'` |

Computed server-side rather than assembled from a dozen client calls, because a dashboard that fans out to twelve endpoints is twelve chances to leak a tenant predicate and twelve round trips on a hospital network.

## Reports

`/api/v1/reports` → `/dashboard/reports`.

| Report | Answers |
|---|---|
| Calibration compliance | which devices were in and out of interval over a period |
| Calibration forecast | what falls due in the next N days |
| Device inventory | full register with status and location |
| Maintenance history | orders by device, type, outcome |
| Stock movement | adjustments, transfers, opname over a period |
| Audit trail export | filtered `audit_logs` |
| Vendor performance | scorecards over time |

Large exports run as **batch jobs**, not synchronous requests. A full audit-trail export for a busy tenant will exceed the 30-second request timeout (N3), and a report that times out halfway is worse than one that takes five minutes and tells you when it is ready.

Export is an audited action in its own right — `audit_logs.action` includes `EXPORT`. Knowing who extracted what, and when, is itself a compliance requirement.

## IoT Telemetry

`iot_readings`: `deviceId`, `timestamp`, `metrics` (JSONB), `isAnomaly`. Indexed on `(device_id, timestamp)` as a pair, because every query is "this device, this window".

Ingest is over MQTT — the backend embeds an `aedes` broker (`MQTT_HOST`, `MQTT_PORT`) — and over `/api/v1/iot`. Devices authenticate with `calibration_devices.iotDeviceToken`, gated by `iotEnabled` (migration `0010`).

`isAnomaly` is computed against `calibration_devices.readingTolerance` (JSONB) at ingest, not at query time. Anomaly detection that runs at read time cannot alert.

**Telemetry is never a calibration result** (see [`00-PROJECT-OVERVIEW.md`](./00-PROJECT-OVERVIEW.md) § Non-Goals). A device reporting itself in tolerance has not been calibrated; it has reported. The distinction is the difference between evidence and a claim.

`iot_readings` is the highest-volume table in the system and the only one purged by retention policy rather than soft-deleted.

## Predictive Maintenance

`/api/v1/predictive-maintenance` → `/dashboard/predictive-maintenance`.

Derives risk signals from IoT readings, maintenance history and calibration outcomes, and proposes preventative work orders and revised calibration intervals (`calibration_devices.recommendedCalibrationInterval`, with a `recommendationReason` because a bare number nobody can justify gets ignored).

**Proposals only.** Nothing here changes a calibration interval or dispatches a technician on its own. Interval changes are quality decisions with regulatory weight.

There is no dedicated predictive-maintenance model; the module computes over `iot_readings`, `maintenance_work_orders` and `calibration_records`. Worth knowing when looking for a table that does not exist.

## AI Assistant

`/api/v1/ai` → `/dashboard/ai-assistant`.

Retrieval-augmented generation over tenant documents:

```
document → chunked → embedded → document_chunks.embedding vector(1536)
                                        │
query ──embed──▶ nearest-neighbour search (pgvector, tenant-scoped)
                                        │
                                        ▼
                          top chunks + question → LLM → answer
```

`document_chunks` carries `tenantId`, `sourceType`, `sourceId`, `chunkIndex`, `content` and the embedding. Migration `0018` runs `CREATE EXTENSION vector`, which is why the compose stack uses `pgvector/pgvector:pg17` rather than plain `postgres:17-alpine`.

Configuration is OpenAI-compatible (`OPENAI_API_KEY`, `OPENAI_BASE_URL`), and per-tenant keys override the platform default — a tenant whose policy forbids sending data to a shared account can point at its own endpoint.

**Tenant scoping is the whole security story here.** Vector similarity search does not naturally respect a `WHERE` clause unless the query includes one; a retrieval that omits the tenant predicate will happily return another hospital documents as context and then paraphrase them into an answer. `document_chunks.tenantId` is indexed and the scoping hooks apply, but this is the module where a review should look hardest.

With no provider configured, `/ai` and the GDPR export path return errors. That is an environment condition, not a code defect — see [`../ARCHIVE/2026-07-fullstack-integration-audit.md`](../ARCHIVE/2026-07-fullstack-integration-audit.md) § 2.

## Metered Usage

`UsageMetrics` doubles as a product-analytics source: per tenant, per metric, per period. See [`09-BILLING-AND-PLANS.md`](./09-BILLING-AND-PLANS.md).

## Kanban Analytics

`HDC-KANBAN` (31) carries its own analytics — cycle time, throughput per sprint, cards by column — over the nine `kanban_*` tables. Cards keep a stable `cardKey` so a card referenced in a commit message stays findable after it moves.

## What Is Deliberately Not Here

No data lake, no warehouse, no BI export. Reporting runs against the operational database with indexes chosen for it (`nextCalibrationDate`, `isCompliant`, `(device_id, timestamp)`, `published_at`).

That is a correct choice at current scale and a wrong one eventually. The threshold is when reporting queries start affecting operational latency; the answer at that point is a read replica before it is a warehouse. Recorded in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md) rather than pre-built.
