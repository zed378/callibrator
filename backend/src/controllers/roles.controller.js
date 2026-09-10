const rolesService = require("../services/roles.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");

// ==========================================
//                     ROLES
// ==========================================

exports.getAllRoles = asyncHandler(async (req, res) => {
  const { page, limit, search } = req.query;
  const result = await rolesService.getAllRoles({
    limit: parseInt(limit) || 20,
    offset: ((parseInt(page) || 1) - 1) * (parseInt(limit) || 20),
    search: search || "",
  });
  return res.status(200).json({
    success: true,
    data: result.data,
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.count,
    },
  });
});

exports.getRoleById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const role = await rolesService.getRoleById(id);
  if (!role) {
    return res.status(404).json({
      success: false,
      message: "Role not found",
    });
  }
  return res.status(200).json({ success: true, data: role });
});

exports.createRole = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const role = await rolesService.createRole({ name, description });
  const fullRole = await rolesService.getRoleById(role.id);
  return res.status(201).json({ success: true, data: fullRole });
});

exports.updateRole = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, description, status } = req.body;
  const role = await rolesService.updateRole(id, {
    name,
    description,
    status,
  });
  return res.status(200).json({ success: true, data: role });
});

exports.deleteRole = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await rolesService.deleteRole(id);
  return res.status(200).json({ success: true, ...result });
});

// ==========================================
//                     MENU GROUPS
// ==========================================

exports.getAllMenus = asyncHandler(async (req, res) => {
  const { page, limit, search } = req.query;
  const result = await rolesService.getAllMenus({
    limit: parseInt(limit) || 20,
    offset: ((parseInt(page) || 1) - 1) * (parseInt(limit) || 20),
    search: search || "",
  });
  return res.status(200).json({
    success: true,
    data: result.data,
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.count,
    },
  });
});

exports.getMenuById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const menu = await rolesService.getMenuById(id);
  if (!menu) {
    return res.status(404).json({
      success: false,
      message: "Menu group not found",
    });
  }
  return res.status(200).json({ success: true, data: menu });
});

exports.createMenu = asyncHandler(async (req, res) => {
  const menu = await rolesService.createMenu(req.body);
  return res.status(201).json({ success: true, data: menu });
});

exports.updateMenu = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const menu = await rolesService.updateMenu(id, req.body);
  return res.status(200).json({ success: true, data: menu });
});

exports.deleteMenu = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await rolesService.deleteMenu(id);
  return res.status(200).json({ success: true, ...result });
});

// ==========================================
//                     ROLE ASSIGNMENT
// ==========================================

exports.assignRoleToUser = asyncHandler(async (req, res) => {
  const { userId, roleId } = req.body;
  const user = await rolesService.assignRoleToUser(userId, roleId);
  return res.status(200).json({ success: true, data: user });
});

exports.removeRoleFromUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const result = await rolesService.removeRoleFromUser(userId);
  return res.status(200).json({ success: true, ...result });
});

// ==========================================
//                     PERMISSIONS (Role-Menu)
// ==========================================

exports.assignPermissionToRole = asyncHandler(async (req, res) => {
  const { roleId } = req.params;
  const { menuGroupId, permissionType } = req.body;
  const permission = await rolesService.assignMenuToRole(
    roleId,
    menuGroupId,
    permissionType || "read",
  );
  return res.status(201).json({
    success: true,
    message: "Permission assigned successfully",
    data: permission,
  });
});

exports.removePermissionFromRole = asyncHandler(async (req, res) => {
  const { roleId, menuGroupId } = req.params;
  const result = await rolesService.removeMenuFromRole(roleId, menuGroupId);
  return res.status(200).json({ success: true, ...result });
});
