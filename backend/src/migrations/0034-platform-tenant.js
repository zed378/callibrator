"use strict";

/**
 * The reserved PLATFORM tenant (A-125, ADR-051 Q-14, F-7).
 *
 * WHAT WAS WRONG
 *
 * `audit_logs.tenant_id` is NOT NULL, and a platform operation — creating or
 * deleting a tenant, changing a global role or its grants — was recorded under
 * the acting super admin's HOME tenant (BR-A41-4). The seeded super admin's
 * home is "Default Hospital Tenant": its admins could read the creation and
 * deletion of every other hospital, with names, in their own trail.
 *
 * WHAT THIS DOES
 *
 * Inserts the PLATFORM tenant row (constants/platformTenant.js) if it is
 * absent, so the audit rows those operations now write have a tenant to
 * reference. The seed (migration.service.js seedPlatformTenant) creates it too.
 * The Tenant model's hooks hide the row from every tenant listing, count and
 * lookup.
 *
 * WHAT THIS DOES NOT DO
 *
 *  - It does not move existing rows. Rows written under the default tenant for
 *    a tenant create or delete, or a global role change, stay where they are:
 *    audit rows are append-only. They are found with
 *      SELECT id, created_at, resource_type, resource_id FROM audit_logs
 *       WHERE tenant_id = 'd3b07384-d113-49cd-a5d6-8ee00d5db6ef'
 *         AND resource_type IN ('Tenant', 'Role')
 *    (a `Role` row is global; a `Tenant` row under the default tenant whose
 *    resource_id is not the default tenant's own id is a platform operation).
 *  - It does not move the super admin. `sys` keeps "Default Hospital Tenant"
 *    as its home (the traps table: tests and x-tenant-id defaults rely on it).
 *
 * REFUSE, DON'T GUESS. The insert would collide with a tenant that already
 * uses the reserved subdomain or code, or a row that already holds the fixed
 * id but is not the PLATFORM tenant (another code, or soft-deleted). In each
 * case the migration throws, naming the row. Which tenant is the real one is
 * not a migration's decision.
 *
 * `tenants` MUST exist — see 0033 for why this throws instead of skipping.
 *
 * IDEMPOTENT: a present, well-formed PLATFORM row is left alone. REVERSIBLE:
 * `down` deletes the row, and refuses while any audit row or user references
 * it (audit_logs.tenant_id is ON DELETE RESTRICT: deleting it would fail
 * anyway, and those rows must not be orphaned by a rollback).
 *
 * No try/catch (CLAUDE.md). Verify with psql:
 *   SELECT id, name, code, subdomain, status FROM tenants WHERE code = 'PLATFORM';
 */

const { PLATFORM_TENANT } = require("../constants/platformTenant");

const TABLE = "tenants";

const one = async (sequelize, transaction, sql, replacements = {}) => {
  const [rows] = await sequelize.query(sql, { transaction, replacements });
  return rows[0];
};

const tablePresent = async (sequelize, transaction, table) =>
  (await one(
    sequelize,
    transaction,
    "SELECT to_regclass(current_schema() || '.' || :table) IS NOT NULL AS present",
    { table },
  )).present;

module.exports = {
  TABLE,
  PLATFORM_TENANT,

  up: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      if (!(await tablePresent(sequelize, transaction, TABLE))) {
        throw new Error(
          `0034: table "${TABLE}" does not exist. Run db.sync() first (the backend does at boot).`,
        );
      }

      const [rows] = await sequelize.query(
        `SELECT id, code, subdomain, deleted_at FROM ${TABLE}
          WHERE id = :id OR subdomain = :subdomain OR code = :code`,
        { transaction, replacements: PLATFORM_TENANT },
      );

      const own = rows.find((r) => r.id === PLATFORM_TENANT.id);
      const others = rows.filter((r) => r.id !== PLATFORM_TENANT.id);
      if (others.length) {
        throw new Error(
          "0034: the PLATFORM tenant's reserved subdomain or code is already used by " +
            others.map((r) => `tenant ${r.id} (code ${r.code}, subdomain ${r.subdomain})`).join("; ") +
            ". Rename that tenant by hand, then re-run. Refusing to guess which is the real one.",
        );
      }
      if (own) {
        if (own.code !== PLATFORM_TENANT.code || own.deleted_at !== null) {
          throw new Error(
            `0034: tenant ${own.id} holds the PLATFORM tenant's reserved id but is not it ` +
              `(code ${own.code}, deleted_at ${own.deleted_at}). Refusing to overwrite it.`,
          );
        }
        return; // already present — a second run, or the seed got there first
      }

      await sequelize.query(
        `INSERT INTO ${TABLE}
           (id, name, subdomain, email, plan, status, code, settings, is_deleted, created_at, updated_at)
         VALUES
           (:id, :name, :subdomain, :email, :plan, :status, :code, '{}'::jsonb, false, now(), now())`,
        { transaction, replacements: PLATFORM_TENANT },
      );
    });
  },

  down: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      if (!(await tablePresent(sequelize, transaction, TABLE))) {
        return;
      }
      const refs = await one(
        sequelize,
        transaction,
        `SELECT (SELECT count(*) FROM audit_logs WHERE tenant_id = :id)::int AS audit,
                (SELECT count(*) FROM users WHERE tenant_id = :id)::int AS users`,
        { id: PLATFORM_TENANT.id },
      );
      if (refs.audit > 0 || refs.users > 0) {
        throw new Error(
          `0034 down: the PLATFORM tenant is referenced by ${refs.audit} audit row(s) and ` +
            `${refs.users} user(s). Audit rows are permanent; refusing to roll back.`,
        );
      }
      await sequelize.query(`DELETE FROM ${TABLE} WHERE id = :id`, {
        transaction,
        replacements: { id: PLATFORM_TENANT.id },
      });
    });
  },
};
