/**
 * GDPR/CCPA Compliance Controller
 *
 * Handles data subject requests and privacy compliance endpoints.
 */

const gdprService = require("../services/gdpr.service");
const { success } = require("../utils/response.util");
const { asyncHandler } = require("../utils/controllerWrapper.util");

/**
 * Resolve the authenticated actor. tenantId comes from the auth-middleware
 * (req.tenantId, which honours SUPER_ADMIN overrides) and the subject is the
 * authenticated user's id (req.user.id — NOT req.user.userId, which is undefined).
 */
const actor = (req) => ({
  tenantId: req.tenantId || req.user?.tenantId || null,
  userId: req.user?.id || null,
});

/**
 * Export all user data (GDPR Article 20 - Data Portability)
 */
exports.exportUserData = asyncHandler(async (req, res) => {
  const { tenantId, userId } = actor(req);
  const result = await gdprService.exportUserData(tenantId, userId);
  return success(res, result, "Data export initiated");
});

/**
 * Request data erasure (GDPR Article 17 - Right to Erasure)
 * Recorded as a DSAR of type "erasure" for the compliance team to action.
 */
exports.requestErasure = asyncHandler(async (req, res) => {
  const { tenantId, userId } = actor(req);
  const { reason } = req.body;
  const request = await gdprService.createDsar(tenantId, userId, "erasure", {
    reason: reason || null,
  });
  return success(res, request, null, "Erasure request submitted", 201);
});

/**
 * Get erasure request status
 */
exports.getErasureStatus = asyncHandler(async (req, res) => {
  const { requestId } = req.params;
  const { tenantId } = actor(req);
  const status = await gdprService.getDsarStatus(tenantId, requestId);
  return success(res, status, "Erasure status retrieved");
});

/**
 * Update consent preferences
 */
exports.updateConsent = asyncHandler(async (req, res) => {
  const { tenantId, userId } = actor(req);
  const { categories, consent } = req.body;
  const result = await gdprService.updateConsent(
    tenantId,
    userId,
    categories,
    consent,
    req.ip,
  );
  return success(res, result, "Consent preferences updated");
});

/**
 * Get consent history
 */
exports.getConsentHistory = asyncHandler(async (req, res) => {
  const { tenantId, userId } = actor(req);
  const history = await gdprService.getConsentHistory(tenantId, userId);
  return success(res, history, "Consent history retrieved");
});

/**
 * Get data processing activities (GDPR Article 30)
 */
exports.getProcessingActivities = asyncHandler(async (req, res) => {
  const { tenantId, userId } = actor(req);
  const activities = await gdprService.getProcessingActivities(
    tenantId,
    userId,
  );
  return success(res, activities, "Processing activities retrieved");
});

/**
 * Rectify personal data (GDPR Article 16)
 */
exports.rectifyData = asyncHandler(async (req, res) => {
  const { tenantId, userId } = actor(req);
  const { field, value } = req.body;
  const result = await gdprService.rectifyData(tenantId, userId, field, value);
  return success(res, result, "Data rectified");
});

/**
 * Restrict processing (GDPR Article 18)
 */
exports.restrictProcessing = asyncHandler(async (req, res) => {
  const { tenantId, userId } = actor(req);
  const { reason } = req.body;
  const result = await gdprService.restrictProcessing(tenantId, userId, reason);
  return success(res, result, "Processing restricted");
});
