/**
 * P24-02b (ADR-129 Am. 4) — the transform's users step on a REAL PostgreSQL 18, on the transform
 * role's own connection (never as the owner):
 *
 *  - migration 0135: down / up / up rebuilds the same objects; the transform role's grants on
 *    `users` are COLUMN-level — it cannot read a password, an MFA secret or a recovery code, nor
 *    change an e-mail, a role or a binding;
 *  - P18-01-02 § 2.2 on synthetic accounts: staff unbound; one HEALTHCARE ADMIN per facility (the
 *    earliest ACTIVE client), the others ROOM USER, an inactive one imported inactive;
 *    HEALTHCARE TECHNICIAN; every quarantine reason; a taken username suffixed; the bound-role
 *    trigger satisfied; one unusable hash, `must_change_password`;
 *  - audit rows for users only (a group mapped to its role writes none), each in its facility;
 *  - a re-run of the same values writes nothing; a changed name updates the profile, never the e-mail.
 *
 * Synthetic values only (example.test, `Sintetis`); nothing from upstream.
 *
 *   docker run -d --name p2402-pg18 -e POSTGRES_PASSWORD=p2402pass -p 127.0.0.1:56231:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=56231 DB_USER=postgres DB_PASS=p2402pass npm run test:live -- --only=p2402b
 *   docker rm -f p2402-pg18
 */
import type { Transaction } from "sequelize";
import { env } from "../../config/env";
import type { StepContext, TransformStep } from "../../services/upstreamImport/transform/steps";
import type * as StepsModule from "../../services/upstreamImport/transform/steps";
import type * as LedgerModule from "../../services/upstreamImport/transform/ledger";
import type * as RunnerModule from "../../services/upstreamImport/transform/runner";
import type * as ConfigModule from "../../config/upstreamImport";

const IMPORT_ROLE = "callibrator_import";
const TRANSFORM_ROLE = "callibrator_transform";
const PROVIDER = "a2402000-0000-4000-8000-0000000000a1";
const OTHER = "a2402000-0000-4000-8000-0000000000a2";
const RUN_1 = "a2402000-0000-4000-8000-0000000000e1";
const RUN_2 = "a2402000-0000-4000-8000-0000000000e2";
const RUN_3 = "a2402000-0000-4000-8000-0000000000e3";

type Row = Record<string, unknown>;
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  transaction(): Promise<Transaction>;
  transaction<T>(fn: (t: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  getQueryInterface(): unknown;
}
interface Migration {
  up(o: { context: unknown }): Promise<void>;
  down(o: { context: unknown }): Promise<void>;
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

/* eslint-disable @typescript-eslint/no-require-imports -- the graph is loaded after the environment is set; typed by the members used */
const load = () => ({
  db: (require("../../config") as { db: LiveDb }).db,
  models: require("../../models") as unknown,
  migrator: (require("../../config/migrator") as { migrator: { pending(): Promise<unknown[]> } }).migrator,
  migrationLock: require("../../utils/migrationLock.util") as { runSchemaSetup(options: object): Promise<unknown> },
  steps: require("../../services/upstreamImport/transform/steps") as typeof StepsModule,
  ledger: require("../../services/upstreamImport/transform/ledger") as typeof LedgerModule,
  runner: require("../../services/upstreamImport/transform/runner") as typeof RunnerModule,
  config: require("../../config/upstreamImport") as typeof ConfigModule,
  m0135: require("../../migrations/0135-upstream-transform-users") as Migration,
});
/* eslint-enable @typescript-eslint/no-require-imports */

/** [id, email, username, fullname, active, created_at]. */
type UserRow = readonly [number, string, string | null, string | null, number, string | null];
const USERS: readonly UserRow[] = [
  [10, "Admin@Example.test", "admin.sintetis", "Admin  Sintetis Satu", 1, "2023-01-01 09:00:00"],
  [11, "teknisi@example.test", null, "", 1, "2023-01-02 09:00:00"],
  [12, "rs1.a@example.test", "rs1a", "Klien Satu", 1, "2024-01-01 09:00:00"],
  [13, "rs1.b@example.test", "rs1b", "Klien Lama", 0, "2023-12-01 09:00:00"],
  [14, "rs1.c@example.test", "rs1c", "Klien Tiga", 1, "2024-02-01 09:00:00"],
  [15, "rs2.t@example.test", "rs2t", "Teknisi Faskes", 1, null],
  [16, "rs3.a@example.test", "rs3a", "Tanpa Alat", 1, null],
  [17, "nomap@example.test", "nomap", "Tanpa Pemetaan", 1, null],
  [18, "nogroup@example.test", "nogroup", "Tanpa Grup", 1, null],
  [19, "both@example.test", "both", "Dua Grup", 1, null],
  [20, "existing@example.test", "dupmail", "Surel Terpakai", 1, null],
  [21, "taken.name@example.test", "taken", "Nama Terpakai", 1, null],
];
/** [group id, user id]. */
const MEMBERSHIPS: readonly (readonly [number, number])[] = [
  [1, 10], [5, 10], [2, 11], [3, 12], [3, 13], [3, 14], [4, 15], [3, 16], [3, 17], [1, 19], [2, 19], [1, 20], [2, 21],
];
/** [id, user id, facility id]. */
const MAPPINGS: readonly (readonly [number, number, number])[] = [[31, 12, 1], [32, 13, 1], [33, 14, 1], [34, 15, 2], [35, 16, 3]];

describe("P24-02b — the users step on live PostgreSQL 18, as the transform role", () => {
  jest.setTimeout(300_000);
  let g: ReturnType<typeof load>;
  let transformDb: LiveDb;

  const rows = async (sql: string): Promise<Row[]> => (await g.db.query(sql))[0];

  const errorAs = async (role: string, sql: string): Promise<string | null> => {
    const t = await g.db.transaction();
    try {
      await g.db.query(`SET LOCAL ROLE ${role}`, { transaction: t });
      await g.db.query(sql, { transaction: t });
      return null;
    } catch (err) {
      const e = err as { parent?: { code?: string; message?: string } };
      return `${e.parent?.code ?? "?"} ${e.parent?.message ?? String(err)}`;
    } finally {
      await t.rollback();
    }
  };

  const asImport = async (...statements: string[]): Promise<void> => {
    const t = await g.db.transaction();
    await g.db.query(`SET LOCAL ROLE ${IMPORT_ROLE}`, { transaction: t });
    for (const statement of statements) {
      await g.db.query(statement, { transaction: t });
    }
    await t.commit();
  };

  const lit = (value: string | number | null): string => (value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replace(/'/g, "''")}'`);
  const values = (run: string, list: readonly (readonly (string | number | null)[])[]): string =>
    list.map((r, i) => `('${run}', ${String(i + 1)}, ${r.map(lit).join(", ")})`).join(", ");

  /** Stage the synthetic world for `run`; `rename` changes a user's fullname. */
  const stage = (run: string, rename: Readonly<Record<number, string>> = {}): Promise<void> =>
    asImport(
      `INSERT INTO upstream_import.stg_mst_faskes (import_run_id, source_row_number, id, name_faskes) VALUES
         ${values(run, [[1, "RS Sintetis Satu"], [2, "Klinik Sintetis Dua"], [3, "Puskesmas Tanpa Alat"]])}`,
      `INSERT INTO upstream_import.stg_trx_inventory (import_run_id, source_row_number, id, id_client) VALUES ${values(run, [[101, 1], [102, 2]])}`,
      `INSERT INTO upstream_import.stg_auth_groups (import_run_id, source_row_number, id, name, description) VALUES
         ${values(run, [[1, "admin", null], [2, "user", null], [3, "client", null], [4, "teknisi_client", null], [5, "auditor", null]])}`,
      `INSERT INTO upstream_import.stg_users (import_run_id, source_row_number, id, email, username, fullname, active, created_at, updated_at) VALUES
         ${values(run, USERS.map(([id, email, username, fullname, active, created]) => [id, email, username, rename[id] ?? fullname, active, created, null]))}`,
      `INSERT INTO upstream_import.stg_auth_groups_users (import_run_id, source_row_number, group_id, user_id) VALUES ${values(run, MEMBERSHIPS)}`,
      `INSERT INTO upstream_import.stg_trx_mapping_user_client (import_run_id, source_row_number, id, id_user, id_client) VALUES ${values(run, MAPPINGS)}`,
    );

  const devicesStub = (): TransformStep => ({
    id: "devices_stub",
    writes: ["calibration_devices"],
    sources: [{ table: "trx_inventory", legacyId: 's."id"::text' }],
    run: async (context: StepContext) => {
      const source = { table: "trx_inventory", legacyId: 's."id"::text' };
      const staged = await g.ledger.classify(context, source);
      await g.ledger.quarantineRows(
        context,
        staged.map((r) => ({ sourceTable: "trx_inventory", sourceRowNumber: r.sourceRowNumber, legacyId: r.legacyId, reason: "no_device" as const })),
      );
    },
  });

  const steps = (): TransformStep[] => {
    const byId = (id: string): TransformStep => g.steps.TRANSFORM_STEPS.find((s) => s.id === id) as TransformStep;
    return [byId("client_facilities"), byId("users"), devicesStub(), byId("audit_logs")];
  };

  const transform = (runId: string) =>
    g.runner.runTransform({ runId, db: transformDb, runner: transformDb, role: TRANSFORM_ROLE, tenantId: PROVIDER, sourceZone: "Asia/Jakarta", steps: steps() });

  const imported = (): Promise<Row[]> =>
    rows(
      `SELECT u.username, u.email, u.first_name, u.last_name, r.name AS role, f.code AS facility, u.is_active, u.status,
              u.must_change_password, u.is_email_verified, u.awaiting_invitation, u.password LIKE '$2%' AS bcrypt, (u.created_at AT TIME ZONE 'UTC')::text AS created
         FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN client_facilities f ON f.id = u.client_facility_id
        WHERE u.tenant_id = '${PROVIDER}' ORDER BY u.username`,
    );

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to build a schema in DB_NAME="${name}": use a scratch database (see the header)`);
    }
    g = load();
    g.db.options.logging = false;
    await g.migrationLock.runSchemaSetup({ sequelize: g.db, migrator: g.migrator, logger });
    expect(await g.migrator.pending()).toEqual([]);
    await g.db.query(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES
         ('${PROVIDER}', 'Penyedia Kalibrasi Sintetis', 'p2402b-penyedia', 'penyedia@example.test', now(), now()),
         ('${OTHER}', 'Tenant Lain Sintetis', 'p2402b-lain', 'lain@example.test', now(), now())`,
    );
    await g.db.query(
      `INSERT INTO client_facilities (id, tenant_id, name, code, is_self, created_at, updated_at) VALUES
         (gen_random_uuid(), '${PROVIDER}', 'Penyedia Kalibrasi Sintetis', 'SELF', true, now(), now()),
         (gen_random_uuid(), '${OTHER}', 'Tenant Lain Sintetis', 'SELF', true, now(), now())`,
    );
    // The roles P18-01 assigns (the application's seed makes them; a migrated scratch database has none).
    await g.db.query(
      `INSERT INTO roles (id, name, created_at, updated_at)
       SELECT gen_random_uuid(), n, now(), now()
         FROM unnest(ARRAY['CALIBRATOR ADMIN', 'TECHNICIAN', 'ROOM USER', 'HEALTHCARE TECHNICIAN', 'HEALTHCARE ADMIN']) AS n
        WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.name = n)`,
    );
    // Accounts that already exist elsewhere: their e-mail and username are taken platform-wide.
    await g.db.query(
      `INSERT INTO users (id, tenant_id, role_id, username, email, password, first_name, last_name, created_at, updated_at)
       SELECT gen_random_uuid(), '${OTHER}', r.id, v.username, v.email, 'x', 'Sintetis', 'Lain', now(), now()
         FROM (VALUES ('someone', 'EXISTING@example.test'), ('Taken', 'taken.other@example.test')) AS v(username, email)
         JOIN roles r ON r.name = 'TECHNICIAN'`,
    );
    await asImport(
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_faskes (import_run_id uuid NOT NULL, source_row_number bigint NOT NULL,
         id integer, name_faskes varchar(255), phone varchar(50), address varchar(255), created_at timestamp, updated_at timestamp,
         PRIMARY KEY (import_run_id, source_row_number))`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_trx_inventory (import_run_id uuid NOT NULL, source_row_number bigint NOT NULL,
         id integer, id_client integer, PRIMARY KEY (import_run_id, source_row_number))`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_auth_groups (import_run_id uuid NOT NULL, source_row_number bigint NOT NULL,
         id integer, name varchar(255), description varchar(255), PRIMARY KEY (import_run_id, source_row_number))`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_users (import_run_id uuid NOT NULL, source_row_number bigint NOT NULL,
         id integer, email varchar(255), username varchar(30), fullname varchar(50), active smallint, created_at timestamp, updated_at timestamp,
         PRIMARY KEY (import_run_id, source_row_number))`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_auth_groups_users (import_run_id uuid NOT NULL, source_row_number bigint NOT NULL,
         group_id integer, user_id integer, PRIMARY KEY (import_run_id, source_row_number))`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_trx_mapping_user_client (import_run_id uuid NOT NULL, source_row_number bigint NOT NULL,
         id integer, id_user integer, id_client integer, PRIMARY KEY (import_run_id, source_row_number))`,
    );
    transformDb = g.config.createTransformDb() as unknown as LiveDb;
  });

  afterAll(async () => {
    await transformDb.close();
    await g.db.close();
  });

  it("0135: down / up / up rebuilds the same column grants and reasons", async () => {
    const objects = (): Promise<Row[]> =>
      rows(
        `SELECT table_name || ':' || privilege_type || ':' || column_name AS o FROM information_schema.column_privileges
          WHERE grantee = '${TRANSFORM_ROLE}' AND table_name IN ('users', 'roles')
         UNION ALL SELECT 'c:' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'quarantine_reason_vocabulary'
         ORDER BY 1`,
      );
    const before = await objects();
    const grants = before.map((r) => String(r["o"])).filter((o) => !o.startsWith("c:"));
    expect(grants.filter((o) => o.startsWith("roles:"))).toEqual(["roles:SELECT:id", "roles:SELECT:name"]);
    expect(grants.filter((o) => o.startsWith("users:UPDATE:"))).toEqual([
      "users:UPDATE:first_name",
      "users:UPDATE:is_active",
      "users:UPDATE:last_name",
      "users:UPDATE:status",
      "users:UPDATE:updated_at",
    ]);
    // 0135's four, plus the registrant's printed name, role and facility that 0139 grants (P24-02e).
    expect(grants.filter((o) => o.startsWith("users:SELECT:"))).toEqual([
      "users:SELECT:client_facility_id",
      "users:SELECT:email",
      "users:SELECT:first_name",
      "users:SELECT:id",
      "users:SELECT:last_name",
      "users:SELECT:role_id",
      "users:SELECT:tenant_id",
      "users:SELECT:username",
    ]);
    expect(String(before.find((r) => String(r["o"]).startsWith("c:"))?.["o"])).toContain("'user_not_imported'");
    await g.m0135.down({ context: g.db.getQueryInterface() });
    // Only 0139's four SELECT columns on users (P24-02e) and 0143's INSERT of awaiting_invitation
    // (P24-08) remain; 0135's own grants are gone.
    expect(await rows(`SELECT count(*)::int AS n FROM information_schema.column_privileges WHERE grantee = '${TRANSFORM_ROLE}' AND table_name IN ('users', 'roles')`)).toEqual([
      { n: 5 },
    ]);
    await g.m0135.up({ context: g.db.getQueryInterface() });
    await g.m0135.up({ context: g.db.getQueryInterface() });
    expect(await objects()).toEqual(before);
  });

  it("the transform role cannot read a credential or change an identity or binding", async () => {
    for (const column of ["password", "mfa_secret", "mfa_recovery_codes", "otp_code", "webauthn_public_key"]) {
      expect([column, await errorAs(TRANSFORM_ROLE, `SELECT ${column} FROM users LIMIT 1`)]).toEqual([column, expect.stringMatching(/^42501 permission denied for table users/)]);
    }
    // P24-08: nor reopen (or close) an account awaiting its invitation — INSERT on it, never UPDATE.
    for (const set of ["email = email", "username = username", "role_id = role_id", "client_facility_id = client_facility_id", "password = 'x'", "awaiting_invitation = false"]) {
      expect([set, await errorAs(TRANSFORM_ROLE, `UPDATE users SET ${set} WHERE false`)]).toEqual([set, expect.stringMatching(/^42501/)]);
    }
    expect(await errorAs(TRANSFORM_ROLE, "DELETE FROM users WHERE false")).toMatch(/^42501/);
    expect(await errorAs(TRANSFORM_ROLE, "SELECT id, tenant_id, username, email FROM users LIMIT 1")).toBeNull();
  });

  it("the first transform: roles and bindings by P18-01-02 § 2.2; every quarantine reason; one unusable hash; audit rows for users only", async () => {
    await stage(RUN_1);
    const summary = await transform(RUN_1);
    const usersStep = summary.steps.find((s) => s.step === "users");
    expect(usersStep?.sources.map((s) => [s.table, s.staged, s.mapped, s.quarantined])).toEqual([
      ["users", 12, 7, { email_in_use: 1, facility_mapping_ambiguous: 1, facility_not_imported: 1, group_conflict: 1, user_without_group: 1 }],
      ["auth_groups", 5, 4, { unknown_group: 1 }],
      ["auth_groups_users", 13, 7, { unknown_group: 1, user_not_imported: 5 }],
      ["trx_mapping_user_client", 5, 4, { user_not_imported: 1 }],
    ]);
    const users = await imported();
    expect(users.map((u) => [u["username"], u["role"], u["facility"], u["is_active"]])).toEqual([
      ["admin.sintetis", "CALIBRATOR ADMIN", null, true],
      ["rs1a", "HEALTHCARE ADMIN", "F-0001", true],
      ["rs1b", "ROOM USER", "F-0001", false],
      ["rs1c", "ROOM USER", "F-0001", true],
      ["rs2t", "HEALTHCARE TECHNICIAN", "F-0002", true],
      ["taken_2", "TECHNICIAN", null, true],
      ["teknisi", "TECHNICIAN", null, true],
    ]);
    expect(users.every((u) => u["must_change_password"] === true && u["is_email_verified"] === false && u["bcrypt"] === true)).toBe(true);
    // P24-08 (ADR-139 § 2): every imported account, active or not, awaits its invitation.
    expect(users.map((u) => u["awaiting_invitation"])).toEqual(users.map(() => true));
    expect(users.find((u) => u["username"] === "admin.sintetis")).toMatchObject({ email: "admin@example.test", first_name: "Admin Sintetis", last_name: "Satu" });
    expect(users.find((u) => u["username"] === "teknisi")).toMatchObject({ first_name: "teknisi", last_name: "" });
    expect(users.find((u) => u["username"] === "rs1a")).toMatchObject({ status: "ACTIVE", created: "2024-01-01 02:00:00" });
    expect(users.find((u) => u["username"] === "rs1b")).toMatchObject({ status: "INACTIVE" });
    expect(await rows(`SELECT count(DISTINCT password)::int AS n FROM users WHERE tenant_id = '${PROVIDER}'`)).toEqual([{ n: 1 }]);
    expect(await rows("SELECT legacy_id, reason FROM upstream_import.quarantine WHERE source_table = 'users' ORDER BY legacy_id")).toEqual([
      { legacy_id: "16", reason: "facility_not_imported" },
      { legacy_id: "17", reason: "facility_mapping_ambiguous" },
      { legacy_id: "18", reason: "user_without_group" },
      { legacy_id: "19", reason: "group_conflict" },
      { legacy_id: "20", reason: "email_in_use" },
    ]);
    expect(await rows("SELECT count(*)::int AS n FROM upstream_import.id_map WHERE source_table = 'users' AND source_values IS NOT NULL")).toEqual([{ n: 0 }]);
    const audits = await rows(
      `SELECT a.resource_type, count(*)::int AS n, count(a.client_facility_id)::int AS bound FROM audit_logs a
        WHERE a.actor_name = 'system:upstream-transform' GROUP BY 1 ORDER BY 1`,
    );
    expect(audits).toEqual([
      { resource_type: "ClientFacility", n: 2, bound: 2 },
      { resource_type: "User", n: 7, bound: 4 },
    ]);
  });

  it("the same values again: nothing written, no audit row; a changed name updates the profile and never the e-mail", async () => {
    const auditCount = async (): Promise<number> =>
      Number((await rows("SELECT count(*)::int AS n FROM audit_logs WHERE actor_name = 'system:upstream-transform'"))[0]?.["n"]);
    const before = await auditCount();
    await stage(RUN_2);
    const again = await transform(RUN_2);
    expect(again.steps.find((s) => s.step === "users")?.sources[0]).toMatchObject({ staged: 12, mapped: 0, unchanged: 7 });
    expect(await auditCount()).toBe(before);
    await stage(RUN_3, { 10: "Admin Sintetis Baru" });
    const changed = await transform(RUN_3);
    expect(changed.steps.find((s) => s.step === "users")?.sources[0]).toMatchObject({ mapped: 1, unchanged: 6 });
    expect((await imported()).find((u) => u["username"] === "admin.sintetis")).toMatchObject({ email: "admin@example.test", first_name: "Admin Sintetis", last_name: "Baru" });
    expect(await rows("SELECT action::text AS action, resource_type FROM audit_logs WHERE actor_name = 'system:upstream-transform' ORDER BY created_at DESC LIMIT 1")).toEqual([
      { action: "UPDATE", resource_type: "User" },
    ]);
    expect(await auditCount()).toBe(before + 1);
  });
});
