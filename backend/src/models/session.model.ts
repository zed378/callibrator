/**
 * Session Model
 *
 * Persistent authentication session records stored in PostgreSQL.
 * Used for session management, logout, and audit purposes.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from session.model.js with no behaviour
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
import type { TenantId, UserId } from "../types/ids";
import type { DefaultScoped, ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A Session row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Session extends Model<
  InferAttributes<Session>,
  InferCreationAttributes<Session>
> {
  id: CreationOptional<string>;
  /** snake_case attributes, as the model has always named them: `tenantId` on a Session is a compile error (TS2551). */
  user_id: UserId;
  tenant_id: TenantId | null;
  /** A-146: the super admin behind an impersonation session. */
  impersonator_id: UserId | null;
  /** A-160: "saml" | "oidc" for a federated session, else NULL. */
  auth_method: string | null;
  token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  device: string | null;
  expired_at: Date;
  last_activity_at: Date | null;
  is_revoked: CreationOptional<boolean | null>;
  is_active: CreationOptional<boolean | null>;
  revoked_at: Date | null;
  revoked_reason: string | null;
  is_deleted: CreationOptional<boolean>;
  deleted_at: Date | null;
  /** underscored: true keeps the timestamp ATTRIBUTES camelCase (response.util#login reads createdAt). */
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  user?: NonAttribute<ModelInstance<"User">>;
  tenant?: NonAttribute<ModelInstance<"Tenant">>;

  softDelete(): Promise<Session>;
}

interface SessionStatics {
  associate: (models: Models) => void;
  restoreStatic: (id: string) => Promise<[affectedCount: number]>;
  /** D-12: the defaultScope carries a `where`, so a bare include is an INNER JOIN. Phantom: never read at run time. */
  readonly defaultScoped: DefaultScoped;
}

type DefineSession = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<Session, SessionStatics>;

/** Define the Session model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineSession = (db, DataTypes) => {
  const Session = initModel<Session, SessionStatics>(
    class extends Model {},
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      tenant_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "tenants", key: "id" },
        onDelete: "CASCADE",
      },
      // A-146: the super admin behind an impersonation session; NULL for an
      // ordinary one. The refresh reads it back, so a refreshed access token
      // keeps its `impersonatorId` claim — and with it the F-8 attribution and
      // the Part 11 refusal (A-127). Added to existing databases by migration
      // 0040-session-impersonator. snake_case, like every column here.
      impersonator_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      // A-160: "saml" or "oidc" for a session opened by single sign-on, NULL
      // for every other (password, MFA, impersonation, and any session opened
      // before migration 0052-session-auth-method). The refresh re-issues it as
      // the access token's `amr` claim, which the tenant MFA policy reads: a
      // federated session answers to its identity provider's MFA.
      auth_method: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      token_hash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      ip_address: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      user_agent: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      device: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      expired_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      last_activity_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      is_revoked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      revoked_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      revoked_reason: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      deleted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "sessions",
      timestamps: true,
      underscored: true,
      // Sequelize 6 reads no such option, but it sits in model.options, so it is kept (P9-10 spec,
      // item 8). The options type did not reject this unknown key only while the
      // `includeDeleted` scope's own @ts-expect-error sat in the same literal (A-274).
      // @ts-expect-error -- not in InitOptions: Sequelize 6 ignores it; kept so model.options is unchanged (P9-10 spec, item 8)
      underscoredAll: true,
      indexes: [
        { fields: ["token_hash"], unique: true },
        { fields: ["user_id"] },
        { fields: ["tenant_id"] },
        { fields: ["expired_at"] },
        { fields: ["is_revoked", "is_active"] },
        { fields: ["is_deleted"] },
      ],
      defaultScope: {
        where: { is_deleted: false },
      },
      // A-274 (2026-09-30): the unused `includeDeleted` scope was removed — no
      // caller used it, and `.scope(["defaultScope", "includeDeleted"])` would have
      // silently dropped the soft-delete predicate. Use `.unscoped()` deliberately.
      modelName: "Session",
      sequelize: db,
    },
  );

  /**
   * Soft-delete a session. Sets is_deleted = true, records deleted_at timestamp,
   * and persists. Also revokes the session (sets is_revoked = true).
   */
  Session.prototype.softDelete = async function (
    this: Session,
  ): Promise<Session> {
    this.is_deleted = true;
    this.deleted_at = new Date();
    this.is_revoked = true;
    return this.save({ hooks: false });
  };

  /**
   * Restore a soft-deleted session by ID. Sets is_deleted = false and nulls deleted_at.
   */
  Session.restoreStatic = async function (
    this: TypedModel<Session, SessionStatics>,
    id: string,
  ): Promise<[affectedCount: number]> {
    // As built: this.update, not unscoped() — the snake_case where key is the attribute here.
    return this.update(
      { is_deleted: false, deleted_at: null },
      { where: { id, is_deleted: true } },
    );
  };

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  Session.associate = (models: Models): void => {
    // Session -> User
    Session.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
      onDelete: "CASCADE",
    });
    // Session -> Tenant
    Session.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
      onDelete: "CASCADE",
    });
  };

  return Session;
};

export = defineModel;
