const { Model, DataTypes } = require("sequelize");
const { ACTOR_TYPE_VALUES, ACTOR_NAME_MAX_LENGTH } = require("../constants/systemActors");

module.exports = (sequelize) => {
  class AuditLog extends Model {
    static associate(models) {
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

  AuditLog.init(
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
        type: DataTypes.ENUM(
          "CREATE",
          "UPDATE",
          "DELETE",
          "LOGIN",
          "APPROVE",
          "EXPORT",
          "ACCOUNT_LOCKED",
          "SIGNATURE_AUTH_FAILED",
        ),
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
