/**
 * Tenants: `/api/v1/tenants` (index.js mounts it, beside tenantBackup,
 * tenantLifecycle and dataRetention).
 *
 * P9-21 (ADR-087): converted from tenant.route.js. Every route, gate and
 * middleware is in the same order as before (checked against the mounted
 * route table and the module text). `MAX_FILE_SIZE` is read through
 * config/env (`env`), as upload.util reads it; the value is the same. The
 * contract is code-first: tenant.openapi.ts (P9-25, ADR-103); the `@swagger`
 * JSDoc this file carried is gone.
 */
import { Router } from "express";
import { env } from "../../config/env";
import { auth, superAdminOnly } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
// The `.js` required `validateUuid` here and never used it; the binding is gone.
import { endpointRateLimiter } from "../../services/rateLimiter.redis.service";
import { enforceStorageQuota } from "../../middlewares/enforceQuota.middleware";
import tenantController from "../../controllers/tenant.controller";
import { upload, PUBLIC_IMAGE_MIMES, PUBLIC_IMAGE_EXTS } from "../../utils/upload.util";

// `Router` is `express.Router` (the same function).
const router = Router();

/* ------------------------------------------------------------------ */
/* GET ALL TENANTS                                                    */
/* ------------------------------------------------------------------ */
// A-76: listing every tenant is a PLATFORM operation. It was gated on the
// `Management` menu, which the seed grants to every tenant administrator (and
// read to ENGINEERING MANAGER), and `tenants` is not tenant-scoped — so any of
// them could enumerate every hospital on the platform. A tenant reads its own
// row through POST /detail.
router.get("/all", auth, superAdminOnly, tenantController.getAllTenants);

/* ------------------------------------------------------------------ */
/* GET SPECIFIC TENANT                                                */
/* ------------------------------------------------------------------ */
router.post(
  "/detail",
  auth,
  dynamicAccess("management", "read", { checkTenant: true }),
  tenantController.getSpecificTenant,
);

/* ------------------------------------------------------------------ */
/* PUBLIC BRANDING (no auth) — login/register page reads tenant        */
/* logo/name/color pre-auth via the X-Tenant-ID header.                */
/* Returns only non-sensitive branding fields (no users/settings).     */
/* ------------------------------------------------------------------ */
router.get("/public", tenantController.getPublicBranding);

/* ------------------------------------------------------------------ */
/* CREATE TENANT (supports form-data with optional file upload)       */
/* ------------------------------------------------------------------ */
router.post(
  "/create",
  endpointRateLimiter("tenantCreate"),
  auth,
  // A-76: creating a tenant is a platform operation (it was `Management`
  // create, which every tenant administrator holds). The gate runs before
  // upload(), so a refused request never writes a file.
  superAdminOnly,
  upload({
    folder: "uploads/public/tenant",
    // ADR-042 step 3: a logo is in the public class; SVG is refused.
    allowedMimes: PUBLIC_IMAGE_MIMES,
    allowedExtensions: PUBLIC_IMAGE_EXTS,
    maxFileSize: parseInt(env("MAX_FILE_SIZE") as string) || 5 * 1024 * 1024,
  }),
  tenantController.createTenant,
);

/* ------------------------------------------------------------------ */
/* UPDATE TENANT (supports form-data with optional file upload)       */
/* ------------------------------------------------------------------ */
router.patch(
  "/edit",
  endpointRateLimiter("tenantUpload"),
  auth,
  // A-63: no `checkSelf` — a tenant is not a user's own resource, and the
  // self bypass it enabled skipped checkTenant for any body `userId: <self>`.
  // checkTenant here sees a JSON body's tenantId but NOT a multipart one
  // (multer parses that later, in upload()), so the ownership rule that
  // actually holds is in tenantService.updateTenant.
  dynamicAccess("management", "update", { checkTenant: true }),
  enforceStorageQuota(),
  upload({
    folder: "uploads/public/tenant",
    // ADR-042 step 3: a logo is in the public class; SVG is refused.
    allowedMimes: PUBLIC_IMAGE_MIMES,
    allowedExtensions: PUBLIC_IMAGE_EXTS,
    maxFileSize: parseInt(env("MAX_FILE_SIZE") as string) || 5 * 1024 * 1024,
  }),
  tenantController.updateTenant,
);

/* ------------------------------------------------------------------ */
/* DELETE TENANT                                                      */
/* ------------------------------------------------------------------ */
// A-76: deleting a tenant is a platform operation. Under `Management` delete
// with checkTenant, a tenant administrator could delete their OWN tenant —
// checkTenant only proves the target is theirs.
router.delete("/delete", auth, superAdminOnly, tenantController.deleteTenant);

/* ------------------------------------------------------------------ */
/* TENANT SETTINGS & LOGO OPERATIONS */
/* ------------------------------------------------------------------ */

router.post(
  "/settings",
  auth,
  dynamicAccess("management", "read", { checkTenant: true }),
  tenantController.getTenantSettings,
);

router.patch(
  "/settings",
  auth,
  dynamicAccess("management", "write", { checkTenant: true }),
  tenantController.updateTenantSettings,
);

router.post(
  "/user-count",
  auth,
  dynamicAccess("management", "read", { checkTenant: true }),
  tenantController.getTenantUserCount,
);

router.post(
  "/:tenantId/logo",
  auth,
  dynamicAccess("management", "update", { checkTenant: true }),
  upload({
    folder: "uploads/public/tenant",
    // ADR-042 step 3: a logo is in the public class; SVG is refused.
    allowedMimes: PUBLIC_IMAGE_MIMES,
    allowedExtensions: PUBLIC_IMAGE_EXTS,
    maxFileSize: parseInt(env("MAX_FILE_SIZE") as string) || 5 * 1024 * 1024,
  }),
  tenantController.uploadTenantLogo,
);

router.delete(
  "/:tenantId/logo",
  auth,
  dynamicAccess("management", "update", { checkTenant: true }),
  tenantController.removeTenantLogo,
);

export = router;
