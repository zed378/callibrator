require("./env.util");
const { Connection, db } = require("../config");
const { MenuGroup } = require("../models");

async function check() {
  try {
    await Connection();
    const groups = await MenuGroup.findAll({
      attributes: ["id", "name", "slug", "parentId", "isActive"],
      raw: true,
    });
    console.log("=== ALL MENU GROUPS IN DB ===");
    console.log(JSON.stringify(groups, null, 2));

    const { Role } = require("../models");
    const roles = await Role.findAll({ raw: true });
    console.log("=== ALL ROLES IN DB ===");
    console.log(JSON.stringify(roles, null, 2));

    const RoleMenuPermission = db.models.RoleMenuPermission;
    const permissions = await RoleMenuPermission.findAll({
      raw: true,
    });
    console.log("=== ALL ROLE MENU PERMISSIONS IN DB ===");
    console.log(JSON.stringify(permissions, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
