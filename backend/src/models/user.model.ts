/**
 * User Model
 *
 * Individual user accounts within tenants.
 * Users have roles for RBAC and belong to tenants.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from user.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
  type UpdateOptions,
} from "sequelize";
import { DEFAULT_UPLOAD_PLACEHOLDER } from "../constants/appConstants";
import { envOr } from "../config/env";
import type { ClientFacilityId, TenantId, UserId } from "../types/ids";
import type { DefaultScoped, ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A User row (attributes, included associations, instance methods). Types only: emits nothing. */
interface User extends Model<
  InferAttributes<User>,
  InferCreationAttributes<User>
> {
  id: CreationOptional<UserId>;
  username: string;
  /** NULL for the platform super admin, who belongs to no tenant. */
  tenantId: TenantId | null;
  roleId: string | null;
  email: string;
  /** A bcrypt hash, never the password. */
  password: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatarUrl: CreationOptional<string>;
  isActive: CreationOptional<boolean | null>;
  /** STRING column (ACTIVE | …), held by the services. */
  status: CreationOptional<string>;
  isEmailVerified: CreationOptional<boolean | null>;
  lastLoginAt: Date | null;
  failedLoginAttempts: CreationOptional<number | null>;
  lockedUntil: Date | null;
  mfaEnabled: CreationOptional<boolean | null>;
  /** S-20: a kms.service envelope of the TOTP seed, never the seed (the hooks refuse plaintext). */
  mfaSecret: string | null;
  /** A-114 / S-20: the secret being enrolled, an envelope. */
  mfaPendingSecret: string | null;
  mfaPendingCreatedAt: Date | null;
  /** A-115: the last accepted TOTP step (replay guard). */
  mfaLastUsedStep: number | null;
  /** A-141: salted SHA-256 hashes of the unused recovery codes. */
  mfaRecoveryCodes: string[] | null;
  /** A-123: an administrator-set password must be changed at first sign-in. */
  mustChangePassword: CreationOptional<boolean>;
  /** A-215: when an administrator's temporary password stops signing in. */
  temporaryPasswordExpiresAt: Date | null;
  /** P10-16 (ADR-099): the password signs in ONCE, then only a password change is possible. */
  passwordOneTime: CreationOptional<boolean>;
  webauthnEnabled: CreationOptional<boolean | null>;
  webauthnCredentialId: string | null;
  webauthnPublicKey: string | null;
  webauthnSignCount: CreationOptional<number | null>;
  otpCode: string | null;
  otpExpiredAt: Date | null;
  otpRequestCount: CreationOptional<number | null>;
  otpLastRequestedAt: Date | null;
  passwordChangedAt: Date | null;
  /**
   * P20-07 (ADR-124 § 4, Am. 2 § 6): set ⇔ the user is BOUND to that client facility of its tenant
   * (sees that facility only — the hooks, P21-09); NULL = unbound (provider staff, a self-served
   * hospital's users — every user that existed before migration 0123). Composite foreign key
   * `(tenant_id, client_facility_id)` → client_facilities RESTRICT (0123). Changed only by the
   * binding operation under `callibrator.facility_binding`; a bound row's role must be one of
   * FACILITY_BOUND_ROLES — both held by 0123's triggers for every role and write path.
   */
  clientFacilityId: CreationOptional<ClientFacilityId | null>;
  /** P20-07 (G-F6, AM-15): a JIT/SCIM user waiting for an administrator to bind it, or confirm it unbound. */
  facilityBindingPending: CreationOptional<boolean>;
  isDeleted: CreationOptional<boolean>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  /** getterMethods (not columns): the avatar URL, or null for the default placeholder. */
  picture: NonAttribute<string | null>;
  first_name: NonAttribute<string>;
  last_name: NonAttribute<string>;

  role?: NonAttribute<ModelInstance<"Role">>;
  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  clientFacility?: NonAttribute<ModelInstance<"ClientFacility"> | null>;
  sessions?: NonAttribute<ModelInstance<"Session">[]>;
  requestedTransfers?: NonAttribute<ModelInstance<"StockTransfer">[]>;
  approvedTransfers?: NonAttribute<ModelInstance<"StockTransfer">[]>;
  adjustments?: NonAttribute<ModelInstance<"StockAdjustment">[]>;
  performedOpnames?: NonAttribute<ModelInstance<"StockOpname">[]>;
  calibrationRecords?: NonAttribute<ModelInstance<"CalibrationRecord">[]>;

  softDelete(): Promise<User>;
}

/** The beforeUpsert hook: the upserted values. */
type UpsertHookUser = (values: unknown) => void;

interface UserStatics {
  associate: (models: Models) => void;
  restoreStatic: (id: string) => Promise<[affectedCount: number]>;
  /** D-12: the defaultScope carries a `where`, so a bare include is an INNER JOIN. Phantom: never read at run time. */
  readonly defaultScoped: DefaultScoped;
}

type DefineUser = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<User, UserStatics>;

/** Define the User model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineUser = (db, DataTypes) => {
  const User = initModel<User, UserStatics>(
    class extends Model {},
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      username: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "tenants", key: "id" },
        onDelete: "RESTRICT",
      },
      roleId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "roles", key: "id" },
        onDelete: "SET NULL",
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { isEmail: true },
      },
      password: { type: DataTypes.STRING(255), allowNull: false },
      firstName: { type: DataTypes.STRING(100), allowNull: false },
      lastName: { type: DataTypes.STRING(100), allowNull: false },
      phone: { type: DataTypes.STRING(50), allowNull: true },
      avatarUrl: {
        type: DataTypes.STRING(1024),
        allowNull: false,
        defaultValue: "default.svg",
      },
      isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "ACTIVE",
      },
      isEmailVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
      lastLoginAt: { type: DataTypes.DATE, allowNull: true },
      // Authentication security fields
      failedLoginAttempts: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      lockedUntil: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Multi-Factor Authentication (TOTP)
      mfaEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      // S-20 (ADR-080): a kms.service envelope of the base32 seed, sealed
      // under the user id (mfa.service#sealSecret) — never the seed. TEXT: an
      // envelope is ~200 characters. Migration 0086 widened the column and
      // encrypted the rows written before; the hooks below refuse plaintext.
      mfaSecret: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // A-114: a secret being enrolled or rotated in. It is NOT the live
      // second factor — nothing signs in with it — until verifyMfaSetup
      // accepts a code from it and promotes it to mfaSecret. Held with the
      // time it was issued; an enrolment older than MFA_PENDING_TTL_MS is
      // refused (auth.service.js). Column added by migration 0028. S-20: an
      // envelope, like mfaSecret (migration 0086).
      mfaPendingSecret: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      mfaPendingCreatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // A-115: the last TOTP time step (floor(epoch / 30)) this account had a
      // code accepted for. A code whose step is <= this is a replay and is
      // refused (mfa.service.js#consumeCode). INTEGER holds steps until the
      // year ~4010. Column added by migration 0028.
      mfaLastUsedStep: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // A-141: SHA-256 hashes (salted with the user id) of the one-time
      // recovery codes issued at MFA enable / rotate. A code is consumed by a
      // conditional update that removes its hash (mfa.service.js
      // #consumeRecoveryCode). Never returned by any endpoint. Migration 0031.
      mfaRecoveryCodes: {
        type: DataTypes.ARRAY(DataTypes.TEXT),
        allowNull: true,
      },
      // A-123 (ADR-051 Q-11): set on an account an administrator created, so
      // the admin-chosen password is changed at first sign-in. While set,
      // auth.middleware refuses every route but change-password, logout and
      // "who am I". Migration 0031.
      mustChangePassword: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // A-215 (ADR-068): when an administrator's temporary password (a create
      // or a reset) stops signing in; null for a password the holder chose.
      // Past it, sign-in is the same 401 as a wrong password. Migration 0078.
      temporaryPasswordExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // P10-16 (ADR-099): a one-time password (the bootstrap super admin's, or
      // one the recovery CLI issued). Its first sign-in clears this and expires
      // the password (bootstrapCredential.service#firstSignIn); the beforeSave
      // hook below clears it whenever the password changes. Migration 0094.
      passwordOneTime: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // WebAuthn (passkeys / security keys)
      webauthnEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      webauthnCredentialId: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      webauthnPublicKey: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Authenticator signature counter, used to detect cloned credentials.
      webauthnSignCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      // OTP fields
      otpCode: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      otpExpiredAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      otpRequestCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      otpLastRequestedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      passwordChangedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // P20-07 (ADR-124 Am. 2): the facility binding. Its composite key and triggers are 0123's.
      clientFacilityId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      facilityBindingPending: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
    },
    {
      tableName: "users",
      timestamps: true,
      paranoid: true,
      underscored: true,
      getterMethods: {
        picture(this: User): string | null {
          const avatar = this.getDataValue("avatarUrl");
          // P9-06: `process.env.HOST_URL || ""`, read at call time, exactly (envOr: unset or "" -> "").
          const baseUrl = envOr("HOST_URL", "");
          // DEFAULT_UPLOAD_PLACEHOLDER means "no avatar uploaded". Building a
          // URL from it yields /uploads/public/profile/default.svg, which 404s —
          // nothing ships that file, and /app/uploads is a volume that would
          // shadow it anyway. Returning null lets the UI render its initials
          // block, which is the intended appearance for a user with no photo.
          if (!avatar || avatar === DEFAULT_UPLOAD_PLACEHOLDER) {
            return null;
          }
          return `${baseUrl}/uploads/public/profile/${avatar}`;
        },
        first_name(this: User): string {
          return this.getDataValue("firstName");
        },
        last_name(this: User): string {
          return this.getDataValue("lastName");
        },
      },
      indexes: [
        { fields: ["username"], unique: true },
        { fields: ["email"], unique: true },
        { fields: ["tenant_id", "email"] },
        { fields: ["tenant_id", "role_id"] },
        { fields: ["status"] },
        { fields: ["is_active"] },
        { fields: ["failed_login_attempts"] },
        { fields: ["is_deleted"] },
      ],
      defaultScope: {
        // @ts-expect-error -- the key is the COLUMN is_deleted, not the attribute isDeleted: a caller's where on is_deleted REPLACES this default only with the column key (P9-10 spec, probe 3; user.service#assertIdentityFree depends on it)
        where: { is_deleted: false },
      },
      // A-274 (2026-09-30): the unused `includeDeleted` scope was removed — no
      // caller used it, and `.scope(["defaultScope", "includeDeleted"])` would have
      // silently dropped the soft-delete predicate. Use `.unscoped()` deliberately.
      modelName: "User",
      sequelize: db,
    },
  );

  // S-20 (ADR-080): the MFA seed columns hold kms.service envelopes only.
  // Every ORM write path is checked, and a plaintext value is REFUSED rather
  // than stored (the writer is mfa.service#sealSecret). `hooks: false` is the
  // only bypass — the same explicit opt-out that bypasses tenant isolation.
  const MFA_SEED_ATTRIBUTES = ["mfaSecret", "mfaPendingSecret"] as const;
  // services/kms.service is required HERE, inside the factory, as the JavaScript did — the same
  // lazy load (it reads the master key ring at load), typed by the one function this model reads.
  // It is TypeScript since P9-18 (ADR-087); the lazy require is kept for the load timing.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require, kept for the load timing
  const { isEnvelope } = require("../services/kms.service") as {
    isEnvelope: (value: unknown) => boolean;
  };
  const refusePlaintextSeed = (
    values: Readonly<Record<string, unknown>> | null | undefined,
    isChanged: (
      attribute: (typeof MFA_SEED_ATTRIBUTES)[number],
    ) => boolean = () => true,
  ): void => {
    for (const attribute of MFA_SEED_ATTRIBUTES) {
      const value = values ? values[attribute] : undefined;
      if (
        value !== undefined &&
        value !== null &&
        isChanged(attribute) &&
        !isEnvelope(value)
      ) {
        throw new Error(
          `User: refusing to store ${attribute} in plaintext (S-20; use mfa.service#sealSecret)`,
        );
      }
    }
  };
  User.beforeSave((user) => {
    refusePlaintextSeed(user.dataValues, (attribute) =>
      user.changed(attribute),
    );
  });
  // P10-16 (ADR-099): a password written without saying it is one-time is not
  // one-time — so every password writer (reset, change, SCIM, SSO) leaves the
  // flag cleared without having to know about it. The bootstrap, the recovery
  // CLI and every administrator-set temporary password set it, in the same
  // save as the password.
  // Amendment 1 (Q-49): the save says so with `{ oneTimePassword: true }` —
  // an instance update drops a field whose value did not change, so a reset of
  // an account that is ALREADY one-time could not be told from an ordinary
  // password change by the attribute alone.
  // The hook receives a save's or an update's options; only this one key is read.
  interface OneTimePasswordOption {
    readonly oneTimePassword?: unknown;
  }
  User.beforeSave((user, options) => {
    if (user.changed("password")) {
      user.passwordOneTime =
        (options as OneTimePasswordOption).oneTimePassword === true ||
        (user.changed("passwordOneTime") && user.passwordOneTime);
    }
  });
  // ADR-108 Amendment 1: `webauthnEnabled` is the derived "has at least one
  // passkey" flag. Whoever turns it OFF — the owner removing every passkey, an
  // administrator's passkey reset, a GDPR erasure — removes the passkeys
  // themselves too, in the same transaction, without having to know the
  // credentials table exists. (An instance save only: a bulk update of the
  // flag does not reach here, and no code does one.)
  User.beforeSave(async (user, options) => {
    if (user.changed("webauthnEnabled") && user.webauthnEnabled !== true && !user.isNewRecord) {
      const credentials = db.models["WebauthnCredential"];
      await credentials?.destroy({ where: { userId: user.id }, transaction: options.transaction ?? null });
    }
  });
  User.beforeBulkCreate((users) => {
    users.forEach((user) => {
      refusePlaintextSeed(user.dataValues);
    });
  });
  // A bulk update's values reach its hooks as `options.attributes` (Sequelize internals; not in its typings).
  User.beforeBulkUpdate((options) => {
    refusePlaintextSeed(
      (
        options as UpdateOptions<InferAttributes<User>> & {
          attributes?: Record<string, unknown>;
        }
      ).attributes,
    );
  });
  // `beforeUpsert` is a Sequelize hook shorthand that exists at run time but is missing from its
  // static typings; the same call, through a typed view of the class.
  (
    User as typeof User & { beforeUpsert: (fn: UpsertHookUser) => void }
  ).beforeUpsert((values) => {
    refusePlaintextSeed(values as Record<string, unknown>);
  });

  /**
   * Soft-delete a user. Sets is_deleted = true and persists.
   */
  User.prototype.softDelete = async function (this: User): Promise<User> {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  /**
   * Restore a soft-deleted user by ID. Sets is_deleted = false.
   */
  User.restoreStatic = async function (
    this: TypedModel<User, UserStatics>,
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
  User.associate = (models: Models): void => {
    // User -> Role
    User.belongsTo(models.Role, {
      foreignKey: "roleId",
      as: "role",
      onDelete: "SET NULL",
    });
    // User -> ClientFacility (P20-07, ADR-124 § 4): the facility a bound user is confined to. The
    // key is COMPOSITE `(tenant_id, client_facility_id)` (migration 0123), so no single-column
    // constraint here. ClientFacility has no defaultScope; an include says `required: false`.
    User.belongsTo(models.ClientFacility, {
      foreignKey: "clientFacilityId",
      as: "clientFacility",
      constraints: false,
    });
    // User -> Tenant
    User.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    // User -> Session (hasMany)
    User.hasMany(models.Session, {
      foreignKey: "user_id",
      as: "sessions",
    });
    // User -> StockTransfer (requestedBy)
    User.hasMany(models.StockTransfer, {
      foreignKey: "requestedBy",
      as: "requestedTransfers",
      onDelete: "RESTRICT",
    });
    // User -> StockTransfer (approvedBy)
    User.hasMany(models.StockTransfer, {
      foreignKey: "approvedBy",
      as: "approvedTransfers",
      onDelete: "SET NULL",
    });
    // User -> StockAdjustment (adjustedBy)
    User.hasMany(models.StockAdjustment, {
      foreignKey: "adjustedBy",
      as: "adjustments",
      onDelete: "RESTRICT",
    });
    // User -> StockOpname (performedBy)
    User.hasMany(models.StockOpname, {
      foreignKey: "performedBy",
      as: "performedOpnames",
      onDelete: "RESTRICT",
    });
    // User -> CalibrationRecord (performedBy)
    // The ATTRIBUTE, not the column: "performed_by" added a second, nullable
    // attribute that sync() built as nullable + SET NULL (A-88 shape; F-6).
    User.hasMany(models.CalibrationRecord, {
      foreignKey: "performedBy",
      as: "calibrationRecords",
      onDelete: "RESTRICT",
    });
  };

  return User;
};

export = defineModel;
