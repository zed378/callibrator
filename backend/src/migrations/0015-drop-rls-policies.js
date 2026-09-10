/**
 * Drop Postgres ROW LEVEL SECURITY tenant-isolation policies.
 *
 * Why: RLS is Postgres-only, which blocks running the platform on multiple
 * database engines, and the policy created by 0012 carried a fail-open branch —
 *
 *     current_setting('app.current_tenant', true) = ''  OR ...
 *
 * — so any connection without the GUC set (a background job, or an
 * authenticated principal with no tenant) matched EVERY tenant's rows.
 *
 * Isolation is now enforced in the ORM layer by utils/tenantScope.util.js:
 * global Sequelize hooks inject a mandatory tenant predicate, deny-by-default,
 * on every dialect.
 *
 * This migration is intentionally NOT wrapped in a blanket try/catch — a
 * silent failure here would leave RLS enforcing on a database whose app layer
 * no longer sets `app.current_tenant`, which would make queries return nothing.
 */
module.exports = {
  async up({ context }) {
    // `context` is the QueryInterface (0011/0012 tolerate the legacy wrapper).
    const queryInterface = context.queryInterface || context;
    const sequelize = queryInterface.sequelize;

    if (sequelize.getDialect() !== "postgres") {
      return;
    }

    // Discover every table still carrying the policy rather than hardcoding a
    // table list that drifts as models are added.
    const [policies] = await sequelize.query(`
      SELECT schemaname, tablename
      FROM pg_policies
      WHERE policyname = 'tenant_isolation_policy'
    `);

    for (const { schemaname, tablename } of policies) {
      const qualified = `"${schemaname}"."${tablename}"`;
      await sequelize.query(
        `DROP POLICY IF EXISTS tenant_isolation_policy ON ${qualified};`,
      );
      await sequelize.query(`ALTER TABLE ${qualified} NO FORCE ROW LEVEL SECURITY;`);
      await sequelize.query(`ALTER TABLE ${qualified} DISABLE ROW LEVEL SECURITY;`);
    }
  },

  async down({ context }) {
    // Deliberately not reinstating RLS: the previous policy was fail-open and
    // Postgres-only. Re-enabling it would reintroduce the isolation bypass.
    // Roll back the application code instead.
    const queryInterface = context.queryInterface || context;
    void queryInterface;
  },
};
