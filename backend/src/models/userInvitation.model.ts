/**
 * UserInvitation Model — the single-use invitation of an imported user (P24-09a; ADR-139 § 3 – § 4).
 *
 * Only the SHA-256 of the 43-character token is stored (`tokenHash`, 64 hex): a database dump hands
 * out no working invitation. A user has at most one live row (neither accepted nor revoked — the
 * partial UNIQUE index of migration 0144). Append-mostly, for every role (0144's trigger): a row is
 * inserted, and later EITHER `acceptedAt` OR its three revoke columns are set, once; nothing else is
 * ever updated, and nothing is deleted. The application role has SELECT, INSERT and UPDATE of those
 * four columns only.
 *
 * TENANT-scoped (the hooks). NOT facility-scoped: no bound principal reaches a route that reads it
 * (the user routes are not facility-accessible), and the acceptance — which arrives with no
 * principal — resolves the hash with a reviewed skip of both dimensions. The `tokenHash` UNIQUE
 * index is global — the reviewed exception of ADR-138 § 2 (a hash of a random token is no existence
 * oracle).
 *
 * NOT paranoid, NO defaultScope, no `updated_at`; no index declared (all in 0144, ADR-100 Am. 3).
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import type { UserInvitationRevokedReason } from "@callibrator/contracts/userInvitations";
import type { TenantId, UserId, UserInvitationId } from "../types/ids";
import type { Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A UserInvitation row. Types only: emits nothing. */
interface UserInvitation extends Model<InferAttributes<UserInvitation>, InferCreationAttributes<UserInvitation>> {
  id: CreationOptional<UserInvitationId>;
  tenantId: TenantId;
  userId: UserId;
  /** SHA-256 of the token, lower-case hex. Never returned by any contract. */
  tokenHash: string;
  issuedBy: UserId;
  createdAt: CreationOptional<Date>;
  expiresAt: Date;
  acceptedAt: CreationOptional<Date | null>;
  revokedAt: CreationOptional<Date | null>;
  revokedBy: CreationOptional<UserId | null>;
  revokedReason: CreationOptional<UserInvitationRevokedReason | null>;
}

interface UserInvitationStatics {
  associate: (models: Models) => void;
}

type DefineUserInvitation = (db: Sequelize, DataTypes: typeof DataTypesNamespace) => TypedModel<UserInvitation, UserInvitationStatics>;

const userFk = (DataTypes: typeof DataTypesNamespace, allowNull: boolean) => ({
  type: DataTypes.UUID,
  allowNull,
  references: { model: "users", key: "id" },
  onDelete: "RESTRICT",
  onUpdate: "CASCADE",
});

/** Define the UserInvitation model on `db`. */
const defineModel: DefineUserInvitation = (db, DataTypes) => {
  const UserInvitation = initModel<UserInvitation, UserInvitationStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      userId: userFk(DataTypes, false),
      tokenHash: { type: DataTypes.CHAR(64), allowNull: false },
      issuedBy: userFk(DataTypes, false),
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      acceptedAt: { type: DataTypes.DATE, allowNull: true },
      revokedAt: { type: DataTypes.DATE, allowNull: true },
      revokedBy: userFk(DataTypes, true),
      revokedReason: { type: DataTypes.STRING(16), allowNull: true },
    },
    {
      tableName: "user_invitations",
      timestamps: true,
      updatedAt: false,
      paranoid: false,
      underscored: true,
      modelName: "UserInvitation",
      sequelize: db,
    },
  );

  UserInvitation.associate = (models: Models): void => {
    UserInvitation.belongsTo(models.Tenant, { foreignKey: "tenantId", as: "tenant", onDelete: "RESTRICT" });
    UserInvitation.belongsTo(models.User, { foreignKey: "userId", as: "user", onDelete: "RESTRICT" });
  };

  return UserInvitation;
};

export = defineModel;
