/**
 * MenuGroup validation schemas
 */
const Joi = require("joi");

// ==========================================
// FILTER/GET ALL MENU GROUPS
// ==========================================

exports.filterMenuGroupSchema = Joi.object({
  search: Joi.string().allow(null, ""),
  isActive: Joi.boolean().allow(null),
});

// ==========================================
// GET ASSIGNMENTS
// ==========================================

exports.getAssignmentsSchema = Joi.object({
  roleId: Joi.string().uuid().required(),
});

// ==========================================
// CREATE MENU GROUP
// ==========================================

exports.createMenuGroupSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  slug: Joi.string().min(2).max(100).allow(null, ""),
  icon: Joi.string().max(50).allow(null, ""),
  parentId: Joi.string().uuid().allow(null),
  sortOrder: Joi.number().integer().min(0).default(0),
  isActive: Joi.boolean().default(true),
});

// ==========================================
// UPDATE MENU GROUP
// ==========================================

exports.updateMenuGroupSchema = Joi.object({
  id: Joi.string().uuid().required(),
  name: Joi.string().min(2).max(100),
  slug: Joi.string().min(2).max(100).allow(null, ""),
  icon: Joi.string().max(50).allow(null, ""),
  parentId: Joi.string().uuid().allow(null),
  sortOrder: Joi.number().integer().min(0),
  isActive: Joi.boolean(),
});

// ==========================================
// ASSIGN MENU GROUP TO ROLE
// ==========================================

exports.assignMenuGroupSchema = Joi.object({
  roleId: Joi.string().uuid().required(),
  menuGroupId: Joi.string().uuid().required(),
  notes: Joi.string().max(255).allow(null, ""),
});

// ==========================================
// BULK ASSIGN MENU GROUPS TO ROLE
// ==========================================

exports.bulkAssignMenuGroupsSchema = Joi.object({
  roleId: Joi.string().uuid().required(),
  menuGroupIds: Joi.array().items(Joi.string().uuid()).min(1).required(),
  notes: Joi.string().max(255).allow(null, ""),
});

// ==========================================
// REVOKE MENU GROUP FROM ROLE
// ==========================================

exports.revokeMenuGroupSchema = Joi.object({
  roleId: Joi.string().uuid().required(),
  menuGroupId: Joi.string().uuid().required(),
});

// ==========================================
// BULK REVOKE MENU GROUPS FROM ROLE
// ==========================================

exports.bulkRevokeMenuGroupsSchema = Joi.object({
  roleId: Joi.string().uuid().required(),
  menuGroupIds: Joi.array().items(Joi.string().uuid()).min(1).required(),
});

// ==========================================
// ASSIGN/REVOKE INDIVIDUAL MENU ITEM (AS CHILD MENU GROUP)
// ==========================================

exports.assignMenuItemSchema = Joi.object({
  roleId: Joi.string().uuid().required(),
  menuItemId: Joi.string().uuid().required(),
  notes: Joi.string().max(255).allow(null, ""),
});

exports.revokeMenuItemSchema = Joi.object({
  roleId: Joi.string().uuid().required(),
  menuItemId: Joi.string().uuid().required(),
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
