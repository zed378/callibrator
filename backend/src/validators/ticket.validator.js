/**
 * Ticket Validators
 */
const Joi = require("joi");

const STATUSES = ["open", "in_progress", "resolved", "closed"];
const PRIORITIES = ["low", "medium", "high", "urgent"];
const CATEGORIES = ["support", "bug", "feature", "incident", "question"];

exports.createTicket = Joi.object({
  subject: Joi.string().trim().min(3).max(255).required(),
  // Rich-text HTML from the editor; length caps the payload, not the markup.
  description: Joi.string().allow("", null).max(50000),
  priority: Joi.string().valid(...PRIORITIES).default("medium"),
  category: Joi.string().valid(...CATEGORIES).default("support"),
  assignedTo: Joi.string().uuid().allow(null),
  dueDate: Joi.date().allow(null),
}).options({ abortEarly: false, stripUnknown: true });

exports.updateTicket = Joi.object({
  subject: Joi.string().trim().min(3).max(255),
  description: Joi.string().allow("", null).max(50000),
  status: Joi.string().valid(...STATUSES),
  priority: Joi.string().valid(...PRIORITIES),
  category: Joi.string().valid(...CATEGORIES),
  assignedTo: Joi.string().uuid().allow(null),
  dueDate: Joi.date().allow(null),
})
  .min(1) // at least one field to change
  .options({ abortEarly: false, stripUnknown: true });

exports.assignTicket = Joi.object({
  // null unassigns the ticket.
  assignedTo: Joi.string().uuid().allow(null).required(),
}).options({ abortEarly: false, stripUnknown: true });

exports.addComment = Joi.object({
  body: Joi.string().trim().min(1).max(50000).required(),
  isInternal: Joi.boolean().default(false),
}).options({ abortEarly: false, stripUnknown: true });

exports.STATUSES = STATUSES;
exports.PRIORITIES = PRIORITIES;
exports.CATEGORIES = CATEGORIES;
