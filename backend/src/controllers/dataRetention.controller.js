const dataRetentionService = require("../services/dataRetention.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success, error } = require("../utils/response.util");
const { auditActor } = require("../utils/auditActor.util");
const {
  tenantIdSchema,
  retentionPolicySchema,
  legalHoldSchema,
  piiMaskSchema,
  anonymizeSchema,
  validate,
} = require("../validators/dataRetention.validator");

exports.getRetentionPolicy = asyncHandler(async (req, res) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await dataRetentionService.getRetentionPolicy(validated.tenantId);

  success(res, result, null, "Fetch retention policy successful");
});

exports.setRetentionPolicy = asyncHandler(async (req, res) => {
  // `tenantId` arrives as a path param (:tenantId); merge it with the body so
  // the frontend does not have to redundantly repeat it in the payload.
  const validated = validate({ ...req.params, ...req.body }, retentionPolicySchema);
  const result = await dataRetentionService.setRetentionPolicy(
    validated.tenantId,
    validated.policyKey,
    validated.days,
    auditActor(req), // A-153: audited in the transaction
  );

  success(res, result, null, "Retention policy updated");
});

exports.isOnLegalHold = asyncHandler(async (req, res) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await dataRetentionService.isOnLegalHold(validated.tenantId);

  success(res, { tenantId: validated.tenantId, onLegalHold: result }, null, "Legal hold status fetched");
});

exports.enableLegalHold = asyncHandler(async (req, res) => {
  const validated = validate({ ...req.params, ...req.body }, legalHoldSchema);
  // A-153: the actor, for the audit row written in the transaction.
  const result = await dataRetentionService.enableLegalHold(
    validated.tenantId,
    auditActor(req),
    validated.reason,
  );

  success(res, result, null, "Legal hold enabled");
});

exports.disableLegalHold = asyncHandler(async (req, res) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await dataRetentionService.disableLegalHold(
    validated.tenantId,
    auditActor(req),
  );

  success(res, result, null, "Legal hold disabled");
});

exports.purgeExpiredRecords = asyncHandler(async (req, res) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await dataRetentionService.purgeExpiredRecords(validated.tenantId);

  success(res, result, null, "Purge completed");
});

exports.maskPII = asyncHandler(async (req, res) => {
  const validated = validate({ ...req.params, ...req.body }, piiMaskSchema);
  const result = await dataRetentionService.maskPII(
    validated.tenantId,
    validated.entityType,
    // A-135: audit rows are masked per data subject (piiMaskSchema).
    validated.entityType === "audit_logs" ? validated.subjectIds : validated.recordIds,
    auditActor(req),
  );

  success(res, result, null, "PII masked");
});

exports.anonymizeDataset = asyncHandler(async (req, res) => {
  const validated = validate({ ...req.params, ...req.body }, anonymizeSchema);
  // A-152: refused for every entity type (400); see the service.
  const result = await dataRetentionService.anonymizeDataset(
    validated.tenantId,
    validated.entityType,
  );

  success(res, result, null, "Dataset anonymized");
});
