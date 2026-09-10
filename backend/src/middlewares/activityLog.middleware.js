const { createLogger, format, transports } = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
const storagePath = require("../utils/storagePath.util");
const crypto = require("crypto");
const { combine, timestamp, errors, json } = format;
const logDir = storagePath("log/activity");
const isProduction = process.env.NODE_ENV === "production";

// ======================================================
// LOGGER
// ======================================================

const logger = createLogger({
  level: isProduction ? "info" : "debug",

  format: combine(
    errors({ stack: true }),
    timestamp({
      format: "YYYY-MM-DD HH:mm:ss",
    }),
    json(),
  ),

  transports: [
    // Error Logs
    new DailyRotateFile({
      level: "error",
      dirname: `${logDir}/error`,
      filename: "%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "30d",
      createDir: true,
    }),

    // Combined Logs
    new DailyRotateFile({
      dirname: `${logDir}/combined`,
      filename: "%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "30d",
      createDir: true,
    }),
  ],

  exceptionHandlers: [
    new DailyRotateFile({
      dirname: `${logDir}/exception`,
      filename: "%DATE%.log",
      datePattern: "YYYY-MM-DD",
      createDir: true,
    }),
  ],

  rejectionHandlers: [
    new DailyRotateFile({
      dirname: `${logDir}/rejection`,
      filename: "%DATE%.log",
      datePattern: "YYYY-MM-DD",
      createDir: true,
    }),
  ],
});

// Console Logging
if (!isProduction) {
  logger.add(
    new transports.Console({
      format: combine(
        format.colorize(),
        timestamp({
          format: "YYYY-MM-DD HH:mm:ss",
        }),
        format.printf(({ timestamp: ts, level, message }) => {
          return `${ts} [${level}]: ${message}`;
        }),
      ),
    }),
  );
}

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
 * Check if request should be excluded from logging
 */
const shouldExcludeFromLogging = (url) => {
  // Exact match
  if (EXCLUDED_PATHS.includes(url)) {
    return true;
  }
};

const activityLogger = (req, res, next) => {
  const start = Date.now();

  // Reuse the request id assigned by the upstream request-id middleware (in
  // index.js); only generate one if it's somehow missing, so there's a single
  // source of truth and the X-Request-Id header isn't rewritten.
  const requestId = req.requestId || crypto.randomUUID();

  req.requestId = requestId;

  if (!res.getHeader("X-Request-Id")) {
    res.setHeader("X-Request-Id", requestId);
  }

  const { ip, method, originalUrl } = req;

  // Skip logging for excluded endpoints
  if (!shouldExcludeFromLogging(originalUrl)) {
    logger.http({
      requestId,

      type: "REQUEST",

      ip,

      method,

      url: originalUrl,
    });

    res.on("finish", () => {
      const duration = Date.now() - start;

      logger.http({
        requestId,
        type: "RESPONSE",
        ip,
        method,
        url: originalUrl,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
      });
    });
  }

  next();
};

module.exports = {
  activityLogger,
  logger,
};
