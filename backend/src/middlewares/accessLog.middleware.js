const fs = require("fs");
const path = require("path");
const storagePath = require("../utils/storagePath.util");

const morgan = require("morgan");

const rfs = require("rotating-file-stream");

const moment = require("moment-timezone");

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
  (time) => {
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
morgan.token("request-id", (req) => {
  return req.requestId || "-";
});

morgan.token("user-id", (req) => {
  return req.user?.id || "-";
});

// A-16: req.ip — the address sessions, audit rows and e-signatures record —
// and never a request header. This token used to prefer CF-Connecting-IP and
// then the raw X-Forwarded-For, which a client connecting to nginx directly
// can set to anything; it also made the access log disagree with the audit
// trail about who the client was. nginx now resolves the edge header itself
// and strips it (deploy/compose/nginx/vm-http.conf).
morgan.token("real-ip", (req) => {
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

const accessLog = morgan(customFormat, {
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

const errorLog = morgan(customFormat, {
  stream: accessLogStream,
  skip: (req, res) => res.statusCode < 400,
});

module.exports = {
  accessLog,
  errorLog,
};
