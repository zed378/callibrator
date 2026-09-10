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

const submitActionSchema = Joi.object({
  action: Joi.string().valid("APPROVED", "REJECTED").required(),
  comments: Joi.string().allow("", null).optional(),
});

module.exports = {
  createWorkflowSchema,
  updateWorkflowSchema,
  submitActionSchema,
};
