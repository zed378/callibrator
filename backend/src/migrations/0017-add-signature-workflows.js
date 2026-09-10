/**
 * Create the e-Signature workflow tables.
 *
 * eSignature.service.js referenced four models — TenantKey, SignatureWorkflow,
 * SignatureWorkflowStep, SignatureRecord — that were never defined, so every
 * /api/v1/esignature workflow route threw at runtime. This creates their tables.
 *
 * Idempotent: each table is skipped if it already exists, and the Postgres ENUM
 * types are dropped-if-exists first so a re-run cannot collide. Verify in psql
 * afterward — do not trust "migration applied" (a silent createTable no-op would
 * otherwise pass unnoticed).
 */
module.exports = {
  up: async ({ context }) => {
    const queryInterface = context.queryInterface || context;
    const { DataTypes, Sequelize } = require("sequelize");

    const existing = (await queryInterface.showAllTables()).map((t) =>
      (typeof t === "object" ? t.tableName : t).toLowerCase(),
    );
    const has = (name) => existing.includes(name.toLowerCase());

    const stamps = {
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    };

    // Drop leftover ENUM types so a partial prior run cannot collide (Postgres).
    for (const t of [
      "enum_signature_workflows_status",
      "enum_signature_workflow_steps_status",
      "enum_signature_records_status",
    ]) {
      await queryInterface.sequelize
        .query(`DROP TYPE IF EXISTS "${t}";`)
        .catch(() => {});
    }

    if (!has("tenant_keys")) {
      await queryInterface.createTable("tenant_keys", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        tenant_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: "tenants", key: "id" },
          onDelete: "CASCADE",
        },
        key_id: { type: DataTypes.STRING(100), allowNull: false, unique: true },
        key_type: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "esignature" },
        algorithm: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "RS256" },
        public_key: { type: DataTypes.TEXT, allowNull: false },
        private_key: { type: DataTypes.TEXT, allowNull: false },
        ...stamps,
      });
      await queryInterface.addIndex("tenant_keys", ["tenant_id"]);
      await queryInterface.addIndex("tenant_keys", ["key_type"]);
    }

    if (!has("signature_workflows")) {
      await queryInterface.createTable("signature_workflows", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        tenant_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: "tenants", key: "id" },
          onDelete: "CASCADE",
        },
        document_id: { type: DataTypes.STRING(255), allowNull: false },
        subject: { type: DataTypes.STRING(255), allowNull: false, defaultValue: "Please sign this document" },
        message: { type: DataTypes.TEXT, allowNull: true },
        status: {
          type: DataTypes.ENUM("pending", "in_progress", "completed", "cancelled", "expired"),
          allowNull: false,
          defaultValue: "pending",
        },
        expires_at: { type: DataTypes.DATE, allowNull: true },
        signature_algorithm: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "RS256" },
        ...stamps,
      });
      await queryInterface.addIndex("signature_workflows", ["tenant_id"]);
      await queryInterface.addIndex("signature_workflows", ["document_id"]);
      await queryInterface.addIndex("signature_workflows", ["status"]);
    }

    if (!has("signature_workflow_steps")) {
      await queryInterface.createTable("signature_workflow_steps", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        tenant_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: "tenants", key: "id" },
          onDelete: "CASCADE",
        },
        workflow_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: "signature_workflows", key: "id" },
          onDelete: "CASCADE",
        },
        step_number: { type: DataTypes.INTEGER, allowNull: false },
        signer_id: { type: DataTypes.UUID, allowNull: true },
        signer_email: { type: DataTypes.STRING(255), allowNull: false },
        signer_name: { type: DataTypes.STRING(255), allowNull: true },
        status: {
          type: DataTypes.ENUM("waiting", "pending", "signed", "declined"),
          allowNull: false,
          defaultValue: "waiting",
        },
        signed_at: { type: DataTypes.DATE, allowNull: true },
        ip_address: { type: DataTypes.STRING(45), allowNull: true },
        user_agent: { type: DataTypes.STRING(500), allowNull: true },
        ...stamps,
      });
      await queryInterface.addIndex("signature_workflow_steps", ["tenant_id"]);
      await queryInterface.addIndex("signature_workflow_steps", ["workflow_id"]);
      await queryInterface.addIndex("signature_workflow_steps", ["status"]);
    }

    if (!has("signature_records")) {
      await queryInterface.createTable("signature_records", {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        tenant_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: "tenants", key: "id" },
          onDelete: "CASCADE",
        },
        workflow_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: "signature_workflows", key: "id" },
          onDelete: "CASCADE",
        },
        workflow_step_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: "signature_workflow_steps", key: "id" },
          onDelete: "CASCADE",
        },
        user_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: "users", key: "id" },
        },
        signature_hash: { type: DataTypes.STRING(255), allowNull: false },
        signature_algorithm: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "RS256" },
        polygon: { type: DataTypes.JSON, allowNull: true },
        biometric_data: { type: DataTypes.JSON, allowNull: true },
        authentication_method: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "password" },
        signed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
        ip_address: { type: DataTypes.STRING(45), allowNull: true },
        user_agent: { type: DataTypes.STRING(500), allowNull: true },
        status: {
          type: DataTypes.ENUM("signed", "revoked"),
          allowNull: false,
          defaultValue: "signed",
        },
        revoked_at: { type: DataTypes.DATE, allowNull: true },
        revoked_by: { type: DataTypes.UUID, allowNull: true },
        revocation_reason: { type: DataTypes.STRING(500), allowNull: true },
        ...stamps,
      });
      await queryInterface.addIndex("signature_records", ["tenant_id"]);
      await queryInterface.addIndex("signature_records", ["workflow_id"]);
      await queryInterface.addIndex("signature_records", ["workflow_step_id"]);
      await queryInterface.addIndex("signature_records", ["user_id"]);
      await queryInterface.addIndex("signature_records", ["status"]);
    }
  },

  down: async ({ context }) => {
    const queryInterface = context.queryInterface || context;
    // Drop in FK-dependency order (children first).
    for (const table of [
      "signature_records",
      "signature_workflow_steps",
      "signature_workflows",
      "tenant_keys",
    ]) {
      await queryInterface.dropTable(table, { cascade: true }).catch(() => {});
    }
    for (const t of [
      "enum_signature_workflows_status",
      "enum_signature_workflow_steps_status",
      "enum_signature_records_status",
    ]) {
      await queryInterface.sequelize
        .query(`DROP TYPE IF EXISTS "${t}";`)
        .catch(() => {});
    }
  },
};
