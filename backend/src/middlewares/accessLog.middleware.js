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
    history: "30d",
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

morgan.token("real-ip", (req) => {
  return (
    req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip
  );
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
