const scimService = require("../services/scim.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const {
  scimUserSchema,
  scimGroupSchema,
  scimPatchSchema,
  validate,
} = require("../validators/scim.validator");

exports.getUsers = asyncHandler(async (req, res) => {
  const { startIndex = 1, count = 100, filter } = req.query;
  const result = await scimService.getUsers(req.user?.tenantId, Number(startIndex), Number(count), filter);
  success(res, result, null, "SCIM users fetched");
});

exports.getUserById = asyncHandler(async (req, res) => {
  const result = await scimService.getUserById(req.user?.tenantId, req.params.id);
  success(res, result, null, "SCIM user fetched");
});

exports.createUser = asyncHandler(async (req, res) => {
  const validated = validate(req.body, scimUserSchema);
  const result = await scimService.createUser(req.user?.tenantId, validated);
  res.status(201).json({ success: true, status: 201, message: "SCIM user created", data: result });
});

exports.updateUser = asyncHandler(async (req, res) => {
  const validated = validate(req.body, scimUserSchema);
  const result = await scimService.updateUser(req.user?.tenantId, req.params.id, validated);
  success(res, result, null, "SCIM user updated");
});

exports.patchUser = asyncHandler(async (req, res) => {
  const validated = validate(req.body, scimPatchSchema);
  const result = await scimService.patchUser(req.user?.tenantId, req.params.id, validated.Operations || []);
  success(res, result, null, "SCIM user patched");
});

exports.deleteUser = asyncHandler(async (req, res) => {
  await scimService.deleteUser(req.user?.tenantId, req.params.id);
  res.status(204).json({ success: true, status: 204, message: "SCIM user deleted", data: null });
});

exports.getGroups = asyncHandler(async (req, res) => {
  const { startIndex = 1, count = 100, filter } = req.query;
  const result = await scimService.getGroups(req.user?.tenantId, Number(startIndex), Number(count), filter);
  success(res, result, null, "SCIM groups fetched");
});

exports.getGroupById = asyncHandler(async (req, res) => {
  const result = await scimService.getGroupById(req.user?.tenantId, req.params.id);
  success(res, result, null, "SCIM group fetched");
});

exports.createGroup = asyncHandler(async (req, res) => {
  const validated = validate(req.body, scimGroupSchema);
  const result = await scimService.createGroup(req.user?.tenantId, validated);
  res.status(201).json({ success: true, status: 201, message: "SCIM group created", data: result });
});

exports.updateGroup = asyncHandler(async (req, res) => {
  const validated = validate(req.body, scimGroupSchema);
  const result = await scimService.updateGroup(req.user?.tenantId, req.params.id, validated);
  success(res, result, null, "SCIM group updated");
});

exports.patchGroup = asyncHandler(async (req, res) => {
  const validated = validate(req.body, scimPatchSchema);
  const result = await scimService.patchGroup(req.user?.tenantId, req.params.id, validated.Operations || []);
  success(res, result, null, "SCIM group patched");
});

exports.deleteGroup = asyncHandler(async (req, res) => {
  await scimService.deleteGroup(req.user?.tenantId, req.params.id);
  res.status(204).json({ success: true, status: 204, message: "SCIM group deleted", data: null });
});
