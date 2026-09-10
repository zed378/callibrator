/**
 * User validation schemas
 */
const Joi = require("joi");

// ==========================================
// GET ALL USERS QUERY
// ==========================================

exports.getAllUsersQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  find: Joi.string().allow(null, ""),
  status: Joi.string()
    .valid("ACTIVE", "INACTIVE", "SUSPENDED", "active", "inactive", "suspended")
    .insensitive()
    .allow(null, ""),
  roleFilter: Joi.string().allow(null, ""),
  tenantId: Joi.string().uuid().allow(null, ""),
});

// ==========================================
// CREATE USER
// ==========================================

exports.createUserSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  firstName: Joi.string().trim().min(2).max(100).required(),
  lastName: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  roleId: Joi.string().uuid().required(),
  tenantId: Joi.string().uuid().allow(null, ""),
  status: Joi.string()
    .valid("ACTIVE", "INACTIVE", "SUSPENDED", "active", "inactive", "suspended")
    .default("ACTIVE")
    .insensitive()
    .allow(null),
}).custom((value, helpers) => {
  if (value.status && typeof value.status === "string") {
    value.status = value.status.toUpperCase();
  }
  value.email = value.email.toLowerCase();
  value.username = value.username.toLowerCase();
  return value;
});

// ==========================================
// UPDATE USER
// ==========================================

exports.updateUserSchema = Joi.object({
  // userId identifies the target user and must survive validation (it was
  // previously stripped, which made editUser look up `undefined` -> 404).
  userId: Joi.string().uuid().required(),
  username: Joi.string().alphanum().min(3).max(30),
  firstName: Joi.string().trim().min(2).max(100),
  lastName: Joi.string().trim().min(2).max(100),
  email: Joi.string().email(),
  status: Joi.string()
    .valid("ACTIVE", "INACTIVE", "SUSPENDED", "active", "inactive", "suspended")
    .insensitive(),
}).custom((value, helpers) => {
  if (value.status && typeof value.status === "string") {
    value.status = value.status.toUpperCase();
  }
  if (value.email) {
    value.email = value.email.toLowerCase();
  }
  if (value.username) {
    value.username = value.username.toLowerCase();
  }
  return value;
});

// ==========================================
// GET/DELETE USER BY ID
// ==========================================

exports.userParamSchema = Joi.object({
  userId: Joi.string().uuid().required(),
});

// ==========================================
// ROLE UPDATE
// ==========================================

exports.updateRoleSchema = Joi.object({
  userId: Joi.string().uuid().required(),
  roleId: Joi.string().uuid().required(),
});

// ==========================================
// USERNAME CHECK
// ==========================================

exports.usernameCheckSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
});

// ==========================================
// VALIDATION HELPER
// ==========================================

/**
 * Validate request body against a Joi schema
 * @param {Object} body - Request body to validate
 * @param {Object} schema - Joi schema
 * @returns {Object} - { error, value }
 */
exports.validate = (body, schema) => {
  return schema.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });
};

/**
 * Format validation errors for API response
 * @param {Array} details - Joi error details
 * @returns {Array} - Formatted errors
 */
exports.formatErrors = (details) => {
  return details.map((item) => ({
    field: item.path.join("."),
    message: item.message,
  }));
};
