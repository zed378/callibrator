const Joi = require("joi");

const createWorkflowSchema = Joi.object({
  name: Joi.string().required(),
  resourceType: Joi.string().valid("Certificate", "StockTransfer", "MaintenanceWorkOrder").required(),
  isActive: Joi.boolean().optional(),
  steps: Joi.array().items(
    Joi.object({
      stepOrder: Joi.number().integer().min(1).required(),
      roleId: Joi.string().uuid().required(),
      requiredApprovals: Joi.number().integer().min(1).optional(),
    })
  ).min(1).required(),
});

const updateWorkflowSchema = Joi.object({
  name: Joi.string().optional(),
  isActive: Joi.boolean().optional(),
  steps: Joi.array().items(
    Joi.object({
      stepOrder: Joi.number().integer().min(1).required(),
      roleId: Joi.string().uuid().required(),
      requiredApprovals: Joi.number().integer().min(1).optional(),
    })
  ).min(1).optional(),
});

// A-182 — approving a Certificate is an electronic signature, so the caller
// re-authenticates with the same three fields as POST /certificates/:id/approve.
// They are optional here because a StockTransfer or work-order decision, and
// any rejection, needs none; workflow.service#submitAction requires them when
// the instance decides on a Certificate. The approver is always the caller.
const submitActionSchema = Joi.object({
  action: Joi.string().valid("APPROVED", "REJECTED").required(),
  comments: Joi.string().allow("", null).optional(),
  authMethod: Joi.string().valid("password", "mfa").optional(),
  authPayload: Joi.string().optional(),
  meaning: Joi.string().min(1).max(255).optional(),
});

module.exports = {
  createWorkflowSchema,
  updateWorkflowSchema,
  submitActionSchema,
};
