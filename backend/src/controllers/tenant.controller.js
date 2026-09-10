const tenantService = require("../services/tenant.service");
const tenantUploadService = require("../services/tenantUpload.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const {
  getAllTenantsQuery,
  getTenantSchema,
  createTenantSchema,
  updateTenantSchema,
  deleteTenantSchema,
  tenantIdSchema,
  validate,
} = require("../validators/tenant.validator");

exports.getAllTenants = asyncHandler(async (req, res) => {
  const validated = validate(req.query, getAllTenantsQuery);
  const result = await tenantService.fetchTenants(validated);

  success(
    res,
    result.data.data || result.data.rows,
    result.data.meta || result.meta,
    result.message || "Fetch tenants successful",
    result.status || 200,
  );
});

exports.getSpecificTenant = asyncHandler(async (req, res) => {
  const validated = validate({ ...req.body, ...req.params }, getTenantSchema);
  const result = await tenantService.fetchSpecificTenant(validated.tenantId);

  if (result.status === 404) {
    return res.status(404).json({
      success: false,
      status: 404,
      message: result.message,
      data: null,
    });
  }

  success(
    res,
    result.data,
    null,
    result.message || "Fetch tenant successful",
    result.status || 200,
  );
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

    if (uploadedFilename) {
      inputData.logo = uploadedFilename;
    }

    const result = await tenantService.createTenant(inputData, createdBy);

    success(
      res,
      result.data,
      null,
      result.message || "Tenant created successfully",
      result.status || 201,
    );
  } catch (err) {
    if (req.file) {
      try {
        await require("../utils/upload.util").deleteUpload(
          req.uploadFilename,
          "uploads/tenant",
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

exports.updateTenant = asyncHandler(async (req, res) => {
  const validated = validate(
    { ...req.params, ...req.body },
    updateTenantSchema,
  );
  const updatedBy = req.user?.id;
  const uploadedFilename = req.file ? req.uploadFilename : null;

  const inputData = { ...validated };

  if (uploadedFilename) {
    inputData.logo = uploadedFilename;
  }

  const result = await tenantService.updateTenant(
    validated.tenantId,
    inputData,
    updatedBy,
  );

  if (result.status === 404) {
    return res.status(404).json({
      success: false,
      status: 404,
      message: result.message,
      data: null,
    });
  }

  success(
    res,
    result.data,
    null,
    result.message || "Tenant updated successfully",
    result.status || 200,
  );
});

exports.deleteTenant = asyncHandler(async (req, res) => {
  const validated = validate({ ...req.body, ...req.query }, deleteTenantSchema);
  const result = await tenantService.deleteTenant(
    validated.tenantId,
    validated.deletedBy,
  );

  if (result.status === 404) {
    return res.status(404).json({
      success: false,
      status: 404,
      message: result.message,
      data: null,
    });
  }

  if (result.status === 400) {
    return res.status(400).json({
      success: false,
      status: 400,
      message: result.message,
      data: null,
    });
  }

  success(
    res,
    result.data,
    null,
    result.message || "Tenant deleted successfully",
    result.status || 200,
  );
});

exports.getTenantSettings = asyncHandler(async (req, res) => {
  const validated = validate({ ...req.body, ...req.params }, tenantIdSchema);
  const result = await tenantService.getTenantSettings(validated.tenantId);

  if (result.status === 404) {
    return res.status(404).json({
      success: false,
      status: 404,
      message: result.message,
      data: null,
    });
  }

  success(
    res,
    result.data,
    null,
    result.message || "Fetch tenant settings successful",
    result.status || 200,
  );
});

exports.updateTenantSettings = asyncHandler(async (req, res) => {
  const validated = validate({ ...req.body, ...req.params }, tenantIdSchema);
  const settingsData = req.body;
  const updatedBy = req.user?.id;

  const result = await tenantService.updateTenantSettings(
    validated.tenantId,
    settingsData,
    updatedBy,
  );

  if (result.status === 404) {
    return res.status(404).json({
      success: false,
      status: 404,
      message: result.message,
      data: null,
    });
  }

  success(
    res,
    result.data,
    null,
    result.message || "Tenant settings updated successfully",
    result.status || 200,
  );
});

exports.getTenantUserCount = asyncHandler(async (req, res) => {
  const validated = validate({ ...req.body, ...req.params }, tenantIdSchema);
  const result = await tenantService.getTenantUserCount(validated.tenantId);

  if (result.status === 404) {
    return res.status(404).json({
      success: false,
      status: 404,
      message: result.message,
      data: null,
    });
  }

  success(
    res,
    result.data,
    null,
    result.message || "Fetch tenant user count successful",
    result.status || 200,
  );
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

  const result = await tenantUploadService.updateTenantLogo(
    tenantId,
    req.uploadFilename,
    updatedBy,
  );

  success(
    res,
    result.data,
    null,
    result.message || "Tenant logo uploaded successfully",
    result.status || 200,
  );
});

exports.removeTenantLogo = asyncHandler(async (req, res) => {
  const { tenantId } = { ...req.body, ...req.params };
  const updatedBy = req.user?.id;

  const result = await tenantUploadService.removeTenantLogo(
    tenantId,
    updatedBy,
  );

  success(
    res,
    result.data,
    null,
    result.message || "Tenant logo removed successfully",
    result.status || 200,
  );
});
