/**
 * P20-07 against a REAL PostgreSQL 18 — migrations 0117 – 0123, the client-facility dimension
 * (ADR-124 Am. 2, Am. 3; spec MEMORY/specs/P19-04-client-facilities.md § 4 – § 6; the G-25 row of
 * docs/SECURITY/15 § 11). Every refusal is asserted AS `callibrator_app` (SET LOCAL ROLE), and the
 * triggers' again as the OWNER — never only as the owner (CLAUDE.md, Evidence).
 *
 * One scratch database:
 *
 *  A. FAIL-BEFORE (the fresh path: today's models' sync() has made the columns, no migration has
 *     made a control): the application role writes a device into another tenant's facility, moves a
 *     record to another facility, binds a user to a facility with a non-facility role — nothing
 *     refuses.
 *  B. The pre-P20-07 schema (the columns and tables sync() made are dropped — what 0116 left on an
 *     upgraded database) is SEEDED with realistic data: four tenants (one soft-deleted) besides
 *     PLATFORM, users, devices (some soft-deleted), calibration records (some voided), certificates
 *     (with and without a record), work orders, IoT readings, non-conformances (with and without a
 *     device), warehouses, attachments of every kind (linked to each facility-scoped type, a kanban
 *     card, standalone, an orphan whose record is gone).
 *  C. 0117 – 0123 up, then (describe blocks named after the spec's G-25 files):
 *     selfFacility        — exactly one self facility per tenant (PLATFORM and the soft-deleted one
 *                           included), its normalised name, one audit row each;
 *     facilityBackfill    — every row back-filled to its tenant's self facility, reconciled per
 *                           table AND per tenant against the seed; the nullable set exactly NULL
 *                           where § 5.1 says;
 *     facilityNotNull     — NOT NULL where § 5.1 says; schemaVerify (every control object); every
 *                           trigger ENABLE ALWAYS;
 *     facilityCompositeFk — a child naming another facility than its device's, a device naming
 *                           another tenant's facility, a certificate whose record is in another
 *                           facility (at COMMIT): refused;
 *     insertDefault (Am. 3) — the existing create paths keep working: a device written without a
 *                           facility gets the self facility while the tenant has no other, and is
 *                           refused (23502) once it has; children, attachments and NCs take theirs;
 *     checks              — every CHECK and unique of 0117 / 0123;
 *     facilityImmutable   — the facility column refused on all seven tables for the app role AND
 *                           the owner, with no move, a garbage setting, or a move of another device;
 *     usersBinding        — the binding guard and the bound-role trigger;
 *     endedFacilityInsert — no new device, record, certificate, work order, NC or attachment in an
 *                           ended facility; IoT telemetry still lands (spec § 5.4);
 *     attachmentFacilityTrigger — AM-7 refuses at COMMIT, not at the statement;
 *     moveLog             — append-only, no DELETE/TRUNCATE, never committed in progress;
 *  D. a REBOOT in a fresh module graph (sync() — showIndex on every new index, the 0109 class — the
 *     migrator applies nothing, the schema check is clean);
 *  E. every down refuses while a facility beyond the self ones exists; with none, down × 7 then
 *     up × 7: the data intact, the same objects, the back-fill reconciled again.
 *
 *   docker run -d --name p2007-pg18 -e POSTGRES_PASSWORD=p2007pass -p 127.0.0.1:55207:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=55207 DB_NAME=p2007_scratch DB_USER=postgres DB_PASS=p2007pass \
 *     npm run test:live:jest -- src/tests/migrations/clientFacilities.p2007.live
 *   docker rm -f p2007-pg18
 */
import { Sequelize } from "sequelize";
import { env } from "../../config/env";

const APP_ROLE = "callibrator_app";
const PLATFORM = "00000000-0000-4000-8000-000000000001";
const T1 = "b2007000-0000-4000-8000-000000000001";
const T2 = "b2007000-0000-4000-8000-000000000002";
const T3 = "b2007000-0000-4000-8000-000000000003";
const TDEL = "b2007000-0000-4000-8000-000000000004";
const TENANTS = [T1, T2, T3, TDEL];
const ROLE_HT = "b2007000-0000-4000-8000-0000000000a1";
const ROLE_SUP = "b2007000-0000-4000-8000-0000000000a2";
const F1 = "b2007000-0000-4000-8000-0000000000f1";
const F2 = "b2007000-0000-4000-8000-0000000000f2";
const FB = "b2007000-0000-4000-8000-0000000000fb";
const NEW_DEVICE = "b2007000-0000-4000-8000-0000000000d1";
const NEW_DEVICE_2 = "b2007000-0000-4000-8000-0000000000d2";
const NEW_RECORD = "b2007000-0000-4000-8000-0000000000e1";
const NO_FACILITY_ID = "00000000-0000-0000-0000-00000000f000";
const DEVICES_PER_TENANT = 12;

/** A deterministic synthetic id: md5 of a label, as a UUID. */
const id = (label: string): string => `md5('${label}')::uuid`;

type Row = Record<string, unknown>;
interface LiveTx {
  rollback(): Promise<void>;
  commit(): Promise<void>;
}
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  transaction(): Promise<LiveTx>;
  close(): Promise<void>;
  sync(): Promise<unknown>;
  getQueryInterface(): unknown;
}
interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<{ name: string }[]>; down(options?: object): Promise<{ name: string }[]> };
  schemaVerify: { verifySchema(db: unknown): Promise<{ problems: string[]; objects: number }>; EXPECTED_OBJECTS: readonly unknown[] };
}

/* eslint-disable @typescript-eslint/no-require-imports -- the graph is loaded per "process" with jest.isolateModules; typed by the members used */
const startProcess = (): Graph => {
  let graph: Graph | undefined;
  jest.isolateModules(() => {
    const db = (require("../../config") as { db: LiveDb }).db;
    db.options.logging = false;
    require("../../models");
    graph = {
      db,
      migrator: (require("../../config/migrator") as { migrator: Graph["migrator"] }).migrator,
      schemaVerify: require("../../utils/schemaVerify.util") as Graph["schemaVerify"],
    };
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** The PostgreSQL error `sql` raises inside a savepoint of `t` (as `role`, when given): "<code> <message>", or null. */
const errorOf = async (db: LiveDb, t: LiveTx, sql: string, replacements: object = {}, role: string | null = APP_ROLE) => {
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

/** Run `sql` as the application role, keeping its effect (it must succeed). */
const asApp = async (db: LiveDb, t: LiveTx, sql: string, replacements: object = {}): Promise<void> => {
  expect(await errorOf(db, t, sql, replacements, APP_ROLE)).toBeNull();
};

const rows = async (db: LiveDb, sql: string, replacements: object = {}, transaction?: LiveTx): Promise<Row[]> =>
  (await db.query(sql, { replacements, transaction }))[0];

const inRolledBack = async (db: LiveDb, work: (t: LiveTx) => Promise<void>): Promise<void> => {
  const t = await db.transaction();
  try {
    await work(t);
  } finally {
    await t.rollback();
  }
};

/** The COMMIT error of a transaction (deferred constraints fire there), or null. */
const commitError = async (db: LiveDb, work: (t: LiveTx) => Promise<void>): Promise<string | null> => {
  const t = await db.transaction();
  await work(t);
  try {
    await t.commit();
    return null;
  } catch (err) {
    const e = err as { parent?: { code?: string; message?: string }; original?: { code?: string; message?: string } };
    const p = e.parent ?? e.original;
    return `${p?.code ?? "?"} ${p?.message ?? String(err)}`;
  }
};

/** The tables P20-07 adds a facility to, and the columns/tables sync() made that 0116 never had. */
const P2007_COLUMNS: readonly (readonly [string, string])[] = [
  ["audit_logs", "client_facility_id"],
  ["calibration_devices", "client_facility_id"],
  ["calibration_records", "client_facility_id"],
  ["certificates", "client_facility_id"],
  ["maintenance_work_orders", "client_facility_id"],
  ["iot_readings", "client_facility_id"],
  ["attachments", "client_facility_id"],
  ["attachments", "rekey_pending"],
  ["non_conformances", "client_facility_id"],
  ["warehouses", "client_facility_id"],
  ["users", "client_facility_id"],
  ["users", "facility_binding_pending"],
];
const NOT_NULL = ["calibration_devices", "calibration_records", "certificates", "maintenance_work_orders", "iot_readings"];
/** The migrations after P20-07's, applied by C and reverted first by E1 (0124 — P20-06 — onward). */
let later: string[] = [];
const P2007_MIGRATIONS = [
  "0117-client-facilities.js",
  "0118-facility-devices.js",
  "0119-facility-calibration-records.js",
  "0120-facility-certificates.js",
  "0121-facility-work-orders.js",
  "0122-facility-iot-readings.js",
  "0123-facility-nullable.js",
];

/** The seed: realistic, synthetic, set-based. Every id is md5 of a label. */
const seedSql = (): string[] => {
  const out: string[] = [
    `INSERT INTO roles (id, name, created_at, updated_at) VALUES ('${ROLE_HT}', 'HEALTHCARE TECHNICIAN', now(), now()), ('${ROLE_SUP}', 'SUPERVISOR', now(), now())`,
    `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES
       ('${T1}', 'Rumah Sakit Sintetis Satu', 'p2007-satu', 'satu@example.test', now(), now()),
       ('${T2}', '  Klinik   Sintetis  Dua ', 'p2007-dua', 'dua@example.test', now(), now()),
       ('${T3}', 'Puskesmas Sintetis Tiga', 'p2007-tiga', 'tiga@example.test', now(), now())`,
    `INSERT INTO tenants (id, name, subdomain, email, is_deleted, deleted_at, created_at, updated_at) VALUES
       ('${TDEL}', 'Laboratorium Sintetis Lama', 'p2007-lama', 'lama@example.test', true, now(), now(), now())`,
  ];
  for (const [n, tenant] of TENANTS.entries()) {
    const t = `t${String(n)}`;
    out.push(
      `INSERT INTO users (id, tenant_id, role_id, username, email, password, first_name, last_name, created_at, updated_at)
       SELECT ${id(`${t}-user-' || g || '`)}, '${tenant}', '${ROLE_SUP}', '${t}user' || g, '${t}user' || g || '@example.test', 'x', 'Synthetic', 'User', now(), now()
         FROM generate_series(1, 3) g`,
      `INSERT INTO warehouses (id, tenant_id, name, code, created_at, updated_at)
       SELECT ${id(`${t}-wh-' || g || '`)}, '${tenant}', 'Gudang ' || g, '${t}W' || g, now(), now() FROM generate_series(1, 2) g`,
      `INSERT INTO calibration_devices (id, tenant_id, name, serial_number, is_deleted, deleted_at, created_at, updated_at)
       SELECT ${id(`${t}-dev-' || g || '`)}, '${tenant}', 'Alat Sintetis ' || g, 'SN-${t}-' || g, g % 6 = 0, CASE WHEN g % 6 = 0 THEN now() END, now(), now()
         FROM generate_series(1, ${String(DEVICES_PER_TENANT)}) g`,
      `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, is_deleted, void_reason, created_at, updated_at)
       SELECT ${id(`${t}-rec-' || g || '-' || r || '`)}, '${tenant}', ${id(`${t}-dev-' || g || '`)}, ${id(`${t}-user-1`)}, now(),
              r = 3, CASE WHEN r = 3 THEN 'Synthetic void' END, now(), now()
         FROM generate_series(1, ${String(DEVICES_PER_TENANT)}) g, generate_series(1, 3) r`,
      `INSERT INTO certificates (id, tenant_id, device_id, calibration_record_id, certificate_number, verification_token, created_at, updated_at)
       SELECT ${id(`${t}-cert-' || g || '`)}, '${tenant}', ${id(`${t}-dev-' || g || '`)},
              CASE WHEN g % 2 = 0 THEN ${id(`${t}-rec-' || g || '-1`)} END,
              'CERT-${t}-' || g, substr(md5('${t}-token-' || g) || md5('x'), 1, 32), now(), now()
         FROM generate_series(1, ${String(DEVICES_PER_TENANT)}) g`,
      `INSERT INTO maintenance_work_orders (id, tenant_id, device_id, title, created_at, updated_at)
       SELECT ${id(`${t}-wo-' || g || '-' || w || '`)}, '${tenant}', ${id(`${t}-dev-' || g || '`)}, 'Perawatan ' || w, now(), now()
         FROM generate_series(1, ${String(DEVICES_PER_TENANT)}) g, generate_series(1, 2) w`,
      `INSERT INTO iot_readings (id, tenant_id, device_id, timestamp, metrics, created_at)
       SELECT ${id(`${t}-iot-' || g || '-' || i || '`)}, '${tenant}', ${id(`${t}-dev-' || g || '`)}, now() - i * interval '1 minute', '{"t": 21}', now()
         FROM generate_series(1, ${String(DEVICES_PER_TENANT)}) g, generate_series(1, 10) i`,
      `INSERT INTO non_conformances (id, tenant_id, nc_number, title, description, reported_by, device_id, date_identified, created_at, updated_at)
       SELECT ${id(`${t}-nc-' || g || '`)}, '${tenant}', 'NC-${t}-' || g, 'Temuan', 'Sintetis', ${id(`${t}-user-1`)},
              CASE WHEN g <= 5 THEN ${id(`${t}-dev-' || g || '`)} END, now(), now(), now()
         FROM generate_series(1, 8) g`,
      // Attachments: linked to each facility-scoped type (mixed case), a kanban card, standalone, an orphan.
      `INSERT INTO attachments (id, tenant_id, resource_type, resource_id, file_name, original_name, created_at, updated_at) VALUES
         (${id(`${t}-att-device`)}, '${tenant}', 'device', ${id(`${t}-dev-1`)}, 'a', 'a.jpg', now(), now()),
         (${id(`${t}-att-cdevice`)}, '${tenant}', 'CalibrationDevice', ${id(`${t}-dev-6`)}, 'b', 'b.jpg', now(), now()),
         (${id(`${t}-att-cert`)}, '${tenant}', 'Certificate', ${id(`${t}-cert-2`)}, 'c', 'c.pdf', now(), now()),
         (${id(`${t}-att-rec`)}, '${tenant}', 'calibrationrecord', ${id(`${t}-rec-2-1`)}, 'd', 'd.pdf', now(), now()),
         (${id(`${t}-att-cal`)}, '${tenant}', 'calibration', ${id(`${t}-rec-3-3`)}, 'e', 'e.pdf', now(), now()),
         (${id(`${t}-att-wo`)}, '${tenant}', 'workOrder', ${id(`${t}-wo-1-1`)}, 'f', 'f.jpg', now(), now()),
         (${id(`${t}-att-mwo`)}, '${tenant}', 'MaintenanceWorkOrder', ${id(`${t}-wo-2-2`)}, 'g', 'g.jpg', now(), now()),
         (${id(`${t}-att-kanban`)}, '${tenant}', 'KanbanCard', ${id(`${t}-kanban-1`)}, 'h', 'h.png', now(), now()),
         (${id(`${t}-att-generic`)}, '${tenant}', 'generic', NULL, 'i', 'i.png', now(), now()),
         (${id(`${t}-att-unlinked`)}, '${tenant}', 'device', NULL, 'j', 'j.png', now(), now()),
         (${id(`${t}-att-orphan`)}, '${tenant}', 'Certificate', ${id(`${t}-cert-gone`)}, 'k', 'k.pdf', now(), now())`,
      `INSERT INTO audit_logs (id, tenant_id, actor_type, actor_name, action, resource_type, created_at)
       SELECT ${id(`${t}-audit-' || g || '`)}, '${tenant}', 'system', 'system:calibration-scan', 'CREATE', 'MaintenanceWorkOrder', now() FROM generate_series(1, 4) g`,
    );
  }
  return out;
};

/** Per table, per tenant, the seed's row counts — and the linked attachments that take a facility. */
const EXPECTED_PER_TENANT: Readonly<Record<string, number>> = {
  calibration_devices: DEVICES_PER_TENANT,
  calibration_records: DEVICES_PER_TENANT * 3,
  certificates: DEVICES_PER_TENANT,
  maintenance_work_orders: DEVICES_PER_TENANT * 2,
  iot_readings: DEVICES_PER_TENANT * 10,
};

jest.setTimeout(900000);

describe("P20-07 — migrations 0117 – 0123 on live PostgreSQL 18", () => {
  let g: Graph;
  let admin: Sequelize;
  const self: Record<string, string> = {};

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to rebuild DB_NAME="${name}": use a scratch database (see the header)`);
    }
    admin = new Sequelize("postgres", env("DB_USER") ?? "", env("DB_PASS") ?? "", {
      host: env("DB_HOST") ?? "",
      port: Number(env("DB_PORT") ?? "5432"),
      dialect: "postgres",
      logging: false,
    });
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
    g = startProcess();
    await g.db.sync();
    await g.migrator.up({ to: "0116-upstream-sql-import-menu.js" });
  });

  afterAll(async () => {
    await g.db.close();
    await admin.close();
  });

  it("A. FAIL-BEFORE (sync() alone made the columns, no control): the application role crosses facilities and tenants unrefused", async () => {
    await inRolledBack(g.db, async (t) => {
      await g.db.query(`INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES ('${T1}', 'A', 'fa', 'fa@example.test', now(), now()), ('${T2}', 'B', 'fb', 'fb@example.test', now(), now())`, { transaction: t });
      await g.db.query(`INSERT INTO client_facilities (id, tenant_id, name, code, created_at, updated_at) VALUES ('${FB}', '${T2}', 'Fasilitas B', 'F-B', now(), now())`, { transaction: t });
      // A device of tenant 1 in tenant 2's facility: accepted.
      await asApp(g.db, t, `INSERT INTO calibration_devices (id, tenant_id, name, client_facility_id, created_at, updated_at) VALUES ('${NEW_DEVICE}', '${T1}', 'x', '${FB}', now(), now())`);
      // Its facility rewritten at will: accepted.
      await asApp(g.db, t, `UPDATE calibration_devices SET client_facility_id = '${NO_FACILITY_ID}' WHERE id = '${NEW_DEVICE}'`);
      // A second "self" facility: accepted.
      await asApp(g.db, t, `INSERT INTO client_facilities (id, tenant_id, name, code, is_self, created_at, updated_at) VALUES ('${F1}', '${T2}', 'Lagi', 'F-C', true, now(), now()), ('${F2}', '${T2}', 'Lagi 2', 'F-D', true, now(), now())`);
    });
  });

  it("B. the pre-P20-07 schema (what 0116 left on an upgraded database), seeded with realistic data", async () => {
    for (const [table, column] of P2007_COLUMNS) {
      await g.db.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
    await g.db.query("DROP TABLE client_facility_moves");
    await g.db.query("DROP TABLE client_facilities");
    await g.db.query('DROP TYPE "enum_client_facilities_kind", "enum_client_facilities_status", "enum_client_facility_moves_status"');
    for (const statement of seedSql()) {
      await g.db.query(statement);
    }
    expect(await rows(g.db, "SELECT count(*)::int AS n FROM tenants")).toEqual([{ n: 5 }]);
    expect(await rows(g.db, "SELECT count(*)::int AS n FROM attachments")).toEqual([{ n: 44 }]);
  });

  it("C. 0117 – 0123 up: exactly the seven, in order, each recorded", async () => {
    const applied = await g.migrator.up({ to: "0123-facility-nullable.js" });
    expect(applied.map((m) => m.name)).toEqual(P2007_MIGRATIONS);
    // The migrations after P20-07's (0124, P20-06, onward) complete the boot path; E reverts them first.
    later = (await g.migrator.up()).map((m) => m.name);
    expect(later.every((name) => name > "0123-facility-nullable.js")).toBe(true);
    for (const row of await rows(g.db, "SELECT tenant_id, id FROM client_facilities WHERE is_self")) {
      self[String(row["tenant_id"])] = String(row["id"]);
    }
  });

  describe("selfFacility.p2007 — one self facility per tenant", () => {
    it("every tenant — PLATFORM and the soft-deleted one included — has exactly one, active, code SELF, its name normalised", async () => {
      expect(await rows(g.db, "SELECT count(*)::int AS tenants, (SELECT count(*)::int FROM client_facilities) AS facilities FROM tenants")).toEqual([{ tenants: 5, facilities: 5 }]);
      const facilities = await rows(
        g.db,
        "SELECT t.id AS tenant, f.name, f.code, f.kind::text, f.status::text, f.is_self FROM tenants t JOIN client_facilities f ON f.tenant_id = t.id ORDER BY t.id",
      );
      expect(facilities).toEqual([
        { tenant: PLATFORM, name: "Callibrator Platform", code: "SELF", kind: "other", status: "active", is_self: true },
        { tenant: T1, name: "Rumah Sakit Sintetis Satu", code: "SELF", kind: "other", status: "active", is_self: true },
        { tenant: T2, name: "Klinik Sintetis Dua", code: "SELF", kind: "other", status: "active", is_self: true },
        { tenant: T3, name: "Puskesmas Sintetis Tiga", code: "SELF", kind: "other", status: "active", is_self: true },
        { tenant: TDEL, name: "Laboratorium Sintetis Lama", code: "SELF", kind: "other", status: "active", is_self: true },
      ]);
    });

    it("one CREATE audit row per facility, in its own tenant, stamped with it, under system:client-facility-backfill", async () => {
      const audit = await rows(
        g.db,
        `SELECT a.tenant_id, a.actor_type::text, a.actor_name, a.action::text, a.client_facility_id, a.changes->>'operation' AS op
           FROM audit_logs a WHERE a.resource_type = 'ClientFacility' ORDER BY a.tenant_id`,
      );
      expect(audit).toEqual(
        [PLATFORM, T1, T2, T3, TDEL].map((tenant) => ({
          tenant_id: tenant,
          actor_type: "system",
          actor_name: "system:client-facility-backfill",
          action: "CREATE",
          client_facility_id: self[tenant],
          op: "CREATE_SELF_FACILITY",
        })),
      );
    });
  });

  describe("facilityBackfill.p2007 — every row to its tenant's self facility, reconciled", () => {
    it.each(NOT_NULL)("%s: per tenant, every seeded row and only its tenant's self facility", async (table) => {
      const counted = await rows(
        g.db,
        `SELECT x.tenant_id, count(*)::int AS n, count(*) FILTER (WHERE x.client_facility_id = f.id)::int AS own
           FROM ${table} x JOIN client_facilities f ON f.tenant_id = x.tenant_id AND f.is_self GROUP BY x.tenant_id ORDER BY x.tenant_id`,
      );
      expect(counted).toEqual(TENANTS.map((tenant) => ({ tenant_id: tenant, n: EXPECTED_PER_TENANT[table], own: EXPECTED_PER_TENANT[table] })).sort((a, b) => a.tenant_id.localeCompare(b.tenant_id)));
      expect(await rows(g.db, `SELECT count(*)::int AS n FROM ${table} WHERE client_facility_id IS NULL`)).toEqual([{ n: 0 }]);
    });

    it("non_conformances: the five with a device in its facility, the three without NULL — per tenant", async () => {
      const counted = await rows(
        g.db,
        `SELECT n.tenant_id, count(*) FILTER (WHERE n.client_facility_id = f.id AND n.device_id IS NOT NULL)::int AS own,
                count(*) FILTER (WHERE n.client_facility_id IS NULL AND n.device_id IS NULL)::int AS none, count(*)::int AS n
           FROM non_conformances n JOIN client_facilities f ON f.tenant_id = n.tenant_id AND f.is_self GROUP BY n.tenant_id`,
      );
      expect(counted).toHaveLength(4);
      expect(counted.every((r) => r["own"] === 5 && r["none"] === 3 && r["n"] === 8)).toBe(true);
    });

    it("attachments: the seven linked to a facility-scoped type (the orphan to the self facility) carry it; kanban, standalone and unlinked stay NULL", async () => {
      const attachments = await rows(
        g.db,
        `SELECT a.resource_type, a.resource_id IS NULL AS unlinked, a.client_facility_id = f.id AS own, a.client_facility_id IS NULL AS none, a.rekey_pending
           FROM attachments a JOIN client_facilities f ON f.tenant_id = a.tenant_id AND f.is_self WHERE a.tenant_id = :t ORDER BY a.file_name`,
        { t: T2 },
      );
      expect(attachments).toEqual([
        { resource_type: "device", unlinked: false, own: true, none: false, rekey_pending: false },
        { resource_type: "CalibrationDevice", unlinked: false, own: true, none: false, rekey_pending: false },
        { resource_type: "Certificate", unlinked: false, own: true, none: false, rekey_pending: false },
        { resource_type: "calibrationrecord", unlinked: false, own: true, none: false, rekey_pending: false },
        { resource_type: "calibration", unlinked: false, own: true, none: false, rekey_pending: false },
        { resource_type: "workOrder", unlinked: false, own: true, none: false, rekey_pending: false },
        { resource_type: "MaintenanceWorkOrder", unlinked: false, own: true, none: false, rekey_pending: false },
        { resource_type: "KanbanCard", unlinked: false, own: null, none: true, rekey_pending: false },
        { resource_type: "generic", unlinked: true, own: null, none: true, rekey_pending: false },
        { resource_type: "device", unlinked: true, own: null, none: true, rekey_pending: false },
        { resource_type: "Certificate", unlinked: false, own: true, none: false, rekey_pending: false },
      ]);
      expect(await rows(g.db, "SELECT count(*)::int AS n FROM attachments WHERE client_facility_id IS NOT NULL")).toEqual([{ n: 32 }]);
    });

    it("users stay UNBOUND, warehouses the provider's store, the audit trail's past rows NULL (no back-fill)", async () => {
      expect(await rows(g.db, "SELECT count(*)::int AS n, count(client_facility_id)::int AS bound, count(*) FILTER (WHERE facility_binding_pending)::int AS pending FROM users")).toEqual([{ n: 12, bound: 0, pending: 0 }]);
      expect(await rows(g.db, "SELECT count(*)::int AS n, count(client_facility_id)::int AS f FROM warehouses")).toEqual([{ n: 8, f: 0 }]);
      expect(await rows(g.db, "SELECT count(*)::int AS n FROM audit_logs WHERE client_facility_id IS NULL AND resource_type = 'MaintenanceWorkOrder'")).toEqual([{ n: 16 }]);
    });
  });

  describe("facilityNotNull.p2007 — the columns, the controls, the schema check", () => {
    it("NOT NULL on the five evidence tables, nullable on the rest; rekey_pending / facility_binding_pending NOT NULL DEFAULT false", async () => {
      const columns = await rows(
        g.db,
        `SELECT table_name || '.' || column_name AS c, is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = current_schema() AND column_name IN ('client_facility_id', 'rekey_pending', 'facility_binding_pending') ORDER BY 1`,
      );
      const byColumn = Object.fromEntries(columns.map((c) => [String(c["c"]), c["is_nullable"]]));
      for (const table of NOT_NULL) {
        expect(byColumn[`${table}.client_facility_id`]).toBe("NO");
      }
      for (const table of ["attachments", "non_conformances", "warehouses", "users", "audit_logs"]) {
        expect(byColumn[`${table}.client_facility_id`]).toBe("YES");
      }
      expect(columns.filter((c) => /rekey_pending|facility_binding_pending/.test(String(c["c"])))).toEqual([
        { c: "attachments.rekey_pending", is_nullable: "NO", column_default: "false" },
        { c: "users.facility_binding_pending", is_nullable: "NO", column_default: "false" },
      ]);
    });

    it("every trigger of the seven is ENABLE ALWAYS ('A'), 31 of them", async () => {
      const triggers = await rows(
        g.db,
        `SELECT c.relname || ':' || t.tgname AS t, t.tgenabled::text AS e FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal AND (t.tgname LIKE '%facilit%' OR c.relname LIKE 'client_facilit%')
            AND c.relname NOT IN ('inspection_sessions', 'inspection_results', 'inspection_session_signatures')
            AND t.tgname NOT IN ('calibration_devices_location_facility', 'warehouses_room_devices_facility')`, // 0126's facility triggers are P20-04's, 0128's room triggers P20-02's — not the seven's
      );
      expect(triggers).toHaveLength(31);
      expect(triggers.filter((r) => r["e"] !== "A")).toEqual([]);
    });

    it("schemaVerify passes: every table, column and control object (the P20-07 ones among them)", async () => {
      const result = await g.schemaVerify.verifySchema(g.db);
      expect(result.problems).toEqual([]);
      expect(result.objects).toBe(g.schemaVerify.EXPECTED_OBJECTS.length); // 76 after P20-07; later migrations add theirs (P20-04/05: 106)
    });

    it("the per-tenant serial index is gone, the per-facility one is there (UD-9)", async () => {
      expect(
        await rows(g.db, "SELECT indexname FROM pg_indexes WHERE tablename = 'calibration_devices' AND indexname LIKE '%serial%' ORDER BY 1"),
      ).toEqual([{ indexname: "calibration_devices_tenant_facility_serial_unique" }]);
    });
  });

  /** In `t`, as the owner: a client facility F1 (and F2) in tenant 1 beside its self facility. */
  const withFacilities = async (t: LiveTx): Promise<void> => {
    await g.db.query(
      `INSERT INTO client_facilities (id, tenant_id, name, code, kind, created_at, updated_at) VALUES
         ('${F1}', '${T1}', 'Fasilitas Satu', 'F-0001', 'hospital', now(), now()),
         ('${F2}', '${T1}', 'Fasilitas Dua', 'F-0002', 'clinic', now(), now()),
         ('${FB}', '${T2}', 'Fasilitas Tetangga', 'F-0001', 'clinic', now(), now())`,
      { transaction: t },
    );
    await g.db.query(
      `INSERT INTO calibration_devices (id, tenant_id, name, serial_number, client_facility_id, created_at, updated_at) VALUES ('${NEW_DEVICE}', '${T1}', 'Alat F1', 'SN-F1', '${F1}', now(), now())`,
      { transaction: t },
    );
  };

  describe("facilityCompositeFk.p2007 — a child names its device's facility, a device its own tenant's", () => {
    it("AS callibrator_app: a record, certificate, work order, reading or NC naming another facility than its device's is refused (23503)", async () => {
      await inRolledBack(g.db, async (t) => {
        await withFacilities(t);
        const user = `(SELECT id FROM users WHERE tenant_id = '${T1}' LIMIT 1)`;
        for (const [label, sql] of [
          ["record", `INSERT INTO calibration_records (id, tenant_id, device_id, client_facility_id, performed_by, calibration_date, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', '${NEW_DEVICE}', '${F2}', ${user}, now(), now(), now())`],
          ["certificate", `INSERT INTO certificates (id, tenant_id, device_id, client_facility_id, certificate_number, verification_token, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', '${NEW_DEVICE}', '${F2}', 'CERT-X', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', now(), now())`],
          ["work order", `INSERT INTO maintenance_work_orders (id, tenant_id, device_id, client_facility_id, title, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', '${NEW_DEVICE}', '${self[T1] ?? ""}', 'x', now(), now())`],
          ["reading", `INSERT INTO iot_readings (id, tenant_id, device_id, client_facility_id, timestamp, metrics, created_at) VALUES (gen_random_uuid(), '${T1}', '${NEW_DEVICE}', '${F2}', now(), '{}', now())`],
          ["nc", `INSERT INTO non_conformances (id, tenant_id, nc_number, title, description, reported_by, device_id, client_facility_id, date_identified, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', 'NC-X', 't', 'd', ${user}, '${NEW_DEVICE}', '${F2}', now(), now(), now())`],
        ] as const) {
          expect([label, await errorOf(g.db, t, sql)]).toEqual([label, expect.stringMatching(/^23503 .*_device_facility_fkey/)]);
        }
      });
    });

    it("AS callibrator_app: a device, warehouse or user naming ANOTHER tenant's facility is refused (23503)", async () => {
      await inRolledBack(g.db, async (t) => {
        await withFacilities(t);
        expect(await errorOf(g.db, t, `INSERT INTO calibration_devices (id, tenant_id, name, client_facility_id, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', 'x', '${FB}', now(), now())`))
          .toMatch(/^23503 .*calibration_devices_client_facility_fkey/);
        expect(await errorOf(g.db, t, `INSERT INTO warehouses (id, tenant_id, name, code, client_facility_id, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', 'R', 'R1', '${FB}', now(), now())`))
          .toMatch(/^23503 .*warehouses_client_facility_fkey/);
        expect(await errorOf(g.db, t, `INSERT INTO users (id, tenant_id, role_id, client_facility_id, username, email, password, first_name, last_name, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', '${ROLE_HT}', '${FB}', 'xb', 'xb@example.test', 'x', 'X', 'B', now(), now())`))
          .toMatch(/^23503 .*users_client_facility_fkey/);
      });
    });

    it("a certificate whose record is in another facility is refused at COMMIT (the deferred record path), not at the statement", async () => {
      const err = await commitError(g.db, async (t) => {
        await withFacilities(t);
        // A record in F1 (on the F1 device); a certificate on a device of the SELF facility naming it.
        await g.db.query(
          `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, created_at, updated_at)
           VALUES ('${NEW_RECORD}', '${T1}', '${NEW_DEVICE}', (SELECT id FROM users WHERE tenant_id = '${T1}' LIMIT 1), now(), now(), now())`,
          { transaction: t },
        );
        expect(await errorOf(g.db, t,
          `INSERT INTO certificates (id, tenant_id, device_id, calibration_record_id, certificate_number, verification_token, created_at, updated_at)
           VALUES (gen_random_uuid(), '${T1}', ${id("t0-dev-1")}, '${NEW_RECORD}', 'CERT-XF', 'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy', now(), now())`)).toBeNull();
      });
      expect(err).toMatch(/^23503 .*certificates_record_facility_fkey/);
    });
  });

  describe("insertDefault (ADR-124 Am. 3) — today's create paths keep working", () => {
    it("AS callibrator_app, a single-facility tenant: a device without a facility gets the self one; its children, files and NCs take theirs", async () => {
      await inRolledBack(g.db, async (t) => {
        const user = `(SELECT id FROM users WHERE tenant_id = '${T3}' LIMIT 1)`;
        await asApp(g.db, t, `INSERT INTO calibration_devices (id, tenant_id, name, serial_number, created_at, updated_at) VALUES ('${NEW_DEVICE}', '${T3}', 'Baru', 'SN-NEW', now(), now())`);
        await asApp(g.db, t, `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, created_at, updated_at) VALUES ('${NEW_RECORD}', '${T3}', '${NEW_DEVICE}', ${user}, now(), now(), now())`);
        await asApp(g.db, t, `INSERT INTO certificates (id, tenant_id, device_id, calibration_record_id, certificate_number, verification_token, created_at, updated_at) VALUES (gen_random_uuid(), '${T3}', '${NEW_DEVICE}', '${NEW_RECORD}', 'CERT-NEW', 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', now(), now())`);
        await asApp(g.db, t, `INSERT INTO maintenance_work_orders (id, tenant_id, device_id, title, created_at, updated_at) VALUES (gen_random_uuid(), '${T3}', '${NEW_DEVICE}', 'Baru', now(), now())`);
        await asApp(g.db, t, `INSERT INTO iot_readings (id, tenant_id, device_id, timestamp, metrics, created_at) VALUES (gen_random_uuid(), '${T3}', '${NEW_DEVICE}', now(), '{}', now())`);
        await asApp(g.db, t, `INSERT INTO non_conformances (id, tenant_id, nc_number, title, description, reported_by, device_id, date_identified, created_at, updated_at) VALUES (gen_random_uuid(), '${T3}', 'NC-NEW', 't', 'd', ${user}, '${NEW_DEVICE}', now(), now(), now()), (gen_random_uuid(), '${T3}', 'NC-NEW2', 't', 'd', ${user}, NULL, now(), now(), now())`);
        await asApp(g.db, t, `INSERT INTO attachments (id, tenant_id, resource_type, resource_id, file_name, original_name, created_at, updated_at) VALUES (gen_random_uuid(), '${T3}', 'Device', '${NEW_DEVICE}', 'n', 'n.jpg', now(), now()), (gen_random_uuid(), '${T3}', 'generic', NULL, 'o', 'o.jpg', now(), now())`);
        const facilityOf = async (sql: string) => (await rows(g.db, sql, {}, t)).map((r) => r["f"]);
        const own = self[T3];
        expect(await facilityOf(`SELECT client_facility_id AS f FROM calibration_devices WHERE id = '${NEW_DEVICE}'`)).toEqual([own]);
        for (const table of ["calibration_records", "certificates", "maintenance_work_orders", "iot_readings"]) {
          expect(await facilityOf(`SELECT DISTINCT client_facility_id AS f FROM ${table} WHERE device_id = '${NEW_DEVICE}'`)).toEqual([own]);
        }
        expect(await facilityOf("SELECT client_facility_id AS f FROM non_conformances WHERE nc_number IN ('NC-NEW', 'NC-NEW2') ORDER BY nc_number")).toEqual([own, null]);
        expect(await facilityOf("SELECT client_facility_id AS f FROM attachments WHERE file_name IN ('n', 'o') ORDER BY file_name")).toEqual([own, null]);
        // An NC unlinked from its device drops its facility; linked again, takes it back.
        await asApp(g.db, t, "UPDATE non_conformances SET device_id = NULL WHERE nc_number = 'NC-NEW'");
        expect(await facilityOf("SELECT client_facility_id AS f FROM non_conformances WHERE nc_number = 'NC-NEW'")).toEqual([null]);
        await asApp(g.db, t, `UPDATE non_conformances SET device_id = '${NEW_DEVICE}' WHERE nc_number = 'NC-NEW'`);
        expect(await facilityOf("SELECT client_facility_id AS f FROM non_conformances WHERE nc_number = 'NC-NEW'")).toEqual([own]);
        // A standalone file linked later takes its record's facility.
        await asApp(g.db, t, `UPDATE attachments SET resource_type = 'device', resource_id = '${NEW_DEVICE}' WHERE file_name = 'o'`);
        expect(await facilityOf("SELECT client_facility_id AS f FROM attachments WHERE file_name = 'o'")).toEqual([own]);
      });
    });

    it("a tenant WITH client facilities must name one: a device without is refused (23502); a tenant with no self facility too", async () => {
      await inRolledBack(g.db, async (t) => {
        await withFacilities(t);
        expect(await errorOf(g.db, t, `INSERT INTO calibration_devices (id, tenant_id, name, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', 'x', now(), now())`))
          .toMatch(/^23502 calibration device: client_facility_id is required — tenant .* serves client facilities beyond its own/);
        await asApp(g.db, t, `INSERT INTO calibration_devices (id, tenant_id, name, client_facility_id, created_at, updated_at) VALUES ('${NEW_DEVICE_2}', '${T1}', 'x', '${F2}', now(), now())`);
        await g.db.query(`INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES ('${FB.replace("fb", "fe")}', 'No Self', 'noself', 'noself@example.test', now(), now())`, { transaction: t });
        expect(await errorOf(g.db, t, `INSERT INTO calibration_devices (id, tenant_id, name, created_at, updated_at) VALUES (gen_random_uuid(), '${FB.replace("fb", "fe")}', 'x', now(), now())`))
          .toMatch(/^23502 calibration device: tenant .* has no self client facility/);
      });
    });

    it("an explicit wrong facility on a child is never replaced — the key refuses it", async () => {
      await inRolledBack(g.db, async (t) => {
        await withFacilities(t);
        expect(await errorOf(g.db, t, `INSERT INTO maintenance_work_orders (id, tenant_id, device_id, client_facility_id, title, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', '${NEW_DEVICE}', '${F2}', 'x', now(), now())`))
          .toMatch(/^23503 /);
      });
    });
  });

  describe("checks — 0117 / 0123's CHECKs and per-tenant uniques", () => {
    it.each([
      ["a second self facility", `INSERT INTO client_facilities (id, tenant_id, name, code, is_self, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', 'Lagi', 'AGAIN', true, now(), now())`, /^23505 .*client_facilities_one_self/],
      ["the self facility deactivated", `UPDATE client_facilities SET status = 'inactive', status_reason = 'x' WHERE tenant_id = '${T1}' AND is_self`, /^23514 .*client_facilities_self_active/],
      ["a status change without a reason", `UPDATE client_facilities SET status = 'ended' WHERE id = '${F1}'`, /^23514 .*client_facilities_status_reason/],
      ["a malformed code", `INSERT INTO client_facilities (id, tenant_id, name, code, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', 'X', 'f-lower', now(), now())`, /^23514 .*client_facilities_code_shape/],
      ["an un-normalised name", `INSERT INTO client_facilities (id, tenant_id, name, code, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', ' Spasi  Ganda', 'F-9', now(), now())`, /^23514 .*client_facilities_name_normalised/],
      ["the deny sentinel as an id", `INSERT INTO client_facilities (id, tenant_id, name, code, created_at, updated_at) VALUES ('${NO_FACILITY_ID}', '${T1}', 'Sentinel', 'F-8', now(), now())`, /^23514 .*client_facilities_id_not_sentinel/],
      ["a duplicate code in the tenant", `INSERT INTO client_facilities (id, tenant_id, name, code, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', 'Lain', 'F-0001', now(), now())`, /^23505 .*client_facilities_tenant_code_unique/],
      ["a duplicate name in the tenant, whatever its case", `INSERT INTO client_facilities (id, tenant_id, name, code, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', 'FASILITAS SATU', 'F-7', now(), now())`, /^23505 .*client_facilities_tenant_name_unique/],
      ["a file with a facility it is not linked to", `INSERT INTO attachments (id, tenant_id, resource_type, client_facility_id, file_name, original_name, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', 'generic', '${F1}', 'z', 'z', now(), now())`, /^23514 .*attachments_facility_kind/],
      ["an NC with a facility and no device", `UPDATE non_conformances SET client_facility_id = '${F1}' WHERE device_id IS NULL AND tenant_id = '${T1}'`, /^(23514 .*non_conformances_facility_follows_device|42501 )/],
      ["a bound user with no tenant", `INSERT INTO users (id, tenant_id, role_id, client_facility_id, username, email, password, first_name, last_name, created_at, updated_at) VALUES (gen_random_uuid(), NULL, '${ROLE_HT}', '${F1}', 'nt', 'nt@example.test', 'x', 'N', 'T', now(), now())`, /^23514 .*users_facility_needs_tenant/],
    ])("AS callibrator_app: %s is refused", async (_label, sql, expected) => {
      await inRolledBack(g.db, async (t) => {
        await withFacilities(t);
        expect(await errorOf(g.db, t, sql)).toMatch(expected);
      });
    });

    it("the same code in ANOTHER tenant is fine (no global uniqueness — the oracle trap)", async () => {
      await inRolledBack(g.db, async (t) => {
        await withFacilities(t); // FB in tenant 2 is F-0001 too
        expect(await rows(g.db, "SELECT count(*)::int AS n FROM client_facilities WHERE code = 'F-0001'", {}, t)).toEqual([{ n: 2 }]);
      });
    });

    it("a facility's id, tenant and self flag never change — for the owner too (42501)", async () => {
      await inRolledBack(g.db, async (t) => {
        await withFacilities(t);
        for (const role of [APP_ROLE, null]) {
          expect(await errorOf(g.db, t, `UPDATE client_facilities SET is_self = true WHERE id = '${F1}'`, {}, role)).toMatch(/^42501 .*never change/);
          expect(await errorOf(g.db, t, `UPDATE client_facilities SET tenant_id = '${T2}' WHERE id = '${F1}'`, {}, role)).toMatch(/^42501 .*never change/);
        }
        // Everything else changes: the self facility's name, a client's status with a reason.
        await asApp(g.db, t, `UPDATE client_facilities SET name = 'Nama Baru' WHERE tenant_id = '${T1}' AND is_self`);
        await asApp(g.db, t, `UPDATE client_facilities SET status = 'inactive', status_reason = 'Kontrak dijeda' WHERE id = '${F1}'`);
      });
    });
  });

  describe("facilityImmutable.p2007 — the facility column changes only by a device move, for every role", () => {
    const UPDATES = [
      ["calibration_devices", `UPDATE calibration_devices SET client_facility_id = '${F2}' WHERE id = '${NEW_DEVICE}'`],
      ["calibration_records", `UPDATE calibration_records SET client_facility_id = '${F2}' WHERE device_id = '${NEW_DEVICE}'`],
      ["certificates", `UPDATE certificates SET client_facility_id = '${F2}' WHERE device_id = '${NEW_DEVICE}'`],
      ["maintenance_work_orders", `UPDATE maintenance_work_orders SET client_facility_id = '${F2}' WHERE device_id = '${NEW_DEVICE}'`],
      ["iot_readings", `UPDATE iot_readings SET client_facility_id = '${F2}' WHERE device_id = '${NEW_DEVICE}'`],
      ["non_conformances", `UPDATE non_conformances SET client_facility_id = '${F2}' WHERE device_id = '${NEW_DEVICE}'`],
      ["attachments", `UPDATE attachments SET client_facility_id = '${F2}' WHERE resource_id = '${NEW_DEVICE}'`],
    ] as const;

    /** One row of every facility table on the F1 device. */
    const childrenOfF1Device = async (t: LiveTx): Promise<void> => {
      await withFacilities(t);
      const user = `(SELECT id FROM users WHERE tenant_id = '${T1}' LIMIT 1)`;
      for (const sql of [
        `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, created_at, updated_at) VALUES ('${NEW_RECORD}', '${T1}', '${NEW_DEVICE}', ${user}, now(), now(), now())`,
        `INSERT INTO certificates (id, tenant_id, device_id, certificate_number, verification_token, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', '${NEW_DEVICE}', 'CERT-I', 'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii', now(), now())`,
        `INSERT INTO maintenance_work_orders (id, tenant_id, device_id, title, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', '${NEW_DEVICE}', 'x', now(), now())`,
        `INSERT INTO iot_readings (id, tenant_id, device_id, timestamp, metrics, created_at) VALUES (gen_random_uuid(), '${T1}', '${NEW_DEVICE}', now(), '{}', now())`,
        `INSERT INTO non_conformances (id, tenant_id, nc_number, title, description, reported_by, device_id, date_identified, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', 'NC-I', 't', 'd', ${user}, '${NEW_DEVICE}', now(), now(), now())`,
        `INSERT INTO attachments (id, tenant_id, resource_type, resource_id, file_name, original_name, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', 'device', '${NEW_DEVICE}', 'i', 'i', now(), now())`,
      ]) {
        await g.db.query(sql, { transaction: t });
      }
    };

    it.each(UPDATES)("%s: refused (42501) for callibrator_app and for the OWNER, with no move set", async (_table, sql) => {
      await inRolledBack(g.db, async (t) => {
        await childrenOfF1Device(t);
        // calibration_records: 0057's append-only trigger (replaced by 0119) fires first and refuses the same change.
        // The application role has no UPDATE grant on that column at all (0057's column grants), a refusal too.
        const refused = /^42501 .*(changed only by an audited device move|the content of record .* cannot be changed)/;
        expect(await errorOf(g.db, t, sql, {}, APP_ROLE)).toMatch(_table === "calibration_records" ? /^42501 permission denied for table calibration_records/ : refused);
        expect(await errorOf(g.db, t, sql, {}, null)).toMatch(refused);
      });
    });

    it("refused with a garbage setting, an unknown move, a move of ANOTHER device, and a move from/to other facilities", async () => {
      await inRolledBack(g.db, async (t) => {
        await childrenOfF1Device(t);
        const mover = `(SELECT id FROM users WHERE tenant_id = '${T1}' LIMIT 1)`;
        await g.db.query(
          `INSERT INTO calibration_devices (id, tenant_id, name, client_facility_id, created_at, updated_at) VALUES ('${NEW_DEVICE_2}', '${T1}', 'Lain', '${F1}', now(), now());
           INSERT INTO client_facility_moves (id, tenant_id, device_id, from_client_facility_id, to_client_facility_id, reason, moved_by, created_at)
           VALUES ('${F1.replace("f1", "a1")}', '${T1}', '${NEW_DEVICE_2}', '${F1}', '${F2}', 'Pindah', ${mover}, now()),
                  ('${F1.replace("f1", "a2")}', '${T1}', '${NEW_DEVICE}', '${F1}', '${self[T1] ?? ""}', 'Pindah', ${mover}, now())`,
          { transaction: t },
        );
        const device = `UPDATE calibration_devices SET client_facility_id = '${F2}' WHERE id = '${NEW_DEVICE}'`;
        for (const setting of ["not-a-uuid", "b2007000-0000-4000-8000-00000000dead", F1.replace("f1", "a1"), F1.replace("f1", "a2")]) {
          await g.db.query("SELECT set_config('callibrator.facility_move', :setting, true)", { transaction: t, replacements: { setting } });
          expect([setting, await errorOf(g.db, t, device)]).toEqual([setting, expect.stringMatching(/^42501 .*changed only by an audited device move/)]);
        }
      });
    });
  });

  describe("usersBinding.p2007 — the binding guard and the bound-role trigger", () => {
    const U = `(SELECT id FROM users WHERE tenant_id = '${T1}' ORDER BY username LIMIT 1)`;

    it("AS callibrator_app: a binding written outside the binding operation is refused (42501), for the owner too", async () => {
      await inRolledBack(g.db, async (t) => {
        await withFacilities(t);
        for (const role of [APP_ROLE, null]) {
          expect(await errorOf(g.db, t, `UPDATE users SET client_facility_id = '${F1}', role_id = '${ROLE_HT}' WHERE id = ${U}`, {}, role))
            .toMatch(/^42501 .*the facility binding is changed only by the binding operation/);
        }
      });
    });

    it("under `callibrator.facility_binding` naming THAT user: bound with a facility role; refused with a non-facility role (23514); another user still refused", async () => {
      await inRolledBack(g.db, async (t) => {
        await withFacilities(t);
        const [user] = await rows(g.db, `SELECT id FROM users WHERE tenant_id = '${T1}' ORDER BY username LIMIT 1`, {}, t);
        await g.db.query("SELECT set_config('callibrator.facility_binding', :u, true)", { transaction: t, replacements: { u: user?.["id"] } });
        expect(await errorOf(g.db, t, `UPDATE users SET client_facility_id = '${F1}' WHERE id = :u`, { u: user?.["id"] }))
          .toMatch(/^23514 .*holds one of HEALTHCARE ADMIN, HEALTHCARE TECHNICIAN, FACILITY MAINTENANCE, ROOM USER \(has SUPERVISOR\)/);
        await asApp(g.db, t, `UPDATE users SET client_facility_id = '${F1}', role_id = '${ROLE_HT}' WHERE id = :u`, { u: user?.["id"] });
        // A bound user's role moved outside the set: refused, whoever writes it.
        expect(await errorOf(g.db, t, `UPDATE users SET role_id = '${ROLE_SUP}' WHERE id = :u`, { u: user?.["id"] }, null)).toMatch(/^23514 /);
        expect(await errorOf(g.db, t, `UPDATE users SET client_facility_id = '${F1}', role_id = '${ROLE_HT}' WHERE tenant_id = '${T1}' AND id <> :u`, { u: user?.["id"] }))
          .toMatch(/^42501 /);
      });
    });

    it("a user CREATED bound (the ETL, SCIM, POST /users): with a facility role accepted, with another refused — no setting needed", async () => {
      await inRolledBack(g.db, async (t) => {
        await withFacilities(t);
        const insert = (role: string, name: string) =>
          `INSERT INTO users (id, tenant_id, role_id, client_facility_id, username, email, password, first_name, last_name, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', '${role}', '${F1}', '${name}', '${name}@example.test', 'x', 'B', 'U', now(), now())`;
        await asApp(g.db, t, insert(ROLE_HT, "boundht"));
        expect(await errorOf(g.db, t, insert(ROLE_SUP, "boundsup"))).toMatch(/^23514 .*\(has SUPERVISOR\)/);
      });
    });
  });

  describe("endedFacilityInsert.p2007 — nothing new in an ended facility (but telemetry)", () => {
    it("AS callibrator_app: device, record, certificate, work order, NC and file refused (23514); an IoT reading accepted", async () => {
      await inRolledBack(g.db, async (t) => {
        await withFacilities(t);
        await g.db.query(`UPDATE client_facilities SET status = 'ended', status_reason = 'Kontrak selesai' WHERE id = '${F1}'`, { transaction: t });
        const user = `(SELECT id FROM users WHERE tenant_id = '${T1}' LIMIT 1)`;
        for (const [label, sql] of [
          ["device", `INSERT INTO calibration_devices (id, tenant_id, name, client_facility_id, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', 'x', '${F1}', now(), now())`],
          ["record", `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', '${NEW_DEVICE}', ${user}, now(), now(), now())`],
          ["certificate", `INSERT INTO certificates (id, tenant_id, device_id, certificate_number, verification_token, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', '${NEW_DEVICE}', 'CERT-E', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', now(), now())`],
          ["work order", `INSERT INTO maintenance_work_orders (id, tenant_id, device_id, title, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', '${NEW_DEVICE}', 'x', now(), now())`],
          ["nc", `INSERT INTO non_conformances (id, tenant_id, nc_number, title, description, reported_by, device_id, date_identified, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', 'NC-E', 't', 'd', ${user}, '${NEW_DEVICE}', now(), now(), now())`],
          ["file", `INSERT INTO attachments (id, tenant_id, resource_type, resource_id, file_name, original_name, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', 'device', '${NEW_DEVICE}', 'e', 'e', now(), now())`],
        ] as const) {
          expect([label, await errorOf(g.db, t, sql)]).toEqual([label, expect.stringMatching(/^23514 Fasilitas Satu has ended; new records cannot be added/)]);
        }
        await asApp(g.db, t, `INSERT INTO iot_readings (id, tenant_id, device_id, timestamp, metrics, created_at) VALUES (gen_random_uuid(), '${T1}', '${NEW_DEVICE}', now(), '{}', now())`);
        // The provider still reads it; an inactive facility still takes rows.
        await g.db.query(`UPDATE client_facilities SET status = 'inactive', status_reason = 'Dijeda' WHERE id = '${F2}'`, { transaction: t });
        await asApp(g.db, t, `INSERT INTO calibration_devices (id, tenant_id, name, client_facility_id, created_at, updated_at) VALUES (gen_random_uuid(), '${T1}', 'x', '${F2}', now(), now())`);
      });
    });
  });

  describe("attachmentFacilityTrigger.p2007 — AM-7, checked at COMMIT", () => {
    it("a file naming another facility than its record's passes the statement and is refused at COMMIT (23514)", async () => {
      const err = await commitError(g.db, async (t) => {
        await withFacilities(t);
        await g.db.query("SET LOCAL ROLE callibrator_app", { transaction: t });
        await g.db.query(
          `INSERT INTO attachments (id, tenant_id, resource_type, resource_id, client_facility_id, file_name, original_name, created_at, updated_at)
           VALUES (gen_random_uuid(), '${T1}', 'device', '${NEW_DEVICE}', '${F2}', 'w', 'w', now(), now())`,
          { transaction: t },
        );
      });
      expect(err).toMatch(/^23514 attachment .*: its client facility \(.*\) is not its device's/);
    });

    it("a file linked to a record that does not exist is refused at COMMIT (23503)", async () => {
      const err = await commitError(g.db, async (t) => {
        await g.db.query(
          `INSERT INTO attachments (id, tenant_id, resource_type, resource_id, client_facility_id, file_name, original_name, created_at, updated_at)
           VALUES (gen_random_uuid(), '${T1}', 'workorder', '${NEW_DEVICE}', '${self[T1] ?? ""}', 'w', 'w', now(), now())`,
          { transaction: t },
        );
      });
      expect(err).toMatch(/^23503 attachment .*: its workorder .* does not exist in its tenant/);
    });
  });

  describe("moveLog.p2007 — client_facility_moves", () => {
    const insertMove = (status = "in_progress") =>
      `INSERT INTO client_facility_moves (id, tenant_id, device_id, from_client_facility_id, to_client_facility_id, reason, status, completed_at, moved_by, created_at)
       VALUES ('${F1.replace("f1", "c1")}', '${T1}', '${NEW_DEVICE}', '${F1}', '${F2}', 'Pindah', '${status}', ${status === "completed" ? "now()" : "NULL"}, (SELECT id FROM users WHERE tenant_id = '${T1}' LIMIT 1), now())`;

    it("a COMMIT that leaves a move in progress is refused (23514)", async () => {
      const err = await commitError(g.db, async (t) => {
        await withFacilities(t);
        await g.db.query(insertMove(), { transaction: t });
      });
      expect(err).toMatch(/^23514 device move .* was not completed in its transaction/);
    });

    it("append-only: completed is final, nothing else changes, DELETE and TRUNCATE refused for the owner; the app role has no DELETE", async () => {
      await inRolledBack(g.db, async (t) => {
        await withFacilities(t);
        await g.db.query(insertMove("completed"), { transaction: t });
        const move = F1.replace("f1", "c1");
        expect(await errorOf(g.db, t, `UPDATE client_facility_moves SET reason = 'lain' WHERE id = '${move}'`)).toMatch(/^42501 .*only completes, once/);
        expect(await errorOf(g.db, t, `DELETE FROM client_facility_moves WHERE id = '${move}'`)).toMatch(/^42501 permission denied/);
        expect(await errorOf(g.db, t, `DELETE FROM client_facility_moves WHERE id = '${move}'`, {}, null)).toMatch(/^42501 .*cannot be deleted/);
        expect(await errorOf(g.db, t, insertMove().replace("'Pindah'", "'  '").replace(F1.replace("f1", "c1"), F1.replace("f1", "c2")))).toMatch(/^23514 .*client_facility_moves_reason/);
      });
    });
  });

  it("moveLog.p2007 — TRUNCATE is refused for the owner (a transaction with no pending deferred check)", async () => {
    await inRolledBack(g.db, async (t) => {
      expect(await errorOf(g.db, t, "TRUNCATE client_facility_moves", {}, null)).toMatch(/^42501 .*TRUNCATE is refused/);
      expect(await errorOf(g.db, t, "TRUNCATE client_facility_moves")).toMatch(/^42501 permission denied/);
    });
  });

  it("D. a REBOOT on the migrated database: sync() (showIndex on every new index), the migrator (nothing), the schema check", async () => {
    const next = startProcess();
    try {
      await next.db.sync();
      expect(await next.migrator.up()).toEqual([]);
      expect((await next.schemaVerify.verifySchema(next.db)).problems).toEqual([]);
    } finally {
      await next.db.close();
    }
  });

  it("E1. every down REFUSES while a facility beyond the self ones exists, and changes nothing", async () => {
    await g.db.query(`INSERT INTO client_facilities (id, tenant_id, name, code, created_at, updated_at) VALUES ('${F1}', '${T1}', 'Fasilitas Satu', 'F-0001', now(), now())`);
    const [firstLater] = later;
    if (firstLater !== undefined) {
      const undone = await g.migrator.down({ to: firstLater });
      expect(undone.map((m) => m.name)).toEqual([...later].reverse());
    }
    await expect(g.migrator.down({ step: 1 })).rejects.toThrow(/0123 down: the database holds 1 client facility beyond the tenants' own/);
    // Clean up the one row (nothing references it: a hard delete — spec § 4.6).
    await g.db.query(`DELETE FROM client_facilities WHERE id = '${F1}'`);
    // The later migrations are re-applied for the check (0126 owns tables the models declare), then
    // reverted again, as E2 expects them.
    await g.migrator.up();
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
    if (firstLater !== undefined) {
      await g.migrator.down({ to: firstLater });
    }
  });

  it("E2. on a single-facility database: down × 7 removes every object and keeps every row; up × 7 rebuilds and back-fills again", async () => {
    const before = await rows(g.db, `SELECT (SELECT count(*) FROM calibration_devices)::int AS d, (SELECT count(*) FROM calibration_records)::int AS r,
      (SELECT count(*) FROM certificates)::int AS c, (SELECT count(*) FROM iot_readings)::int AS i, (SELECT count(*) FROM attachments)::int AS a`);
    const reverted = await g.migrator.down({ to: "0117-client-facilities.js" });
    expect(reverted.map((m) => m.name)).toEqual([...P2007_MIGRATIONS].reverse());
    expect(await rows(g.db, "SELECT to_regclass('client_facilities') AS f, to_regclass('client_facility_moves') AS m")).toEqual([{ f: null, m: null }]);
    expect(await rows(g.db, `SELECT table_name || '.' || column_name AS c FROM information_schema.columns
      WHERE table_schema = current_schema() AND column_name IN ('client_facility_id', 'rekey_pending', 'facility_binding_pending') ORDER BY 1`))
      .toEqual([{ c: "audit_logs.client_facility_id" }]); // the audit trail keeps its column (append-only)
    expect(await rows(g.db, "SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%facilit%'")).toEqual([{ n: 0 }]);
    expect(await rows(g.db, "SELECT indexname FROM pg_indexes WHERE tablename = 'calibration_devices' AND indexname LIKE '%serial%'"))
      .toEqual([{ indexname: "calibration_devices_tenant_id_serial_number_unique" }]);
    // 0057's function is 0057's again: a record's content is immutable, no exception.
    const fn = await rows(g.db, "SELECT prosrc FROM pg_proc WHERE proname = 'calibration_records_append_only'");
    expect(String(fn[0]?.["prosrc"])).not.toContain("facility_move_admits");
    expect(await rows(g.db, `SELECT (SELECT count(*) FROM calibration_devices)::int AS d, (SELECT count(*) FROM calibration_records)::int AS r,
      (SELECT count(*) FROM certificates)::int AS c, (SELECT count(*) FROM iot_readings)::int AS i, (SELECT count(*) FROM attachments)::int AS a`)).toEqual(before);

    const applied = await g.migrator.up();
    expect(applied.map((m) => m.name)).toEqual([...P2007_MIGRATIONS, ...later]);
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
    for (const table of NOT_NULL) {
      expect(await rows(g.db, `SELECT count(*)::int AS n FROM ${table} x JOIN client_facilities f ON f.id = x.client_facility_id AND f.tenant_id = x.tenant_id AND f.is_self`))
        .toEqual([{ n: (EXPECTED_PER_TENANT[table] ?? 0) * TENANTS.length }]);
    }
    // One CREATE audit row per self facility id: the old facilities' rows stay (append-only), the new ones have theirs.
    expect(await rows(g.db, `SELECT count(*)::int AS n FROM client_facilities f
      WHERE (SELECT count(*) FROM audit_logs a WHERE a.resource_type = 'ClientFacility' AND a.client_facility_id = f.id) = 1`)).toEqual([{ n: 5 }]);
    expect(await rows(g.db, "SELECT count(*)::int AS n FROM audit_logs WHERE resource_type = 'ClientFacility'")).toEqual([{ n: 10 }]);
  });
});
