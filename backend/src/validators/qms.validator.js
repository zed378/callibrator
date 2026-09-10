const Joi = require("joi");

// Partial-update validators for QMS records. Without these, an out-of-enum
// `status` reached the DB and produced an unhandled 500 (raw SQL enum error)
// instead of a 400. Enum values mirror the DB enums (migration 0006).

const updateNCSchema = Joi.object({
  title: Joi.string().min(1).max(255),
  description: Joi.string().allow(""),
  status: Joi.string().valid(
    "OPEN",
    "UNDER_INVESTIGATION",
    "CAPA_REQUIRED",
    "CLOSED",
  ),
  severity: Joi.string().valid("LOW", "MEDIUM", "HIGH", "CRITICAL"),
  rootCause: Joi.string().allow("", null),
}).min(1);

const updateCapaSchema = Joi.object({
  title: Joi.string().min(1).max(255),
  actionPlan: Joi.string(),
  status: Joi.string().valid(
    "DRAFT",
    "OPEN",
    "IN_PROGRESS",
    "VERIFICATION",
    "CLOSED",
  ),
  assignedTo: Joi.string().uuid().allow(null),
  dueDate: Joi.date().allow(null),
  completedDate: Joi.date().allow(null),
  approvedBy: Joi.string().uuid().allow(null),
  verificationNotes: Joi.string().allow("", null),
}).min(1);

module.exports = { updateNCSchema, updateCapaSchema };
