// P9-05a (ADR-087 Amendment 2): converted from activityLog.middleware.js with no
// behaviour change. The imports load the same modules in the same order; the
// environment is read at load, as before (P9-06 moves those reads into
// src/config/); every `||` below is the as-built semantics, where an empty
// string means "unset" — `??` would change that.
import { createLogger, format, transports } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import storagePath from "../utils/storagePath.util";
import { randomUUID } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import type { NextFunction, Request, Response } from "express";
import type { TransformableInfo } from "logform";
import { env, envOr, isProduction as isProductionNow } from "../config/env";

const { combine, timestamp, errors, json } = format;
const logDir = storagePath("log/activity");
// Read at load, as built (src/config/env).
const isProduction = isProductionNow();

// ======================================================
// CONFIGURATION (A-14)
// ======================================================

/**
 * Production logs JSON lines to stdout, where Docker collects them (and the
 * compose json-file driver bounds them). Before A-14 the Console transport was
 * added only outside production, so `docker logs` was empty and a crash at
 * boot left its stack trace in a file nobody looked at.
 *
 * File logging is optional:
 *   LOG_TO_FILE=true   write the rotated files too
 *   LOG_TO_FILE=false  never write them
 *   unset              files outside production, stdout only in production
 * Every file transport is bounded (daily, 20 MB, gzip, 30 days).
 *
 * LOG_LEVEL overrides the level (default: info in production, debug elsewhere).
 */
const logToFile =
  env("LOG_TO_FILE") === undefined || env("LOG_TO_FILE") === ""
    ? !isProduction
    : env("LOG_TO_FILE") === "true";

const level = envOr("LOG_LEVEL", isProduction ? "info" : "debug");

// ======================================================
// REDACTION (A-14)
// ======================================================

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 8;

/**
 * Key names whose value is never logged, matched at any depth after
 * lower-casing and removing `-` and `_` (so `set-cookie`, `api_key`,
 * `x-api-key`, `refreshToken` and `mfa_secret` all match).
 */
const SENSITIVE_KEY =
  /password|passwd|passphrase|^pass$|secret|token|authorization|cookie|apikey|privatekey|publickey|masterkey|encryptionkey|credential|^otp|otp$|^totp|mfacode|recoverycode|backupcode|sessionid|^sid$|link$/;
// A-228 — `link$`: a generated link (`activationLink`, `resetLink`,
// `verificationLink`, `inviteLink`, `magicLink`, ...) carries its capability
// token in the URL, so the whole value is a credential. The template data
// handed to the mailer is logged under exactly these keys.

/** A one-time code under a generic key (`code`, `pin`): redacted when it looks like one. */
const CODE_KEY = /^(code|pin|verificationcode)$/;
const ONE_TIME_CODE = /^\s*\d{4,10}\s*$/;

/** Credentials that show up as VALUES under unremarkable key names. */
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;

/**
 * A-228 — an email address anywhere in a logged string. It is personal data
 * (GDPR Art. 4(1)), and a log line is kept, shipped and read far more widely
 * than the users table. The address is masked, not removed: the first
 * character of the local part and the domain stay, so an operator can still
 * tell "the hospital-b.example user" from another without learning who.
 * The domain must end in a label of two or more letters, which keeps
 * `user@host` fragments of stack traces and ids out of it.
 */
const EMAIL = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g;

/** A key as JavaScript callers may pass it: any property key. */
type LogKey = PropertyKey;

const normaliseKey = (key: LogKey): string => String(key).toLowerCase().replace(/[-_]/g, "");

const isSensitiveKey = (key: LogKey): boolean => SENSITIVE_KEY.test(normaliseKey(key));

const scrubString = (value: string): string => {
  const scrubbed = value.replace(BEARER, `$1 ${REDACTED}`).replace(JWT, REDACTED);
  // The includes() guard keeps the email pass off the (long, @-free) strings
  // that are most of what is logged.
  return scrubbed.includes("@") ? scrubbed.replace(EMAIL, "$1***@$2") : scrubbed;
};

/** Sequelize instances and the like: something that says how it serialises. */
const hasToJSON = (value: object): value is { toJSON: () => unknown } =>
  typeof (value as { toJSON?: unknown }).toJSON === "function";

/**
 * Returns a redacted COPY of `value`; never mutates what the caller logged.
 * @param value - anything logged
 * @param seen - cycle guard
 * @param depth - current depth
 */
const redactValue = (value: unknown, seen: WeakSet<object>, depth: number): unknown => {
  if (typeof value === "string") {
    return scrubString(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return `[Buffer ${String(value.length)} bytes]`;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  if (depth >= MAX_DEPTH) {
    return "[Truncated]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactValue(item, seen, depth + 1));
  }

  let source: unknown = value;
  if (value instanceof Error) {
    // Spread as a plain object: at run time only the error's OWN enumerable
    // properties are copied (name and message are normally not), exactly as before.
    const ownFields: object = value;
    source = { name: value.name, message: value.message, stack: value.stack, ...ownFields };
  } else if (hasToJSON(value)) {
    // Sequelize instances and the like: walk what would be serialised.
    source = value.toJSON();
    if (source === null || typeof source !== "object") {
      return redactValue(source, seen, depth + 1);
    }
  }

  const record = source as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    out[key] = redactEntry(key, record[key], seen, depth + 1);
  }
  return out;
};

const redactEntry = (key: LogKey, value: unknown, seen: WeakSet<object>, depth: number): unknown => {
  if (value !== undefined && value !== null && value !== "") {
    if (isSensitiveKey(key)) {
      return REDACTED;
    }
    if (
      CODE_KEY.test(normaliseKey(key)) &&
      (typeof value === "string" || typeof value === "number") &&
      ONE_TIME_CODE.test(String(value))
    ) {
      return REDACTED;
    }
  }
  return redactValue(value, seen, depth);
};

/**
 * Redacts a query string's sensitive parameters (`?token=`, `?code=`, …) in a
 * URL that is about to be logged. Keeps the path and non-sensitive parameters.
 * A non-string is returned as it is.
 */
const sanitizeUrl = <T>(url: T): T | string => {
  if (typeof url !== "string") {
    return url;
  }
  const q = url.indexOf("?");
  if (q === -1) {
    return scrubString(url);
  }
  const query = url
    .slice(q + 1)
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) {
        return pair;
      }
      let key = pair.slice(0, eq);
      try {
        key = decodeURIComponent(key);
      } catch {
        /* keep the raw key */
      }
      const normalised = normaliseKey(key);
      return isSensitiveKey(key) || CODE_KEY.test(normalised) || normalised === "state"
        ? `${pair.slice(0, eq)}=${REDACTED}`
        : pair;
    })
    .join("&");
  return scrubString(`${url.slice(0, q)}?${query}`);
};

/**
 * winston format: redacts every string-keyed field of the log record at any
 * depth, keeps winston's Symbol keys, and returns a new record so an object
 * the caller passed in is never modified.
 */
const redactFormat = format((info: TransformableInfo) => {
  const seen = new WeakSet<object>();
  seen.add(info);
  // Built key by key, in the record's own order (the JSON line keeps it); the
  // result has every key of `info`, `level` among them, so it is a record.
  const out: Record<string | symbol, unknown> = {};
  for (const sym of Object.getOwnPropertySymbols(info)) {
    out[sym] = info[sym];
  }
  for (const key of Object.keys(info)) {
    if (key === "level") {
      out[key] = info[key];
      continue;
    }
    out[key] = redactEntry(key, info[key], seen, 1);
  }
  return out as TransformableInfo;
});

// ======================================================
// REQUEST CORRELATION (P7-03)
// ======================================================

/** What a request's log lines carry from its context. */
export interface RequestLogContext {
  requestId: string;
}

/**
 * The request a log line was written on behalf of. activityLogger runs the
 * rest of the request inside `requestContext.run({ requestId })`, and every
 * continuation of it (awaits, callbacks, the service and model layers) sees
 * the same store — so a service's `logger.error(...)` carries the request's
 * id without being handed it. Before P7-03 only the two per-request lines
 * did; correlating a client's X-Request-Id with a failure deeper down meant
 * matching timestamps.
 */
const requestContext = new AsyncLocalStorage<RequestLogContext>();

/** winston format: add `requestId` from the request context, never overwrite one. */
const requestIdFormat = format((info: TransformableInfo) => {
  if (info["requestId"] === undefined) {
    const store = requestContext.getStore();
    // `store.requestId` may be "" from a JavaScript caller: falsy, not added.
    if (store?.requestId) {
      info["requestId"] = store.requestId;
    }
  }
  return info;
});

// ======================================================
// LOGGER
// ======================================================

const baseFormat = combine(
  errors({ stack: true }),
  // ISO-8601 with an offset, so a line from a container whose TZ nobody
  // recorded can still be placed in time.
  timestamp(),
  requestIdFormat(),
  redactFormat(),
  json(),
);

/** The only per-transport override used below. */
interface RotatedExtra {
  level?: string;
}

/**
 * `createDir` is an option the transport reads at run time but its type
 * declarations do not list; the options keep it, exactly as before.
 */
type RotatedOptions = DailyRotateFile.DailyRotateFileTransportOptions & { createDir: boolean };

const rotated = (dirname: string, extra: RotatedExtra = {}): DailyRotateFile => {
  const options: RotatedOptions = {
    dirname,
    filename: "%DATE%.log",
    datePattern: "YYYY-MM-DD",
    zippedArchive: true,
    maxSize: "20m",
    maxFiles: "30d",
    createDir: true,
    ...extra,
  };
  return new DailyRotateFile(options);
};

const consoleTransport = new transports.Console({
  // Uncaught exceptions and unhandled rejections reach stdout too, so a
  // crash loop is visible in `docker logs`.
  handleExceptions: true,
  handleRejections: true,
  ...(isProduction
    ? {}
    : {
      format: combine(
        format.colorize(),
        format.printf(({ timestamp: ts, level: lvl, message }) => {
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: template interpolation of whatever the record holds
          return `${ts} [${lvl}]: ${message}`;
        }),
      ),
    }),
});

const fileTransports = logToFile
  ? [rotated(`${logDir}/error`, { level: "error" }), rotated(`${logDir}/combined`)]
  : [];

const logger = createLogger({
  level,
  format: baseFormat,
  transports: [consoleTransport, ...fileTransports],
  // The console transport handles both itself (above); these add bounded files.
  exceptionHandlers: logToFile ? [rotated(`${logDir}/exception`)] : undefined,
  rejectionHandlers: logToFile ? [rotated(`${logDir}/rejection`)] : undefined,
});

// ======================================================
// HTTP LOGGER MIDDLEWARE
// ======================================================

/**
 * Endpoints to exclude from activity logging
 */
const EXCLUDED_PATHS = [
  "/health",
  "/live",
  "/ready",
  "/favicon.ico",
  "/docs",
  "/",
  "/documentation",
  "/standards",
  "/tab-permissions",
];

/**
 * Check if request should be excluded from logging (exact path match).
 */
const shouldExcludeFromLogging = (url: string): boolean => EXCLUDED_PATHS.includes(url);

const activityLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = process.hrtime.bigint();

  // Reuse the request id assigned by the upstream request-id middleware (in
  // index.js); only generate one if it's somehow missing, so there's a single
  // source of truth and the X-Request-Id header isn't rewritten.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: "" means missing
  const requestId = req.requestId || randomUUID();

  req.requestId = requestId;

  if (!res.getHeader("X-Request-Id")) {
    res.setHeader("X-Request-Id", requestId);
  }

  const { ip, method, originalUrl } = req;

  // Skip logging for excluded endpoints
  if (!shouldExcludeFromLogging(originalUrl)) {
    const url = sanitizeUrl(originalUrl);

    // The arrival line stays at `http` (development detail); the completion
    // line below is the per-request record and is written at `info` so it
    // survives the production level (A-14).
    // `message` must be set: winston treats a lone object WITHOUT one as the
    // message itself, which is how this line used to print "[object Object]".
    logger.http({ message: "request received", requestId, type: "REQUEST", ip, method, url });

    res.on("finish", () => {
      const durationMs =
        Math.round(Number(process.hrtime.bigint() - start) / 1e4) / 100;

      logger.info({
        message: "request completed",
        requestId,
        type: "RESPONSE",
        ip,
        method,
        url,
        statusCode: res.statusCode,
        durationMs,
        /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: "" and 0 mean unset */
        userId: req.user?.id || null,
        tenantId: req.tenantId || req.user?.tenantId || null,
        /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
      });
    });
  }

  // P7-03: everything downstream of this request logs with its requestId.
  requestContext.run({ requestId }, next);
};

export {
  activityLogger,
  logger,
  requestContext,
  // exported for tests and for any caller that must log a request-shaped value
  redactFormat,
  requestIdFormat,
  sanitizeUrl,
  isSensitiveKey,
};
