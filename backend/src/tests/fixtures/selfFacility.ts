/**
 * P20-07 (ADR-124 Am. 2 § 4, Am. 3) — the self facility a live suite's raw-SQL tenants need.
 *
 * Since migration 0118 a device written without a facility takes its tenant's SELF facility from
 * the database, and a tenant with none is refused (23502). Every application path that creates a
 * tenant makes one (services/clientFacility#createSelfFacility); a live suite that inserts tenants
 * by raw SQL calls this right after, as a fixture — the trigger is never weakened for a test.
 *
 * Idempotent: one `is_self` facility for every tenant that has none, named as 0117 names it.
 */
export const SELF_FACILITIES_SQL =
  "INSERT INTO client_facilities (id, tenant_id, name, code, kind, is_self, status, created_at, updated_at) " +
  "SELECT gen_random_uuid(), t.id, coalesce(nullif(btrim(left(regexp_replace(btrim(t.name), '\\s+', ' ', 'g'), 255)), ''), 'SELF'), " +
  "'SELF', 'other', true, 'active', now(), now() FROM tenants t " +
  "WHERE NOT EXISTS (SELECT 1 FROM client_facilities f WHERE f.tenant_id = t.id AND f.is_self)";

/** Anything with a Sequelize-shaped `query`. */
interface Queryable {
  query(sql: string, options?: object): Promise<unknown>;
}

/**
 * Give every tenant without one its self facility.
 *
 * @param db - the suite's Sequelize (or anything with `query`)
 * @param options - passed to `query` (e.g. `{ transaction }`)
 */
export const ensureSelfFacilities = async (db: Queryable, options: object = {}): Promise<void> => {
  await db.query(SELF_FACILITIES_SQL, options);
};
