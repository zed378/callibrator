# 01 — Logging

Where a log line in this system ends up, what it carries, and how it leaves the host.

How to *write* a log line from application code is [`../ENGINEERING/12-LOGGING-CONVENTIONS.md`](../ENGINEERING/12-LOGGING-CONVENTIONS.md). The operational summary and the compliance contrast are [`../DEVOPS/06-LOGGING.md`](../DEVOPS/06-LOGGING.md) and [`../DATABASE/10-AUDIT-LOGS.md`](../DATABASE/10-AUDIT-LOGS.md). This document is the as-built detail underneath them.

> **Target standard: TypeScript, strict (ADR-038).** The logging code described here is **JavaScript/CommonJS as built**; every file named below is a `.js` file today. Conversion is tracked in [`../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md) and changes no behaviour.

> **Rewritten 2026-09-24 (batch 6, P7-03).** The previous version described the logger before A-14: files only in production, nothing on stdout, per-request lines dropped, no redactor, unbounded exception files. **All of that was fixed by A-14/A-42/A-43/A-44/A-228 and this document had not caught up** — it was on the batch-5 "Owed" list. Where a claim below comes from reading the code rather than running it, it says so.

---

## The One Thing To Know

**In production the backend writes one JSON object per line to stdout.** Docker (compose) or the cluster's log agent (Kubernetes) collects it; files are optional.

`backend/src/middlewares/activityLog.middleware.js` builds one winston logger:

| Transport | When | Destination |
|---|---|---|
| **Console** | always | stdout. JSON in production; colourised `timestamp [level]: message` in development. It also handles uncaught exceptions and unhandled rejections, so a boot crash is visible in `docker logs` |
| error file | `LOG_TO_FILE=true`, or unset outside production | `log/activity/error/<date>.log` |
| combined file | same | `log/activity/combined/<date>.log` |
| exception / rejection files | same | `log/activity/{exception,rejection}/<date>.log` |

`LOG_TO_FILE`: `true` writes the files too, `false` never writes them, **unset** writes them outside production and not in production. `LOG_LEVEL` overrides the level (default `info` in production, `debug` elsewhere).

Every file transport is bounded: daily, 20 MB per file, gzip, 30 days (`rotated()` in the same file).

## What A Line Carries

The format chain is `errors({stack}) → timestamp() → requestIdFormat → redactFormat → json()`:

- **`timestamp`** — ISO-8601 with an offset, so a line from a container whose `TZ` nobody recorded can still be placed in time.
- **`requestId`** — **on every line written while a request is being served**, not only the request lines (P7-03, 2026-09-24). `activityLogger` runs the rest of the request inside an `AsyncLocalStorage` (`requestContext`), and `requestIdFormat` adds that request's id to any line that does not already carry one. A `logger.error(...)` three service calls deep is therefore joinable to the `X-Request-Id` the client saw. Test: `tests/middlewares/activityLog.requestId.p703.test.js`.
- **`level`, `message`**, and whatever structured fields the call passed.

### The request lines

| Line | Level | Fields |
|---|---|---|
| `request received` | `http` — **dropped at the production level**, development detail | `requestId, ip, method, url` |
| `request completed` | **`info`** — the per-request record of production | `requestId, ip, method, url, statusCode, durationMs` (a **number**), `userId, tenantId` |

`/health`, `/live`, `/ready`, `/favicon.ico`, `/docs`, `/`, `/documentation`, `/standards` and `/tab-permissions` are not request-logged (exact path match).

### Alert lines (P7-02)

A scheduled-job failure, a missed run or a stuck batch job is logged at `error` with a structured `alert` object — `alert.key` (e.g. `job.retention-sweep.failed`), `alert.severity`, `title`, `meaning`, `action`, `detail`. **Match on `alert.key`**; it is stable. [`../DEVOPS/07-ALERTING.md`](../DEVOPS/07-ALERTING.md).

## Redaction — implemented (A-14, A-228)

`redactFormat` walks **every** field of a record at any depth (cycle-safe, depth-capped at 8) on a **copy**, and:

- replaces the value of any key matching the sensitive-name pattern (`password`, `secret`, `token`, `authorization`, `cookie`, `apikey`, `privatekey`, `masterkey`, `credential`, `otp…`, `mfacode`, `recoverycode`, `sessionid`, … — after lower-casing and removing `-`/`_`) with `[REDACTED]`;
- redacts a 4–10 digit value under a generic `code`/`pin` key;
- scrubs `Bearer …`/`Basic …` credentials and JWT-shaped strings appearing as **values** under innocent keys;
- `sanitizeUrl` redacts sensitive query parameters (including OAuth `code` and `state`) in a URL that is about to be logged.

Tests: `tests/middlewares/activityLog.test.js` and `tests/middlewares/activityLog.redaction.a228.test.js` (A-228 adds e-mail addresses and `*Link` keys; its expectations are written out literally, not derived from the redactor's own patterns — CLAUDE.md § Evidence).

`auditAction`, the helper that logged whole request and response bodies, **was deleted** (A-43); `withAudit` logs actor, ip and user agent only.

## What Does Not Go Through The Logger

**24 `console.*` call sites** remain in runtime code (counted 2026-09-24, excluding tests, scripts and migrations): `config/socket.js` (9), `utils/checkMenu.util.js` (7), `index.js` (3), `services/notification.service.js` (3), `services/sso.service.js` (1), `controllers/calibrationDevices.controller.js` (1). They reach stdout/stderr as **plain text, unredacted, with no `requestId`**. The log shipper parses them as unstructured lines (below) and re-applies redaction to them. Routing them through winston — not silencing them with `--fix` — is the rest of P7-03's `console.*` sweep.

The one that mattered — `audit.service#logAction` announcing a failed compliance write — **now goes through `logger.error("Audit log write failed", …)`** (A-42).

## The Access Log (morgan)

`accessLog.middleware.js` writes a **text** line per request to `log/access/<date>-access.log` (rotating-file-stream: daily, gzip, **`maxFiles: 30`** — the `history: "30d"` misreading was fixed by A-44). Format:

```
:request-id :user-id :real-ip - :remote-user [:custom-date] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time[3] ms
```

It is written **whatever `LOG_TO_FILE` says**, and its timestamps are `Asia/Jakarta`. It duplicates the JSON `request completed` line, which is the one to ship; the access log is a local fallback.

## Shipping (P7-03)

| Deployment | How lines leave the host | Status |
|---|---|---|
| compose | the Docker `json-file` driver keeps them (bounded: `max-size`/`max-file` in the prod overlay). **To ship:** [`deploy/observability/docker-compose.logging.yml`](../../deploy/observability/docker-compose.logging.yml) runs Vector with [`deploy/observability/vector.toml`](../../deploy/observability/vector.toml) — Docker source → JSON parse → **redaction again** → Loki, alert lines labelled by `alert.key` | template. `vector validate` passes (Vector 0.58.0); its transforms were run on sample lines (a JSON alert line with `password` and a Bearer token → both `[REDACTED]`, `alert.key` preserved; a plain text line kept as `message`). **Not run against a Docker socket or a Loki** |
| Kubernetes | the cluster's node agent (Fluent Bit, Vector, the cloud provider's) collects container stdout; nothing chart-specific is needed. Apply the same second redaction pass in that agent | the chart writes no log files (`LOG_TO_FILE` unset in production); `/app/log` is an `emptyDir` for the job-status files |

**Why redact again in the shipper.** An aggregator with its own parsing can re-expose what the application hid, and a leak into a third-party log store is a leak (P7-03 DoD). The second pass is key-based on the top-level fields plus value scrubbing everywhere; nested sensitive keys rely on the application's redactor. **"Redaction verified after shipping" is therefore not yet ticked** — it needs a line read back *from the aggregator*.

## Reading The Logs When Something Broke

```bash
# Everything the backend said, as JSON — boot crashes included (A-14).
docker compose logs backend
docker compose logs backend | grep '"alert"'                       # alerts only
docker compose logs backend | grep '"requestId":"<id-a-user-quoted>"'

# Files, only if LOG_TO_FILE=true:
tail -n 200 deploy/compose/volumes/log/activity/combined/$(date +%F).log

# Scheduled-job state (P7-02):
cat deploy/compose/volumes/log/jobs/*.json
```

## Known Gaps

| Gap | Effect | Tracked as |
|---|---|---|
| 24 `console.*` sites | plain text, no `requestId`, redacted only by the shipper | P7-03 remainder |
| the access log is text and duplicates `request completed` | a second, unstructured record of each request | — |
| no aggregator is deployed anywhere | lines live on the host / in the cluster's agent until one is | P7-03 remainder |
| redaction not verified from inside an aggregator | the DoD item is open | P7-03 remainder |

## `audit_logs` Is Not In This Document

It is a database table, not a log. It has no rotation, no retention and no delete path, and losing a row is a compliance incident rather than an inconvenience. [`../DATABASE/10-AUDIT-LOGS.md`](../DATABASE/10-AUDIT-LOGS.md).

One as-built caveat belongs here because it concerns durability: `auditLog.middleware.js#recordAudit` still writes its row on `res.on("finish")`, **after** the response and outside any transaction — its own JSDoc says it must never be what attribution rests on. The compliance-critical mutations write their row inside their transaction in the service (A-41); a failed `recordAudit` insert is logged at `error` (A-42).
