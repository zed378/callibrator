const tenantService = require("../services/tenant.service");
const tenantUploadService = require("../services/tenantUpload.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success, sendResult } = require("../utils/response.util");
const {
  getAllTenantsQuery,
  getTenantSchema,
  createTenantSchema,
  updateTenantSchema,
  deleteTenantSchema,
  tenantIdSchema,
  validate,
} = require("../validators/tenant.validator");
const { auditActor } = require("../utils/auditActor.util");

/**
 * A-63. The principal a tenant mutation is checked against: the audit actor
 * (A-41) plus whether it is a super admin. Taken from the authenticated user
 * only — never from the body, the query or an x-tenant-* header.
 *
 * @param {import("express").Request} req
 * @returns {{userId: string|null, tenantId: string|null, impersonatorId: string|null,
 *   ipAddress: string|null, userAgent: string|null, actorIsSuperAdmin: boolean}}
 */
const tenantActor = (req) => {
  const roleName = req.user && req.user.role && req.user.role.name;
  return {
    ...auditActor(req),
    actorIsSuperAdmin: roleName === "SUPER_ADMIN" || roleName === "SUPERADMIN",
  };
};

/**
 * A-112. Send a tenant service result down the path its status belongs on
 * (utils/response.util.js#sendResult, A-103). Each handler used to special-case
 * `status === 404` by hand and forward everything else through success(), so
 * any other non-2xx result — a 409, a 403 — went out with `success: true`.
 *
 * The handler's default message and status apply only to a successful result:
 * a failure without a message must not be announced as, say, "Tenant created
 * successfully".
 *
 * @param {import("express").Response} res
 * @param {{success?: boolean, status?: number, message?: string, data?: *}} result
 * @param {string} defaultMessage - for a successful result that carries none
 * @param {number} defaultStatus - for a result that carries none
 * @param {Object|null} [meta] - pagination for a list
 */
const sendTenantResult = (res, result, defaultMessage, defaultStatus, meta = null) => {
  const status = result.status || defaultStatus;
  const failed = result.success === false || status >= 400;
  return sendResult(
    res,
    {
      ...result,
      status,
      message: result.message || (failed ? undefined : defaultMessage),
    },
    meta,
  );
};

exports.getAllTenants = asyncHandler(async (req, res) => {
  const validated = validate(req.query, getAllTenantsQuery);
  const result = await tenantService.fetchTenants(validated);

  // Rows in `data`, pagination in a top-level `meta`. A failed result carries
  // no page; it goes down the error path and the meta is ignored.
  const page = result.data || {};
  sendTenantResult(
    res,
    { ...result, data: page.data || page.rows },
    "Fetch tenants successful",
    200,
    page.meta || result.meta || null,
  );
});

exports.getSpecificTenant = asyncHandler(async (req, res) => {
  const validated = validate({ ...req.body, ...req.params }, getTenantSchema);
  const result = await tenantService.fetchSpecificTenant(validated.tenantId);

  sendTenantResult(res, result, "Fetch tenant successful", 200);
});

/**
 * Public (no-auth) tenant branding for the login/register page. The
 * deploy-configured tenant id arrives via the `X-Tenant-ID` header (injected by
 * the frontend proxy from NEXT_PUBLIC_TENANT_ID); a query/param fallback is
 * accepted. Returns only non-sensitive branding fields.
 */
exports.getPublicBranding = asyncHandler(async (req, res) => {
  const tenantId =
    req.headers["x-tenant-id"] || req.query.tenantId || req.params.tenantId;

  const validated = validate({ tenantId }, getTenantSchema);
  const branding = await tenantService.getPublicBranding(validated.tenantId);

  if (!branding) {
    return res.status(404).json({
      success: false,
      status: 404,
      message: "Tenant not found",
      data: null,
    });
  }

  success(res, branding, null, "Fetch tenant branding successful", 200);
});

exports.createTenant = asyncHandler(async (req, res, next) => {
  try {
    const validated = validate(req.body, createTenantSchema);
    const createdBy = req.user?.id;
    const uploadedFilename = req.file ? req.uploadFilename : null;

    const inputData = { ...validated };
    // A-79: the logo is only ever the file this request uploaded, never a
    // filename from the body (which could name another tenant's file).
    delete inputData.logo;

    if (uploadedFilename) {
      inputData.logo = uploadedFilename;
    }

    // A-95: the service audits the create inside its transaction.
    const result = await tenantService.createTenant(inputData, createdBy, auditActor(req));

    sendTenantResult(res, result, "Tenant created successfully", 201);
  } catch (err) {
    if (req.file) {
      try {
        await require("../utils/upload.util").deleteUpload(
          req.uploadFilename,
          "uploads/public/tenant",
        );
      } catch (deleteErr) {
        require("../middlewares/activityLog.middleware").logger.warn(
          `Failed to delete uploaded file after failure: ${req.uploadFilename}`,
          deleteErr,
        );
      }
    }
    next(err);
  }
});

/**
 * A-79. Remove the file THIS request uploaded, after the update was refused or
 * failed. Never throws: the original error is what the caller must see.
 *
 * @param {import("express").Request} req
 */
const discardUploadedLogo = async (req) => {
  if (!req.file) {
    return;
  }
  try {
    await require("../utils/upload.util").deleteUpload(req.uploadFilename, "uploads/public/tenant");
  } catch (deleteErr) {
    require("../middlewares/activityLog.middleware").logger.warn(
      `Failed to delete uploaded file after failure: ${req.uploadFilename}`,
      deleteErr,
    );
  }
};

exports.updateTenant = asyncHandler(async (req, res) => {
  let result;
  try {
    const validated = validate(
      { ...req.params, ...req.body },
      updateTenantSchema,
    );
    const updatedBy = req.user?.id;
    const uploadedFilename = req.file ? req.uploadFilename : null;

    const inputData = { ...validated };
    // A-79: the logo is only ever the file this request uploaded. A body
    // `logo` could name another tenant's file — which the next upload would
    // then delete as "the old logo".
    delete inputData.logo;

    if (uploadedFilename) {
      inputData.logo = uploadedFilename;
    }

    // A-63: who is asking decides WHICH tenant may be changed and WHICH fields.
    // Derived from the authenticated principal, never from the request.
    // It throws for every refusal (400, 403, 404, 409) and for a failed audit
    // insert, all BEFORE the commit — so a throw means nothing was committed
    // and the uploaded file belongs to no tenant.
    result = await tenantService.updateTenant(
      validated.tenantId,
      inputData,
      updatedBy,
      tenantActor(req),
    );
  } catch (err) {
    await discardUploadedLogo(req);
    throw err;
  }

  sendTenantResult(res, result, "Tenant updated successfully", 200);
});

exports.deleteTenant = asyncHandler(async (req, res) => {
  const validated = validate({ ...req.body, ...req.query }, deleteTenantSchema);
  // A-95: the actor is the authenticated caller — never a body or query
  // `deletedBy` (the schema no longer accepts one; stripUnknown drops it).
  const result = await tenantService.deleteTenant(validated.tenantId, auditActor(req));

  sendTenantResult(res, result, "Tenant deleted successfully", 200);
});

exports.getTenantSettings = asyncHandler(async (req, res) => {
  const validated = validate({ ...req.body, ...req.params }, tenantIdSchema);
  const result = await tenantService.getTenantSettings(validated.tenantId);

  sendTenantResult(res, result, "Fetch tenant settings successful", 200);
});

exports.updateTenantSettings = asyncHandler(async (req, res) => {
  const validated = validate({ ...req.body, ...req.params }, tenantIdSchema);
  const settingsData = req.body || {};
  const updatedBy = req.user?.id;

  const result = await tenantService.updateTenantSettings(
    validated.tenantId,
    settingsData,
    updatedBy,
    auditActor(req), // A-117: for the audit row written in the transaction
  );

  sendTenantResult(res, result, "Tenant settings updated successfully", 200);
});

exports.getTenantUserCount = asyncHandler(async (req, res) => {
  const validated = validate({ ...req.body, ...req.params }, tenantIdSchema);
  const result = await tenantService.getTenantUserCount(validated.tenantId);

  sendTenantResult(res, result, "Fetch tenant user count successful", 200);
});

exports.uploadTenantLogo = asyncHandler(async (req, res) => {
  const { tenantId } = { ...req.body, ...req.params };
  const updatedBy = req.user?.id;

  if (!req.file) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: "No file uploaded",
      data: null,
    });
  }

  let result;
  try {
    // A-96: the service audits inside its transaction and throws for every
    // refusal BEFORE the commit — so a throw means the upload belongs to no
    // tenant and must not stay on disk.
    result = await tenantUploadService.updateTenantLogo(
      tenantId,
      req.uploadFilename,
      updatedBy,
      tenantActor(req),
    );
  } catch (err) {
    await discardUploadedLogo(req);
    throw err;
  }

  sendTenantResult(res, result, "Tenant logo uploaded successfully", 200);
});

exports.removeTenantLogo = asyncHandler(async (req, res) => {
  const { tenantId } = { ...req.body, ...req.params };
  const updatedBy = req.user?.id;

  const result = await tenantUploadService.removeTenantLogo(
    tenantId,
    updatedBy,
    tenantActor(req),
  );

  sendTenantResult(res, result, "Tenant logo removed successfully", 200);
});
