const path = require('path');

module.exports = {
  async up({ context }) {
    // `context` is the QueryInterface. Tolerate the legacy { queryInterface }
    // wrapper this file used to assume, as 0011 already does.
    const queryInterface = context.queryInterface || context;

    if (queryInterface.sequelize.getDialect() !== 'postgres') {
      return;
    }

    const tableNames = [
      'users',
      'sessions',
      'warehouses',
      'storage_locations',
      'stocks',
      'stock_transfers',
      'stock_adjustments',
      'stock_opnames',
      'calibration_devices',
      'calibration_records',
      'certificates',
      'vendor_documents',
      'vendors',
      'maintenance_work_orders',
      'notifications',
      'subscriptions',
      'invoices',
      'audit_logs',
      'attachments',
      'webhooks',
      'webhook_deliveries',
      'api_keys',
      'workflows',
      'workflow_steps',
      'workflow_instances',
      'workflow_actions',
      'posts',
      'categories',
      'post_categories',
      'capas',
      'non_conformances',
      'sop_documents',
      'sop_training_acknowledgments',
      'e_signature_records',
      'iot_readings',
      'risks',
      'supplier_scorecards',
      'asset_finances',
      'batch_jobs',
      'tenant_backups',
      'tenant_settings',
    ];

    for (const tableName of tableNames) {
      try {
        await queryInterface.sequelize.query(`
          ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY;
        `);

        await queryInterface.sequelize.query(`
          ALTER TABLE "${tableName}" FORCE ROW LEVEL SECURITY;
        `);

        await queryInterface.sequelize.query(`
          DROP POLICY IF EXISTS tenant_isolation_policy ON "${tableName}";
        `);

        await queryInterface.sequelize.query(`
          CREATE POLICY tenant_isolation_policy ON "${tableName}"
          USING (
            current_setting('app.current_tenant', true) = '' OR
            current_setting('app.current_tenant', true) = 'SUPER_ADMIN' OR
            tenant_id::text = current_setting('app.current_tenant', true)
          );
        `);

        console.log(`RLS policy applied to ${tableName}`);
      } catch (err) {
        console.warn(`RLS setup skipped for ${tableName}: ${err.message}`);
      }
    }
  },

  async down({ context }) {
    const queryInterface = context.queryInterface || context;

    if (queryInterface.sequelize.getDialect() !== 'postgres') {
      return;
    }

    const tableNames = [
      'users',
      'sessions',
      'warehouses',
      'storage_locations',
      'stocks',
      'stock_transfers',
      'stock_adjustments',
      'stock_opnames',
      'calibration_devices',
      'calibration_records',
      'certificates',
      'vendor_documents',
      'vendors',
      'maintenance_work_orders',
      'notifications',
      'subscriptions',
      'invoices',
      'audit_logs',
      'attachments',
      'webhooks',
      'webhook_deliveries',
      'api_keys',
      'workflows',
      'workflow_steps',
      'workflow_instances',
      'workflow_actions',
      'posts',
      'categories',
      'post_categories',
      'capas',
      'non_conformances',
      'sop_documents',
      'sop_training_acknowledgments',
      'e_signature_records',
      'iot_readings',
      'risks',
      'supplier_scorecards',
      'asset_finances',
      'batch_jobs',
      'tenant_backups',
      'tenant_settings',
    ];

    for (const tableName of tableNames) {
      try {
        await queryInterface.sequelize.query(`
          DROP POLICY IF EXISTS tenant_isolation_policy ON "${tableName}";
        `);

        await queryInterface.sequelize.query(`
          ALTER TABLE "${tableName}" DISABLE ROW LEVEL SECURITY;
        `);

        console.log(`RLS policy removed from ${tableName}`);
      } catch (err) {
        console.warn(`RLS removal skipped for ${tableName}: ${err.message}`);
      }
    }
  }
};
