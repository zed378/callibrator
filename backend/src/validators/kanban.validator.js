/**
 * Kanban Validators
 */
const Joi = require("joi");

const ACCESS_LEVELS = ["owner", "editor", "viewer"];
const PRIORITIES = ["low", "medium", "high", "urgent"];
const SPRINT_STATUSES = ["planned", "active", "completed"];
const RELATION_TYPES = [
  "relates_to",
  "duplicates",
  "blocks",
  "blocked_by",
  "parent_of",
  "child_of",
];
// A sprint reference accepts a uuid, the literal "backlog", or null.
const sprintRef = Joi.alternatives().try(
  Joi.string().uuid(),
  Joi.string().valid("backlog"),
  Joi.valid(null),
);

const memberSchema = Joi.object({
  userId: Joi.string().uuid(),
  roleId: Joi.string().uuid(),
  accessLevel: Joi.string()
    .valid(...ACCESS_LEVELS)
    .default("viewer"),
})
  // Exactly one of userId / roleId.
  .xor("userId", "roleId");

exports.createProject = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  // Short card-key prefix, e.g. "MGT" -> MGT-1. Letters/digits only.
  code: Joi.string().trim().max(12).pattern(/^[A-Za-z0-9]+$/).allow("", null),
  description: Joi.string().allow("", null).max(5000),
  color: Joi.string().max(20).allow("", null),
  // Optional initial members (beyond the creator, who becomes owner).
  members: Joi.array().items(memberSchema).default([]),
}).options({ abortEarly: false, stripUnknown: true });

exports.updateProject = Joi.object({
  name: Joi.string().trim().min(1).max(255),
  code: Joi.string().trim().max(12).pattern(/^[A-Za-z0-9]+$/).allow("", null),
  description: Joi.string().allow("", null).max(5000),
  color: Joi.string().max(20).allow("", null),
  archived: Joi.boolean(),
}).options({ abortEarly: false, stripUnknown: true });

exports.addMember = memberSchema.options({
  abortEarly: false,
  stripUnknown: true,
});

exports.updateMember = Joi.object({
  accessLevel: Joi.string()
    .valid(...ACCESS_LEVELS)
    .required(),
}).options({ abortEarly: false, stripUnknown: true });

exports.createColumn = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  position: Joi.number().integer().min(0),
  wipLimit: Joi.number().integer().min(1).allow(null),
}).options({ abortEarly: false, stripUnknown: true });

exports.updateColumn = Joi.object({
  name: Joi.string().trim().min(1).max(120),
  position: Joi.number().integer().min(0),
  wipLimit: Joi.number().integer().min(1).allow(null),
}).options({ abortEarly: false, stripUnknown: true });

exports.reorderColumns = Joi.object({
  // Full ordered list of column ids.
  order: Joi.array().items(Joi.string().uuid()).min(1).required(),
}).options({ abortEarly: false, stripUnknown: true });

exports.createCard = Joi.object({
  columnId: Joi.string().uuid().required(),
  // Omit to land in the active sprint; "backlog"/null for the backlog.
  sprintId: sprintRef,
  title: Joi.string().trim().min(1).max(500).required(),
  description: Joi.string().allow("", null).max(20000),
  priority: Joi.string().valid(...PRIORITIES).allow(null),
  dueDate: Joi.date().allow(null),
  assigneeIds: Joi.array().items(Joi.string().uuid()).default([]),
  labelIds: Joi.array().items(Joi.string().uuid()).default([]),
}).options({ abortEarly: false, stripUnknown: true });

exports.updateCard = Joi.object({
  title: Joi.string().trim().min(1).max(500),
  description: Joi.string().allow("", null).max(20000),
  priority: Joi.string().valid(...PRIORITIES).allow(null),
  dueDate: Joi.date().allow(null),
  sprintId: sprintRef,
  // When present, replaces the full set.
  assigneeIds: Joi.array().items(Joi.string().uuid()),
  labelIds: Joi.array().items(Joi.string().uuid()),
}).options({ abortEarly: false, stripUnknown: true });

exports.moveCard = Joi.object({
  columnId: Joi.string().uuid().required(),
  // Target index within the destination column (0-based).
  position: Joi.number().integer().min(0).required(),
}).options({ abortEarly: false, stripUnknown: true });

exports.createLabel = Joi.object({
  name: Joi.string().trim().min(1).max(80).required(),
  color: Joi.string().max(20).allow("", null),
}).options({ abortEarly: false, stripUnknown: true });

exports.updateLabel = Joi.object({
  name: Joi.string().trim().min(1).max(80),
  color: Joi.string().max(20).allow("", null),
}).options({ abortEarly: false, stripUnknown: true });

exports.createSprint = Joi.object({
  name: Joi.string().trim().min(1).max(160).required(),
  goal: Joi.string().allow("", null).max(2000),
  status: Joi.string().valid(...SPRINT_STATUSES).default("planned"),
  startDate: Joi.date().allow(null),
  endDate: Joi.date().allow(null),
  position: Joi.number().integer().min(0),
}).options({ abortEarly: false, stripUnknown: true });

exports.updateSprint = Joi.object({
  name: Joi.string().trim().min(1).max(160),
  goal: Joi.string().allow("", null).max(2000),
  status: Joi.string().valid(...SPRINT_STATUSES),
  startDate: Joi.date().allow(null),
  endDate: Joi.date().allow(null),
  position: Joi.number().integer().min(0),
}).options({ abortEarly: false, stripUnknown: true });

exports.migrateCards = Joi.object({
  // Explicit card ids, OR allNotDone to sweep every non-Done card.
  cardIds: Joi.array().items(Joi.string().uuid()),
  allNotDone: Joi.boolean(),
  fromSprintId: sprintRef,
  targetSprintId: sprintRef.required(),
})
  .or("cardIds", "allNotDone")
  .options({ abortEarly: false, stripUnknown: true });

exports.addRelation = Joi.object({
  targetCardId: Joi.string().uuid().required(),
  type: Joi.string().valid(...RELATION_TYPES).required(),
}).options({ abortEarly: false, stripUnknown: true });

exports.ACCESS_LEVELS = ACCESS_LEVELS;
exports.PRIORITIES = PRIORITIES;
exports.SPRINT_STATUSES = SPRINT_STATUSES;
exports.RELATION_TYPES = RELATION_TYPES;
