/**
 * Q-35 (ADR-095) — `Role.prototype.softDelete` refuses a SYSTEM role.
 *
 * The guard read `this.is_system`. The attribute is `isSystem` (the column is
 * is_system through `underscored`), so the guard read `undefined` and never
 * fired: a system role — SUPERADMIN, ADMIN — could be soft-deleted through
 * this method, and every principal holding it would then fail every gate.
 *
 * The effect is asserted, not the call: `save` is replaced (there is no
 * database here), and the test checks whether the row was marked deleted and
 * whether it was persisted. A test that only checked "throws" would pass
 * against a guard reading any truthy attribute; so a NON-system role is
 * also checked to still be deletable.
 */
import { DataTypes, Sequelize } from "sequelize";
import defineRole from "../../models/role.model";

const sequelize = new Sequelize("postgres://u:p@127.0.0.1:1/none", { logging: false });
const Role = defineRole(sequelize, DataTypes);

describe("Role.softDelete (Q-35)", () => {
  it("refuses a system role: throws CANNOT_DELETE_SYSTEM_ROLE, leaves it undeleted and never saves", async () => {
    const role = Role.build({ name: "SUPERADMIN", isSystem: true });
    const save = jest.spyOn(role, "save").mockResolvedValue(role);

    await expect(role.softDelete()).rejects.toMatchObject({
      message: "Cannot soft-delete system roles",
      code: "CANNOT_DELETE_SYSTEM_ROLE",
    });
    expect(role.isDeleted).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("still soft-deletes a non-system role and persists it without hooks", async () => {
    const role = Role.build({ name: "AUDITOR", isSystem: false });
    const save = jest.spyOn(role, "save").mockResolvedValue(role);

    await expect(role.softDelete()).resolves.toBe(role);
    expect(role.isDeleted).toBe(true);
    expect(save).toHaveBeenCalledWith({ hooks: false });
  });
});
