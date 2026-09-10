/**
 * Support Ticket
 *
 * A request raised by a user (the requester) and worked by an agent (the
 * assignee). Tenant-scoped, with a human-friendly incremental key (TKT-1) and a
 * lifecycle: open -> in_progress -> resolved -> closed (reopenable).
 */
const defineModel = (db, DataTypes) => {
  const Ticket = db.define(
    "Ticket",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "CASCADE",
      },
      // Per-tenant sequence number and its rendered key (e.g. 1 / "TKT-1").
      number: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      ticketKey: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      subject: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "open", // open | in_progress | resolved | closed
      },
      priority: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "medium", // low | medium | high | urgent
      },
      category: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: "support", // support | bug | feature | incident | question
      },
      // Requester (who raised it) and agent (who owns it; null = unassigned).
      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      assignedTo: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      dueDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      resolvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      closedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "tickets",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["status"] },
        { fields: ["assigned_to"] },
        { fields: ["created_by"] },
      ],
    },
  );

  Ticket.associate = (models) => {
    Ticket.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
    Ticket.belongsTo(models.User, {
      foreignKey: "created_by",
      as: "requester",
    });
    Ticket.belongsTo(models.User, {
      foreignKey: "assigned_to",
      as: "assignee",
    });
    Ticket.hasMany(models.TicketComment, {
      foreignKey: "ticket_id",
      as: "comments",
      onDelete: "CASCADE",
    });
  };

  return Ticket;
};

module.exports = defineModel;
