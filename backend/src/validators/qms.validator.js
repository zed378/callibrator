const Joi = require("joi");
const { NC_STATUSES, NC_SEVERITIES, CAPA_STATUSES } = require("../constants/qmsConstants");

// QMS request validators. Without these, an out-of-enum value reached the DB
// and produced an unhandled 500 (raw SQL enum error) instead of a 400. The
// value sets are the models' own ENUMs (constants/qmsConstants.js), not a
// restatement of them.
//
// None of these schemas accepts `tenantId`: it is stamped from the caller's
// context, never read from a body (unknown keys are stripped by validate()).

// A-74 — POST /qms/nc. `title` and `description` are NOT NULL columns; a
// missing one used to reach the INSERT and 500.
const createNCSchema = Joi.object({
  title: Joi.string().trim().min(1).max(255).required(),
  description: Joi.string().trim().min(1).required(),
  severity: Joi.string().valid(...NC_SEVERITIES),
  // Must be a device of the caller's tenant — checked in the service (A-75),
  // which answers 404 for another tenant's device.
  deviceId: Joi.string().uuid().allow(null),
  dateIdentified: Joi.date().iso(),
  rootCause: Joi.string().allow("", null),
});

// Partial update. `deviceId` is deliberately absent: an NC's device is fixed at
// creation (the service's allow-list never contained it).
const updateNCSchema = Joi.object({
  title: Joi.string().min(1).max(255),
  description: Joi.string().allow(""),
  status: Joi.string().valid(...NC_STATUSES),
  severity: Joi.string().valid(...NC_SEVERITIES),
  rootCause: Joi.string().allow("", null),
}).min(1);

// A-74 — POST /qms/capa. `status` is not accepted: a CAPA is always created as
// DRAFT (qms.service#createCapa).
const createCapaSchema = Joi.object({
  ncId: Joi.string().uuid().required(),
  title: Joi.string().trim().min(1).max(255).required(),
  actionPlan: Joi.string().trim().min(1).required(),
  // Must be a user of the caller's tenant — checked in the service (A-75).
  assignedTo: Joi.string().uuid().allow(null),
  dueDate: Joi.date().iso().allow(null),
});

const updateCapaSchema = Joi.object({
  title: Joi.string().min(1).max(255),
  actionPlan: Joi.string(),
  status: Joi.string().valid(...CAPA_STATUSES),
  // A-75: a non-null value must be a user of the caller's tenant (service).
  assignedTo: Joi.string().uuid().allow(null),
  dueDate: Joi.date().allow(null),
  completedDate: Joi.date().allow(null),
  // A-62: accepted for compatibility, but the id is IGNORED — a value records
  // the authenticated caller as approver (qms.service#updateCapa), null clears.
  approvedBy: Joi.string().uuid().allow(null),
  verificationNotes: Joi.string().allow("", null),
}).min(1);

module.exports = { createNCSchema, updateNCSchema, createCapaSchema, updateCapaSchema };
