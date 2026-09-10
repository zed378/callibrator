const Joi = require("joi");

// NOTE: enums and field names are aligned with the MaintenanceWorkOrder model:
// - `title` is a NOT NULL column and must be accepted (it was previously
//   stripped by stripUnknown, making creates fail the DB constraint).
// - type enum: Preventative | Breakdown | Repair (model), not "Inspection".
// - status enum: Open | InProgress | Completed | Cancelled (model), not "Pending".
// - `assigneeId` is kept as the public API name; the controller/service maps
//   it to the `assignedTo` column.
exports.createWorkOrder = Joi.object({
  deviceId: Joi.string().uuid().required(),
  title: Joi.string().trim().max(255).required(),
  vendorId: Joi.string().uuid().allow(null),
  assigneeId: Joi.string().uuid().allow(null),
  type: Joi.string().valid("Preventative", "Breakdown", "Repair").required(),
  priority: Joi.string().valid("Low", "Medium", "High", "Critical").default("Medium"),
  status: Joi.string().valid("Open", "InProgress", "Completed", "Cancelled").default("Open"),
  description: Joi.string().trim().allow(null, ""),
  scheduledDate: Joi.date().iso().allow(null),
  estimatedCost: Joi.number().min(0).allow(null),
});

exports.updateWorkOrder = Joi.object({
  title: Joi.string().trim().max(255),
  vendorId: Joi.string().uuid().allow(null),
  assigneeId: Joi.string().uuid().allow(null),
  type: Joi.string().valid("Preventative", "Breakdown", "Repair"),
  priority: Joi.string().valid("Low", "Medium", "High", "Critical"),
  status: Joi.string().valid("Open", "InProgress", "Completed", "Cancelled"),
  description: Joi.string().trim().allow(null, ""),
  scheduledDate: Joi.date().iso().allow(null),
  completedDate: Joi.date().iso().allow(null),
  estimatedCost: Joi.number().min(0).allow(null),
  actualCost: Joi.number().min(0).allow(null),
  resolutionNotes: Joi.string().trim().allow(null, ""),
});

exports.validate = (body, schema) => {
  return schema.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });
};

exports.formatErrors = (details) => {
  return details.map((item) => ({
    field: item.path.join("."),
    message: item.message,
  }));
};
