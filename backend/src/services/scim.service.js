const { Op } = require("sequelize");
const { Users, Role } = require("../models");
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

// Renaming or deleting a system role changes behaviour for EVERY tenant: roles
// are global here, and authorization compares role names.
const assertMutableGroup = (role) => {
  if (role.isSystem) {
    throw new AppError(403, "System roles cannot be renamed or deleted through SCIM");
  }
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

const toMemberIds = (value) => {
  const list = Array.isArray(value) ? value : [value];
  const ids = list
    .map((member) => (typeof member === "string" ? member : member?.value))
    .filter(Boolean);
  if (ids.length === 0) {
    throw new AppError(400, "SCIM members value must name at least one member");
  }
  return ids;
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
      // createUser writes the email to both columns; keep them in step.
      const email = toScimString(value, "userName");
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

// The `members = []` default is unreachable: all five call sites in this module
// pass an explicit members array.
/* istanbul ignore next */
const formatScimGroup = (group, members = []) => ({
  schemas: [SCIM_GROUP_SCHEMA],
  id: group.id,
  displayName: group.name,
  members: members.map((m) => ({ value: m.id, display: m.email })),
  meta: {
    resourceType: "Group",
    created: group.createdAt,
    lastModified: group.updatedAt,
  },
});

// RFC 7644 § 3.4.2.2: a filter the service cannot honour is an `invalidFilter`
// 400. Before 2026-09-23 an unrecognised filter — including the `userName eq`
// that Okta and Entra ID send to test for an existing user — was dropped, and
// the caller got the WHOLE tenant back in answer to "does this one user exist?"
const USER_FILTER_EMAIL = /^(?:userName|email|emails\.value)\s+eq\s+"([^"]*)"$/i;
const USER_FILTER_ACTIVE = /^active\s+eq\s+"?(true|false)"?$/i;

const parseUserFilter = (filter) => {
  const where = {};
  for (const term of filter.split(/\s+and\s+/i)) {
    const trimmed = term.trim();
    const emailMatch = trimmed.match(USER_FILTER_EMAIL);
    if (emailMatch) {
      where.email = emailMatch[1];
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
  const email = (scimData.emails && scimData.emails[0]?.value) || scimData.userName;
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

// SCIM Groups map onto Roles. Roles are GLOBAL in this schema — the model has
// no tenantId column — so a Role query must never be filtered by it (doing so
// threw `column Role.tenantId does not exist` and 500'd every Group endpoint).
// Tenant scoping applies to membership instead: the Users lookups below are
// always constrained by tenantId.
exports.getGroups = async (tenantId, startIndex = 1, count = 100, filter = null) => {
  const offset = Math.max(0, startIndex - 1);
  const limit = Math.max(1, count);

  const roleWhere = {};
  if (filter) {
    const displayNameMatch = filter.match(/displayName eq "([^"]+)"/);
    if (displayNameMatch) {
      roleWhere.name = displayNameMatch[1];
    }
  }

  const { count: total, rows } = await Role.findAndCountAll({
    where: roleWhere,
    offset,
    limit,
  });

  const groups = await Promise.all(
    rows.map(async (role) => {
      const members = await Users.findAll({
        where: { tenantId, roleId: role.id },
        attributes: ["id", "email"],
      });
      return formatScimGroup(role, members);
    }),
  );

  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: total,
    startIndex,
    itemsPerPage: groups.length,
    Resources: groups,
  };
};

exports.getGroupById = async (tenantId, groupId) => {
  const role = await Role.findOne({ where: { id: groupId } });
  if (!role) {
    throw new AppError(404, "Group not found");
  }

  const members = await Users.findAll({
    where: { tenantId, roleId: groupId },
    attributes: ["id", "email"],
  });

  return formatScimGroup(role, members);
};

exports.createGroup = async (tenantId, scimData) => {
  const { displayName, members } = scimData;

  if (!displayName) {
    throw new AppError(400, "displayName is required");
  }

  const existing = await Role.findOne({ where: { name: displayName.toUpperCase() } });
  if (existing) {
    throw new AppError(409, "Group already exists");
  }

  const role = await Role.create({
    // No tenantId: roles are global. Sequelize silently drops unknown
    // attributes, so passing one here was a no-op that implied isolation
    // the schema does not provide.
    name: displayName.toUpperCase(),
    description: `SCIM-provisioned group: ${displayName}`,
    nameToShow: displayName,
    isSystem: false,
    status: "active",
    sortOrder: 99,
  });

  if (members && members.length > 0) {
    await Promise.all(
      members.map(async (m) => {
        const userId = typeof m === "string" ? m : m.value;
        const user = await Users.findOne({ where: { id: userId, tenantId } });
        if (user) {
          await user.update({ roleId: role.id });
        }
      }),
    );
  }

  const memberUsers = await Users.findAll({
    where: { tenantId, roleId: role.id },
    attributes: ["id", "email"],
  });

  return formatScimGroup(role, memberUsers);
};

exports.updateGroup = async (tenantId, groupId, scimData) => {
  const role = await Role.findOne({ where: { id: groupId } });
  if (!role) {
    throw new AppError(404, "Group not found");
  }
  assertMutableGroup(role);

  const updates = {};
  if (scimData.displayName) {
    updates.name = scimData.displayName.toUpperCase();
  }
  if (scimData.nameToShow) {
    updates.nameToShow = scimData.nameToShow;
  }

  await role.update(updates);

  if (scimData.members) {
    const memberIds = scimData.members.map((m) => (typeof m === "string" ? m : m.value));
    await assertAssignableRole(groupId);
    await Users.update(
      { roleId: groupId },
      { where: { id: { [Op.in]: memberIds }, tenantId } },
    );
  }

  const members = await Users.findAll({
    where: { tenantId, roleId: groupId },
    attributes: ["id", "email"],
  });

  return formatScimGroup(role, members);
};

exports.patchGroup = async (tenantId, groupId, patchOps) => {
  const role = await Role.findOne({ where: { id: groupId } });
  if (!role) {
    throw new AppError(404, "Group not found");
  }
  assertMutableGroup(role);

  for (const op of patchOps) {
    const operation = assertOp(op);

    let attribute;
    let memberIds = null;
    let value;

    if (op.path) {
      ({ attribute, memberIds } = resolveGroupPath(op.path));
      value = op.value;
    } else if (isPlainObject(op.value)) {
      // The pre-A-33, non-standard shape: { "op": "add", "value": { members: [] } }.
      if (op.value.displayName !== undefined) {
        attribute = "displayName";
      } else if (op.value.members !== undefined) {
        attribute = "members";
      } else {
        throw new AppError(400, "SCIM operation names no supported attribute");
      }
      value = op.value[attribute];
    } else {
      throw new AppError(400, "SCIM operation requires a path or an object value");
    }

    if (attribute === "displayName") {
      if (operation === "remove") {
        throw new AppError(400, "SCIM cannot remove displayName");
      }
      const displayName = toScimString(value, "displayName");
      await role.update({ name: displayName.toUpperCase(), nameToShow: displayName });
    } else if (operation === "remove") {
      // `remove` on `members` with no value clears the whole attribute
      // (RFC 7644 § 3.5.2), i.e. demotes every member this tenant can see.
      const ids = memberIds || (value === undefined || value === null ? null : toMemberIds(value));
      await Users.update(
        { roleId: ROLE_IDS.USER },
        { where: ids ? { id: { [Op.in]: ids }, tenantId } : { roleId: groupId, tenantId } },
      );
    } else {
      const ids = memberIds || toMemberIds(value);
      // A-27 parity with updateGroup. patchGroup used to assign members with no
      // role guard at all; the only thing standing in the way was
      // assertMutableGroup firing first, which is a coincidence, not a control.
      // `replace` is deliberately additive here, as updateGroup's member
      // handling is: it does not demote members the IdP omitted.
      await assertAssignableRole(groupId);
      await Users.update(
        { roleId: groupId },
        { where: { id: { [Op.in]: ids }, tenantId } },
      );
    }
  }

  const members = await Users.findAll({
    where: { tenantId, roleId: groupId },
    attributes: ["id", "email"],
  });

  return formatScimGroup(role, members);
};

exports.deleteGroup = async (tenantId, groupId) => {
  const role = await Role.findOne({ where: { id: groupId } });
  if (!role) {
    throw new AppError(404, "Group not found");
  }
  assertMutableGroup(role);
  await role.destroy();
  return { status: 204 };
};
