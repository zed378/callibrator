// D-27 (ADR-070): every JSON column declares its shape, validated on write.
// P9-10 (ADR-087 Amendments 7–8): converted from auditLog.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  DataTypes,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import { jsonShape, type AuditLogChanges } from "../utils/jsonShape.util";
import {
  ACTOR_NAME_MAX_LENGTH,
  ACTOR_TYPE_VALUES,
} from "../constants/systemActors";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** The `action` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const AUDIT_LOG_ACTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "APPROVE",
  "EXPORT",
  "ACCOUNT_LOCKED",
  "SIGNATURE_AUTH_FAILED",
] as const;

/** A AuditLog row (attributes, included associations, instance methods). Types only: emits nothing. */
interface AuditLog extends Model<
  InferAttributes<AuditLog>,
  InferCreationAttributes<AuditLog>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  userId: UserId | null;
  /** F-8: the super admin who acted through an impersonation token. */
  impersonatorId: UserId | null;
  /** Migration 0033's actor CHECK ties actorType to userId / actorName. */
  actorType: (typeof ACTOR_TYPE_VALUES)[number];
  actorName: string | null;
  action: (typeof AUDIT_LOG_ACTIONS)[number];
  resourceType: string;
  resourceId: string | null;
  /** JSONB, D-27 shape `AuditLog.changes`: { before, after } snapshots. */
  changes: AuditLogChanges | null;
  ipAddress: string | null;
  userAgent: string | null;
  /** Immutable: `updatedAt: false`, createdAt only. */
  createdAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  user?: NonAttribute<ModelInstance<"User">>;
  impersonator?: NonAttribute<ModelInstance<"User">>;
}

interface AuditLogStatics {
  associate(models: Models): void;
}

type DefineAuditLog = (
  sequelize: Sequelize,
) => TypedModel<AuditLog, AuditLogStatics>;

/** Define the AuditLog model (a fresh class per call). */
const defineModel: DefineAuditLog = (sequelize) => {
  // The class keeps its static (and prototype) members as class members — non-enumerable, as
  // the JavaScript had them. Its name is set to the modelName by init, as before.
  class AuditLogModel extends Model {
    static associate(models: Models): void {
      AuditLog.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        // RESTRICT (W-20, ADR-051 Q-16): deleting a tenant row must never
        // delete its audit trail. Matches migration 0030.
        onDelete: "RESTRICT",
      });
      AuditLog.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
        // RESTRICT (ADR-051 Q-16): a hard delete of an actor is refused rather
        // than erasing WHO from the trail. Users are paranoid, so this blocks
        // only hard deletes. Matches migration 0030.
        onDelete: "RESTRICT",
      });
      // F-8: the super admin who acted through an impersonation token.
      AuditLog.belongsTo(models.User, {
        foreignKey: "impersonatorId",
        as: "impersonator",
        onDelete: "RESTRICT", // as userId; 0029 deferred this to Q-16 (0030)
      });
    }
  }

  const AuditLog = initModel<AuditLog, AuditLogStatics>(
    AuditLogModel,
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "tenants",
          key: "id",
        },
        onDelete: "RESTRICT",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
      },
      // F-8: set when the change was made by a super admin impersonating
      // `userId`; null otherwise. Added to existing databases by migration
      // 0029-audit-log-impersonator.
      impersonatorId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
      },
      // A-124 (ADR-051 Q-13): WHAT acted — a user (`userId`), a system job
      // (`actorName`), or, for rows written before migration 0033 only,
      // `unknown`. Added to existing databases, and backfilled, by 0033,
      // which also adds the CHECK tying the three columns together.
      // audit.service#logAction sets it; nothing else writes this table.
      actorType: {
        type: DataTypes.ENUM(...ACTOR_TYPE_VALUES),
        allowNull: false,
      },
      // A-124: the system job's name, from constants/systemActors.js
      // SYSTEM_ACTORS; NULL for a user row (the user is `userId`).
      actorName: {
        type: DataTypes.STRING(ACTOR_NAME_MAX_LENGTH),
        allowNull: true,
      },
      action: {
        // A-126 (ADR-051 Q-15): the last two are added to existing databases by
        // migration 0049, appended in this order — keep them last.
        type: DataTypes.ENUM(...AUDIT_LOG_ACTIONS),
        allowNull: false,
      },
      resourceType: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      resourceId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      changes: {
        type: DataTypes.JSONB,
        validate: { shape: jsonShape("AuditLog.changes") },
        allowNull: true,
        comment: "Stores { before: {}, after: {} } snapshots of the record",
      },
      ipAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      userAgent: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "AuditLog",
      tableName: "audit_logs",
      timestamps: true,
      updatedAt: false, // Audit logs are immutable, they shouldn't be updated
      underscored: true,
    },
  );

  return AuditLog;
};

export = defineModel;
