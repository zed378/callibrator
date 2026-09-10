require("./src/utils/env.util");
const express = require("express");

const compression = require("compression");
const crypto = require("crypto");
const timeout = require("connect-timeout");
const hpp = require("hpp");

const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { swaggerDocs } = require("./src/docs/swagger");
const path = require("path");

const { Connection, db } = require("./src/config");
const { initSocket } = require("./src/config/socket");

const {
  globalSanitizer,
} = require("./src/middlewares/globalSanitizer.middleware");

const {
  ensureFolderExisted,
} = require("./src/middlewares/createFolder.middleware");

const { notFound } = require("./src/middlewares/notFound.middleware");

const { errorHandler } = require("./src/middlewares/errorHandlers.middleware");

const { cronBackup } = require("./src/middlewares/backup.middleware");

const {
  initSessionCleanup,
} = require("./src/middlewares/sessionCleanup.middleware");

const {
  initCalibrationScheduler,
} = require("./src/middlewares/calibrationScheduler.middleware");

const {
  initRetentionScheduler,
} = require("./src/middlewares/retentionScheduler.middleware");

const { initRedis, closeRedis } = require("./src/services/redis.service");

const {
  processEmailQueue,
  closeRabbitMQ,
} = require("./src/services/emailQueue.service");

const { accessLog } = require("./src/middlewares/accessLog.middleware");

const {
  activityLogger,
  logger,
} = require("./src/middlewares/activityLog.middleware");

const { WINDOW } = require("./src/constants/rateLimitConstants");

const storagePath = require("./src/utils/storagePath.util");
const appPath = require("./src/utils/appPath.util");

const migrationService = require("./src/services/migration.service");

// ======================================================
// INITIALIZATION
// ======================================================

// Ensure required folders exist
ensureFolderExisted();

// uncaughtException / unhandledRejection handlers are registered once, next to
// the graceful shutdown() below (see PROCESS HANDLERS), so a fatal error is
// logged and the server drains DB/Redis/RabbitMQ before exiting.

// Initialize Express
const app = express();

// ======================================================
// GLOBAL SETTINGS
// ======================================================

// Trust Proxy
// Required for:
// - Kubernetes
// - Nginx
// - Cloudflare
// - Rate limiter
app.set("trust proxy", 1);

// Pretty JSON in development
if (process.env.NODE_ENV !== "production") {
  app.set("json spaces", 2);
}

// ======================================================
// MIDDLEWARES
// ======================================================

// Compression
app.use(compression());

// HTTPS Redirect (production only — behind reverse proxy)
if (
  process.env.NODE_ENV === "production" &&
  process.env.FORCE_HTTPS === "true"
) {
  app.use((req, res, next) => {
    if (!req.secure && req.get("X-Forwarded-Proto") !== "https") {
      // Redirect to HTTPS (preserves path + query)
      return res.redirect(301, `https://${req.get("Host")}${req.url}`);
    }
    next();
  });
}

// Security Headers
// A conservative Content-Security-Policy is enabled (previously disabled).
// 'unsafe-inline' is permitted for scripts/styles because the bundled
// swagger-ui injects inline assets; the remaining directives (default-src
// 'self', object-src 'none', frame-ancestors 'none') still provide meaningful
// XSS/clickjacking mitigation. crossOriginResourcePolicy is set to
// "cross-origin" so the separate-origin frontend can load /uploads images.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'", "https:"],
        "img-src": ["'self'", "data:", "https:"],
        "font-src": ["'self'", "data:", "https:"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        "upgrade-insecure-requests": null,
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  }),
);

// Prevent HTTP Parameter Pollution
app.use(hpp());

// ======================================================
// CORS
// ======================================================

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server / Postman requests (no origin header)
      if (!origin) {
        return callback(null, true);
      }

      // Strict: only allow explicitly configured origins. A wildcard "*" is
      // intentionally NOT honored here — this CORS policy runs with
      // credentials:true, and reflecting an arbitrary origin back with
      // credentials would let any site make authenticated cross-origin
      // requests. Configure explicit origins instead.
      if (allowedOrigins.includes(origin.trim())) {
        return callback(null, true);
      }

      // Production default: reject if no origins configured
      if (
        process.env.NODE_ENV === "production" &&
        allowedOrigins.length === 0
      ) {
        console.warn(
          `CORS error: "${origin}" rejected — no CORS_ORIGIN configured in production`,
        );
        return callback(new Error("Not allowed by CORS"));
      }

      // Development default: allow all
      if (process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },

    credentials: true,
    exposedHeaders: ["X-Request-Id"],
    optionsSuccessStatus: 200,
  }),
);

// ======================================================
// RATE LIMITERS
// ======================================================

// Default rate limiter (applied to all routes).
//
// Production keeps a real budget. Outside production it is raised, because one
// full E2E run (75 browser tests, each page load fanning out to several API
// calls) exhausts a normal budget and then fails for reasons that have nothing
// to do with the code under test. RATE_LIMIT_MAX overrides either way.
const defaultLimiter = rateLimit({
  windowMs: WINDOW.FIFTEEN_MIN,
  max:
    Number(process.env.RATE_LIMIT_MAX) ||
    (process.env.NODE_ENV === "production" ? 5000 : 100000),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "Error",
    message: "Too many requests, please try again later",
  },
});

// Strict rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: WINDOW.FIFTEEN_MIN,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "Error",
    message: "Too many authentication attempts, please try again later",
  },
});

// Strict rate limiter for OTP/Password reset endpoints
const otpLimiter = rateLimit({
  windowMs: WINDOW.HOUR,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "Error",
    message: "Too many requests, please try again later",
  },
});

// Apply default limiter globally
app.use(defaultLimiter);

// ======================================================
// BODY PARSER
// ======================================================

// Stripe webhook signature verification needs the UNPARSED body. Stash the raw
// bytes on req.rawBody via the JSON parser's verify hook (this survives the
// downstream globalSanitizer, which only rewrites req.body/query/params).
app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buf) => {
      if (
        req.originalUrl &&
        req.originalUrl.startsWith("/api/v1/billing/webhook")
      ) {
        req.rawBody = buf;
      }
    },
  }),
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  }),
);

// ======================================================
// REQUEST TIMEOUT
// ======================================================

app.use(timeout("30s"));

app.use((req, res, next) => {
  if (!req.timedout) {
    next();
  }
});

app.use((err, req, res, next) => {
  if (err.timeout) {
    return res.status(408).json({
      status: "Error",
      message: "Request timeout",
    });
  }

  next(err);
});

// ======================================================
// REQUEST ID
// ======================================================

app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();

  res.setHeader("X-Request-Id", req.requestId);

  next();
});

// ======================================================
// LOGGING
// ======================================================

app.use(accessLog);

app.use(activityLogger);

// ======================================================
// STATIC FILES
// ======================================================

// ACME HTTP-01 challenge files are written at runtime, so serve them from the
// writable storage root (must match where customDomains.service writes them),
// not a CWD-relative path that shifts with the launch directory.
app.use("/.well-known", express.static(storagePath(".well-known")));

app.use(
  "/uploads",
  express.static(storagePath("uploads"), {
    setHeaders: (res) => {
      // Defense-in-depth for user-uploaded content: prevent MIME sniffing and
      // force inline rendering only (never treat an upload as active content).
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", "inline");
    },
  }),
);

app.use("/public", express.static(appPath("public")));

// ======================================================
// SANITIZER
// ======================================================

app.use(globalSanitizer);

// ======================================================
// SWAGGER
// ======================================================

swaggerDocs(app);

// ======================================================
// ROUTES
// ======================================================
const migrationRoutes = require("./src/routes/internal/migration.route");
const authRoutes = require("./src/routes/api/auth.route");
const userRoutes = require("./src/routes/api/user.route");
const tenantRoutes = require("./src/routes/api/tenant.route");
const tenantBackupRoutes = require("./src/routes/api/tenantBackup.route");
const rolesRoutes = require("./src/routes/api/roles.route");
const sessionRoutes = require("./src/routes/api/session.route");
const warehouseRoutes = require("./src/routes/api/warehouse.route");
const stockRoutes = require("./src/routes/api/stock.route");
const calibrationDevicesRoutes = require("./src/routes/api/calibrationDevices.route");
const calibrationRecordsRoutes = require("./src/routes/api/calibrationRecords.route");
const certificateRoutes = require("./src/routes/api/certificates.route");
const menuGroupsRoutes = require("./src/routes/api/menuGroups.route");
const vendorRoutes = require("./src/routes/api/vendor.route");
const maintenanceRoutes = require("./src/routes/api/maintenance.route");
const notificationRoutes = require("./src/routes/api/notifications.route");
const billingRoutes = require("./src/routes/api/billing.route");
const auditRoutes = require("./src/routes/api/audit.route");
const calibrationSchedulerRoutes = require("./src/routes/api/calibrationScheduler.route");
const dashboardRoutes = require("./src/routes/api/dashboard.route");
const userPermissionsRoutes = require("./src/routes/api/userPermissions.route");
const quotaRoutes = require("./src/routes/api/quota.route");
const attachmentRoutes = require("./src/routes/api/attachments.route");
const storageRoutes = require("./src/routes/api/storage.route");
const reportRoutes = require("./src/routes/api/reports.route");
const webhookRoutes = require("./src/routes/api/webhooks.route");
const apiKeyRoutes = require("./src/routes/api/apiKeys.route");
const searchRoutes = require("./src/routes/api/search.route");
const workflowRoutes = require("./src/routes/api/workflows.route");
const financeRoutes = require("./src/routes/api/finance.route");
const contentRoutes = require("./src/routes/api/content.route");
const scimRoutes = require("./src/routes/api/scim.route");
const adminRoutes = require("./src/routes/api/admin.route");
const batchJobsRoutes = require("./src/routes/api/batchJobs.route");
const qmsRoutes = require("./src/routes/api/qms.route");
const sopRoutes = require("./src/routes/api/sop.route");
const iotRoutes = require("./src/routes/api/iot.route");
const predictiveMaintenanceRoutes = require("./src/routes/api/predictiveMaintenance.route");
const riskRoutes = require("./src/routes/api/risk.route");
const supplierScorecardRoutes = require("./src/routes/api/supplierScorecard.route");
const aiRoutes = require("./src/routes/api/ai.route");
const featureFlagRoutes = require("./src/routes/api/featureFlags.route");
const tenantLifecycleRoutes = require("./src/routes/api/tenantLifecycle.route");
const dataRetentionRoutes = require("./src/routes/api/dataRetention.route");
const oidcRoutes = require("./src/routes/api/oidc.route");
const webauthnRoutes = require("./src/routes/api/webauthn.route");
const networkSecurityRoutes = require("./src/routes/api/networkSecurity.route");
const meteredBillingRoutes = require("./src/routes/api/meteredBilling.route");
const customDomainsRoutes = require("./src/routes/api/customDomains.route");
const gdprRoutes = require("./src/routes/api/gdpr.route");
const tenantHierarchyRoutes = require("./src/routes/api/tenantHierarchy.route");
const eSignatureRoutes = require("./src/routes/api/eSignature.route");
const kanbanRoutes = require("./src/routes/api/kanban.route");
const ticketRoutes = require("./src/routes/api/tickets.route");

// ======================================================
// ROUTES ENDPOINT
// ======================================================

// Migration routes are available for manual triggering
// Use GET /api/v1/migration/seeding to seed database with initial data
// Use GET /api/v1/migration/up to run database migration
// Use GET /api/v1/migration/down to drop database tables
// Use GET /api/v1/migration/unseeding to remove seeded data
app.use("/api/v1/migration", migrationRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/jobs", batchJobsRoutes);
app.use("/api/v1/qms", qmsRoutes);
app.use("/api/v1/sop", sopRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/roles", rolesRoutes);
app.use("/api/v1/tenants", tenantRoutes);
app.use("/api/v1/tenants", tenantBackupRoutes);
app.use("/api/v1/sessions", sessionRoutes);
app.use("/api/v1/warehouses", warehouseRoutes);
app.use("/api/v1/stocks", stockRoutes);
app.use("/api/v1/calibration-devices", calibrationDevicesRoutes);
app.use("/api/v1/calibration-records", calibrationRecordsRoutes);
app.use("/api/v1/certificates", certificateRoutes);
app.use("/api/v1/menu-groups", menuGroupsRoutes);
app.use("/api/v1/menu-group-roles", menuGroupsRoutes);
app.use("/api/v1/vendors", vendorRoutes);
app.use("/api/v1/maintenance", maintenanceRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/billing", billingRoutes);
app.use("/api/v1/audit", auditRoutes);
app.use("/api/v1/calibration-scheduler", calibrationSchedulerRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/user-permissions", userPermissionsRoutes);
app.use("/api/v1/quota", quotaRoutes);
app.use("/api/v1/attachments", attachmentRoutes);
app.use("/api/v1/storage", storageRoutes);
app.use("/api/v1/reports", reportRoutes);
app.use("/api/v1/webhooks", webhookRoutes);
app.use("/api/v1/api-keys", apiKeyRoutes);
app.use("/api/v1/search", searchRoutes);
app.use("/api/v1/workflows", workflowRoutes);
app.use("/api/v1/finance", financeRoutes);
app.use("/api/v1/content", contentRoutes);
app.use("/api/v1/scim/v2", scimRoutes);
app.use("/api/v1/iot", iotRoutes);
app.use("/api/v1/predictive-maintenance", predictiveMaintenanceRoutes);
app.use("/api/v1/risk", riskRoutes);
app.use("/api/v1/supplier-scorecard", supplierScorecardRoutes);
app.use("/api/v1/ai", aiRoutes);
app.use("/api/v1/feature-flags", featureFlagRoutes);
app.use("/api/v1/tenants", tenantLifecycleRoutes);
app.use("/api/v1/tenants", dataRetentionRoutes);
app.use("/api/v1/oidc", oidcRoutes);
// Also mount OIDC at the issuer root: the discovery document advertises its
// endpoints at `<issuer>/oidc/...` (issuer = host root), so relying parties
// fetch `/oidc/.well-known/openid-configuration` and `/oidc/.well-known/jwks.json`
// directly — not under the `/api/v1` API prefix. Serve them where discovery
// says they are.
app.use("/oidc", oidcRoutes);
app.use("/api/v1/webauthn", webauthnRoutes);
app.use("/api/v1/network-security", networkSecurityRoutes);
app.use("/api/v1/metered-billing", meteredBillingRoutes);
app.use("/api/v1/custom-domains", customDomainsRoutes);
app.use("/api/v1/gdpr", gdprRoutes);
app.use("/api/v1/tenant-hierarchy", tenantHierarchyRoutes);
app.use("/api/v1/esignature", eSignatureRoutes);
app.use("/api/v1/kanban", kanbanRoutes);
app.use("/api/v1/tickets", ticketRoutes);

// ======================================================
// HEALTHCHECK
// ======================================================

app.get("/health", async (req, res) => {
  try {
    await db.authenticate();

    return res.status(200).json({
      status: "OK",
      uptime: process.uptime(),
      timestamp: new Date(),
      memory: process.memoryUsage(),
      pid: process.pid,
      node: process.version,
      database: "connected",
    });
  } catch (error) {
    return res.status(503).json({
      status: "ERROR",
      database: "disconnected",
      message: error.message,
    });
  }
});

// ======================================================
// ROOT
// ======================================================

app.get("/", (req, res) => {
  return res.status(200).json({
    status: "Success",
    message: "Your API is running",
  });
});

// ======================================================
// LIVENESS
// ======================================================

app.get("/live", (req, res) => {
  return res.status(200).send("OK");
});

// ======================================================
// READINESS
// ======================================================

app.get("/ready", async (req, res) => {
  try {
    await db.authenticate();

    return res.status(200).send("READY");
  } catch {
    return res.status(503).send("NOT READY");
  }
});

// ======================================================
// DOCUMENTATION (HTML)
// ======================================================

// appPath (execPath-relative when packaged) so these are read from the docs
// folder shipped next to the binary — res.sendFile cannot serve a file embedded
// under __dirname inside a compiled single-file binary.
const htmlDocPath = appPath("docs", "DOCUMENTATION.html");
const codingStandardsPath = appPath("docs", "CODING_STANDARDS.html");
const tablePermissionsDocPath = appPath("docs", "TABLE_PERMISSIONS.html");

app.get("/documentation", (req, res) => {
  return res.sendFile(htmlDocPath);
});

app.get("/standards", (req, res) => {
  return res.sendFile(codingStandardsPath);
});

app.get("/tab-permissions", (req, res) => {
  return res.sendFile(tablePermissionsDocPath);
});

// ======================================================
// TEST ERROR ROUTE
// ======================================================

app.get("/error", (req, res, next) => {
  const err = new Error("This is a test error");

  err.status = 500;

  next(err);
});

// ======================================================
// NOT FOUND
// ======================================================

app.use(notFound);

// ======================================================
// ERROR HANDLER
// ======================================================

app.use(errorHandler);

// ======================================================
// START SERVER
// ======================================================

let server;

async function startServer() {
  try {
    // Database Connection
    await Connection();

    // Ensure ALL tables exist before seeding.
    // Sync model definitions with the database without alter constraints
    await db.sync();
    logger.info("All database tables synced");

    // NOTE: Postgres ROW LEVEL SECURITY is no longer applied. It is
    // Postgres-only (incompatible with running on multiple database engines)
    // and its policy carried a fail-open branch. Tenant isolation is enforced
    // in the ORM layer by utils/tenantScope.util.js (deny-by-default) for every
    // dialect. Migration 0013 drops any policies left on existing databases.

    // Apply pending schema/data migrations (versioned, non-destructive) on top
    // of the model-driven sync — for column renames, custom indexes, backfills.
    const { migrator } = require("./src/config/migrator");
    const applied = await migrator.up();
    if (applied.length) {
      logger.info(
        `Applied ${applied.length} migration(s): ${applied
          .map((m) => m.name)
          .join(", ")}`,
      );
    }

    // Redis Connection
    await initRedis();

    // NOTE: Database seeding is NOT automatic on startup.
    // To seed the database, call GET /api/v1/migration/seeding manually.

    // Start Cron Jobs
    cronBackup();
    initSessionCleanup();
    initCalibrationScheduler();
    initRetentionScheduler();

    // Start the batch-job worker (RabbitMQ consumer). No-op in inline mode.
    require("./src/workers/batchJob.worker")
      .startBatchJobWorker()
      .catch((err) =>
        console.error("Failed to start batch job worker:", err.message),
      );

    // Start Tenant Lifecycle Processor (grace period expiry, offboarding)
    const tenantLifecycleService = require("./src/services/tenantLifecycle.service");
    setInterval(
      async () => {
        try {
          await tenantLifecycleService.processExpiredGracePeriods();
        } catch (err) {
          logger.error("Tenant lifecycle processor failed", {
            error: err.message,
          });
        }
      },
      24 * 60 * 60 * 1000,
    ); // Run daily

    // Start Email Queue Worker (background processing) - fire and forget
    // processEmailQueue() starts a persistent RabbitMQ consumer, so we must
    // not await it before starting the HTTP server.
    processEmailQueue().catch((err) => {
      logger.error("Email queue worker failed to start", {
        error: err.message,
      });
    });

    // Connect to external IoT MQTT Broker (only if configured)
    const iotService = require("./src/services/iot.service");
    if (process.env.MQTT_HOST && process.env.MQTT_PORT) {
      const mqttHost = process.env.MQTT_HOST;
      const mqttPort = parseInt(process.env.MQTT_PORT, 10);
      iotService.connect(mqttPort, mqttHost).catch((err) => {
        logger.warn("IoT MQTT Broker connection failed (non-fatal)", {
          error: err.message,
        });
      });
    } else {
      logger.info(
        "IoT MQTT Broker not configured (set MQTT_HOST and MQTT_PORT to enable)",
      );
    }

    const port = process.env.PORT || 3000;

    const http = require("http");
    server = http.createServer(app);
    initSocket(server);

    server.listen(port, () => {
      logger.info(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error("STARTUP ERROR:", error);
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

startServer();

// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

async function shutdown(signal) {
  try {
    logger.info(`${signal} received. Shutting down application...`);

    if (server) {
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) {
            return reject(err);
          }

          logger.info("HTTP server closed");

          resolve();
        });
      });
    }

    await db.close();

    logger.info("Database connection closed.");

    await closeRedis();

    logger.info("Redis connection closed.");

    await closeRabbitMQ();

    logger.info("RabbitMQ connection closed.");

    process.exit(0);
  } catch (error) {
    logger.error(`Shutdown error: ${error.message}`);

    process.exit(1);
  }
}

// ======================================================
// PROCESS HANDLERS
// ======================================================

process.on("SIGINT", () => shutdown("SIGINT"));

process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", async (err) => {
  logger.error(`uncaughtException: ${err.stack || err.message}`);

  await shutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", async (reason) => {
  logger.error(
    `unhandledRejection: ${reason?.stack || JSON.stringify(reason)}`,
  );

  await shutdown("UNHANDLED_REJECTION");
});
