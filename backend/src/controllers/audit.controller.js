const auditService = require("../services/audit.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");

exports.fetchAuditLogs = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { page, limit, userId, action, resourceType, resourceId, startDate, endDate } = req.query;

  const result = await auditService.fetchAuditLogs({
    tenantId,
    page,
    limit,
    userId,
    action,
    resourceType,
    resourceId,
    startDate,
    endDate,
  });

  success(res, result.data.rows, result.data.meta, result.message, result.status);
});
