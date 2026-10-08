/**
 * The backend's entry point: the Express app, its middleware and routes, the
 * boot sequence (schema, checks, schedulers, workers) and graceful shutdown.
 *
 * P9-21 (ADR-087): converted from index.js with no behaviour change. Every
 * module still loads by a literal `require`, at the place and in the order
 * index.js loaded it: an `import` would be hoisted above the code between them
 * (the routes load after the middleware is wired; the boot-time modules inside
 * startServer), and the literal paths are what load-check and the binary
 * bundlers read. Each is typed with `typeof import(...)`; compression,
 * connect-timeout and hpp ship no types and are typed by what this file calls.
 * Proved by a boot-identity run of both against PostgreSQL 18 and Redis (the
 * src load order, every app/router call with its factory arguments, the log
 * sequence, the HTTP answers once ready, and the shutdown sequence).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- see above: index.js's load order, literal paths */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Server as HttpServer } from "http";
import type ExpressModule from "express";
import type * as CryptoModule from "crypto";
import type * as CorsPolicyMiddlewareModule from "./src/middlewares/corsPolicy.middleware";
import type HelmetModule from "helmet";
import type * as CspUtilModule from "./src/utils/csp.util";
import type ExpressRateLimitModule from "express-rate-limit";
import type * as GlobalRateLimitMiddlewareModule from "./src/middlewares/globalRateLimit.middleware";
import type * as ApiDocsModule from "./src/docs/apiDocs";
import type * as ConfigModule from "./src/config";
import type SocketModule from "./src/config/socket";
import type * as GlobalSanitizerMiddlewareModule from "./src/middlewares/globalSanitizer.middleware";
import type * as BodyDefaultMiddlewareModule from "./src/middlewares/bodyDefault.middleware";
import type * as CreateFolderMiddlewareModule from "./src/middlewares/createFolder.middleware";
import type * as NotFoundMiddlewareModule from "./src/middlewares/notFound.middleware";
import type * as ErrorHandlersMiddlewareModule from "./src/middlewares/errorHandlers.middleware";
import type * as RequestTimeoutMiddlewareModule from "./src/middlewares/requestTimeout.middleware";
import type BackupMiddlewareModule from "./src/middlewares/backup.middleware";
import type SessionCleanupMiddlewareModule from "./src/middlewares/sessionCleanup.middleware";
import type CalibrationSchedulerMiddlewareModule from "./src/middlewares/calibrationScheduler.middleware";
import type RetentionSchedulerMiddlewareModule from "./src/middlewares/retentionScheduler.middleware";
import type TenantLifecycleSchedulerMiddlewareModule from "./src/middlewares/tenantLifecycleScheduler.middleware";
import type WebhookDeliverySchedulerMiddlewareModule from "./src/middlewares/webhookDeliveryScheduler.middleware";
import type QuarantineSweepSchedulerMiddlewareModule from "./src/middlewares/quarantineSweepScheduler.middleware";
import type * as UpstreamSqlImportSweepSchedulerModule from "./src/middlewares/upstreamSqlImportSweepScheduler.middleware";
import type * as BoundAccountDeactivationSchedulerModule from "./src/middlewares/boundAccountDeactivationScheduler.middleware";
import type WebhookDeliveryPurgeSchedulerMiddlewareModule from "./src/middlewares/webhookDeliveryPurgeScheduler.middleware";
import type AttachmentFileSweepSchedulerMiddlewareModule from "./src/middlewares/attachmentFileSweepScheduler.middleware";
import type JobMonitorServiceModule from "./src/services/jobMonitor.service";
import type RedisServiceModule from "./src/services/redis.service";
import type EmailQueueServiceModule from "./src/services/emailQueue.service";
import type RabbitmqServiceModule from "./src/services/rabbitmq.service";
import type BatchJobWorkerModule from "./src/workers/batchJob.worker";
import type * as AccessLogMiddlewareModule from "./src/middlewares/accessLog.middleware";
import type * as ActivityLogMiddlewareModule from "./src/middlewares/activityLog.middleware";
import type * as EnvModule from "./src/config/env";
import type * as RateLimitConstantsModule from "./src/constants/rateLimitConstants";
import type * as AppConstantsModule from "./src/constants/appConstants";
import type StoragePathUtilModule from "./src/utils/storagePath.util";
import type AppPathUtilModule from "./src/utils/appPath.util";
import type HealthRouteModule from "./src/routes/internal/health.route";
import type * as UploadUtilModule from "./src/utils/upload.util";
import type MigrationRouteModule from "./src/routes/internal/migration.route";
import type AuthRouteModule from "./src/routes/api/auth.route";
import type AuthPublicRouteModule from "./src/routes/api/authPublic.route";
import type AccessRequestsRouteModule from "./src/routes/api/accessRequests.route";
import type UserRouteModule from "./src/routes/api/user.route";
import type TenantRouteModule from "./src/routes/api/tenant.route";
import type TenantBackupRouteModule from "./src/routes/api/tenantBackup.route";
import type RolesRouteModule from "./src/routes/api/roles.route";
import type SessionRouteModule from "./src/routes/api/session.route";
import type WarehouseRouteModule from "./src/routes/api/warehouse.route";
import type StockRouteModule from "./src/routes/api/stock.route";
import type CalibrationDevicesRouteModule from "./src/routes/api/calibrationDevices.route";
import type CalibrationRecordsRouteModule from "./src/routes/api/calibrationRecords.route";
import type CertificatesRouteModule from "./src/routes/api/certificates.route";
import type MenuGroupsRouteModule from "./src/routes/api/menuGroups.route";
import type VendorRouteModule from "./src/routes/api/vendor.route";
import type MaintenanceRouteModule from "./src/routes/api/maintenance.route";
import type NotificationsRouteModule from "./src/routes/api/notifications.route";
import type BillingRouteModule from "./src/routes/api/billing.route";
import type AuditRouteModule from "./src/routes/api/audit.route";
import type CalibrationSchedulerRouteModule from "./src/routes/api/calibrationScheduler.route";
import type DashboardRouteModule from "./src/routes/api/dashboard.route";
import type UserPermissionsRouteModule from "./src/routes/api/userPermissions.route";
import type QuotaRouteModule from "./src/routes/api/quota.route";
import type AttachmentsRouteModule from "./src/routes/api/attachments.route";
import type StorageRouteModule from "./src/routes/api/storage.route";
import type ReportsRouteModule from "./src/routes/api/reports.route";
import type WebhooksRouteModule from "./src/routes/api/webhooks.route";
import type ApiKeysRouteModule from "./src/routes/api/apiKeys.route";
import type SearchRouteModule from "./src/routes/api/search.route";
import type WorkflowsRouteModule from "./src/routes/api/workflows.route";
import type FinanceRouteModule from "./src/routes/api/finance.route";
import type ContentRouteModule from "./src/routes/api/content.route";
import type ScimRouteModule from "./src/routes/api/scim.route";
import type AdminRouteModule from "./src/routes/api/admin.route";
import type UpstreamFileImportsRouteModule from "./src/routes/api/upstreamFileImports.route";
import type BatchJobsRouteModule from "./src/routes/api/batchJobs.route";
import type QmsRouteModule from "./src/routes/api/qms.route";
import type SopRouteModule from "./src/routes/api/sop.route";
import type IotRouteModule from "./src/routes/api/iot.route";
import type PredictiveMaintenanceRouteModule from "./src/routes/api/predictiveMaintenance.route";
import type RiskRouteModule from "./src/routes/api/risk.route";
import type SupplierScorecardRouteModule from "./src/routes/api/supplierScorecard.route";
import type AiRouteModule from "./src/routes/api/ai.route";
import type FeatureFlagsRouteModule from "./src/routes/api/featureFlags.route";
import type TenantLifecycleRouteModule from "./src/routes/api/tenantLifecycle.route";
import type DataRetentionRouteModule from "./src/routes/api/dataRetention.route";
import type OidcRouteModule from "./src/routes/api/oidc.route";
import type WebauthnRouteModule from "./src/routes/api/webauthn.route";
import type NetworkSecurityRouteModule from "./src/routes/api/networkSecurity.route";
import type MeteredBillingRouteModule from "./src/routes/api/meteredBilling.route";
import type CustomDomainsRouteModule from "./src/routes/api/customDomains.route";
import type GdprRouteModule from "./src/routes/api/gdpr.route";
import type TenantHierarchyRouteModule from "./src/routes/api/tenantHierarchy.route";
import type ESignatureRouteModule from "./src/routes/api/eSignature.route";
import type KanbanRouteModule from "./src/routes/api/kanban.route";
import type TicketsRouteModule from "./src/routes/api/tickets.route";
import type * as AuthorizationWiringUtilModule from "./src/utils/authorizationWiring.util";
import type * as RouteTableModule from "./src/utils/routeTable";
import type ClientFacilitiesRouteModule from "./src/routes/api/clientFacilities.route";
import type DeviceTypesRouteModule from "./src/routes/api/deviceTypes.route";
import type IpmRouteModule from "./src/routes/api/ipm.route";
import type MigratorModule from "./src/config/migrator";
import type * as MigrationLockUtilModule from "./src/utils/migrationLock.util";
import type * as SchemaVerifyUtilModule from "./src/utils/schemaVerify.util";
import type KmsVerifyUtilModule from "./src/utils/kmsVerify.util";
import type * as DbRoleUtilModule from "./src/utils/dbRole.util";
import type * as BootstrapCredentialServiceModule from "./src/services/bootstrapCredential.service";
import type IotServiceModule from "./src/services/iot.service";
import type * as HttpModule from "http";
import type * as CliDispatchModule from "./src/scripts/cliDispatch";

/** Request fields only this file's middleware sets or reads. */
type EntryRequest = Request & { rawBody?: Buffer; timedout?: boolean };

require("./src/utils/env.util");
// P9-06 part 2 (ADR-087 Am. 30): every rule the modules below enforce at load, checked at once —
// a broken configuration fails here naming EVERY failing variable (on stderr: winston is not
// loaded yet), instead of one variable per restart.
(require("./src/config/env") as typeof EnvModule).validateEnvironment();
const express = require("express") as typeof ExpressModule;

const compression = require("compression") as () => RequestHandler;
const crypto = require("crypto") as typeof CryptoModule;
const timeout = require("connect-timeout") as (time: string) => RequestHandler;
const hpp = require("hpp") as () => RequestHandler;

const { corsPolicy } = require("./src/middlewares/corsPolicy.middleware") as typeof CorsPolicyMiddlewareModule;
const helmet = require("helmet") as typeof HelmetModule;
const { API_CSP_DIRECTIVES } = require("./src/utils/csp.util") as typeof CspUtilModule;
const rateLimit = require("express-rate-limit") as typeof ExpressRateLimitModule;
const { globalLimitBody } = require("./src/middlewares/globalRateLimit.middleware") as typeof GlobalRateLimitMiddlewareModule;

const { apiDocs } = require("./src/docs/apiDocs") as typeof ApiDocsModule;
// As built: loaded here, and not read.
require("path");

const { Connection, db } = require("./src/config") as typeof ConfigModule;
const { initSocket } = require("./src/config/socket") as typeof SocketModule;

const {
  globalSanitizer,
} = require("./src/middlewares/globalSanitizer.middleware") as typeof GlobalSanitizerMiddlewareModule;

const { bodyDefault } = require("./src/middlewares/bodyDefault.middleware") as typeof BodyDefaultMiddlewareModule;

const {
  ensureFolderExisted,
} = require("./src/middlewares/createFolder.middleware") as typeof CreateFolderMiddlewareModule;

const { notFound } = require("./src/middlewares/notFound.middleware") as typeof NotFoundMiddlewareModule;

const { errorHandler } = require("./src/middlewares/errorHandlers.middleware") as typeof ErrorHandlersMiddlewareModule;
const { requestTimeoutHandler } = require("./src/middlewares/requestTimeout.middleware") as typeof RequestTimeoutMiddlewareModule;

const { cronBackup } = require("./src/middlewares/backup.middleware") as typeof BackupMiddlewareModule;

const {
  initSessionCleanup,
} = require("./src/middlewares/sessionCleanup.middleware") as typeof SessionCleanupMiddlewareModule;

const {
  initCalibrationScheduler,
} = require("./src/middlewares/calibrationScheduler.middleware") as typeof CalibrationSchedulerMiddlewareModule;

const {
  initRetentionScheduler,
} = require("./src/middlewares/retentionScheduler.middleware") as typeof RetentionSchedulerMiddlewareModule;
const {
  initTenantLifecycleScheduler,
} = require("./src/middlewares/tenantLifecycleScheduler.middleware") as typeof TenantLifecycleSchedulerMiddlewareModule;
const {
  initWebhookDeliveryScheduler,
} = require("./src/middlewares/webhookDeliveryScheduler.middleware") as typeof WebhookDeliverySchedulerMiddlewareModule;
const {
  initQuarantineSweep,
} = require("./src/middlewares/quarantineSweepScheduler.middleware") as typeof QuarantineSweepSchedulerMiddlewareModule;
const { initWebhookDeliveryPurge } = require("./src/middlewares/webhookDeliveryPurgeScheduler.middleware") as typeof WebhookDeliveryPurgeSchedulerMiddlewareModule;
const { initAttachmentFileSweep } = require("./src/middlewares/attachmentFileSweepScheduler.middleware") as typeof AttachmentFileSweepSchedulerMiddlewareModule;
const { startWatchdog: initJobWatchdog } = require("./src/services/jobMonitor.service") as typeof JobMonitorServiceModule;

const { initRedis, closeRedis } = require("./src/services/redis.service") as typeof RedisServiceModule;

const { processEmailQueue } = require("./src/services/emailQueue.service") as typeof EmailQueueServiceModule;
// W-18: the process's ONE AMQP connection, and its one close.
const { closeRabbitMQ } = require("./src/services/rabbitmq.service") as typeof RabbitmqServiceModule;
const { stopBatchJobWorker } = require("./src/workers/batchJob.worker") as typeof BatchJobWorkerModule;

const { accessLog } = require("./src/middlewares/accessLog.middleware") as typeof AccessLogMiddlewareModule;

const {
  activityLogger,
  logger,
} = require("./src/middlewares/activityLog.middleware") as typeof ActivityLogMiddlewareModule;
// The environment, read at call time as index.js read process.env (a .ts outside src/config/
// reads it through config/env). activityLog has loaded it already, so the load order is unchanged.
const { env } = require("./src/config/env") as typeof EnvModule;

const { WINDOW } = require("./src/constants/rateLimitConstants") as typeof RateLimitConstantsModule;
const { TRUST_PROXY_HOPS } = require("./src/constants/appConstants") as typeof AppConstantsModule;

const storagePath = require("./src/utils/storagePath.util") as typeof StoragePathUtilModule;
const appPath = require("./src/utils/appPath.util") as typeof AppPathUtilModule;

// As built: loaded here, and not read.
require("./src/services/migration.service");

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
if (env("NODE_ENV") !== "production") {
  app.set("json spaces", 2);
}

// ======================================================
// MIDDLEWARES
// ======================================================

// Compression
app.use(compression());

// HTTPS Redirect (production only — behind reverse proxy)
if (
  env("NODE_ENV") === "production" &&
  env("FORCE_HTTPS") === "true"
) {
  // S-09 / ADR-081: /health, /live and /ready are exempt, or the compose
  // healthcheck follows the 301 to an https port nothing serves.
  app.use((require("./src/routes/internal/health.route") as typeof HealthRouteModule).forceHttps);
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

// The policy lives in src/middlewares/corsPolicy.middleware.ts (explicit
// CORS_ORIGIN allow-list, credentials, no wildcard; a rejected origin in
// production is a 403 — it was a 500 until the 2026-09-29 DAST, A-176 batch).
app.use(corsPolicy());

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
    // As built: an unset, empty, 0 or non-numeric RATE_LIMIT_MAX takes the default (`||`).
    Number(env("RATE_LIMIT_MAX")) ||
    (env("NODE_ENV") === "production" ? 5000 : 100000),
  standardHeaders: true,
  legacyHeaders: false,
  // Q-53 (ADR-109 §6): the 429 is the house envelope, with Retry-After
  // (set by express-rate-limit) repeated as `retryAfter`.
  message: globalLimitBody,
});

// The auth endpoints' own budgets are NOT here. `authLimiter` and
// `otpLimiter` were declared in this file and never mounted (ADR-088), and as
// per-process express-rate-limit stores they would have ignored the shared
// Redis counters. ADR-100 replaced them with request budgets on the routes
// themselves (middlewares/requestBudget.middleware.ts, mounted in
// routes/api/auth.route.js and certificates.route.js).

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
    verify: (incoming, _res, buf) => {
      const req = incoming as EntryRequest;
      if (
        // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `originalUrl && originalUrl.startsWith(...)`
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

app.use((req: Request, _res: Response, next: NextFunction) => {
  if (!(req as EntryRequest).timedout) {
    next();
  }
});

// ======================================================
// REQUEST ID
// ======================================================

app.use((req: Request, res: Response, next: NextFunction) => {
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
(require("./src/utils/upload.util") as typeof UploadUtilModule).mountPublicUploads(app);

app.use("/public", express.static(appPath("public")));

// ======================================================
// SANITIZER
// ======================================================

app.use(globalSanitizer);

// ======================================================
// SWAGGER
// ======================================================

apiDocs(app); // P9-25 (ADR-103): the signed-in API reference (Scalar), was swaggerDocs

// ======================================================
// ROUTES
// ======================================================
const migrationRoutes = require("./src/routes/internal/migration.route") as typeof MigrationRouteModule;
const {
  publicHealthRoutes,
  internalHealthRoutes,
} = require("./src/routes/internal/health.route") as typeof HealthRouteModule;
const authRoutes = require("./src/routes/api/auth.route") as typeof AuthRouteModule;
// Phase 10 (ADR-098): public sign-in additions and the access-request intake (TypeScript).
const authPublicRoutes = require("./src/routes/api/authPublic.route") as typeof AuthPublicRouteModule;
const accessRequestRoutes = require("./src/routes/api/accessRequests.route") as typeof AccessRequestsRouteModule;
const userRoutes = require("./src/routes/api/user.route") as typeof UserRouteModule;
const tenantRoutes = require("./src/routes/api/tenant.route") as typeof TenantRouteModule;
const tenantBackupRoutes = require("./src/routes/api/tenantBackup.route") as typeof TenantBackupRouteModule;
const rolesRoutes = require("./src/routes/api/roles.route") as typeof RolesRouteModule;
const sessionRoutes = require("./src/routes/api/session.route") as typeof SessionRouteModule;
const warehouseRoutes = require("./src/routes/api/warehouse.route") as typeof WarehouseRouteModule;
const stockRoutes = require("./src/routes/api/stock.route") as typeof StockRouteModule;
const calibrationDevicesRoutes = require("./src/routes/api/calibrationDevices.route") as typeof CalibrationDevicesRouteModule;
const calibrationRecordsRoutes = require("./src/routes/api/calibrationRecords.route") as typeof CalibrationRecordsRouteModule;
const certificateRoutes = require("./src/routes/api/certificates.route") as typeof CertificatesRouteModule;
const menuGroupsRoutes = require("./src/routes/api/menuGroups.route") as typeof MenuGroupsRouteModule;
const vendorRoutes = require("./src/routes/api/vendor.route") as typeof VendorRouteModule;
const maintenanceRoutes = require("./src/routes/api/maintenance.route") as typeof MaintenanceRouteModule;
const notificationRoutes = require("./src/routes/api/notifications.route") as typeof NotificationsRouteModule;
const billingRoutes = require("./src/routes/api/billing.route") as typeof BillingRouteModule;
const auditRoutes = require("./src/routes/api/audit.route") as typeof AuditRouteModule;
const calibrationSchedulerRoutes = require("./src/routes/api/calibrationScheduler.route") as typeof CalibrationSchedulerRouteModule;
const dashboardRoutes = require("./src/routes/api/dashboard.route") as typeof DashboardRouteModule;
const userPermissionsRoutes = require("./src/routes/api/userPermissions.route") as typeof UserPermissionsRouteModule;
const quotaRoutes = require("./src/routes/api/quota.route") as typeof QuotaRouteModule;
const attachmentRoutes = require("./src/routes/api/attachments.route") as typeof AttachmentsRouteModule;
const storageRoutes = require("./src/routes/api/storage.route") as typeof StorageRouteModule;
const reportRoutes = require("./src/routes/api/reports.route") as typeof ReportsRouteModule;
const webhookRoutes = require("./src/routes/api/webhooks.route") as typeof WebhooksRouteModule;
const apiKeyRoutes = require("./src/routes/api/apiKeys.route") as typeof ApiKeysRouteModule;
const searchRoutes = require("./src/routes/api/search.route") as typeof SearchRouteModule;
const workflowRoutes = require("./src/routes/api/workflows.route") as typeof WorkflowsRouteModule;
const financeRoutes = require("./src/routes/api/finance.route") as typeof FinanceRouteModule;
const contentRoutes = require("./src/routes/api/content.route") as typeof ContentRouteModule;
const scimRoutes = require("./src/routes/api/scim.route") as typeof ScimRouteModule;
const adminRoutes = require("./src/routes/api/admin.route") as typeof AdminRouteModule;
// The rsync image import (upstream adoption): super admin only, under /api/v1/admin.
const upstreamFileImportRoutes = require("./src/routes/api/upstreamFileImports.route") as typeof UpstreamFileImportsRouteModule;
const batchJobsRoutes = require("./src/routes/api/batchJobs.route") as typeof BatchJobsRouteModule;
const qmsRoutes = require("./src/routes/api/qms.route") as typeof QmsRouteModule;
const sopRoutes = require("./src/routes/api/sop.route") as typeof SopRouteModule;
const iotRoutes = require("./src/routes/api/iot.route") as typeof IotRouteModule;
const predictiveMaintenanceRoutes = require("./src/routes/api/predictiveMaintenance.route") as typeof PredictiveMaintenanceRouteModule;
const riskRoutes = require("./src/routes/api/risk.route") as typeof RiskRouteModule;
const supplierScorecardRoutes = require("./src/routes/api/supplierScorecard.route") as typeof SupplierScorecardRouteModule;
const aiRoutes = require("./src/routes/api/ai.route") as typeof AiRouteModule;
const featureFlagRoutes = require("./src/routes/api/featureFlags.route") as typeof FeatureFlagsRouteModule;
const tenantLifecycleRoutes = require("./src/routes/api/tenantLifecycle.route") as typeof TenantLifecycleRouteModule;
const dataRetentionRoutes = require("./src/routes/api/dataRetention.route") as typeof DataRetentionRouteModule;
const oidcRoutes = require("./src/routes/api/oidc.route") as typeof OidcRouteModule;
const webauthnRoutes = require("./src/routes/api/webauthn.route") as typeof WebauthnRouteModule;
const networkSecurityRoutes = require("./src/routes/api/networkSecurity.route") as typeof NetworkSecurityRouteModule;
const meteredBillingRoutes = require("./src/routes/api/meteredBilling.route") as typeof MeteredBillingRouteModule;
const customDomainsRoutes = require("./src/routes/api/customDomains.route") as typeof CustomDomainsRouteModule;
const gdprRoutes = require("./src/routes/api/gdpr.route") as typeof GdprRouteModule;
const tenantHierarchyRoutes = require("./src/routes/api/tenantHierarchy.route") as typeof TenantHierarchyRouteModule;
const eSignatureRoutes = require("./src/routes/api/eSignature.route") as typeof ESignatureRouteModule;
const kanbanRoutes = require("./src/routes/api/kanban.route") as typeof KanbanRouteModule;
const ticketRoutes = require("./src/routes/api/tickets.route") as typeof TicketsRouteModule;
const clientFacilityRoutes = require("./src/routes/api/clientFacilities.route") as typeof ClientFacilitiesRouteModule;
const deviceTypeRoutes = require("./src/routes/api/deviceTypes.route") as typeof DeviceTypesRouteModule;
const ipmRoutes = require("./src/routes/api/ipm.route") as typeof IpmRouteModule;

// ======================================================
// ROUTES ENDPOINT
// ======================================================

// Migration routes are available for manual triggering
// Use GET /api/v1/migration/seeding to seed database with initial data
// Use GET /api/v1/migration/up to run database migration
// Use GET /api/v1/migration/down to drop database tables
// Use GET /api/v1/migration/unseeding to remove seeded data
app.use("/api/v1/migration", migrationRoutes);
app.use("/api/v1/admin/upstream-file-imports", upstreamFileImportRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/jobs", batchJobsRoutes);
app.use("/api/v1/qms", qmsRoutes);
app.use("/api/v1/sop", sopRoutes);
app.use("/api/v1/auth", authRoutes);
// P10-04 / P10-10 / P10-15: /login/discover, /sso/start, /passkey/*, /invitation/accept.
app.use("/api/v1/auth", authPublicRoutes);
// P10-05: the public access-request intake (replaces self-registration).
app.use("/api/v1/access-requests", accessRequestRoutes);
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
// P21-09 (ADR-124): client facilities — the bound user's own facility (S-8).
app.use("/api/v1/client-facilities", clientFacilityRoutes);
// P21-01 (ADR-125): the global inspection catalogue — device types, checklists, proposals.
app.use("/api/v1/device-types", deviceTypeRoutes);
app.use("/api/v1/ipm", ipmRoutes);
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

app.get("/", (_req: Request, res: Response) => {
  return res.status(200).json({
    status: "Success",
    message: "Your API is running",
  });
});

// ======================================================
// DOCUMENTATION (HTML)
// ======================================================

// A-253 — /documentation and /standards are registered by apiDocs() above
// (src/docs/apiDocs.ts): developer documentation, published under the same
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

// F-14: a request that outran timeout("30s") answers 408 in the envelope.
// connect-timeout raises its error from wherever the request has got to —
// past every route — so the handler that catches it must sit HERE, at the
// end. The inline 408 handler that sat right after timeout() was never
// reached: a timed-out request answered 503 "Response timeout" from
// errorHandler (src/tests/middlewares/requestTimeout.f14.test.js).
app.use(requestTimeoutHandler);
app.use(errorHandler);

// P21-09 (spec § 7.7, AM-12): the route table the facility route gate resolves
// a bound principal's request against — registered now that every router is
// mounted, so it holds the order Express dispatches in (shadowing included).
(require("./src/utils/routeTable") as typeof RouteTableModule).registerAppRouteIndex(app);

// ======================================================
// START SERVER
// ======================================================

let server: HttpServer | undefined;

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
    } = require("./src/utils/authorizationWiring.util") as typeof AuthorizationWiringUtilModule;
    assertStaticAuthorizationWiring();

    // Database Connection
    await Connection();

    // Ensure ALL tables exist before seeding.
    // Sync model definitions with the database without alter constraints
    // NOTE: Postgres ROW LEVEL SECURITY is no longer applied. It is
    // Postgres-only (incompatible with running on multiple database engines)
    // and its policy carried a fail-open branch. Tenant isolation is enforced
    // in the ORM layer by utils/tenantScope.util.js (deny-by-default) for every
    // dialect. Migration 0013 drops any policies left on existing databases.

    // db.sync(), then pending schema/data migrations (versioned,
    // non-destructive) on top of it — for column renames, custom indexes,
    // backfills. P8-03 (ADR-086): both run under a PostgreSQL advisory lock,
    // so of two replicas starting together one migrates and the other WAITS,
    // then finds nothing pending.
    const { migrator } = require("./src/config/migrator") as typeof MigratorModule;
    const { runSchemaSetup } = require("./src/utils/migrationLock.util") as typeof MigrationLockUtilModule;
    await runSchemaSetup({ sequelize: db as unknown as Parameters<typeof runSchemaSetup>[0]["sequelize"], migrator, logger });

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
    const { assertSchemaMatchesModels } = require("./src/utils/schemaVerify.util") as typeof SchemaVerifyUtilModule;
    await assertSchemaMatchesModels({ sequelize: db as unknown as Parameters<typeof assertSchemaMatchesModels>[0]["sequelize"], logger });

    // P7-05 (ADR-078) — a database restored without the KMS_MASTER_KEY it was
    // written under used to boot cleanly and fail per request. Every envelope's
    // key id must be in the configured ring (KMS_VERIFY=warn to continue).
    const { assertKmsKeysConfigured } = require("./src/utils/kmsVerify.util") as typeof KmsVerifyUtilModule;
    await assertKmsKeysConfigured({ sequelize: db as unknown as Parameters<typeof assertKmsKeysConfigured>[0]["sequelize"], logger });

    // P6-03 — from here on every query runs as DB_APP_ROLE, which has no
    // UPDATE/DELETE on calibration_records. db.sync() and the migrator above
    // needed the owner; nothing after this point does.
    const { enterApplicationRole } = require("./src/utils/dbRole.util") as typeof DbRoleUtilModule;
    await enterApplicationRole({ sequelize: db, logger });

    // P10-16 (ADR-099): a super admin still holding the retired public default
    // password is moved to a one-time password (written to a file inside the
    // container, pointer logged, never the value); a one-time password file no
    // account can use any more is deleted. Never refuses the boot.
    await (require("./src/services/bootstrapCredential.service") as typeof BootstrapCredentialServiceModule).runBootChecks();

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
    // P24-06: interrupted SQL-dump imports failed, expired and orphaned dump files deleted.
    (require("./src/middlewares/upstreamSqlImportSweepScheduler.middleware") as typeof UpstreamSqlImportSweepSchedulerModule).initUpstreamSqlImportSweep();
    // ADR-070: finished webhook deliveries past retention, daily, bounded, audited.
    initWebhookDeliveryPurge();
    // D-22 (ADR-083): files of attachments deleted past retention, daily, bounded, audited.
    initAttachmentFileSweep();
    // P21-09e (UD-18 (b)): bound accounts of client facilities ended past their period, nightly, audited.
    (require("./src/middlewares/boundAccountDeactivationScheduler.middleware") as typeof BoundAccountDeactivationSchedulerModule).initBoundAccountDeactivation();
    // P7-02: every job above records its runs and alerts on failure; the
    // watchdog alerts on a run that did not happen and on stuck batch jobs.
    initJobWatchdog();

    // Start the batch-job worker (RabbitMQ consumer). No-op in inline mode.
    (require("./src/workers/batchJob.worker") as typeof BatchJobWorkerModule)
      .startBatchJobWorker()
      .catch((err: unknown) =>
        logger.error("Failed to start batch job worker", { error: (err as { message?: unknown }).message }),
      );

    // Start Email Queue Worker (background processing) - fire and forget
    // processEmailQueue() starts a persistent RabbitMQ consumer, so we must
    // not await it before starting the HTTP server.
    processEmailQueue().catch((err: unknown) => {
      logger.error("Email queue worker failed to start", {
        error: (err as { message?: unknown }).message,
      });
    });

    // Connect to external IoT MQTT Broker (only if configured)
    const iotService = require("./src/services/iot.service") as typeof IotServiceModule;
    if (env("MQTT_HOST") && env("MQTT_PORT")) {
      const mqttHost = env("MQTT_HOST") as string;
      const mqttPort = parseInt(env("MQTT_PORT") as string, 10);
      iotService.connect(mqttPort, mqttHost).catch((err: unknown) => {
        logger.warn("IoT MQTT Broker connection failed (non-fatal)", {
          error: (err as { message?: unknown }).message,
        });
      });
    } else {
      logger.info(
        "IoT MQTT Broker not configured (set MQTT_HOST and MQTT_PORT to enable)",
      );
    }

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty PORT means 3000
    const port = env("PORT") || 3000;

    const http = require("http") as typeof HttpModule;
    server = http.createServer(app);
    initSocket(server);

    server.listen(port, () => {
      logger.info(`Server running on port ${String(port)}`);
    });
  } catch (error) {
    // A-42: one redacted JSON line with the stack, not an unredacted console dump.
    logger.error("Failed to start server", { error: (error as { message?: unknown }).message, stack: (error as { stack?: unknown }).stack });
    process.exit(1);
  }
}

// P10-16 (ADR-099): `./backend rotate-bootstrap-password …` (docker exec) runs
// the recovery CLI instead of the server — the image has no Node, so the
// compiled binary is the only thing that can run it inside the container.
const { cliCommandFrom, runCliCommand } = require("./src/scripts/cliDispatch") as typeof CliDispatchModule;
if (cliCommandFrom(process.argv)) {
  void runCliCommand(process.argv).then((code) => process.exit(code));
} else {
  void startServer();
}

// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

async function shutdown(signal: string): Promise<void> {
  try {
    logger.info(`${signal} received. Shutting down application...`);

    if (server) {
      const listening = server;
      await new Promise<void>((resolve, reject) => {
        listening.close((err) => {
          if (err) {
            reject(err);
            return;
          }

          logger.info("HTTP server closed");

          resolve();
        });
      });
    }

    // W-07: stop consuming and let in-flight queue work finish BEFORE the
    // database closes under it; batch jobs still running at the deadline are
    // marked FAILED ("interrupted"), not left PROCESSING forever.
    const drain = await stopBatchJobWorker();
    logger.info("Queue consumers stopped", drain);

    await db.close();

    logger.info("Database connection closed.");

    await closeRedis();

    logger.info("Redis connection closed.");

    await closeRabbitMQ();

    logger.info("RabbitMQ connection closed.");

    process.exit(0);
  } catch (error) {
    logger.error(`Shutdown error: ${String((error as { message?: unknown }).message)}`);

    process.exit(1);
  }
}

// ======================================================
// PROCESS HANDLERS
// ======================================================

// The handlers return shutdown()'s promise, as index.js's did; Node ignores it (shutdown catches its own errors).
/* eslint-disable @typescript-eslint/no-misused-promises -- see above */
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", async (err) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty stack falls back to the message
  logger.error(`uncaughtException: ${err.stack || err.message}`);

  await shutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", async (reason) => {
  logger.error(
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-base-to-string, @typescript-eslint/restrict-template-expressions -- as built: a falsy stack falls back to the JSON of the reason
    `unhandledRejection: ${(reason as { stack?: unknown } | null | undefined)?.stack || JSON.stringify(reason)}`,
  );

  await shutdown("UNHANDLED_REJECTION");
});
/* eslint-enable @typescript-eslint/no-misused-promises */
