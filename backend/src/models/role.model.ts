// D-17 — NO tenant column, so the global tenant hooks never scope this model: roles are GLOBAL by decision (D-16, ADR-064): `name` is unique platform-wide and every write route is SUPERADMIN-only, so no tenant principal can create, rename or probe one.
// Held by tests/models/unscopedModels.d17.test.js.
/**
 * Role Model
 *
 * RBAC roles with CRUD permissions (read/write) on menu groups.
 * All roles are global (not tenant-scoped) for consistent permission management.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from role.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import type { DefaultScoped, ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A Role row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Role extends Model<
  InferAttributes<Role>,
  InferCreationAttributes<Role>
> {
  id: CreationOptional<string>;
  name: string;
  nameToShow: string | null;
  description: string | null;
  isSystem: CreationOptional<boolean | null>;
  status: CreationOptional<string | null>;
  sortOrder: CreationOptional<number | null>;
  /** ROLE_LEVELS (constants/roleConstants) — a new role without one fails every privileged gate. */
  roleLevel: CreationOptional<number | null>;
  isDeleted: CreationOptional<boolean>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  users?: NonAttribute<ModelInstance<"User">[]>;
  permissions?: NonAttribute<ModelInstance<"RoleMenuPermission">[]>;

  softDelete(): Promise<Role>;
}

interface RoleStatics {
  associate: (models: Models) => void;
  restoreStatic: (id: string) => Promise<[affectedCount: number]>;
  /** D-12: the defaultScope carries a `where`, so a bare include is an INNER JOIN. Phantom: never read at run time. */
  readonly defaultScoped: DefaultScoped;
}

type DefineRole = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<Role, RoleStatics>;

/** Define the Role model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineRole = (db, DataTypes) => {
  const Role = initModel<Role, RoleStatics>(
    class extends Model {},
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      nameToShow: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      description: { type: DataTypes.TEXT, allowNull: true },
      isSystem: { type: DataTypes.BOOLEAN, defaultValue: false },
      status: { type: DataTypes.STRING(20), defaultValue: "active" },
      sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
      roleLevel: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
    },
    {
      tableName: "roles",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [{ fields: ["status"] }, { fields: ["is_deleted"] }],
      defaultScope: {
        // @ts-expect-error -- the key is the COLUMN is_deleted, not the attribute isDeleted: a caller's where on is_deleted REPLACES this default only with the column key (P9-10 spec, probe 3)
        where: { is_deleted: false },
      },
      // A-274 (2026-09-30): the unused `includeDeleted` scope was removed — no
      // caller used it, and `.scope(["defaultScope", "includeDeleted"])` would have
      // silently dropped the soft-delete predicate. Use `.unscoped()` deliberately.
      modelName: "Role",
      sequelize: db,
    },
  );

  /**
   * Soft-delete a non-system role. Sets is_deleted = true and persists.
   * Throws if the role is a system role (is_system: true).
   */
  Role.prototype.softDelete = async function (this: Role): Promise<Role> {
    // Q-35 (ADR-095): the ATTRIBUTE is `isSystem`. The guard read `is_system`, which is
    // always undefined, so it never fired (roleSoftDelete.q35.test.ts).
    if (this.isSystem) {
      const err = Object.assign(new Error("Cannot soft-delete system roles"), {
        code: "CANNOT_DELETE_SYSTEM_ROLE",
      });
      throw err;
    }
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  /**
   * Restore a soft-deleted role by ID. Sets is_deleted = false.
   */
  Role.restoreStatic = async function (
    this: TypedModel<Role, RoleStatics>,
    id: string,
  ): Promise<[affectedCount: number]> {
    // `isDeleted` is the ATTRIBUTE (column is_deleted via underscored).
    // Model.update intersects its values with attribute names, so the former
    // `{ is_deleted: false }` was dropped and nothing was written (D-07).
    // unscoped(): the defaultScope pins isDeleted = false, which a restore
    // must not inherit; paranoid and the global tenant hooks still apply.
    return this.unscoped().update(
      { isDeleted: false },
      { where: { id, isDeleted: true } },
    );
  };

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  Role.associate = (models: Models): void => {
    // Role -> User (hasMany)
    Role.hasMany(models.User, {
      foreignKey: "roleId",
      as: "users",
      onDelete: "SET NULL",
    });
    // Role -> RoleMenuPermission (hasMany)
    Role.hasMany(models.RoleMenuPermission, {
      foreignKey: "roleId",
      as: "permissions",
      onDelete: "CASCADE",
    });
  };

  return Role;
};

export = defineModel;
