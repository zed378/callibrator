const { Op } = require("sequelize");
const { Users, Role } = require("../models");
const { AppError } = require("../utils/appError.util");
const { ROLE_IDS } = require("../constants");

const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";

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

exports.getUsers = async (tenantId, startIndex = 1, count = 100, filter = null) => {
  const offset = Math.max(0, startIndex - 1);
  const limit = Math.max(1, count);
  const where = { tenantId };

  if (filter) {
    const emailMatch = filter.match(/email eq "([^"]+)"/);
    const activeMatch = filter.match(/active eq (true|false)/);
    if (emailMatch) {
      where.email = emailMatch[1];
    }
    if (activeMatch) {
      where.isActive = activeMatch[1] === "true";
      where.status = activeMatch[1] === "true" ? "ACTIVE" : "SUSPENDED";
    }
  }

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

  const randomPassword = require("crypto").randomBytes(16).toString("hex");
  const hashedPassword = await require("../utils/password.util").hashPassword(randomPassword);

  const user = await Users.create({
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
    if (op.op === "replace") {
      for (const [key, value] of Object.entries(op.value || {})) {
        if (key === "name") {
          if (value.givenName) {
            updates.firstName = value.givenName;
          }
          if (value.familyName) {
            updates.lastName = value.familyName;
          }
        } else if (key === "active") {
          updates.isActive = value;
          updates.status = value ? "ACTIVE" : "SUSPENDED";
        } else if (key === "roleId") {
          updates.roleId = value;
        }
      }
    } else if (op.op === "add") {
      for (const [key, value] of Object.entries(op.value || {})) {
        if (key === "roleId") {
          updates.roleId = value;
        }
      }
    } else if (op.op === "remove") {
      for (const key of op.path || []) {
        if (key === "roleId") {
          updates.roleId = ROLE_IDS.USER;
        }
      }
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

  for (const op of patchOps) {
    if (op.op === "replace" && op.value?.displayName) {
      await role.update({ name: op.value.displayName.toUpperCase(), nameToShow: op.value.displayName });
    } else if (op.op === "add" && op.value?.members) {
      const memberIds = op.value.members.map((m) => (typeof m === "string" ? m : m.value));
      await Users.update(
        { roleId: groupId },
        { where: { id: { [Op.in]: memberIds }, tenantId } },
      );
    } else if (op.op === "remove" && op.value?.members) {
      const memberIds = op.value.members.map((m) => (typeof m === "string" ? m : m.value));
      await Users.update(
        { roleId: ROLE_IDS.USER },
        { where: { id: { [Op.in]: memberIds }, tenantId } },
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
  await role.destroy();
  return { status: 204 };
};
