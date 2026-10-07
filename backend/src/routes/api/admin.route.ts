/**
 * The platform operator's console: `/api/v1/admin` (index.js mounts it).
 * Super admin only (this router's rbac).
 *
 * P9-21 (ADR-087): converted from admin.route.js. Every route, gate and
 * middleware is in the same order as before, `router.use(auth)` and the rbac
 * first (checked against the mounted route table). The contract is
 * code-first: admin.openapi.ts (P9-25, ADR-103); the `@swagger` JSDoc this
 * file carried is gone.
 */
import { Router, type RequestHandler } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { getAllTenants, updateTenantStatus, updateTenantFlags } from "../../controllers/admin.controller";
import { validate } from "../../middlewares/validation.middleware";
import { updateTenantFlagsSchema } from "../../validators/admin.validator";
// P10-04 / P10-05 / P10-07 (ADR-098): TypeScript controllers and validators.
import { list as listAccessRequests, erase as eraseAccessRequests, detail as getAccessRequest, approve as approveAccessRequest, reject as rejectAccessRequest, resendInvitation as resendAccessRequestInvitation } from "../../controllers/accessRequest.controller";
import { tenantIdParamsSchema, getDomains as getSsoDomains, putDomains as putSsoDomains } from "../../controllers/ssoDomains.controller";
import { listAccessRequestsSchema, accessRequestIdSchema, approveAccessRequestSchema, rejectAccessRequestSchema, eraseAccessRequestsSchema } from "../../validators/accessRequest.validator";
import { ssoEmailDomainsSchema } from "../../validators/publicAuth.validator";
import { superAdminOnly } from "../../middlewares/auth.middleware";
import { upload } from "../../utils/upload.util";
import { upstreamImportSettings } from "../../config/upstreamImport";
import {
  cancel as cancelSqlImport,
  detail as getSqlImport,
  list as listSqlImports,
  retry as retrySqlImport,
  settings as sqlImportSettings,
  upload as uploadSqlImport,
  uploadTimeBudget,
} from "../../controllers/upstreamSqlImport.controller";
import { listUpstreamSqlImportsSchema, upstreamSqlImportIdSchema } from "../../validators/upstreamSqlImport.validator";

// `Router` is `express.Router` (the same function).
const router = Router();

// All admin routes require SUPER_ADMIN role
router.use(auth);
router.use(rbac(["SUPER_ADMIN", "SUPERADMIN"]));

router.get("/tenants", getAllTenants);

router.patch("/tenants/:id/status", updateTenantStatus);

// A-174: `flags` is a plain object of flag keys to scalar values, and never a
// secret-named key (validators/admin.validator.js).
router.patch("/tenants/:id/flags", validate(updateTenantFlagsSchema), updateTenantFlags);

// ---------------------------------------------------------------------------
// P10-04 (ADR-098 §7.2) — a tenant's SSO email-domain claim, read by the
// public identifier-first discovery. Platform-controlled: super admin only
// (this router's rbac), never a tenant setting a tenant can write.
// Contract: accessRequestAdmin.openapi.ts.
// ---------------------------------------------------------------------------
router.get("/tenants/:id/sso-domains", validate(tenantIdParamsSchema, { from: "params" }), getSsoDomains);
router.put(
  "/tenants/:id/sso-domains",
  validate(ssoEmailDomainsSchema, { from: ["params", "body"] }),
  putSsoDomains,
);

// ---------------------------------------------------------------------------
// P10-05 / P10-07 (ADR-098 §6) — the access-request queue. Super admin only
// (this router's rbac): approving creates a tenant, a platform operation
// (A-76). The table has no tenant; the :id routes are allow-listed as
// `platform` in the two-tenant guard. Contract: accessRequestAdmin.openapi.ts.
// ---------------------------------------------------------------------------
router.get("/access-requests", validate(listAccessRequestsSchema, { from: "query" }), listAccessRequests);
router.post("/access-requests/erasure", validate(eraseAccessRequestsSchema), eraseAccessRequests);
router.get("/access-requests/:id", validate(accessRequestIdSchema, { from: "params" }), getAccessRequest);
router.post(
  "/access-requests/:id/approve",
  validate(approveAccessRequestSchema, { from: ["params", "body"] }),
  approveAccessRequest,
);
router.post(
  "/access-requests/:id/reject",
  validate(rejectAccessRequestSchema, { from: ["params", "body"] }),
  rejectAccessRequest,
);
router.post(
  "/access-requests/:id/resend-invitation",
  validate(accessRequestIdSchema, { from: "params" }),
  resendAccessRequestInvitation,
);

// ---------------------------------------------------------------------------
// P24-06 — the SQL-dump import: a mysqldump / MariaDB dump is uploaded into the
// quarantine, PARSED (never executed) by a background job into the
// `upstream_import` staging schema, and its uploader notified. Super admin only
// (this router's rbac, and `superAdminOnly` on each route besides). The runs
// have no tenant: the :id routes are allow-listed as `platform` in the
// two-tenant guard. Contract: admin.openapi.ts.
// ---------------------------------------------------------------------------

/**
 * Browsers name a .sql / .gz file inconsistently (Windows often sends
 * application/octet-stream, or nothing); the service decides by CONTENT
 * (gzip magic bytes, then a SQL-dump head), never by this header.
 */
const DUMP_MIMES = Object.freeze([
  "application/sql",
  "application/x-sql",
  "text/x-sql",
  "text/plain",
  "application/gzip",
  "application/x-gzip",
  "application/x-gzip-compressed",
  "application/octet-stream",
  "",
]);

/** multer, built per request so UPSTREAM_IMPORT_MAX_BYTES is read at call time. The file stays in quarantine. */
const dumpUpload: RequestHandler = (req, res, next) => {
  upload({
    folder: "uploads/.quarantine/upstream-sql",
    allowedMimes: DUMP_MIMES,
    allowedExtensions: [".sql", ".gz"],
    maxFileSize: upstreamImportSettings().maxUploadBytes,
    // The content check is the service's (a SQL dump or gzip); a magic-byte table has no entry for text.
    validateMagicBytes: false,
    holdInQuarantine: true,
  })(req, res, next);
};

router.get("/upstream-sql-imports/settings", superAdminOnly, sqlImportSettings);
router.get("/upstream-sql-imports", superAdminOnly, validate(listUpstreamSqlImportsSchema, { from: "query" }), listSqlImports);
router.post("/upstream-sql-imports", superAdminOnly, uploadTimeBudget, dumpUpload, uploadSqlImport);
router.get("/upstream-sql-imports/:id", superAdminOnly, validate(upstreamSqlImportIdSchema, { from: "params" }), getSqlImport);
router.post("/upstream-sql-imports/:id/cancel", superAdminOnly, validate(upstreamSqlImportIdSchema, { from: "params" }), cancelSqlImport);
router.post("/upstream-sql-imports/:id/retry", superAdminOnly, validate(upstreamSqlImportIdSchema, { from: "params" }), retrySqlImport);

export = router;
