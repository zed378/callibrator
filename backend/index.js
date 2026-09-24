require("./src/utils/env.util");
const express = require("express");

const compression = require("compression");
const crypto = require("crypto");
const timeout = require("connect-timeout");
const hpp = require("hpp");

const cors = require("cors");
const helmet = require("helmet");
const { API_CSP_DIRECTIVES } = require("./src/utils/csp.util");
const rateLimit = require("express-rate-limit");

const { swaggerDocs } = require("./src/docs/swagger");
const path = require("path");

const { Connection, db } = require("./src/config");
const { initSocket } = require("./src/config/socket");

const {
  globalSanitizer,
} = require("./src/middlewares/globalSanitizer.middleware");

const { bodyDefault } = require("./src/middlewares/bodyDefault.middleware");

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
const {
  initTenantLifecycleScheduler,
} = require("./src/middlewares/tenantLifecycleScheduler.middleware");
const {
  initWebhookDeliveryScheduler,
} = require("./src/middlewares/webhookDeliveryScheduler.middleware");
const {
  initQuarantineSweep,
} = require("./src/middlewares/quarantineSweepScheduler.middleware");
const { startWatchdog: initJobWatchdog } = require("./src/services/jobMonitor.service");

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
const { TRUST_PROXY_HOPS } = require("./src/constants/appConstants");

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

// Trust Proxy — ONE hop (A-16). req.ip is the rightmost X-Forwarded-For entry,
// the one the directly-connected proxy (nginx or the Next.js proxy) wrote; each
// of them sends exactly one entry, the client address. Read the note on
// TRUST_PROXY_HOPS (src/constants/appConstants.js) before changing this: a
// count above the real number of proxies lets a client choose req.ip.
app.set("trust proxy", TRUST_PROXY_HOPS);

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
// P7-08: the API default Content-Security-Policy no longer allows
// 'unsafe-inline' for SCRIPTS. The old comment said swagger-ui injects inline
// assets; its scripts are external files, and Swagger now gets its own policy
// under /docs (docs/swagger.js). Both policies live in utils/csp.util.js with
// the reasoning. crossOriginResourcePolicy is "cross-origin" so the
// separate-origin frontend can load /uploads/public images.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: { ...API_CSP_DIRECTIVES },
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

// A-09 — Express 5 leaves req.body undefined when no body was sent (Express 4
// gave {}). Every downstream `const { x } = req.body` then throws a TypeError
// that surfaces as a 500 instead of the 400 (or the 2xx, where the body is
// optional) the caller is owed. This runs after the parsers and before the
// sanitizer, the routers and every route validator, so no handler ever sees
// an absent body. It fills only an ABSENT body — a parsed object, array,
// string or Buffer is left untouched.
app.use(bodyDefault);

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

// ADR-042 step 3/4 (S-01): ONLY the public class is static — avatars, tenant
// logos and CMS images under `uploads/public/`, images only, served with a
// per-extension Content-Type allowlist and nosniff. Certificates, attachments
// and the upload quarantine live elsewhere in the uploads tree and are
// reachable only through gated routes (attachments/:id/download,
// certificates/:id/pdf, the signed certificate document, storage/object).
require("./src/utils/upload.util").mountPublicUploads(app);

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
const {
  publicHealthRoutes,
  internalHealthRoutes,
} = require("./src/routes/internal/health.route");
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
// Per-dependency readiness detail. Gated (auth + denyApiKey + superAdminOnly)
// because it names every dependency and why it is failing — A-06.
app.use("/api/v1/health", internalHealthRoutes);

// ======================================================
// HEALTHCHECK / LIVENESS / READINESS
// ======================================================
//
// A-06 + A-15. These three public paths (/health, /live, /ready) now live in
// routes/internal/health.route.js:
//
//   * /live   stays dependency-free.
//   * /health and /ready answer an AGGREGATE verdict over every required
//     dependency — PostgreSQL, Redis AND RabbitMQ, not the database alone —
//     with 503 when one is down, so the compose healthcheck and the Helm
//     readiness/startup probes that already point at /health keep working and
//     now mean something.
//   * neither discloses the Node version, pid, memory, hostname or the
//     per-dependency breakdown. That breakdown is at GET /api/v1/health,
//     behind auth + denyApiKey + superAdminOnly.
app.use(publicHealthRoutes);

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
// DOCUMENTATION (HTML)
// ======================================================

// A-253 — /documentation and /standards are registered by swaggerDocs() above
// (src/docs/swagger.js): developer documentation, published under the same
// switch as the API contract, so not in production unless SWAGGER_ENABLED=true.
// Removed outright: /tab-permissions (it sent docs/TABLE_PERMISSIONS.html,
// which does not exist — every request was an error) and /error (a test route
// that answered a 500 to anyone, production included).

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
    // ADR-043 step 5 — refuse to start on broken authorization wiring, naming
    // the offender, the way config/index.js and jwt.util.js refuse bad config.
    //
    // Phase 1 runs BEFORE the database is touched. It reads route source text
    // and constants only, so it cannot fail for a database reason: a
    // `dynamicAccess` name that matches no seeded menu slug (A-58) or a role
    // name with no ROLE_LEVELS entry refuses the boot on its own terms, DB up
    // or down. It throws into the catch below -> process.exit(1).
    const {
      assertStaticAuthorizationWiring,
      assertSeededRoles,
    } = require("./src/utils/authorizationWiring.util");
    assertStaticAuthorizationWiring();

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

    // ADR-043 step 5, phase 2 — the roles table against the role constants.
    // It needs the database, so it runs only here: after Connection() (a down
    // database has already refused the boot above, for that reason and with
    // its own message) and after migrator.up() (0020 backfills role_level;
    // checking earlier would flag every seeded role as level 1).
    //
    // What it does when it cannot run is deliberate: a query that throws, or a
    // roles table holding none of the seeded roles (a fresh install, seeded
    // later via GET /api/v1/migration/seeding), is a logged WARNING and boot
    // continues — refusing there would make the seeding endpoint unreachable
    // and deadlock the install. Only a check that RAN and found a disagreement
    // (a wrong role_level, a partially missing seed) refuses the boot.
    await assertSeededRoles({ sequelize: db });

    // P6-05 (PR-5) — the migration log is not evidence. Compare every model's
    // columns, and the control objects that live only in migrations (the
    // calibration_records append-only trigger, the per-tenant serial index),
    // with information_schema. A mismatch refuses the boot, naming each one
    // (SCHEMA_VERIFY=warn downgrades that to error logs, for a recovery).
    // Runs BEFORE the role switch: information_schema hides from a role the
    // columns it holds no privilege on.
    const { assertSchemaMatchesModels } = require("./src/utils/schemaVerify.util");
    await assertSchemaMatchesModels({ sequelize: db, logger });

    // P6-03 — from here on every query runs as DB_APP_ROLE, which has no
    // UPDATE/DELETE on calibration_records. db.sync() and the migrator above
    // needed the owner; nothing after this point does.
    const { enterApplicationRole } = require("./src/utils/dbRole.util");
    await enterApplicationRole({ sequelize: db, logger });

    // Redis Connection
    await initRedis();

    // NOTE: Database seeding is NOT automatic on startup.
    // To seed the database, call GET /api/v1/migration/seeding manually.

    // Start Cron Jobs
    cronBackup();
    initSessionCleanup();
    initCalibrationScheduler();
    initRetentionScheduler();
    // Tenant lifecycle (grace-period expiry -> offboarding). node-cron, not a
    // 24h setInterval: configurable, and it fires even if no process lives a
    // whole day (W-01).
    initTenantLifecycleScheduler();
    // Durable webhook delivery (A-10): resumes due retries at boot, then polls.
    initWebhookDeliveryScheduler();
    // S-33: remove uploads a crash left in uploads/.quarantine.
    initQuarantineSweep();
    // P7-02: every job above records its runs and alerts on failure; the
    // watchdog alerts on a run that did not happen and on stuck batch jobs.
    initJobWatchdog();

    // Start the batch-job worker (RabbitMQ consumer). No-op in inline mode.
    require("./src/workers/batchJob.worker")
      .startBatchJobWorker()
      .catch((err) =>
        console.error("Failed to start batch job worker:", err.message),
      );

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
