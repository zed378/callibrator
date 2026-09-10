module.exports = {
  up: async ({ context }) => {
    const queryInterface = context.queryInterface || context;
    const { DataTypes, Sequelize } = require("sequelize");
    await queryInterface.dropTable('e_signature_records', { cascade: true }).catch(() => {});
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_e_signature_records_action";').catch(() => {});
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_e_signature_records_auth_method";').catch(() => {});
    await queryInterface.createTable('e_signature_records', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenant_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      entity_type: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      entity_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },
      action: {
        type: DataTypes.ENUM('approve', 'sign', 'revoke'),
        allowNull: false,
      },
      meaning: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      auth_method: {
        type: DataTypes.ENUM('password', 'mfa', 'sso'),
        allowNull: false,
      },
      document_hash: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      ip_address: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      user_agent: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      timestamp: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('e_signature_records', ['tenant_id']);
    await queryInterface.addIndex('e_signature_records', ['entity_type', 'entity_id']);
    await queryInterface.addIndex('e_signature_records', ['user_id']);
  },

  down: async ({ context }) => {
    const queryInterface = context.queryInterface || context;
    await queryInterface.dropTable('e_signature_records');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_e_signature_records_action";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_e_signature_records_auth_method";');
  }
};
