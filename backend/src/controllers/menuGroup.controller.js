// src/controllers/menuGroup.controller.js
const { success } = require("../utils/response.util");
const { AppError } = require("../utils/appError.util");
const { asyncHandlerWithMapping } = require("../utils/controllerWrapper.util");
const menuGroupService = require("../services/menuGroup.service");
const menuGroupValidator = require("../validators/menuGroup.validator");
const schemas = menuGroupValidator;

const validate = (data, schema) => {
  const { error, value } = menuGroupValidator.validate(data, schema);
  if (error) {
    throw new AppError(400, "Validation failed: " + error.details.map((d) => d.message).join(", "));
  }
  return value;
};

// ==========================================
// FILTER/GET ALL MENU GROUPS
// ==========================================
exports.filterMenuGroups = asyncHandlerWithMapping(async (req, res) => {
  const roleId = req.query.roleId || req.body.roleId;
  const data = await menuGroupService.listMenuGroups(roleId);
  return success(res, data, null, "Menu groups fetched successfully", 200);
}, {});

// ==========================================
// GET ROLE MENU ASSIGNMENTS (PERSONALIZED MENU)
// ==========================================
exports.getRoleMenuAssignments = asyncHandlerWithMapping(async (req, res) => {
  const { roleId } = validate(req.body, schemas.getAssignmentsSchema);
  const data = await menuGroupService.getRoleMenuAssignments(roleId);
  return success(
    res,
    data,
    null,
    "Role menu assignments fetched successfully",
    200,
  );
}, {});

// ==========================================
// GET ROLES FOR SELECTION
// ==========================================
exports.getAvailableRoles = asyncHandlerWithMapping(async (req, res) => {
  const roles = await menuGroupService.getAvailableRoles();
  return success(res, roles, null, "Roles fetched successfully", 200);
}, {});

// ==========================================
// CREATE MENU GROUP
// ==========================================
exports.createMenuGroup = asyncHandlerWithMapping(async (req, res) => {
  const value = validate(req.body, schemas.createMenuGroupSchema);
  const data = await menuGroupService.createMenuGroup(value);
  return success(res, data, null, "Menu group created successfully", 201);
}, {});

// ==========================================
// UPDATE MENU GROUP
// ==========================================
exports.updateMenuGroup = asyncHandlerWithMapping(async (req, res) => {
  const value = validate(req.body, schemas.updateMenuGroupSchema);
  const data = await menuGroupService.updateMenuGroup(value);
  return success(res, data, null, "Menu group updated successfully", 200);
}, {});

// ==========================================
// DELETE MENU GROUP
// ==========================================
exports.deleteMenuGroup = asyncHandlerWithMapping(async (req, res) => {
  const { menuGroupId } = req.body;
  if (!menuGroupId) {
    throw new AppError(400, "menuGroupId is required");
  }
  await menuGroupService.deleteMenuGroup(menuGroupId);
  return success(res, null, null, "Menu group deleted successfully", 200);
}, {});

// ==========================================
// ASSIGN MENU TO ROLE (GROUP OR ITEM)
// ==========================================
exports.assignMenuGroupToRole = asyncHandlerWithMapping(async (req, res) => {
  const isItem = !!req.body.menuItemId;
  const schema = isItem
    ? schemas.assignMenuItemSchema
    : schemas.assignMenuGroupSchema;
  const value = validate(req.body, schema);
  const roleId = value.roleId;
  const menuGroupId = isItem ? value.menuItemId : value.menuGroupId;

  const perm = await menuGroupService.assignMenuToRole({ roleId, menuGroupId });
  return success(res, perm, null, "Menu assigned successfully", 200);
}, {});

// ==========================================
// REVOKE MENU FROM ROLE (GROUP OR ITEM)
// ==========================================
exports.revokeMenuGroupFromRole = asyncHandlerWithMapping(async (req, res) => {
  const isItem = !!req.body.menuItemId;
  const schema = isItem
    ? schemas.revokeMenuItemSchema
    : schemas.revokeMenuGroupSchema;
  const value = validate(req.body, schema);
  const roleId = value.roleId;
  const menuGroupId = isItem ? value.menuItemId : value.menuGroupId;

  await menuGroupService.revokeMenuFromRole({ roleId, menuGroupId });
  return success(res, null, null, "Menu revoked successfully", 200);
}, {});

// ==========================================
// BULK ASSIGN
// ==========================================
exports.bulkAssignMenuGroups = asyncHandlerWithMapping(async (req, res) => {
  const value = validate(req.body, schemas.bulkAssignMenuGroupsSchema);
  const data = await menuGroupService.bulkAssign(
    value.roleId,
    value.menuGroupIds,
  );
  return success(res, data, null, "Bulk assignment completed", 200);
}, {});

// ==========================================
// BULK REVOKE
// ==========================================
exports.bulkRevokeMenuGroups = asyncHandlerWithMapping(async (req, res) => {
  const value = validate(req.body, schemas.bulkRevokeMenuGroupsSchema);
  const data = await menuGroupService.bulkRevoke(
    value.roleId,
    value.menuGroupIds,
  );
  return success(res, data, null, "Bulk revocation completed", 200);
}, {});
