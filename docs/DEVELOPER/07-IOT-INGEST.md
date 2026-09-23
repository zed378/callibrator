# 07 — IoT Ingest

How device telemetry enters this system, over HTTP and over MQTT — and why, as built, no device can actually send any.

> **Target standard: TypeScript, strict (ADR-038).** Every backend file named here is **JavaScript/CommonJS as built**. Conversion is tracked in [`../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md) and changes no behaviour.

---

## Read This First: The Feature Is Built And Unreachable

The ingest endpoint exists, the MQTT client exists, the model exists, the anomaly rule exists, the migration has run, and there are unit tests. **No device can use any of it**, because there is no way to give a device a credential.

`POST /api/v1/iot/ingest` authenticates a caller by looking up `calibration_devices.iot_device_token` (`backend/src/controllers/iot.controller.js:20`). **Nothing in the codebase ever writes that column.**

| Would set it | Does it? | Where checked |
|---|---|---|
| a service | **no** | `calibrationDevices.service.js` — `createCalibrationDevice` (line 156) and `updateCalibrationDevice` (line 204) both pass only the Joi-validated body |
| a validator | **no** | `calibrationDevices.validator.js:29` and `:46` — neither schema has an IoT field, and both validate with `stripUnknown: true` (line 70), so a client sending one has it silently removed |
| a route | **no** | `calibrationDevices.route.js` mounts six routes, none of them a provisioning endpoint |
| the frontend | **no** | no surface in `frontend/src` reads or writes it |
| a script or seeder | **no** | `migration.service.js:1220` sets `iotEnabled: true` on one demo device, and **no token** |

Therefore `POST /api/v1/iot/ingest` returns **401** for every device, always, unless someone writes a token into the database by hand. The MQTT path does not need a token — see below — but still requires `iot_enabled`, which only the demo seeder ever sets.

Downstream, predictive maintenance is documented as deriving risk from IoT readings and has none to derive from: `predictiveMaintenance.service.js:38` returns `{ status: "skipped" }` when fewer than ten readings exist in the last thirty days, which is every real device.

**This is tracked as [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-29** — "IoT ingest cannot be provisioned, and its credential would leak if it could" — together with § A-17 for the MQTT exposure. `TASKS/PHASE-5-ANALYTICS.md` marks P5-02 IoT telemetry done; it was built and tested with mocks, and it is unreachable. Do not plan work that assumes readings are arriving.

## What Exists

| Piece | File |
|---|---|
| route (1 endpoint, no middleware) | `backend/src/routes/api/iot.route.js` |
| device authentication + payload check | `backend/src/controllers/iot.controller.js` |
| MQTT client, anomaly rule, persistence | `backend/src/services/iot.service.js` |
| telemetry table | `backend/src/models/iotReading.model.js` |
| device columns | `backend/src/models/calibrationDevice.model.js:82–97` |
| column migration | `backend/src/migrations/0010-add-iot-fields.js` |
| consumer of the readings | `backend/src/services/predictiveMaintenance.service.js` |

Mounted in `backend/index.js` as `app.use("/api/v1/iot", iotRoutes)`.

## Path One — HTTP

```
POST /api/v1/iot/ingest
x-iot-token: <the device's token>        (or "token" in the JSON body)

{ "payload": { "temperature": 22.4, "humidity": 45 } }
```

`iot.controller.js#ingestHttp`, in order:

| Step | Line | Failure |
|---|---|---|
| read `x-iot-token` header, else `body.token` | 8 | missing → **401** |
| require `body.payload` to be an object | 14 | missing or not an object → **400** |
| find a device by `{ iotDeviceToken, iotEnabled: true }` | 20 | no match → **401** |
| `iotService.ingestReading(device.tenantId, device.id, payload)` | 29 | device re-checked → throws |
| `success(res, result, null, "Reading ingested successfully")` | 34 | — |

The payload object goes in under `payload`, not at the top level. A device posting `{ "token": "…", "temperature": 25 }` gets a 400, which is easy to misread as a bad token.

### There is no session, no tenant context and no permission gate

The route is mounted with **no middleware at all** — no `auth`, no `dynamicAccess`, no `validate(schema)`. That is deliberate: the caller is a device, not a user. It has three consequences you have to hold in mind:

- **No tenant context exists.** `tenantScope.util.js` resolves "no CLS context" to `skip`, so the global tenant hooks add no predicate here. The lookup is intentionally global-by-token, and the tenant is then taken **from the matched row** (`device.tenantId`) and stamped onto the reading. Isolation on this path rests entirely on the token being unguessable.
- **No audit row is written.** No mutation on this path reaches `audit_logs`.
- **Rate limiting is the global limiter only** — `defaultLimiter` in `backend/index.js`, 5,000 requests per 15 minutes in production (`RATE_LIMIT_MAX` overrides), keyed by IP. A fleet behind one gateway shares one budget, and a leaked token has 5,000 attempts per window. A-29's fix direction includes a limiter of its own for this route.

### A soft-deleted device still authenticates

`iot.controller.js:20` uses `CalibrationDevice.unscoped()`. `unscoped()` removes the model's `defaultScope`, which is `where: { is_deleted: false }` (`calibrationDevice.model.js:127`). A device that has been decommissioned through `DELETE /api/v1/calibration-devices/:id` is soft-deleted, remains in the table with its token intact, and **continues to be accepted by ingest**. `iot.service.js:120` repeats the same `unscoped()` lookup.

This is not recorded in A-29. It is listed under *New to this document* below.

## Path Two — MQTT

**The backend is an MQTT *client* of an external broker, never a broker itself.** `aedes` and `aedes-server-factory` are in `backend/package.json:58–59` and are imported by no code; earlier documentation described an embedded broker that was never built (A-18 lists them for removal).

MQTT is **off unless both `MQTT_HOST` and `MQTT_PORT` are set**. `backend/index.js` checks the pair before calling `iotService.connect`, and `iot.service.js:18` checks it again and returns early, logging `MQTT broker not configured (set MQTT_HOST and MQTT_PORT to enable)`. With either unset there is no client, no subscription and no MQTT ingest. It is off on the reference deployment.

When it is on (`iot.service.js#connect`):

| | |
|---|---|
| URL | `mqtt://<host>:<port>` |
| client id | `callibrator-backend-<Date.now()>` |
| subscription | `device/#` (line 38) |
| reconnect | every 5 s (line 29) |
| connect timeout | 10 s, rejects (line 78) |
| failure at boot | non-fatal — `index.js` logs `IoT MQTT Broker connection failed (non-fatal)` and the server starts |

The topic carries the identity. `iot.service.js:65–67` splits the topic and takes `parts[1]` as the device id and `parts[2]` as the tenant id, i.e.:

```
device/<deviceId>/<tenantId>
```

Outbound, `publish` builds `<topic>/<deviceId>/<tenantId>` (line 105), so the two agree when `topic` is `device`.

### The broker's ACLs are the only authentication on this path

**Say this out loud before enabling MQTT: a publisher allowed on `device/#` can post readings for any device whose id and tenant id it knows.** The backend checks no token on the MQTT path — `ingestReading` requires only that the `(deviceId, tenantId)` pair match a row with `iot_enabled = true` (`iot.service.js:121`). Both values are UUIDs that appear in ordinary API responses to anyone inside that tenant.

So a forged topic cannot cross into a tenant whose ids the publisher does not have, but within reach of those ids there is no credential at all. **Per-device broker credentials with a topic ACL scoped to that device are a deployment requirement, not a hardening option.** This is A-17's second Definition-of-Done item.

`deploy/compose/docker-compose.vm.yml` publishes `0.0.0.0:19883:1883` on the backend. **Nothing listens there** — the backend is a client — and A-17's first item removes the mapping.

### Message handling swallows nothing and awaits nothing

`iot.service.js:70` calls `this.ingestReading(...)` without `await` and without a `.catch`. The surrounding `try` catches JSON parse failures only (line 72). An unknown or IoT-disabled device therefore produces an **unhandled promise rejection**, which the `process.on("unhandledRejection")` handler in `backend/index.js` turns into a full application shutdown. On the MQTT path, a stale device id in a retained message can stop the server. This is not recorded in A-29 or A-17; see *New to this document*.

## What Happens To A Reading

`iot.service.js#ingestReading`, for both paths:

1. Load the device by `{ id, tenantId, iotEnabled: true }`, `unscoped()`, selecting `id`, `name`, `readingTolerance` (line 120). No match → throws `Device not found or IoT disabled`.
2. If `readingTolerance` is set, walk every key of the payload and compare against `{ min, max }` for that key (lines 132–146). Any breach sets `isAnomaly` and appends a human-readable reason.
3. Insert one `iot_readings` row with `tenantId`, `deviceId`, `metrics` (the whole payload) and `isAnomaly` (line 148).
4. If anomalous: `logger.warn` **with the payload inlined** (line 156), and create a `Notification` of type `system` titled `IoT Anomaly Alert: <device name>` (line 158).
5. Return `{ success: true, isAnomaly }`.

**Anomaly detection runs at write time, not at query time.** That is the point: a detector that runs when someone opens a page cannot alert.

`readingTolerance` is JSONB keyed by metric name:

```json
{ "temperature": { "min": 18, "max": 26 }, "humidity": { "max": 60 } }
```

A key with no tolerance entry is stored and never compared. There is no schema on `metrics` — whatever JSON arrives is what is kept.

Like `iotDeviceToken`, **`readingTolerance` is settable by no validator, service, route or UI.** Both create and update schemas omit it. Every device therefore has `readingTolerance = null`, so step 2 is skipped, `isAnomaly` is always `false`, and no anomaly notification can ever fire — even for the hand-provisioned device described below.

## The Token Leaks The Moment It Exists

`calibrationDevice.model.js:126` declares:

```js
defaultScope: { where: { is_deleted: false } }
```

A `defaultScope` with a `where` and **no `attributes.exclude`** filters rows, not columns. `iotDeviceToken` is an ordinary attribute of the model, so it is selected by default and serialised into **every device list and every device detail response** — to every user in the tenant who can read the device register, at whatever permission level that is.

The token is stored in **plaintext**: `calibrationDevice.model.js:82` is a `STRING(255)` with a `unique` constraint and no hashing anywhere. Compare `api_keys`, which are hashed at rest and shown once.

This is the second half of A-29, and the reason not to work around the provisioning gap in production.

## The Data Model

`iot_readings` (`iotReading.model.js`):

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `tenantId` | UUID | `ON DELETE CASCADE` from `tenants` |
| `deviceId` | UUID | `ON DELETE CASCADE` from `calibration_devices` |
| `timestamp` | DATE | defaults to now |
| `metrics` | JSONB | the reading, unschematised |
| `isAnomaly` | BOOLEAN | computed at ingest |

`timestamps: true` with `updatedAt: false` (line 47) — the series is immutable. Indexed on `tenant_id`, `device_id`, `timestamp` and the pair `(device_id, timestamp)`, because every query is "this device, this window".

`calibration_devices` gains five columns from `migrations/0010-add-iot-fields.js`: `iot_device_token`, `iot_enabled`, `reading_tolerance`, `recommended_calibration_interval`, `recommendation_reason`. The migration guards each `addColumn` with a `describeTable` lookup rather than a blanket `try/catch`, so it is re-runnable **and** still fails loudly if an `addColumn` fails — which is the correct shape (contrast the trap in [`../../CLAUDE.md`](../../CLAUDE.md)).

There is **no read endpoint for readings**. `IotReading` is referenced outside its own model only by `iot.service.js` (write), `predictiveMaintenance.service.js` (two `count` calls), and `migration.service.js` (demo seed at line 1333, tenant purge at line 1987). To look at telemetry today you query the table.

## Consuming The Readings

`predictiveMaintenance.service.js#analyzeDevice` requires a device with `iotEnabled: true` (404 otherwise) and a `calibrationIntervalDays` baseline (400 otherwise), counts readings in the last 30 days, returns `{ status: "skipped" }` below ten, and otherwise adjusts the recommended interval from the anomaly rate. The API surface is documented in [`../API/09-MAINTENANCE-API.md`](../API/09-MAINTENANCE-API.md).

Since `readingTolerance` can never be set, the anomaly rate is structurally zero, and the only branch reachable with real data is the "no drift, lengthen the interval" one. **Treat any recommendation this service produces today as unfounded.**

### Telemetry is not a calibration result

A device reporting itself in tolerance has reported, not been calibrated. Calibration needs a traceable reference standard and a competent human who signs for the result. This is restated from [`../API/09-MAINTENANCE-API.md`](../API/09-MAINTENANCE-API.md) because the temptation is strongest exactly here.

## Making It Work On A Disposable Stack

There is no supported way to provision a device. On a **local or disposable** stack only, and never on a deployment carrying real data:

```sql
UPDATE calibration_devices
   SET iot_enabled = true,
       iot_device_token = 'dev-only-token-not-a-secret',
       reading_tolerance = '{"temperature": {"min": 18, "max": 26}}'::jsonb
 WHERE id = '<device uuid>';
```

```bash
curl -X POST http://localhost:3000/api/v1/iot/ingest \
  -H 'Content-Type: application/json' \
  -H 'x-iot-token: dev-only-token-not-a-secret' \
  -d '{"payload":{"temperature":31.9,"humidity":70}}'
```

That token is now visible in every device list response in that tenant. It is a development fixture, and writing a real one this way puts a plaintext credential into a field that is read back to everybody.

## Tests

| Suite | File | What it establishes |
|---|---|---|
| controller unit | `src/tests/controllers/iot.controller.test.js` | the controller's branches, against a mocked model |
| service unit | `src/tests/services/iot.service.test.js` | the MQTT client and anomaly rule, against a mocked `mqtt` |
| route | `src/tests/routes/iot.route.test.js` | the mount |
| live E2E | `src/tests/e2e/modules/iot.e2e.test.js` | **two rejection cases only** — no successful ingest |

The E2E suite cannot cover a successful ingest, because provisioning a device is exactly the thing that does not exist. **A mock proves the client, not the contract** ([`../../CLAUDE.md`](../../CLAUDE.md) § Evidence): every green test on this module was written against a device that the running system cannot produce.

One of the two E2E assertions also looks wrong. `iot.e2e.test.js:20` posts an empty body and expects **400**; with no token, `ingestHttp` throws `AppError(401, "IoT Device Token is required")` at line 11 before any payload check. **Not verified against a running server** — the live suite has never completed an uninterrupted run (P6-02).

## Planned, Not Built

A-29's fix direction, recorded here so nobody reads it as current behaviour:

- an admin-only endpoint that issues a random token of at least 32 bytes, stores it **hashed**, shows it once, and toggles `iotEnabled` — the shape `api_keys` already uses;
- the token excluded from the model's default attributes;
- a UI surface for provisioning;
- a rate limit on `/iot/ingest` of its own;
- `readingTolerance` accepted by the device validator, so anomaly detection can do anything at all.

Its Definition of Done: a device provisioned end to end through the API with ingest succeeding, no device response containing the token, and tokens hashed at rest.

## New To This Document

Found while writing this and **not** in A-29 or A-17. Each is evidence for the audit, not a decision:

| # | Finding | Evidence |
|---|---|---|
| 1 | a soft-deleted device's token still authenticates | `iot.controller.js:20` and `iot.service.js:120` use `.unscoped()`, dropping `defaultScope: { where: { is_deleted: false } }` (`calibrationDevice.model.js:127`) |
| 2 | `readingTolerance` is as unprovisionable as the token, so **anomaly detection is structurally dead** | absent from both schemas in `calibrationDevices.validator.js` (lines 29, 46), which strip unknown keys (line 70); read at `iot.service.js:132` |
| 3 | one bad MQTT message can shut the server down | `iot.service.js:70` calls `ingestReading` unawaited and uncaught → unhandled rejection → the `unhandledRejection` handler in `index.js` calls `shutdown` |
| 4 | the anomaly log line inlines the whole payload | `iot.service.js:156` — `{ payload, anomalyDetails }` written to `log/activity/combined/`, against the "no full bodies" rule in [`../ENGINEERING/12-LOGGING-CONVENTIONS.md`](../ENGINEERING/12-LOGGING-CONVENTIONS.md) |
| 5 | ingest writes no `audit_logs` row | no `recordAudit` on `iot.route.js`; nothing in `ingestHttp` or `ingestReading` |
| 6 | the demo seeder references an out-of-scope identifier | `migration.service.js:1327` — `devices.find((d) => d.iotEnabled) \|\| device`, where `device` is not bound in that scope; short-circuit hides it while the seed definitions include an IoT device |

## Related

| For | Read |
|---|---|
| the endpoint in the API contract | [`../API/09-MAINTENANCE-API.md`](../API/09-MAINTENANCE-API.md) § `/api/v1/iot` |
| why MQTT is not a queue here | [`../ENGINEERING/08-CACHE-QUEUE-STANDARDS.md`](../ENGINEERING/08-CACHE-QUEUE-STANDARDS.md) |
| the backend's client-not-broker position | [`../ARCHITECTURE/03-BACKEND-ARCHITECTURE.md`](../ARCHITECTURE/03-BACKEND-ARCHITECTURE.md) |
| where the anomaly log line lands | [`../OBSERVABILITY/01-LOGGING.md`](../OBSERVABILITY/01-LOGGING.md) |
| the remediation items | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-29, § A-17, § A-18 |
