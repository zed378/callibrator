# 01 — Logging

Where a log line in this system actually ends up, what is silently dropped on the way, and why `docker logs` on the backend container is empty.

How to *write* a log line from application code is [`../ENGINEERING/12-LOGGING-CONVENTIONS.md`](../ENGINEERING/12-LOGGING-CONVENTIONS.md). The operational summary and the compliance contrast are [`../DEVOPS/06-LOGGING.md`](../DEVOPS/06-LOGGING.md) and [`../DATABASE/10-AUDIT-LOGS.md`](../DATABASE/10-AUDIT-LOGS.md). This document is the as-built detail underneath all three.

> **Target standard: TypeScript, strict (ADR-038).** The logging code described here is **JavaScript/CommonJS as built**, and every file named below is a `.js` file today. Conversion is tracked in [`../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md) and changes no behaviour.

---

## The One Thing To Know

**In production the winston logger writes to files only. Nothing it emits reaches stdout.**

`backend/src/middlewares/activityLog.middleware.js:69` adds the Console transport inside `if (!isProduction)`, where `isProduction` is `process.env.NODE_ENV === "production"` (line 7). The transport list built at lines 24–47 contains two file transports and no console.

That is a property of the **code**, not of the deployment, the entrypoint, or the order in which winston initialises. There is no timing window in which console output works and then stops; in production the Console transport is never constructed.

| Transport | Declared at | Level | Destination |
|---|---|---|---|
| error file | `activityLog.middleware.js:26` | `error` | `log/activity/error/<date>.log` |
| combined file | `activityLog.middleware.js:38` | logger level | `log/activity/combined/<date>.log` |
| exception handler | `activityLog.middleware.js:50` | uncaught | `log/activity/exception/<date>.log` |
| rejection handler | `activityLog.middleware.js:59` | unhandled | `log/activity/rejection/<date>.log` |
| **Console** | `activityLog.middleware.js:71` | logger level | stdout — **development only** |

### What this looks like when something goes wrong at boot

`backend/src/services/kms.service.js:12` throws at **module load** when `NODE_ENV=production` and `KMS_MASTER_KEY` is unset. Module load happens while `backend/index.js` is still resolving its `require` graph, so:

- the `try/catch` inside `startServer` has not been entered;
- the `process.on("uncaughtException")` handler is registered at the **bottom** of `index.js` and does not exist yet;
- winston's `exceptionHandlers` **are** already installed, because `activityLog.middleware.js` is required early;
- winston's `exitOnError` is not set and therefore defaults to `true`, so the process exits.

The result is a container that crash-loops while `docker logs` shows nothing and `log/activity/exception/<date>.log` holds the whole story. Any top-level throw behaves this way; `KMS_MASTER_KEY` is only the one that was hit. See [`../BACKEND/11-CONFIGURATION.md`](../BACKEND/11-CONFIGURATION.md).

### The exception: `console.*`

**"Nothing reaches stdout" is true of the logger, not of the process.** There are 25 `console.*` call sites in runtime backend code (excluding `src/tests/` and `src/scripts/`), and every one of them writes to stdout or stderr in production, outside winston, into no file:

| Where | Line | What is lost if you are not watching the container |
|---|---|---|
| `src/services/audit.service.js` | 47 | **`"Failed to write audit log (CRITICAL)"`** — a failed compliance write, reported nowhere else |
| `backend/index.js` | `startServer` catch | `"STARTUP ERROR:"` |
| `backend/index.js` | batch-worker start | `"Failed to start batch job worker:"` |
| `backend/index.js` | CORS setup | a CORS configuration warning |
| `src/config/socket.js` | five sites | handshake rejection, CORS rejection, connect, disconnect, failed board emit |
| `src/services/notification.service.js` | 71, 96, 102 | Socket.IO emit and channel dispatch failures |
| `src/services/sso.service.js` | 162 | `"SSO CRYPTO ERROR:"` |
| `src/controllers/calibrationDevices.controller.js` | 127 | temp import file not deleted |
| `src/utils/checkMenu.util.js` | 12–28 | a debugging dump |
| `src/migrations/0012-enable-rls-policies.js` | 80–150 | migration progress |

`audit.service.js:47` is the one that matters. A failure to write the compliance trail is announced on stderr and **written to no log file**, in a deployment where nobody reads stderr. It is also swallowed — `logAction` returns `null` and the request succeeds.

[`../ENGINEERING/12-LOGGING-CONVENTIONS.md`](../ENGINEERING/12-LOGGING-CONVENTIONS.md) currently says `config/socket.js` is "the only application output that reaches stdout in production". That is understated: the list above is the full set.

## Where The Files Are

Paths come from `backend/src/utils/storagePath.util.js`, which resolves against a storage root chosen by `backend/src/utils/packaged.util.js`:

| Running as | Storage root | Logs at |
|---|---|---|
| `node`/`bun` from source | `backend/` | `backend/log/...` |
| compiled single-file binary | `APP_STORAGE_PATH`, else `<dir of executable>/storage` | `<root>/log/...` |

In the compose stack the backend sets `APP_STORAGE_PATH: /app` and mounts `./volumes/log:/app/log` (`deploy/compose/docker-compose.yml:35`). **That bind mount is the only place production log lines exist.**

`deploy/compose/docker-compose.prod.yml:41` configures the Docker `json-file` driver with `max-size: 50m` and `max-file: 5` — rotation for an output stream that carries nothing but the `console.*` lines above.

```
log/
├── access/     <date>-access.log(.gz)       morgan, accessLog.middleware.js
└── activity/
    ├── combined/  <date>.log(.gz)           winston, at the logger level
    ├── error/     <date>.log(.gz)           winston, error only
    ├── exception/ <date>.log                uncaught exceptions
    └── rejection/ <date>.log                unhandled rejections
```

## What Is Written, And What Is Dropped

The logger level is set once, at `activityLog.middleware.js:14`:

```js
level: isProduction ? "info" : "debug",
```

winston's default (npm) level order is `error(0) < warn(1) < info(2) < http(3) < verbose(4) < debug(5)`, and a record is emitted only when its numeric level is at or below the configured one.

| Level | Production (`info`) | Development (`debug`) |
|---|---|---|
| `error` | written | written |
| `warn` | written | written |
| `info` | written | written |
| `http` | **dropped** | written |
| `debug` | dropped | written |

**Every per-request line is `http`, so production has no request log from winston.** `activityLog.middleware.js:132` writes the `REQUEST` record and line 147 the `RESPONSE` record, both through `logger.http`. On the reference deployment that is 0 `http` records in 640 combined-log lines (A-14).

Three consequences worth stating plainly:

- In production the combined log contains startup lines, scheduler outcomes, `AUDIT:` lines and errors — and no evidence that any request was ever served.
- The only surviving per-request record is the **morgan access log** on disk, which is a text line, not JSON.
- The `RESPONSE` record's `duration` is a string built as `${duration}ms` (line 154), not a number. Even where it is written — development — it cannot be summed or averaged by an aggregator.

`activityLog.middleware.js:92` excludes `/health`, `/live`, `/ready`, `/favicon.ico`, `/docs`, `/`, `/documentation`, `/standards` and `/tab-permissions` from request logging by **exact path match**. `shouldExcludeFromLogging` returns `undefined` rather than `false` for everything else, which is falsy and so behaves correctly — but it is one edit away from not doing so.

## Rotation And Retention, As Coded

| Log | Library | Rotate | Compress | Retention **as coded** |
|---|---|---|---|---|
| `log/activity/error/` | `winston-daily-rotate-file` | daily, 20 MB | gzip | `maxFiles: "30d"` |
| `log/activity/combined/` | `winston-daily-rotate-file` | daily, 20 MB | gzip | `maxFiles: "30d"` |
| `log/activity/exception/` | `winston-daily-rotate-file` | daily | **none** | **none — unbounded** |
| `log/activity/rejection/` | `winston-daily-rotate-file` | daily | **none** | **none — unbounded** |
| `log/access/` | `rotating-file-stream` | daily | gzip | **see below** |

The exception and rejection transports (`activityLog.middleware.js:50` and `:59`) pass neither `maxSize`, nor `maxFiles`, nor `zippedArchive`. They grow uncompressed until the volume fills. A crash loop writes a stack trace **per restart** into exactly these two files — the case where unbounded growth is fastest and where it matters most, because a full disk stops every write, including `audit_logs`.

**The access log's retention is not what it looks like.** `accessLog.middleware.js:38` passes:

```js
{ interval: "1d", path: logDir, compress: "gzip", history: "30d" }
```

In `rotating-file-stream`, retention is expressed with `maxFiles` and `maxSize`; `history` names the **file in which rotated filenames are recorded**. Neither `maxFiles` nor `maxSize` is passed, so nothing deletes an old access log, and `history: "30d"` creates a bookkeeping file literally named `30d` inside `log/access/`.

> **Unverified against the installed package.** `backend/node_modules` is absent from this checkout, so this reading rests on the library's documented option list rather than on its source. Confirm it by listing `log/access/` on a deployment older than 30 days and looking for a file named `30d`. If the code disagrees with this paragraph, the code wins and this paragraph gets fixed. [`../DEVOPS/06-LOGGING.md`](../DEVOPS/06-LOGGING.md) currently records the access log as "30 days".

Rotation bounds file **count**, never disk. The volume still needs a monitor.

## Redaction — Not Implemented

[`../DEVOPS/06-LOGGING.md`](../DEVOPS/06-LOGGING.md) § Redaction describes a key-name walk at any depth and a never-log list. **That is the target. No such redactor exists in `backend/src`.** The only `redact`-shaped code in the backend is unrelated: GDPR anonymisation (`gdpr.service.js:373`), retention masking (`dataRetention.service.js:212`) and per-response secret hiding (`eSignature.service.js:88`, `storage.route.js:58`).

What stands in for redaction today is discipline at the call site. No logger call in `backend/src` is wrapped by anything that would remove a secret before it reaches disk. Treat the never-log list in [`../ENGINEERING/12-LOGGING-CONVENTIONS.md`](../ENGINEERING/12-LOGGING-CONVENTIONS.md) as a rule you personally enforce, because nothing else does.

### Two helpers that would log entire request and response bodies

`backend/src/middlewares/auditLog.middleware.js` exports three functions. `recordAudit` writes the `audit_logs` row. The other two write **only** to the rotating file logs, and one of them is dangerous:

| Helper | Line | Logs |
|---|---|---|
| `auditAction(action, resource)` | 81 | `body: req.body` at `info` (line 88) **and** `response: body` at `info` (line 103) |
| `withAudit(action, resource)` | 124 | actor, ip and user agent; no bodies |

`auditAction` writes the complete request body and the complete response body, unredacted, into `log/activity/combined/`. Mounted on `POST /api/v1/auth/login` it would write plaintext passwords to disk; mounted on a certificate route it would write signature material.

**Neither helper has a caller anywhere in `src/routes`, `src/controllers` or `src/services`** — they are reachable only from their own tests. They are dead code, not an active leak. Do not make them live code without rewriting them first.

## The Request Id

A middleware in `backend/index.js` assigns `req.requestId = crypto.randomUUID()` and sets `X-Request-Id` on the response, and it is mounted **before** `accessLog` and `activityLogger`. `activityLog.middleware.js:120` reuses that value rather than minting a second one, so the header the client sees and the id in the logs are the same string.

It is exposed through CORS (`exposedHeaders: ["X-Request-Id"]` in `index.js`) and appears in:

| Sink | Field |
|---|---|
| morgan access log | the first token of the line (`accessLog.middleware.js:80`) |
| winston request/response records | `requestId` — **development only**, they are `http` |
| the error response body | `requestId` (`errorHandlers.middleware.js:28`) |
| the winston error record | `requestId` (`errorHandlers.middleware.js:16`) |

In production, therefore, a request id quoted by a user joins the **access log** to the **error log**, and to nothing else. There is no per-request winston line to join them through.

## Errors

`backend/src/middlewares/errorHandlers.middleware.js:15` logs the message with `requestId`, `statusCode`, `method`, `url`, `ip` and the full `stack`, then responds with `sanitizeError(err, isProduction)` (`utils/fileValidation.util.js:291`), which in production replaces the message with a fixed string.

**That is the central handler. A-13 records that most controllers never reach it**: `utils/controllerWrapper.util.js#asyncHandler` writes the error response itself before calling `next(error)`, so the handler runs after headers are sent. Do not read the paragraph above as a guarantee about what a client sees.

## Aggregation — None

There is no shipper, no collector and no aggregator. Logs exist in the `./volumes/log` bind mount and nowhere else.

A stack that collects container stdout collects **nothing** from this backend, which is the practical cost of the first section of this document. The winston files are already JSON and would ship as-is; the access log would need a parser. Shipping them is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

## Reading The Logs When Something Broke

```bash
# The container's own output: startup crashes and console.* only.
docker compose logs backend

# What the application actually wrote. This is the one that matters.
ls  deploy/compose/volumes/log/activity/
tail -n 200 deploy/compose/volumes/log/activity/combined/$(date +%F).log

# A boot that crash-looped with empty docker logs:
cat deploy/compose/volumes/log/activity/exception/$(date +%F).log

# A request id a user reported — access log first, then errors.
grep <request-id> deploy/compose/volumes/log/access/*-access.log
grep <request-id> deploy/compose/volumes/log/activity/error/*.log
```

The access-log format is defined at `accessLog.middleware.js:79`:

```
:request-id :user-id :real-ip - :remote-user [:custom-date] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time[3] ms
```

`:real-ip` prefers `cf-connecting-ip`, then `x-forwarded-for`, then `req.ip` (`accessLog.middleware.js:64`). **This is not the resolution the rest of the system uses.** `audit_logs`, `sessions` and `e_signature_records` store `req.ip`, which is subject to `trust proxy` and has not been verified behind this deployment's hops — A-16, open.

Timestamps in the access log are `Asia/Jakarta` (`accessLog.middleware.js:52`); winston timestamps are `YYYY-MM-DD HH:mm:ss` in the process's local zone with **no offset recorded** (`activityLog.middleware.js:18`). Correlating the two means knowing the container's `TZ`.

## Known Gaps

| Gap | Effect | Tracked as |
|---|---|---|
| no stdout in production | `docker logs` empty; no container-log collector can work | A-14 |
| per-request lines at `http` | no request record survives in production | A-14 |
| exception/rejection files unbounded | a crash loop can fill the volume | A-14 |
| access log has no `maxFiles` | unbounded — **unverified**, see above | new |
| `audit.service.js:47` reports a failed compliance write to stderr only | a lost audit row leaves no durable trace | new |
| no log redactor | the never-log list is enforced by review alone | — |
| `auditAction` logs full bodies | dead code today; a leak the moment it is mounted | new |
| `duration` is a string | not aggregatable | A-14 |
| no aggregation | logs are per-host files | backlog |

A-14's Definition of Done is in [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-14: JSON to stdout in production, per-request completion at `info` with a numeric duration, every file transport bounded.

## `audit_logs` Is Not In This Document

It is a database table, not a log. It has no rotation, no retention and no delete path, and losing one is a compliance incident rather than an inconvenience. [`../DATABASE/10-AUDIT-LOGS.md`](../DATABASE/10-AUDIT-LOGS.md).

One as-built caveat belongs here, because it concerns durability rather than schema: `auditLog.middleware.js:33` registers `recordAudit` on `res.on("finish")` and writes the row **after** the response, outside the action's transaction, describing itself in its own JSDoc as "best-effort and non-blocking" (line 22). A rolled-back action can therefore still produce an audit row, and a committed one can fail to produce any. That contradicts the rule in [`../../CLAUDE.md`](../../CLAUDE.md) ("inside the transaction") and the description in [`../DEVOPS/06-LOGGING.md`](../DEVOPS/06-LOGGING.md). It is not a logging defect and A-14 does not cover it.
