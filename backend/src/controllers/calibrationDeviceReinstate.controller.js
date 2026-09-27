/**
 * Q-02 (ADR-084) — POST /calibration-devices/:calibrationDeviceId/reinstate.
 *
 * The one way a retired calibration device leaves `retired`: a tenant
 * administrator's correction with a reason, audited in the same transaction
 * (services/calibrationDeviceReinstate.service.js). Another tenant's device
 * answers 404, like one that does not exist.
 */
const reinstateService = require("../services/calibrationDeviceReinstate.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { auditActor } = require("../utils/auditActor.util");
const { error, sendResult } = require("../utils/response.util");

exports.reinstateCalibrationDevice = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId || req.user.tenantId;
  const result = await reinstateService.reinstate(
    tenantId,
    req.params.calibrationDeviceId,
    req.body,
    auditActor(req),
  );

  if (result.status === 400) {
    return error(res, result.message, 400, null, { errors: result.errors });
  }
  return sendResult(res, result);
});
