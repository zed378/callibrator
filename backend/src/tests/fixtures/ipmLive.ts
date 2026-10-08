/**
 * SQL builders for the IPM aggregate's live suites (P20-04 / P20-05: inspectionSessions.p2004.live,
 * inspectionImmutable.p2005.live, deviceMove.p2007.live). Plain statements with `:name`
 * replacements — the rows a P21-03 service will write, written directly so the DATABASE's answer
 * (keys, CHECKs, triggers, grants) is what the suites see.
 *
 * Synthetic values only; no upstream data.
 */

/** Base checklist version 1, seeded by migration 0112 with a fixed id (published). */
export const BASE_VERSION = "5eedca7a-0000-4000-8000-000000000002";

/** A well-formed lower-case SHA-256 hex (the stored report content hash of the suites' sessions). */
export const HASH = "ab".repeat(32);

/** Another one, for a signature that binds the wrong document. */
export const OTHER_HASH = "cd".repeat(32);

/** INSERT a root draft (or a correction draft, with `supersedes` + `reason`) captured by `user`. */
export const draftSql = (opts: { supersedes?: boolean; clientRef?: boolean; facility?: boolean } = {}): string =>
  `INSERT INTO inspection_sessions (id, tenant_id, ${opts.facility ? "client_facility_id, " : ""}device_id, template_version_id,
     created_by, performed_by, ${opts.supersedes ? "supersedes_id, correction_reason, " : ""}${opts.clientRef ? "client_ref, " : ""}created_at, updated_at)
   VALUES (:id, :tenant, ${opts.facility ? ":facility, " : ""}:device, '${BASE_VERSION}', :user, :user,
     ${opts.supersedes ? ":supersedes, 'Koreksi tanggal', " : ""}${opts.clientRef ? ":clientRef, " : ""}now(), now())`;

/** UPDATE a draft to `submitted`, with every field the issued-fields CHECK and the submit require. */
export const submitSql = `UPDATE inspection_sessions SET status = 'submitted', submitted_at = now(), submitted_by = created_by,
     visit_number = :visit, performer_snapshot = '{"name": "Teknisi Sintetis", "role": "TECHNICIAN", "organisation": null}',
     device_snapshot = '{}', facility_snapshot = '{}', report_number = :reportNumber, verification_token = :token,
     report_content_hash = '${HASH}', report_hash_scheme = 'ipm-report-v1', issuer_snapshot = '{"version": 1}',
     inspection_outcome = 'pass', maintenance_outcome = 'pass', recommendation = 'fit_for_use', updated_at = now()
   WHERE id = :id`;

/** INSERT an ad-hoc result (no template item needed) in `tools_used`, at `sort`. */
export const resultSql = `INSERT INTO inspection_results (id, tenant_id, session_id, section, input_kind, is_ad_hoc, label_snapshot,
     outcome, sort_order, created_at, updated_at)
   VALUES (:resultId, :tenant, :session, 'tools_used', 'check', true, 'Alat ukur sintetis', 'done', :sort, now(), now())`;

/** INSERT a signature of `kind` by `signer`, binding `hash`. */
export const signatureSql = `INSERT INTO inspection_session_signatures (id, tenant_id, session_id, kind, signer_id, signer_snapshot,
     meaning, auth_method, document_hash, created_at)
   VALUES (:signatureId, :tenant, :session, :kind, :signer, '{"name": "Penandatangan Sintetis", "role": null, "organisation": null}',
     CASE WHEN :kind = 'performer' THEN 'authorship' ELSE 'review' END::enum_inspection_session_signatures_meaning,
     'password', :hash, now())`;

/** The tenant, roles, users, facilities and devices every IPM suite starts from. */
export const seedSql = (ids: {
  tenant: string;
  role: string;
  users: readonly string[];
  facilities: readonly (readonly [id: string, code: string])[];
  devices: readonly (readonly [id: string, facility: string, serial: string])[];
  tag: string;
}): string[] => [
  `INSERT INTO roles (id, name, created_at, updated_at) VALUES ('${ids.role}', 'SYNTHETIC ${ids.tag.toUpperCase()}', now(), now())`,
  `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
   VALUES ('${ids.tenant}', 'Penyedia IPM Sintetis ${ids.tag}', '${ids.tag}', '${ids.tag}@example.test', now(), now())`,
  ...ids.users.map(
    (user, n) =>
      `INSERT INTO users (id, tenant_id, role_id, username, email, password, first_name, last_name, created_at, updated_at)
       VALUES ('${user}', '${ids.tenant}', '${ids.role}', '${ids.tag}u${String(n)}', '${ids.tag}u${String(n)}@example.test', 'x', 'T', '${String(n)}', now(), now())`,
  ),
  ...ids.facilities.map(
    ([id, code]) =>
      `INSERT INTO client_facilities (id, tenant_id, name, code, kind, created_at, updated_at)
       VALUES ('${id}', '${ids.tenant}', 'Fasilitas ${code}', '${code}', 'hospital', now(), now())`,
  ),
  ...ids.devices.map(
    ([id, facility, serial]) =>
      `INSERT INTO calibration_devices (id, tenant_id, client_facility_id, name, serial_number, created_at, updated_at)
       VALUES ('${id}', '${ids.tenant}', '${facility}', 'Alat sintetis ${serial}', '${serial}', now(), now())`,
  ),
];

/** The application role 0057 creates. */
export const APP_ROLE = "callibrator_app";

/** One result row of a raw query. */
export type Row = Record<string, unknown>;

/** The transaction a live suite holds. */
export interface LiveTx {
  rollback(): Promise<void>;
  commit(): Promise<void>;
}

/** The members of the real `db` a live suite uses. */
export interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  transaction(): Promise<LiveTx>;
  close(): Promise<void>;
  sync(): Promise<unknown>;
  getQueryInterface(): unknown;
}

/** The error `sql` raises inside a savepoint of `t` (as `role`; null = the owner): "<code> <message>", or null. */
export const errorOf = async (
  db: LiveDb,
  t: LiveTx,
  sql: string,
  replacements: object = {},
  role: string | null = APP_ROLE,
): Promise<string | null> => {
  await db.query("SAVEPOINT probe", { transaction: t });
  try {
    if (role) {
      await db.query(`SET LOCAL ROLE ${role}`, { transaction: t });
    }
    await db.query(sql, { transaction: t, replacements });
    await db.query("RESET ROLE", { transaction: t });
    await db.query("RELEASE SAVEPOINT probe", { transaction: t });
    return null;
  } catch (err) {
    await db.query("ROLLBACK TO SAVEPOINT probe", { transaction: t });
    await db.query("RESET ROLE", { transaction: t });
    const e = err as { parent?: { code?: string; message?: string } };
    return `${e.parent?.code ?? "?"} ${e.parent?.message ?? String(err)}`;
  }
};

/** Run `sql` in `t` as `role` (default the application role), keeping its effect; returns the error or null. */
export const runAs = (db: LiveDb, t: LiveTx, sql: string, replacements: object = {}, role: string | null = APP_ROLE): Promise<string | null> =>
  errorOf(db, t, sql, replacements, role);

/** The rows of `sql`. */
export const rows = async (db: LiveDb, sql: string, replacements: object = {}, transaction?: LiveTx): Promise<Row[]> =>
  (await db.query(sql, { replacements, transaction }))[0];

/** Run `work` in a transaction that is always rolled back. */
export const inRolledBack = async (db: LiveDb, work: (t: LiveTx) => Promise<void>): Promise<void> => {
  const t = await db.transaction();
  try {
    await work(t);
  } finally {
    await t.rollback();
  }
};
