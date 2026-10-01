// P9-19 (ADR-087): converted from accessLog.middleware.js with no behaviour
// change. The modules load in the same order, except rotating-file-stream
// (below). `fs`, `morgan` and `moment-timezone` are the CommonJS module
// objects themselves (default imports). rotating-file-stream publishes ESM types with a CommonJS build
// behind its "require" condition, so it is loaded with require() as the .js
// did (the utils/upload.util.ts uuid precedent) and `rfs.createStream` is
// called once at load, as before. Babel hoists the imports above that
// require(), so it now loads after moment-timezone instead of before it;
// neither has a load-time effect on the other. The .js required `path` without
// using it; a bare import keeps that load (the dbReady.util precedent).
import fs from "fs";
import "path";
import storagePath from "../utils/storagePath.util";

import morgan from "morgan";

import type * as RfsModule from "rotating-file-stream" with { "resolution-mode": "import" };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: the CommonJS build, required
const rfs = require("rotating-file-stream") as typeof RfsModule;

import moment from "moment-timezone";

import type { Request, Response } from "express";

// ======================================================
// LOG DIRECTORY
// ======================================================

const logDir = storagePath("log/access");
// const logDir = path.join(__dirname, "../../log/access");

// Ensure Directory Exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, {
    recursive: true,
  });
}

// ======================================================
// ROTATING STREAM
// ======================================================

const accessLogStream = rfs.createStream(
  (time: Date | number | null) => {
    if (!time) {
      return "access.log";
    }

    return `${moment(time).tz("Asia/Jakarta").format("YYYY-MM-DD")}-access.log`;
  },

  {
    interval: "1d",
    path: logDir,
    compress: "gzip",
    // `history` is the name of rotating-file-stream's HISTORY FILE, not a
    // retention period (see its README § history: "Specifies the history
    // filename"). `history: "30d"` therefore set no retention at all and
    // created a bookkeeping file literally named `30d`; the access log grew
    // without bound. Retention is maxFiles/maxSize.
    maxFiles: 30,
  },
);

// ======================================================
// CUSTOM TOKENS
// ======================================================

// Jakarta Time
morgan.token("custom-date", () => {
  return moment().tz("Asia/Jakarta").format("DD/MMMM/YYYY HH:mm:ss ZZ");
});

// Request ID
morgan.token<Request, Response>("request-id", (req) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id logs "-"
  return req.requestId || "-";
});

morgan.token<Request, Response>("user-id", (req) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id logs "-"
  return req.user?.id || "-";
});

// A-16: req.ip — the address sessions, audit rows and e-signatures record —
// and never a request header. This token used to prefer CF-Connecting-IP and
// then the raw X-Forwarded-For, which a client connecting to nginx directly
// can set to anything; it also made the access log disagree with the audit
// trail about who the client was. nginx now resolves the edge header itself
// and strips it (deploy/compose/nginx/vm-http.conf).
morgan.token<Request, Response>("real-ip", (req) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition -- as built: an empty ip falls through; a test request may have no socket
  return req.ip || req.socket?.remoteAddress || "-";
});

// activate for the future
// morgan.token("tenant-id", (req) => {
//   return req.user?.tenantId || "-";
// });

// ======================================================
// FORMAT
// ======================================================

const customFormat = [
  ":request-id",
  ":user-id",
  ":real-ip",
  "-",
  ":remote-user",
  "[:custom-date]",
  '":method :url HTTP/:http-version"',
  ":status",
  ":res[content-length]",
  '":referrer"',
  '":user-agent"',
  ":response-time[3] ms",
].join(" ");

// ======================================================
// ACCESS LOGGER
// ======================================================

const accessLog = morgan<Request, Response>(customFormat, {
  stream: accessLogStream,

  // Skip noisy endpoints
  skip: (req) => {
    const skipPaths = [
      "/health",
      "/live",
      "/ready",
      "/favicon.ico",
      "/docs",
      "/",
      "/documentation",
      "/standards",
      "/tab-permissions",
      "/api/v1/permissions/tables",
    ];

    return skipPaths.includes(req.originalUrl);
  },
});

// A-296: an `errorLog` (this format, this same stream, skipping status < 400)
// was exported here and never mounted. Mounting it would only have written a
// second, identical line for every 4xx/5xx that accessLog already writes to the
// same file; errors themselves are logged by errorHandlers through winston. It
// was removed rather than mounted (MEMORY/records/2026-09-29-multipart-sanitizer.md).

export { accessLog };
