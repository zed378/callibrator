const { Op, fn, col, where: sqlWhere } = require("sequelize");
const models = require("../models");

const { Users, Role, ScimGroup, RoleMenuPermission } = models;
const { AppError } = require("../utils/appError.util");
const { logger } = require("../middlewares/activityLog.middleware");

const { ROLE_IDS } = require("../constants");

// SCIM provisions ordinary tenant members. It may never hand out SUPERADMIN or
// any system role: the endpoints accept any API key as a service account, and
// until 2026-09-23 a caller could name ROLE_IDS.SUPER_ADMIN — a constant
// committed to this repository — and take over the platform (A-27).
const assertAssignableRole = async (roleId) => {
  if (!roleId) {
    return;
  }
  if (roleId === ROLE_IDS.SUPER_ADMIN) {
    throw new AppError(403, "SCIM may not assign the SUPERADMIN role");
  }
  const role = await Role.findOne({ where: { id: roleId } });
  if (!role) {
    throw new AppError(400, "Unknown roleId");
  }
  if (role.isSystem && String(role.name).toUpperCase() === "SUPERADMIN") {
    throw new AppError(403, "SCIM may not assign the SUPERADMIN role");
  }
  return role;
};

const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";

const SCIM_OPS = ["add", "remove", "replace"];

// ---------------------------------------------------------------------------
// RFC 7644 § 3.5.2 patch paths (A-33)
//
// Until 2026-09-23 patchUser and patchGroup read only `op.value`, as an object,
// and never looked at `op.path`. The normal form every IdP sends —
//   { "op": "replace", "path": "active", "value": false }
// — made `Object.entries(false)` === `[]`, so the operation was dropped and the
// endpoint answered 200 with the user unchanged. A silent no-op on the
// operation that removes access is the worst failure mode available.
//
// Both forms now funnel through the SAME assignment code below, so every roleId
// write — path form or value form — still passes assertAssignableRole(). An
// operation whose `path` is present but unparseable is a 400, never a no-op.
// ---------------------------------------------------------------------------

const SCIM_USER_URN_PREFIX = "urn:ietf:params:scim:schemas:core:2.0:user:";
const SCIM_GROUP_URN_PREFIX = "urn:ietf:params:scim:schemas:core:2.0:group:";

// Entra ID prefixes core attributes with the schema URN. RFC 7644 § 3.10 makes
// that equivalent to the bare attribute name.
const stripSchemaUrn = (path) => {
  const trimmed = path.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith(SCIM_USER_URN_PREFIX)) {
    return trimmed.slice(SCIM_USER_URN_PREFIX.length);
  }
  if (lower.startsWith(SCIM_GROUP_URN_PREFIX)) {
    return trimmed.slice(SCIM_GROUP_URN_PREFIX.length);
  }
  return trimmed;
};

// RFC 7643 § 2.1: attribute names are case-insensitive.
const USER_PATH_ATTRIBUTES = {
  active: "active",
  username: "userName",
  "name.givenname": "name.givenName",
  "name.familyname": "name.familyName",
  roleid: "roleId",
};

const GROUP_PATH_ATTRIBUTES = {
  displayname: "displayName",
  members: "members",
  roleid: "roleId",
};

// Okta removes a single member with a value filter rather than a value body.
const MEMBER_VALUE_FILTER = /^members\[\s*value\s+eq\s+"([^"]+)"\s*\]$/i;

const assertOp = (op) => {
  const operation = String(op.op || "").toLowerCase();
  if (!SCIM_OPS.includes(operation)) {
    throw new AppError(400, `Unsupported SCIM op: ${op.op}`);
  }
  return operation;
};

const resolveUserPath = (rawPath) => {
  if (typeof rawPath !== "string") {
    throw new AppError(400, "SCIM path must be a string");
  }
  const attribute = USER_PATH_ATTRIBUTES[stripSchemaUrn(rawPath).toLowerCase()];
  if (!attribute) {
    throw new AppError(400, `Unsupported SCIM path: ${rawPath}`);
  }
  return attribute;
};

const resolveGroupPath = (rawPath) => {
  if (typeof rawPath !== "string") {
    throw new AppError(400, "SCIM path must be a string");
  }
  const path = stripSchemaUrn(rawPath);
  const filtered = path.match(MEMBER_VALUE_FILTER);
  if (filtered) {
    return { attribute: "members", memberIds: [filtered[1]] };
  }
  const attribute = GROUP_PATH_ATTRIBUTES[path.toLowerCase()];
  if (!attribute) {
    throw new AppError(400, `Unsupported SCIM path: ${rawPath}`);
  }
  return { attribute, memberIds: null };
};

// Okta sends a JSON boolean, Entra ID has been observed sending "True"/"False".
const toScimBoolean = (value, attribute) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    if (normalised === "true") {
      return true;
    }
    if (normalised === "false") {
      return false;
    }
  }
  throw new AppError(400, `SCIM ${attribute} must be a boolean`);
};

const toScimString = (value, attribute) => {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  throw new AppError(400, `SCIM ${attribute} must be a non-empty string`);
};

// A-49: a patch `value` reaches this module unvalidated — scimPatchSchema types
// it as any object, array, string, boolean or number — while `roleId` and member
// ids are compared against UUID columns. PostgreSQL rejects a malformed UUID
// literal with 22P02 ("invalid input syntax for type uuid"), which surfaced as
// a 500 where a 400 is owed. Every id that arrives in a patch value is checked
// here, before any query.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value) => typeof value === "string" && UUID_PATTERN.test(value);

const assertUuid = (value, attribute) => {
  if (!isUuid(value)) {
    throw new AppError(400, `SCIM ${attribute} must be a UUID`);
  }
  return value;
};

const toMemberIds = (value) => {
  const list = Array.isArray(value) ? value : [value];
  const ids = list
    .map((member) => (typeof member === "string" ? member : member?.value))
    .filter(Boolean);
  if (ids.length === 0) {
    throw new AppError(400, "SCIM members value must name at least one member");
  }
  return ids.map((id) => assertUuid(id, "member value"));
};

// The single assignment point for a user attribute. Both patch forms and
// nothing else reach it, which is what keeps assertAssignableRole unavoidable.
const applyUserAttribute = async (updates, attribute, value) => {
  switch (attribute) {
    case "active": {
      const active = toScimBoolean(value, "active");
      updates.isActive = active;
      updates.status = active ? "ACTIVE" : "SUSPENDED";
      break;
    }
    case "userName": {
      // createUser writes the email to both columns; keep them in step. Stored
      // lowercased, as every other identity path stores it (D-06, migration
      // 0063): SCIM userName is caseExact=false (RFC 7643 §4.1.1).
      const email = toScimString(value, "userName").toLowerCase();
      updates.email = email;
      updates.username = email;
      break;
    }
    case "name.givenName":
      updates.firstName = toScimString(value, "name.givenName");
      break;
    case "name.familyName":
      updates.lastName = toScimString(value, "name.familyName");
      break;
    case "roleId":
      assertUuid(value, "roleId");
      await assertAssignableRole(value);
      updates.roleId = value;
      break;
    /* istanbul ignore next -- unreachable: callers resolve attributes through the maps above */
    default:
      throw new AppError(400, `Unsupported SCIM attribute: ${attribute}`);
  }
};

// The pre-A-33, non-standard shape: { "op": "replace", "value": { … } }. Kept
// working because it is what the existing integration tests and any in-house
// client send. Unknown keys are ignored here, as they always were.
const applyUserValueObject = async (updates, value) => {
  for (const [key, entry] of Object.entries(value)) {
    if (key === "name") {
      if (entry?.givenName) {
        await applyUserAttribute(updates, "name.givenName", entry.givenName);
      }
      if (entry?.familyName) {
        await applyUserAttribute(updates, "name.familyName", entry.familyName);
      }
    } else if (key === "active" || key === "userName" || key === "roleId") {
      await applyUserAttribute(updates, key, entry);
    }
  }
};

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const formatScimUser = (user) => ({
  schemas: [SCIM_USER_SCHEMA],
  id: user.id,
  userName: user.email,
  name: {
    givenName: user.firstName,
    familyName: user.lastName,
  },
  emails: [
    {
      primary: true,
      value: user.email,
      type: "work",
    },
  ],
  active: user.isActive && user.status === "ACTIVE",
  meta: {
    resourceType: "User",
    created: user.createdAt,
    lastModified: user.updatedAt,
  },
});

// RFC 7644 § 3.4.2.2: a filter the service cannot honour is an `invalidFilter`
// 400. Before 2026-09-23 an unrecognised filter — including the `userName eq`
// that Okta and Entra ID send to test for an existing user — was dropped, and
// the caller got the WHOLE tenant back in answer to "does this one user exist?"
const USER_FILTER_USERNAME = /^userName\s+eq\s+"([^"]*)"$/i;
const USER_FILTER_EMAIL = /^(?:email|emails\.value)\s+eq\s+"([^"]*)"$/i;
const USER_FILTER_ACTIVE = /^active\s+eq\s+"?(true|false)"?$/i;

const parseUserFilter = (filter) => {
  const where = {};
  for (const term of filter.split(/\s+and\s+/i)) {
    const trimmed = term.trim();
    // A-49: `userName eq` used to compare `email` only. formatScimUser reports
    // userName as the email, and createUser writes the email to both columns,
    // but a user created elsewhere may have a username that differs — and the
    // IdP's pre-create probe then found nothing and POSTed a duplicate.
    const userNameMatch = trimmed.match(USER_FILTER_USERNAME);
    if (userNameMatch) {
      where[Op.or] = [{ email: userNameMatch[1].toLowerCase() }, { username: userNameMatch[1] }];
      continue;
    }
    const emailMatch = trimmed.match(USER_FILTER_EMAIL);
    if (emailMatch) {
      where.email = emailMatch[1].toLowerCase(); // stored lowercased (D-06)
      continue;
    }
    const activeMatch = trimmed.match(USER_FILTER_ACTIVE);
    if (activeMatch) {
      const active = activeMatch[1].toLowerCase() === "true";
      where.isActive = active;
      where.status = active ? "ACTIVE" : "SUSPENDED";
      continue;
    }
    throw new AppError(400, `Unsupported SCIM filter: ${filter}`);
  }
  return where;
};

exports.getUsers = async (tenantId, startIndex = 1, count = 100, filter = null) => {
  const offset = Math.max(0, startIndex - 1);
  const limit = Math.max(1, count);
  const where = { tenantId, ...(filter ? parseUserFilter(String(filter)) : {}) };

  const { count: total, rows } = await Users.findAndCountAll({
    where,
    offset,
    limit,
    include: [
      {
        model: Role,
        as: "role",
        attributes: ["id", "name"],
        required: false,
      },
    ],
  });

  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: total,
    startIndex,
    itemsPerPage: rows.length,
    Resources: rows.map(formatScimUser),
  };
};

exports.getUserById = async (tenantId, userId) => {
  const user = await Users.findOne({
    where: { id: userId, tenantId },
    include: [
      {
        model: Role,
        as: "role",
        attributes: ["id", "name"],
        required: false,
      },
    ],
  });
  if (!user) {
    throw new AppError(404, "User not found");
  }
  return formatScimUser(user);
};

// ---------------------------------------------------------------------------
// A-37 — the insert failure is answered generically.
//
// `users.email` and `users.username` are unique ACROSS TENANTS (user.model.js),
// while the duplicate check above is narrowed to the caller's tenant by the
// global tenant hooks. So an address held by ANOTHER tenant passes the check
// and is rejected by the database. That rejection used to surface as its own
// response (a 500 carrying Sequelize's "Validation error"), distinguishable
// from every other failure — a cross-tenant existence oracle reachable with
// nothing but an API key.
//
// Every failure of the insert now produces ONE response, built here: the same
// status and the same body whether the cause is a unique violation against
// another tenant's row, a lost connection, or anything else. What actually
// happened goes to the log only. The in-tenant duplicate keeps its 409: the
// caller can list its own tenant's users, so that answer discloses nothing.
//
// This hides the oracle's SIGNAL; it does not remove the constraint behind it.
// An address that belongs to another tenant still cannot be provisioned here —
// whether identities should be unique per tenant (D-06) is an open decision,
// not something this function decides.
// ---------------------------------------------------------------------------
const PROVISIONING_FAILED_STATUS = 500;
const PROVISIONING_FAILED_MESSAGE = "The user could not be provisioned";

/**
 * Log why a SCIM user insert failed and return the one generic error every
 * insert failure is answered with. The address is not logged (it is personal
 * data); the constraint, the columns and the tenant are enough to diagnose.
 *
 * @param {string} tenantId - the caller's tenant
 * @param {Error & {name?: string, fields?: object, parent?: {constraint?: string}}} cause
 * @returns {AppError} always the same status and message
 */
const provisioningFailed = (tenantId, cause) => {
  const isUniqueViolation = cause?.name === "SequelizeUniqueConstraintError";
  logger.warn("scim: user provisioning failed", {
    tenantId,
    reason: isUniqueViolation ? "unique-violation" : "insert-error",
    errorName: cause?.name,
    constraint: cause?.parent?.constraint,
    fields: cause?.fields ? Object.keys(cause.fields) : undefined,
    error: isUniqueViolation ? undefined : cause?.message,
  });
  return new AppError(PROVISIONING_FAILED_STATUS, PROVISIONING_FAILED_MESSAGE);
};

exports.createUser = async (tenantId, scimData) => {
  // D-06: lowercased, as every other identity path stores an address. Sign-in
  // is by username or email across every tenant (ADR-051 Q-18), and an address
  // stored as the IdP happened to case it could sit beside another tenant's
  // identical address — two accounts for one mailbox. Migration 0063 makes the
  // database refuse that; this keeps SCIM from attempting it.
  const rawEmail = (scimData.emails && scimData.emails[0]?.value) || scimData.userName;
  const email = rawEmail ? String(rawEmail).trim().toLowerCase() : rawEmail;
  const firstName = scimData.name?.givenName || "SCIM";
  const lastName = scimData.name?.familyName || "User";

  if (!email) {
    throw new AppError(400, "Email/userName is required");
  }

  const existing = await Users.findOne({ where: { email } });
  if (existing) {
    throw new AppError(409, "User already exists in the system");
  }

  await assertAssignableRole(scimData.roleId);

  const randomPassword = require("crypto").randomBytes(16).toString("hex");
  const hashedPassword = await require("../utils/password.util").hashPassword(randomPassword);

  let user;
  try {
    user = await Users.create({
      tenantId,
      email,
      username: email,
      firstName,
      lastName,
      password: hashedPassword,
      roleId: scimData.roleId || ROLE_IDS.USER,
      isActive: scimData.active !== false,
      status: scimData.active === false ? "SUSPENDED" : "ACTIVE",
      isEmailVerified: true,
    });
  } catch (error) {
    throw provisioningFailed(tenantId, error);
  }

  return formatScimUser(user);
};

exports.updateUser = async (tenantId, userId, scimData) => {
  const user = await Users.findOne({ where: { id: userId, tenantId } });
  if (!user) {
    throw new AppError(404, "User not found");
  }

  const updates = {};
  if (scimData.name?.givenName) {
    updates.firstName = scimData.name.givenName;
  }
  if (scimData.name?.familyName) {
    updates.lastName = scimData.name.familyName;
  }
  if (scimData.roleId) {
    await assertAssignableRole(scimData.roleId);
    updates.roleId = scimData.roleId;
  }
  if (typeof scimData.active === "boolean") {
    updates.isActive = scimData.active;
    updates.status = scimData.active ? "ACTIVE" : "SUSPENDED";
  }

  await user.update(updates);
  return formatScimUser(user);
};

exports.patchUser = async (tenantId, userId, patchOps) => {
  const user = await Users.findOne({ where: { id: userId, tenantId } });
  if (!user) {
    throw new AppError(404, "User not found");
  }

  const updates = {};

  for (const op of patchOps) {
    const operation = assertOp(op);

    if (operation === "remove") {
      // RFC 7644 § 3.5.2 makes `path` REQUIRED on a remove. The pre-A-33 code
      // iterated `op.path` as an array of keys while the validator declared it
      // a string, so this branch could not fire at all.
      if (!op.path) {
        throw new AppError(400, "SCIM remove operations require a path");
      }
      const attribute = resolveUserPath(op.path);
      if (attribute !== "roleId") {
        throw new AppError(400, `SCIM cannot remove ${attribute}`);
      }
      updates.roleId = ROLE_IDS.USER;
    } else if (op.path) {
      await applyUserAttribute(updates, resolveUserPath(op.path), op.value);
    } else if (isPlainObject(op.value)) {
      await applyUserValueObject(updates, op.value);
    } else {
      throw new AppError(400, "SCIM operation requires a path or an object value");
    }
  }

  await user.update(updates);
  return formatScimUser(user);
};

exports.deleteUser = async (tenantId, userId) => {
  const user = await Users.findOne({ where: { id: userId, tenantId } });
  if (!user) {
    throw new AppError(404, "User not found");
  }
  await user.destroy();
  return { status: 204 };
};

// ---------------------------------------------------------------------------
// SCIM Groups (ADR-053; A-38, A-39, A-49)
//
// A SCIM Group is a `scim_groups` row OWNED BY ONE TENANT that maps to an
// existing role. Until 2026-09-24 a group WAS a global `roles` row, so one
// tenant's IdP listed every tenant's groups, got a 409 for a name another
// tenant held, and deleted a role for every tenant that used it (A-38). A group
// it created also carried roleLevel 1 and no menu grants, and nothing said so
// (A-39). Now:
//
//  - SCIM never creates, renames or deletes a ROLE. It creates, renames and
//    deletes the tenant's group row, and maps it with `roleId` to a role that
//    already exists and already grants something.
//  - A group may be created UNMAPPED — standard IdPs send only displayName —
//    but an unmapped group grants nothing, and says so: every response carries
//    the mapping in the Callibrator extension, and adding a member to it is a
//    409 naming the fix. Nothing is granted silently, and nothing is silently
//    not granted.
//  - Membership is derived, as it always was: the tenant's users whose roleId
//    is the group's role. A user holds one role, so joining a group REPLACES
//    their role and leaving it demotes them to ROLE_IDS.USER.
//  - displayName is stored as sent and compared case-insensitively, per tenant
//    (migration 0042's unique index), so another tenant's name is never a 409
//    and `displayName eq` matches however the IdP capitalises it (A-49).
//  - Every multi-step write runs in ONE transaction.
// ---------------------------------------------------------------------------

const SCIM_GROUP_EXTENSION = "urn:ietf:params:scim:schemas:extension:callibrator:2.0:Group";

// RFC 7644 § 3.4.2.4 lets a service return fewer results than `count` asks for.
const MAX_GROUP_PAGE = 200;

const GROUP_FILTER_DISPLAY_NAME = /^displayName\s+eq\s+"([^"]*)"$/i;

const displayNameIs = (displayName) =>
  sqlWhere(fn("lower", col("display_name")), displayName.toLowerCase());

// A principal with no tenant owns no groups. Without this guard a
// tenant-less super admin would reach `where: { tenantId: undefined }`, which
// Sequelize rejects with a thrown error — a 500.
const assertTenant = (tenantId) => {
  if (!tenantId) {
    throw new AppError(403, "SCIM groups require a tenant-bound credential");
  }
};

/**
 * The caller's group, or 404. Another tenant's group, a deleted one, a group
 * that never existed and a malformed id are indistinguishable (CLAUDE.md).
 */
const findGroup = async (tenantId, groupId, transaction) => {
  assertTenant(tenantId);
  const group = isUuid(groupId)
    ? await ScimGroup.findOne({ where: { id: groupId, tenantId }, transaction })
    : null;
  if (!group) {
    throw new AppError(404, "Group not found");
  }
  return group;
};

/**
 * Validate a role a group is to be mapped to (A-39). It must be a UUID, exist,
 * pass the A-27 guard (never SUPERADMIN), not be the default role — removing a
 * member demotes to that role, so a group on it could never remove anyone —
 * and grant at least one menu permission. A role that grants nothing is exactly
 * what A-39 was; mapping a group to one would reproduce it by another route.
 *
 * @returns {Promise<object>} the role
 */
const assertMappableRole = async (roleId) => {
  assertUuid(roleId, "roleId");
  if (roleId === ROLE_IDS.USER) {
    throw new AppError(
      400,
      "A group cannot be mapped to the default USER role: removing a member demotes them to it, so removal would do nothing",
    );
  }
  const role = await assertAssignableRole(roleId);
  const grants = await RoleMenuPermission.count({ where: { roleId } });
  if (grants === 0) {
    throw new AppError(
      400,
      `Role "${role.nameToShow || role.name}" grants no menu permission; a group mapped to it would grant nothing. Grant the role permissions first`,
    );
  }
  return role;
};

/** 409 when another group of this tenant already uses the name or the role. */
const assertGroupUnique = async (tenantId, { displayName, roleId }, exceptId, transaction) => {
  const notSelf = exceptId ? { id: { [Op.ne]: exceptId } } : {};
  if (displayName !== undefined) {
    const clash = await ScimGroup.findOne({
      where: { tenantId, ...notSelf, [Op.and]: [displayNameIs(displayName)] },
      transaction,
    });
    if (clash) {
      throw new AppError(409, "Group already exists");
    }
  }
  if (roleId) {
    const clash = await ScimGroup.findOne({ where: { tenantId, roleId, ...notSelf }, transaction });
    if (clash) {
      throw new AppError(
        409,
        `That role is already mapped to the group "${clash.displayName}"; a role backs at most one group per tenant`,
      );
    }
  }
};

// The unique indexes are the final word under concurrency: a request that lost
// the race to the check above gets the same 409, not a 500.
const asGroupConflict = (error) => {
  if (error?.name === "SequelizeUniqueConstraintError") {
    return new AppError(409, "Group already exists");
  }
  return error;
};

const groupMembers = async (tenantId, group, transaction) => {
  if (!group.roleId) {
    return [];
  }
  return Users.findAll({
    where: { tenantId, roleId: group.roleId },
    attributes: ["id", "email"],
    transaction,
  });
};

const formatScimGroup = async (tenantId, group, transaction) => {
  const [members, role] = await Promise.all([
    groupMembers(tenantId, group, transaction),
    group.roleId ? Role.findOne({ where: { id: group.roleId }, transaction }) : null,
  ]);
  return {
    schemas: [SCIM_GROUP_SCHEMA, SCIM_GROUP_EXTENSION],
    id: group.id,
    displayName: group.displayName,
    members: members.map((m) => ({ value: m.id, display: m.email })),
    // A-39: what membership in this group grants, stated in every response.
    [SCIM_GROUP_EXTENSION]: {
      roleId: group.roleId || null,
      roleName: role ? role.nameToShow || role.name : null,
      grantsAccess: Boolean(role),
    },
    meta: {
      resourceType: "Group",
      created: group.createdAt,
      lastModified: group.updatedAt,
    },
  };
};

/** Give the named tenant users the group's role. Refused for an unmapped group. */
const addMembers = async (tenantId, group, ids, transaction) => {
  if (!group.roleId) {
    throw new AppError(
      409,
      `Group "${group.displayName}" is not mapped to a role, so membership would grant nothing. ` +
        "Map it first: PATCH with path \"roleId\"",
    );
  }
  await Users.update(
    { roleId: group.roleId },
    { where: { id: { [Op.in]: ids }, tenantId }, transaction },
  );
};

/**
 * Demote members to the default role. `ids` null means every member. Only
 * users who ARE members are touched: until 2026-09-24 a remove naming a user
 * demoted them whatever role they held, so removing someone from a group they
 * were not in stripped their real role. An unmapped group has no members.
 */
const removeMembers = async (tenantId, group, ids, transaction) => {
  if (!group.roleId) {
    return;
  }
  const where = { tenantId, roleId: group.roleId };
  if (ids) {
    where.id = { [Op.in]: ids };
  }
  await Users.update({ roleId: ROLE_IDS.USER }, { where, transaction });
};

/**
 * Point the group at another role, or at none. Membership is derived from the
 * role, so the current members MOVE with the group: they take the new role, or
 * — when the group is unmapped — the default one. Leaving them on the old role
 * would drop them from the group the IdP still believes they are in.
 */
const remapGroup = async (tenantId, group, roleId, transaction) => {
  const next = roleId || null;
  if (next === (group.roleId || null)) {
    return;
  }
  if (next) {
    await assertMappableRole(next);
    await assertGroupUnique(tenantId, { roleId: next }, group.id, transaction);
  }
  if (group.roleId) {
    await Users.update(
      { roleId: next || ROLE_IDS.USER },
      { where: { tenantId, roleId: group.roleId }, transaction },
    );
  }
  await group.update({ roleId: next }, { transaction });
};

const renameGroup = async (tenantId, group, value, transaction) => {
  const displayName = toScimString(value, "displayName");
  await assertGroupUnique(tenantId, { displayName }, group.id, transaction);
  await group.update({ displayName }, { transaction });
};

const inTransaction = async (work) => {
  try {
    return await models.sequelize.transaction(work);
  } catch (error) {
    throw asGroupConflict(error);
  }
};

exports.getGroups = async (tenantId, startIndex = 1, count = 100, filter = null) => {
  assertTenant(tenantId);
  const offset = Math.max(0, startIndex - 1);
  const limit = Math.min(MAX_GROUP_PAGE, Math.max(1, count));

  const where = { tenantId };
  if (filter) {
    // A-49: an unsupported filter is a 400, as it is on GET /Users — never
    // the whole list in answer to a question about one group.
    const match = String(filter).trim().match(GROUP_FILTER_DISPLAY_NAME);
    if (!match) {
      throw new AppError(400, `Unsupported SCIM filter: ${filter}`);
    }
    where[Op.and] = [displayNameIs(match[1])];
  }

  const { count: total, rows } = await ScimGroup.findAndCountAll({
    where,
    offset,
    limit,
    order: [["createdAt", "ASC"]],
  });

  const groups = await Promise.all(rows.map((group) => formatScimGroup(tenantId, group)));

  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: total,
    startIndex,
    itemsPerPage: groups.length,
    Resources: groups,
  };
};

exports.getGroupById = async (tenantId, groupId) => {
  const group = await findGroup(tenantId, groupId);
  return formatScimGroup(tenantId, group);
};

exports.createGroup = async (tenantId, scimData) => {
  assertTenant(tenantId);
  const displayName = toScimString(scimData.displayName, "displayName");
  const roleId = scimData.roleId || null;
  const memberIds = scimData.members && scimData.members.length > 0 ? toMemberIds(scimData.members) : [];

  if (roleId) {
    await assertMappableRole(roleId);
  } else if (memberIds.length > 0) {
    // Refused BEFORE anything is written: a group created with members it
    // cannot grant anything to is the A-39 failure, not a partial success.
    throw new AppError(
      409,
      `Group "${displayName}" has members but no roleId, so membership would grant nothing. ` +
        "Create it with a roleId, or create it empty and map it before adding members",
    );
  }

  return inTransaction(async (transaction) => {
    await assertGroupUnique(tenantId, { displayName, roleId }, null, transaction);
    const group = await ScimGroup.create({ tenantId, displayName, roleId }, { transaction });
    if (memberIds.length > 0) {
      await addMembers(tenantId, group, memberIds, transaction);
    }
    return formatScimGroup(tenantId, group, transaction);
  });
};

// PUT. `roleId` changes only when it is sent: IdPs never send it, and reading
// its absence as "unmap" would demote every member on an ordinary rename.
// `members` is additive, as it always was — see docs/DEVELOPER/09.
exports.updateGroup = async (tenantId, groupId, scimData) =>
  inTransaction(async (transaction) => {
    const group = await findGroup(tenantId, groupId, transaction);
    if (scimData.displayName !== undefined) {
      await renameGroup(tenantId, group, scimData.displayName, transaction);
    }
    if (scimData.roleId) {
      await remapGroup(tenantId, group, scimData.roleId, transaction);
    }
    if (scimData.members && scimData.members.length > 0) {
      await addMembers(tenantId, group, toMemberIds(scimData.members), transaction);
    }
    return formatScimGroup(tenantId, group, transaction);
  });

const GROUP_VALUE_ATTRIBUTES = ["displayName", "roleId", "members"];

/** One patch operation as [attribute, memberIds, value] tuples. */
const groupOperationTargets = (op) => {
  if (op.path) {
    const { attribute, memberIds } = resolveGroupPath(op.path);
    return [[attribute, memberIds, op.value]];
  }
  if (isPlainObject(op.value)) {
    // The pre-A-33, non-standard shape: { "op": "add", "value": { members: [] } }.
    const targets = GROUP_VALUE_ATTRIBUTES
      .filter((attribute) => op.value[attribute] !== undefined)
      .map((attribute) => [attribute, null, op.value[attribute]]);
    if (targets.length === 0) {
      throw new AppError(400, "SCIM operation names no supported attribute");
    }
    return targets;
  }
  throw new AppError(400, "SCIM operation requires a path or an object value");
};

exports.patchGroup = async (tenantId, groupId, patchOps) =>
  inTransaction(async (transaction) => {
    const group = await findGroup(tenantId, groupId, transaction);

    for (const op of patchOps) {
      const operation = assertOp(op);

      for (const [attribute, memberIds, value] of groupOperationTargets(op)) {
        if (attribute === "displayName") {
          if (operation === "remove") {
            throw new AppError(400, "SCIM cannot remove displayName");
          }
          await renameGroup(tenantId, group, value, transaction);
        } else if (attribute === "roleId") {
          // `remove roleId` unmaps the group; its members are demoted.
          await remapGroup(tenantId, group, operation === "remove" ? null : value, transaction);
        } else if (operation === "remove") {
          // `remove` on `members` with no value clears the whole attribute
          // (RFC 7644 § 3.5.2), i.e. demotes every member this tenant has.
          const ids = memberIds
            ? memberIds.map((id) => assertUuid(id, "member value"))
            : value === undefined || value === null ? null : toMemberIds(value);
          await removeMembers(tenantId, group, ids, transaction);
        } else {
          // `replace` is deliberately additive, as PUT's member handling is.
          const ids = memberIds ? memberIds.map((id) => assertUuid(id, "member value")) : toMemberIds(value);
          await addMembers(tenantId, group, ids, transaction);
        }
      }
    }

    return formatScimGroup(tenantId, group, transaction);
  });

// Deletes the tenant's group row and nothing else on the platform — never the
// role (A-38). Its members leave it: they are demoted to the default role, as a
// `remove members` with no value would demote them.
exports.deleteGroup = async (tenantId, groupId) =>
  inTransaction(async (transaction) => {
    const group = await findGroup(tenantId, groupId, transaction);
    await removeMembers(tenantId, group, null, transaction);
    await group.destroy({ transaction });
    return { status: 204 };
  });
