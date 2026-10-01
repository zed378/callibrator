/**
 * WebauthnCredential Model — one passkey of one user (ADR-108 Amendment 1).
 *
 * A user may hold several (a phone, a laptop, a security key), each named by
 * the user and revocable on its own. The credential id is globally unique
 * (the authenticator mints it; nobody can choose another's), which is also
 * what the passwordless sign-in looks it up by.
 *
 * NOT tenant-scoped by column: a CHILD of its user (`userId`). Every read or
 * write names the owning user — the signed-in caller, or the account the
 * pre-authentication lookup found by credential id — so isolation is the
 * user's (unscopedModels.d17, group `child`). A user in another tenant asking
 * for this row's id finds no row of theirs: 404.
 *
 * Replaces the one-per-user `users.webauthn_*` columns; migration 0104 moves
 * the enrolled credentials here. `users.webauthn_enabled` stays as the derived
 * "has at least one passkey" flag the rest of the code reads.
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";
import { jsonShape, type PasskeyTransports } from "../utils/jsonShape.util";

/** A WebauthnCredential row. Types only: emits nothing. */
interface WebauthnCredential extends Model<
  InferAttributes<WebauthnCredential>,
  InferCreationAttributes<WebauthnCredential>
> {
  id: CreationOptional<string>;
  userId: string;
  /** base64url, as the authenticator reports it. */
  credentialId: string;
  /** The COSE public key, base64url. Not a secret; still never logged or audited. */
  publicKey: string;
  signCount: CreationOptional<number>;
  /** The user's label ("Pixel 8", "YubiKey"). */
  name: string;
  /** The authenticator's transports hint, as registration reported it. */
  transports: CreationOptional<PasskeyTransports>;
  lastUsedAt: CreationOptional<Date | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  user?: NonAttribute<ModelInstance<"User">>;
}

interface WebauthnCredentialStatics {
  associate: (models: Models) => void;
}

type DefineWebauthnCredential = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<WebauthnCredential, WebauthnCredentialStatics>;

const defineModel: DefineWebauthnCredential = (db, DataTypes) => {
  const WebauthnCredential = initModel<WebauthnCredential, WebauthnCredentialStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      credentialId: { type: DataTypes.STRING(512), allowNull: false, unique: true },
      publicKey: { type: DataTypes.TEXT, allowNull: false },
      signCount: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      name: { type: DataTypes.STRING(64), allowNull: false },
      transports: {
        type: DataTypes.JSONB,
        allowNull: true,
        // D-27: the WebAuthn transport names, or null.
        validate: { shape: jsonShape("WebauthnCredential.transports") },
      },
      lastUsedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "webauthn_credentials",
      timestamps: true,
      paranoid: false,
      underscored: true,
      indexes: [{ fields: ["user_id"] }],
      modelName: "WebauthnCredential",
      sequelize: db,
    },
  );

  WebauthnCredential.associate = (models: Models): void => {
    // `User` has a defaultScope: an include must say `required: false` (A-75).
    WebauthnCredential.belongsTo(models.User, { foreignKey: "userId", as: "user", onDelete: "CASCADE" });
  };

  return WebauthnCredential;
};

export = defineModel;
