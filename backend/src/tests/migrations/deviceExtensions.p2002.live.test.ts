/**
 * P20-02 + P20-08 against a REAL PostgreSQL 18 — migrations 0128 (the device extensions and the
 * calibration-date columns) and 0129 (`attachments.purpose`, the IPM attachment type). ADR-132,
 * ADR-133 and Am. 1 of each; specs MEMORY/specs/P19-03-device-extensions.md § 4, § 6, § 7.1, § 13,
 * P19-05-calibration-dates.md § 4, § 12 and P19-02-ipm-session-aggregate.md § 12.
 *
 * On an EMPTY scratch database: db.sync() and EVERY migration (the boot's schema step). Each probe
 * in a rolled-back transaction; every refusal is checked as `callibrator_app` (SET LOCAL ROLE —
 * CLAUDE.md Evidence) AND as the owner, and every control has its FAIL-BEFORE: the same write with
 * the control removed (DDL inside the rolled-back transaction) SUCCEEDS:
 *  - the QR: unique per tenant over every row, a soft-deleted device's sticker included (23505;
 *    another tenant may hold it); stored normalised (23514);
 *  - rooms: a room has a facility, a store no floor (23514); a live room's name and floor unique per
 *    facility, case and spaces folded (23505) — another facility, or a deleted room, frees it;
 *  - `calibration_devices_location_facility`: a device in another facility's room, or another
 *    tenant's store, is refused on insert and update (23514); a store and its own room are accepted;
 *  - `warehouses_room_devices_facility`: a room's facility does not change under its devices (23514);
 *  - `calibration_devices_request_same_device` and the request pair: another device's IPM session
 *    is refused (23514);
 *  - `calibration_devices_next_date_source`: 'manual' when a date is written without a source, NULL
 *    without a date, an explicit source kept; FAIL-BEFORE: without it, today's writers (which name
 *    no source) are refused by the CHECK (23514); the back-fill labels an existing date 'manual';
 *  - calibration records: an external date names its lab and carries no results (23514); the new
 *    columns are immutable after insert by the existing append-only trigger (42501);
 *  - photos: a purpose is one of four and on its own resource type (23514); one live front photo per
 *    device (23505), a soft-deleted one frees the slot;
 *  - the IPM type: a session's photo takes the session's facility (FAIL-BEFORE with the previous
 *    functions and CHECK: it is stored with NO facility — outside every facility scope); a wrong
 *    facility is refused at commit (23514); under a device move the photo must follow its session
 *    (`inspection_sessions_attachments_follow_facility`, 23514 at commit) and can (the
 *    `inspectionsession` branch of facility_resource_device; FAIL-BEFORE 42501 without it);
 *  - schemaVerify passes; a REBOOT applies nothing; `down` refuses while data would be lost; down ×2
 *    then up ×2 gives the same objects.
 *
 *   docker run -d --name p2002-pg18 -e POSTGRES_PASSWORD=p2002pass -p 127.0.0.1:55202:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=55202 DB_NAME=p2002_scratch DB_USER=postgres DB_PASS=p2002pass \
 *     npm run test:live:jest -- src/tests/migrations/deviceExtensions.p2002.live
 *   docker rm -f p2002-pg18
 *
 * Synthetic values only ("Ruang 1", QR TST000001, "Lab Sintetis").
 */
import { Sequelize } from "sequelize";
import { env } from "../../config/env";
import { APP_ROLE, draftSql, errorOf, inRolledBack, rows, seedSql, type LiveDb, type LiveTx, type Row } from "../fixtures/ipmLive";

const T = "d2002000-0000-4000-8000-000000000001";
const T2 = "d2002000-0000-4000-8000-000000000011";
const ROLE = "d2002000-0000-4000-8000-000000000002";
const ROLE2 = "d2002000-0000-4000-8000-000000000012";
const U1 = "d2002000-0000-4000-8000-0000000000a1";
const U9 = "d2002000-0000-4000-8000-0000000000a9";
const F1 = "d2002000-0000-4000-8000-0000000000f1";
const F2 = "d2002000-0000-4000-8000-0000000000f2";
const F9 = "d2002000-0000-4000-8000-0000000000f9";
const D1 = "d2002000-0000-4000-8000-0000000000d1";
const D2 = "d2002000-0000-4000-8000-0000000000d2";
const D3 = "d2002000-0000-4000-8000-0000000000d3";
const D9 = "d2002000-0000-4000-8000-0000000000d9";
const R1 = "d2002000-0000-4000-8000-000000000101";
const R2 = "d2002000-0000-4000-8000-000000000102";
const STORE = "d2002000-0000-4000-8000-000000000103";
const STORE9 = "d2002000-0000-4000-8000-000000000109";
const S1 = "d2002000-0000-4000-8000-000000000201";
const S2 = "d2002000-0000-4000-8000-000000000202";
const REC = "d2002000-0000-4000-8000-000000000301";
const MOVE = "d2002000-0000-4000-8000-000000000401";
const QR = "TST000001";

const NEW_TRIGGERS = [
  "calibration_devices:calibration_devices_location_facility",
  "calibration_devices:calibration_devices_next_date_source",
  "calibration_devices:calibration_devices_request_same_device",
  "inspection_sessions:inspection_sessions_attachments_follow_facility",
  "warehouses:warehouses_room_devices_facility",
];

interface Migration {
  up(o: { context: unknown }): Promise<void>;
  down(o: { context: unknown }): Promise<void>;
}
interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<{ name: string }[]> };
  schemaVerify: { verifySchema(db: unknown): Promise<{ problems: string[]; objects: number }> };
  m0128: Migration & { BACKFILL_SQL: string };
  m0129: Migration & { PREVIOUS: Readonly<Record<string, string>>; OLD_TYPES: string; facilityKindPredicate(types: string): string };
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
      m0128: require("../../migrations/0128-device-extensions") as Graph["m0128"],
      m0129: require("../../migrations/0129-attachment-purpose") as Graph["m0129"],
    };
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const deviceSql = (opts: { qr?: boolean; location?: boolean; deleted?: boolean } = {}): string =>
  `INSERT INTO calibration_devices (id, tenant_id, client_facility_id, name, ${opts.qr ? "qr_code, " : ""}${opts.location ? "location_id, " : ""}is_deleted, created_at, updated_at)
   VALUES (:id, :tenant, :facility, 'Alat sintetis', ${opts.qr ? ":qr, " : ""}${opts.location ? ":location, " : ""}${opts.deleted ? "true" : "false"}, now(), now())`;

const roomSql = `INSERT INTO warehouses (id, tenant_id, client_facility_id, name, code, kind, floor, is_deleted, created_at, updated_at)
   VALUES (:id, :tenant, :facility, :name, :code, :kind, :floor, :deleted, now(), now())`;

const recordSql = (columns: string, values: string): string =>
  `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, ${columns}, created_at, updated_at)
   VALUES (:id, '${T}', '${D1}', '${U1}', now(), ${values}, now(), now())`;

const photoSql = `INSERT INTO attachments (id, tenant_id, resource_type, resource_id, purpose, file_name, original_name, is_deleted, created_at, updated_at)
   VALUES (gen_random_uuid(), '${T}', :type, :resource, :purpose, 'f', 'f.jpg', :deleted, now(), now())`;

jest.setTimeout(900000);

describe("P20-02 / P20-08 — migrations 0128 and 0129 on live PostgreSQL 18", () => {
  let g: Graph;
  let admin: Sequelize;
  let applied: string[] = [];

  /** Refused with `pattern` as callibrator_app AND as the owner. */
  const refusedForBoth = async (t: LiveTx, sql: string, replacements: object, pattern: RegExp): Promise<void> => {
    expect(await errorOf(g.db, t, sql, replacements)).toMatch(pattern);
    expect(await errorOf(g.db, t, sql, replacements, null)).toMatch(pattern);
  };
  /** Accepted as callibrator_app, keeping its effect. */
  const asApp = async (t: LiveTx, sql: string, replacements: object = {}): Promise<void> => {
    expect(await errorOf(g.db, t, sql, replacements)).toBeNull();
  };
  /** DDL as the owner inside `t` (rolled back with it): removes a control for a FAIL-BEFORE. */
  const ddl = async (t: LiveTx, sql: string): Promise<void> => {
    // ALTER TABLE refuses while deferred trigger events are pending: fire them first.
    await g.db.query("SET CONSTRAINTS ALL IMMEDIATE", { transaction: t });
    await g.db.query("SET CONSTRAINTS ALL DEFERRED", { transaction: t });
    await g.db.query(sql, { transaction: t });
  };
  const one = async (t: LiveTx, sql: string, replacements: object = {}): Promise<Row | undefined> => (await rows(g.db, sql, replacements, t))[0];

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
    applied = (await g.migrator.up()).map((m) => m.name);
    const statements = [
      ...seedSql({ tenant: T, role: ROLE, users: [U1], facilities: [[F1, "F-0001"], [F2, "F-0002"]], devices: [[D1, F1, "SN-1"], [D2, F2, "SN-2"]], tag: "p2002" }),
      ...seedSql({ tenant: T2, role: ROLE2, users: [U9], facilities: [[F9, "F-0009"]], devices: [[D9, F9, "SN-9"]], tag: "p2002b" }),
      `INSERT INTO warehouses (id, tenant_id, name, code, created_at, updated_at) VALUES ('${STORE}', '${T}', 'Gudang Pusat', 'G-1', now(), now())`,
      `INSERT INTO warehouses (id, tenant_id, name, code, created_at, updated_at) VALUES ('${STORE9}', '${T2}', 'Gudang Lain', 'G-9', now(), now())`,
      `INSERT INTO warehouses (id, tenant_id, client_facility_id, name, code, kind, floor, created_at, updated_at)
       VALUES ('${R1}', '${T}', '${F1}', 'Ruang 1', 'R-0001', 'room', '2', now(), now()), ('${R2}', '${T}', '${F2}', 'Ruang 1', 'R-0002', 'room', '2', now(), now())`,
    ];
    for (const statement of statements) {
      await g.db.query(statement);
    }
  });

  afterAll(async () => {
    await g.db.close();
    await admin.close();
  });

  it("0128 and 0129 are applied, last; their five triggers are ENABLE ALWAYS ('A'); existing warehouses are stores", async () => {
    // The adjacent pair, after 0127, not the tail: later migrations (0130 ... ) follow them.
    const at = applied.indexOf("0128-device-extensions.js");
    expect(at).toBeGreaterThan(applied.indexOf("0127-ipm-immutability.js"));
    expect(applied.slice(at, at + 2)).toEqual(["0128-device-extensions.js", "0129-attachment-purpose.js"]);
    const triggers = await rows(
      g.db,
      `SELECT c.relname || ':' || t.tgname AS name, t.tgenabled::text AS state FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE t.tgname IN (:names) ORDER BY 1`,
      { names: NEW_TRIGGERS.map((x) => x.split(":")[1]) },
    );
    expect(triggers.map((r) => r["name"])).toEqual(NEW_TRIGGERS);
    expect(triggers.filter((r) => r["state"] !== "A")).toEqual([]);
    expect(await rows(g.db, `SELECT kind::text, count(*)::int AS n FROM warehouses WHERE id IN ('${STORE}', '${STORE9}') GROUP BY 1`)).toEqual([
      { kind: "store", n: 2 },
    ]);
  });

  it("the QR is unique per tenant over every row — a deleted device keeps its sticker; FAIL-BEFORE without the index", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, deviceSql({ qr: true, deleted: true }), { id: D3, tenant: T, facility: F1, qr: QR });
      await refusedForBoth(t, "UPDATE calibration_devices SET qr_code = :qr WHERE id = :id", { qr: QR, id: D1 }, /^23505 .*calibration_devices_tenant_qr_code_unique/);
      await asApp(t, "UPDATE calibration_devices SET qr_code = :qr WHERE id = :id", { qr: QR, id: D9 });
      await ddl(t, "DROP INDEX calibration_devices_tenant_qr_code_unique");
      await asApp(t, "UPDATE calibration_devices SET qr_code = :qr WHERE id = :id", { qr: QR, id: D1 });
    });
  });

  it("the QR is stored normalised (23514); FAIL-BEFORE without the CHECK", async () => {
    await inRolledBack(g.db, async (t) => {
      for (const bad of ["tst000001", "-AB", "A B"]) {
        await refusedForBoth(t, "UPDATE calibration_devices SET qr_code = :qr WHERE id = :id", { qr: bad, id: D1 }, /^23514 .*calibration_devices_qr_code_shape/);
      }
      await ddl(t, "ALTER TABLE calibration_devices DROP CONSTRAINT calibration_devices_qr_code_shape");
      await asApp(t, "UPDATE calibration_devices SET qr_code = 'tst000001' WHERE id = :id", { id: D1 });
    });
  });

  it("the other device CHECKs: condition ⇔ source, the IPM interval 0 – 60, the inventory floor, client_ref only with its creator", async () => {
    await inRolledBack(g.db, async (t) => {
      const update = "UPDATE calibration_devices SET %s WHERE id = :id";
      await refusedForBoth(t, update.replace("%s", "\"condition\" = 'good'"), { id: D1 }, /^23514 .*calibration_devices_condition_source/);
      await asApp(t, update.replace("%s", "\"condition\" = 'not_good', condition_source = 'manual', condition_changed_at = now()"), { id: D1 });
      await refusedForBoth(t, update.replace("%s", "ipm_interval_months = 61"), { id: D1 }, /^23514 .*calibration_devices_ipm_interval/);
      await asApp(t, update.replace("%s", "ipm_interval_months = 0"), { id: D1 });
      await refusedForBoth(t, update.replace("%s", "inventoried_on = DATE '1989-12-31'"), { id: D1 }, /^23514 .*calibration_devices_inventoried_on_floor/);
      await refusedForBoth(t, update.replace("%s", "client_ref = gen_random_uuid()"), { id: D1 }, /^23514 .*calibration_devices_client_ref_creator/);
      await asApp(t, update.replace("%s", `client_ref = gen_random_uuid(), created_by = '${U1}'`), { id: D1 });
    });
  });

  it("client_ref is unique per creator (23505)", async () => {
    await inRolledBack(g.db, async (t) => {
      const ref = "d2002000-0000-4000-8000-000000000501";
      await asApp(t, "UPDATE calibration_devices SET client_ref = :ref, created_by = :u WHERE id = :id", { ref, u: U1, id: D1 });
      await refusedForBoth(t, "UPDATE calibration_devices SET client_ref = :ref, created_by = :u WHERE id = :id", { ref, u: U1, id: D2 }, /^23505 .*calibration_devices_client_ref_unique/);
    });
  });

  it("rooms: a room has a facility, a store no floor (23514); FAIL-BEFORE without the CHECKs", async () => {
    await inRolledBack(g.db, async (t) => {
      const room = { id: D3, tenant: T, facility: null, name: "Ruang X", code: "R-9", kind: "room", floor: null, deleted: false };
      await refusedForBoth(t, roomSql, room, /^23514 .*warehouses_room_has_facility/);
      await refusedForBoth(t, roomSql, { ...room, facility: null, kind: "store", floor: "3" }, /^23514 .*warehouses_store_no_floor/);
      await ddl(t, "ALTER TABLE warehouses DROP CONSTRAINT warehouses_room_has_facility");
      await asApp(t, roomSql, room);
    });
  });

  it("a live room's name and floor are unique PER FACILITY, case and spaces folded (23505); another facility or a deleted room frees it; FAIL-BEFORE without the index", async () => {
    await inRolledBack(g.db, async (t) => {
      const twin = { id: D3, tenant: T, facility: F1, name: " ruang 1 ", code: "R-9", kind: "room", floor: "2", deleted: false };
      await refusedForBoth(t, roomSql, twin, /^23505 .*warehouses_room_name_unique/);
      await asApp(t, roomSql, { ...twin, floor: "3" });
      await asApp(t, "UPDATE warehouses SET is_deleted = true WHERE id = :id", { id: R1 });
      await asApp(t, roomSql, { ...twin, id: "d2002000-0000-4000-8000-000000000104", code: "R-10" });
    });
    await inRolledBack(g.db, async (t) => {
      await ddl(t, "DROP INDEX warehouses_room_name_unique");
      await asApp(t, roomSql, { id: D3, tenant: T, facility: F1, name: "Ruang 1", code: "R-9", kind: "room", floor: "2", deleted: false });
    });
  });

  it("a device's room is of its facility, any location of its tenant — insert and update (23514); a store and its own room accepted; FAIL-BEFORE with the trigger disabled", async () => {
    await inRolledBack(g.db, async (t) => {
      const move = "UPDATE calibration_devices SET location_id = :location WHERE id = :id";
      await refusedForBoth(t, move, { location: R2, id: D1 }, /^23514 calibration device .*room Ruang 1 belongs to another client facility/);
      await refusedForBoth(t, move, { location: STORE9, id: D1 }, /^23514 .*belongs to another tenant/);
      await refusedForBoth(t, deviceSql({ location: true }), { id: D3, tenant: T, facility: F1, location: R2 }, /^23514 .*another client facility/);
      await asApp(t, move, { location: R1, id: D1 });
      await asApp(t, move, { location: STORE, id: D2 });
      await ddl(t, "ALTER TABLE calibration_devices DISABLE TRIGGER calibration_devices_location_facility");
      await asApp(t, move, { location: R2, id: D1 });
    });
  });

  it("a room's facility does not change under its devices (23514); an empty room's may; FAIL-BEFORE with the trigger disabled", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, "UPDATE calibration_devices SET location_id = :r WHERE id = :d", { r: R1, d: D1 });
      await refusedForBoth(t, "UPDATE warehouses SET client_facility_id = :f WHERE id = :r", { f: F2, r: R1 }, /^23514 warehouse .*1 device\(s\) it holds/);
      await asApp(t, "UPDATE warehouses SET client_facility_id = :f, floor = '9' WHERE id = :r", { f: F1, r: R2 });
      await ddl(t, "ALTER TABLE warehouses DISABLE TRIGGER warehouses_room_devices_facility");
      await asApp(t, "UPDATE warehouses SET client_facility_id = :f WHERE id = :r", { f: F2, r: R1 });
    });
  });

  it("a calibration request names THIS device's IPM session (23514), with its time (the pair CHECK); FAIL-BEFORE with the trigger disabled", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, draftSql(), { id: S1, tenant: T, device: D1, user: U1 });
      await asApp(t, draftSql(), { id: S2, tenant: T, device: D2, user: U1 });
      const request = "UPDATE calibration_devices SET calibration_requested_at = now(), calibration_requested_by_session_id = :s WHERE id = :d";
      await refusedForBoth(t, request, { s: S2, d: D1 }, /^23514 calibration device .*names IPM session .*not this device's/);
      await refusedForBoth(t, "UPDATE calibration_devices SET calibration_requested_at = now() WHERE id = :d", { d: D1 }, /^23514 .*calibration_devices_calibration_request/);
      await asApp(t, request, { s: S1, d: D1 });
      await ddl(t, "ALTER TABLE calibration_devices DISABLE TRIGGER calibration_devices_request_same_device");
      await asApp(t, request, { s: S2, d: D1 });
    });
  });

  it("the next date's source: 'manual' when written without one, NULL with no date, an explicit one kept; FAIL-BEFORE: without the trigger today's writers are refused (23514)", async () => {
    await inRolledBack(g.db, async (t) => {
      const source = async (): Promise<unknown> => (await one(t, "SELECT next_calibration_date_source::text AS s FROM calibration_devices WHERE id = :d", { d: D1 }))?.["s"];
      await asApp(t, "UPDATE calibration_devices SET next_calibration_date = now() + interval '1 year' WHERE id = :d", { d: D1 });
      expect(await source()).toBe("manual");
      await asApp(t, "UPDATE calibration_devices SET next_calibration_date = now(), next_calibration_date_source = 'record' WHERE id = :d", { d: D1 });
      expect(await source()).toBe("record");
      await asApp(t, "UPDATE calibration_devices SET next_calibration_date = NULL WHERE id = :d", { d: D1 });
      expect(await source()).toBeNull();
      await ddl(t, "ALTER TABLE calibration_devices DISABLE TRIGGER calibration_devices_next_date_source");
      await refusedForBoth(t, "UPDATE calibration_devices SET next_calibration_date = now() WHERE id = :d", { d: D1 }, /^23514 .*calibration_devices_next_date_has_source/);
    });
  });

  it("the back-fill labels a date that exists 'manual' (P19-05 § 4.2), and leaves a device with no date alone", async () => {
    await inRolledBack(g.db, async (t) => {
      await ddl(t, "ALTER TABLE calibration_devices DISABLE TRIGGER calibration_devices_next_date_source");
      await ddl(t, "ALTER TABLE calibration_devices DROP CONSTRAINT calibration_devices_next_date_has_source");
      await ddl(t, `UPDATE calibration_devices SET next_calibration_date = now() WHERE id = '${D1}'`);
      await ddl(t, g.m0128.BACKFILL_SQL);
      expect(await rows(g.db, `SELECT id, next_calibration_date_source::text AS s FROM calibration_devices WHERE id IN ('${D1}', '${D2}') ORDER BY id`, {}, t)).toEqual([
        { id: D1, s: "manual" },
        { id: D2, s: null },
      ]);
    });
  });

  it("an external date names its lab and carries no results (23514); FAIL-BEFORE without the CHECKs", async () => {
    await inRolledBack(g.db, async (t) => {
      await refusedForBoth(t, recordSql("entry_kind", "'external_date'"), { id: REC }, /^23514 .*calibration_records_external_has_lab/);
      await refusedForBoth(t, recordSql("entry_kind, external_lab_name, standard", "'external_date', 'Lab Sintetis', 'ref'"), { id: REC }, /^23514 .*calibration_records_external_no_results/);
      await asApp(t, recordSql("entry_kind, performer_snapshot", "'external_date', '{\"name\": \"Former upstream user #7\", \"role\": null, \"organisation\": null, \"source\": \"upstream-import\"}'"), { id: REC });
      // The spec's literal predicate (`performer_snapshot->>'source' = …`) is NULL — so PASSES — on a
      // row with no snapshot: ADR-133 Am. 1 § 2's coalesce is what refuses it.
      await ddl(t, "ALTER TABLE calibration_records DROP CONSTRAINT calibration_records_external_has_lab");
      await ddl(
        t,
        "ALTER TABLE calibration_records ADD CONSTRAINT calibration_records_external_has_lab CHECK (entry_kind <> 'external_date' " +
          "OR external_lab_name IS NOT NULL OR api_key_id IS NOT NULL OR performer_snapshot->>'source' = 'upstream-import')",
      );
      await asApp(t, recordSql("entry_kind", "'external_date'"), { id: "d2002000-0000-4000-8000-000000000302" });
    });
  });

  it("the record's new columns are immutable after insert (no UPDATE grant for the app role; the append-only trigger for the owner, 42501); FAIL-BEFORE with it disabled", async () => {
    await inRolledBack(g.db, async (t) => {
      await asApp(t, recordSql("entry_kind, external_lab_name, room_snapshot, floor_snapshot", "'external_date', 'Lab Sintetis', 'Ruang 1', '2'"), { id: REC });
      for (const set of ["entry_kind = 'full_record'", "room_snapshot = 'Ruang 2'", "external_lab_name = 'Lab Lain'", "performer_snapshot = '{\"name\": \"X\", \"role\": null, \"organisation\": null}'"]) {
        const update = `UPDATE calibration_records SET ${set} WHERE id = :id`;
        // The application role holds no UPDATE on the table at all (0057); the owner meets the trigger.
        expect(await errorOf(g.db, t, update, { id: REC })).toMatch(/^42501 permission denied for table calibration_records/);
        expect(await errorOf(g.db, t, update, { id: REC }, null)).toMatch(/^42501 calibration_records is append-only: the content/);
      }
      await ddl(t, "ALTER TABLE calibration_records DISABLE TRIGGER calibration_records_append_only");
      expect(await errorOf(g.db, t, "UPDATE calibration_records SET room_snapshot = 'Ruang 2' WHERE id = :id", { id: REC }, null)).toBeNull();
    });
  });

  it("a photo's purpose is one of four, on its own resource type (23514)", async () => {
    await inRolledBack(g.db, async (t) => {
      await refusedForBoth(t, photoSql, { type: "device", resource: D1, purpose: "ipm_evidence", deleted: false }, /^23514 .*attachments_purpose_resource/);
      await refusedForBoth(t, photoSql, { type: "kanbancard", resource: D1, purpose: "device_front", deleted: false }, /^23514 .*attachments_purpose_resource/);
      await asApp(t, photoSql, { type: "CalibrationDevice", resource: D1, purpose: "device_other", deleted: false });
      // The value list holds on its own (with the resource rule removed, an unknown purpose is still refused).
      await ddl(t, "ALTER TABLE attachments DROP CONSTRAINT attachments_purpose_resource");
      await refusedForBoth(t, photoSql, { type: "device", resource: D1, purpose: "banner", deleted: false }, /^23514 .*attachments_purpose_values/);
      await ddl(t, "ALTER TABLE attachments DROP CONSTRAINT attachments_purpose_values");
      await asApp(t, photoSql, { type: "device", resource: D1, purpose: "banner", deleted: false });
    });
  });

  it("one live front photo per device (23505); a soft-deleted one frees the slot; other purposes repeat; FAIL-BEFORE without the index", async () => {
    await inRolledBack(g.db, async (t) => {
      const front = { type: "device", resource: D1, purpose: "device_front", deleted: false };
      await asApp(t, photoSql, front);
      await refusedForBoth(t, photoSql, front, /^23505 .*attachments_one_live_device_photo/);
      await asApp(t, photoSql, { ...front, purpose: "device_other" });
      await asApp(t, photoSql, { ...front, purpose: "device_other" });
      await asApp(t, photoSql, { ...front, resource: D2 });
      await asApp(t, "UPDATE attachments SET is_deleted = true WHERE resource_id = :d AND purpose = 'device_front'", { d: D1 });
      await asApp(t, photoSql, front);
      await ddl(t, "DROP INDEX attachments_one_live_device_photo");
      await asApp(t, photoSql, front);
    });
  });

  it("an IPM photo takes its session's facility — FAIL-BEFORE: with the previous functions and CHECK it is stored with NO facility; a wrong one is refused at commit", async () => {
    const ipmPhoto = { type: "inspectionsession", resource: S1, purpose: "ipm_evidence", deleted: false };
    const facilityOf = async (t: LiveTx): Promise<unknown> =>
      (await one(t, "SELECT client_facility_id AS f FROM attachments WHERE resource_id = :s", { s: S1 }))?.["f"];
    await inRolledBack(g.db, async (t) => {
      await asApp(t, draftSql(), { id: S1, tenant: T, device: D1, user: U1 });
      for (const sql of Object.values(g.m0129.PREVIOUS)) {
        await ddl(t, sql);
      }
      await ddl(t, "ALTER TABLE attachments DROP CONSTRAINT attachments_facility_kind");
      await ddl(t, `ALTER TABLE attachments ADD CONSTRAINT attachments_facility_kind CHECK (${g.m0129.facilityKindPredicate(g.m0129.OLD_TYPES)})`);
      await asApp(t, `${photoSql}; SET CONSTRAINTS ALL IMMEDIATE`, ipmPhoto);
      expect(await facilityOf(t)).toBeNull();
    });
    await inRolledBack(g.db, async (t) => {
      await asApp(t, draftSql(), { id: S1, tenant: T, device: D1, user: U1 });
      await asApp(t, `${photoSql}; SET CONSTRAINTS ALL IMMEDIATE`, ipmPhoto);
      expect(await facilityOf(t)).toBe(F1);
    });
    await inRolledBack(g.db, async (t) => {
      await asApp(t, draftSql(), { id: S1, tenant: T, device: D1, user: U1 });
      const wrong = photoSql.replace("(id, tenant_id,", "(id, tenant_id, client_facility_id,").replace(`'${T}', :type`, `'${T}', '${F2}', :type`);
      await refusedForBoth(t, `${wrong}; SET CONSTRAINTS ALL IMMEDIATE`, ipmPhoto, /^23514 attachment .*client facility .* is not its inspectionsession/);
    });
  });

  it("under a device move an IPM photo must follow its session (23514 at commit) and can; FAIL-BEFORE: without the follow trigger it stays behind, without the device branch it cannot move (42501)", async () => {
    /** D1 moved F1 → F2 as the app role; `photos` also moves the session's photo. */
    const moveD1 = async (t: LiveTx, photos: boolean): Promise<string | null> => {
      await asApp(t, draftSql(), { id: S1, tenant: T, device: D1, user: U1 });
      await asApp(t, photoSql, { type: "inspectionsession", resource: S1, purpose: "ipm_evidence", deleted: false });
      // The photo's own insert check fires now, before the move (it is deferred to commit otherwise).
      await asApp(t, "SET CONSTRAINTS ALL IMMEDIATE");
      await asApp(t, "SET CONSTRAINTS ALL DEFERRED");
      await asApp(
        t,
        `INSERT INTO client_facility_moves (id, tenant_id, device_id, from_client_facility_id, to_client_facility_id, reason, moved_by, created_at)
         VALUES ('${MOVE}', '${T}', '${D1}', '${F1}', '${F2}', 'Dipindah ke klien lain', '${U1}', now())`,
      );
      await g.db.query(`SELECT set_config('callibrator.facility_move', '${MOVE}', true)`, { transaction: t });
      await asApp(t, `UPDATE calibration_devices SET client_facility_id = '${F2}' WHERE id = '${D1}'`);
      if (photos) {
        const moved = await errorOf(g.db, t, `UPDATE attachments SET client_facility_id = '${F2}', rekey_pending = true WHERE resource_id = '${S1}'`);
        if (moved) {
          return moved;
        }
      }
      await asApp(t, `UPDATE client_facility_moves SET status = 'completed', completed_at = now(), counts = '{}' WHERE id = '${MOVE}'`);
      return errorOf(g.db, t, "SET CONSTRAINTS ALL IMMEDIATE");
    };
    await inRolledBack(g.db, async (t) => {
      expect(await moveD1(t, false)).toMatch(/^23514 inspection_sessions .*still carry the old one/);
    });
    await inRolledBack(g.db, async (t) => {
      expect(await moveD1(t, true)).toBeNull();
      expect(await one(t, "SELECT s.client_facility_id AS s, a.client_facility_id AS a FROM inspection_sessions s JOIN attachments a ON a.resource_id = s.id WHERE s.id = :s", { s: S1 }))
        .toEqual({ s: F2, a: F2 });
    });
    await inRolledBack(g.db, async (t) => {
      await ddl(t, "DROP TRIGGER inspection_sessions_attachments_follow_facility ON inspection_sessions");
      expect(await moveD1(t, false)).toBeNull();
    });
    await inRolledBack(g.db, async (t) => {
      await ddl(t, String(g.m0129.PREVIOUS["facility_resource_device"]));
      expect(await moveD1(t, true)).toMatch(/^42501 attachments: the client facility of .* is changed only by an audited device move/);
    });
  });

  it("schemaVerify passes: every table, column and control object", async () => {
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
  });

  it("a REBOOT on the migrated database: sync() (ensureEnums, showIndex), the migrator (nothing), the schema check", async () => {
    const next = startProcess();
    try {
      await next.db.sync();
      expect(await next.migrator.up()).toEqual([]);
      expect((await next.schemaVerify.verifySchema(next.db)).problems).toEqual([]);
    } finally {
      await next.db.close();
    }
  });

  it("down REFUSES while data would be lost, changing nothing; on unused extensions down ×2 then up ×2 gives the same objects", async () => {
    const qi = g.db.getQueryInterface();
    const objects = async (): Promise<Row[]> =>
      rows(
        g.db,
        `SELECT 'i:' || indexname AS o FROM pg_indexes WHERE tablename IN ('calibration_devices', 'calibration_records', 'warehouses', 'attachments')
         UNION ALL SELECT 'c:' || conname FROM pg_constraint WHERE conrelid::regclass::text IN ('calibration_devices', 'calibration_records', 'warehouses', 'attachments')
         UNION ALL SELECT 't:' || tgname || tgenabled::text FROM pg_trigger WHERE NOT tgisinternal
           AND tgrelid::regclass::text IN ('calibration_devices', 'calibration_records', 'warehouses', 'attachments', 'inspection_sessions')
         UNION ALL SELECT 'f:' || proname || ':' || md5(prosrc) FROM pg_proc WHERE proname LIKE 'facility_resource_%' OR proname IN ('facility_insert_default', 'attachments_facility_matches_resource')
         UNION ALL SELECT 'y:' || typname FROM pg_type WHERE typname LIKE 'enum_calibration_devices_%' OR typname IN ('enum_warehouses_kind', 'enum_calibration_records_entry_kind')
         ORDER BY 1`,
      );
    const before = await objects();
    await g.db.query(`UPDATE calibration_devices SET qr_code = '${QR}' WHERE id = '${D1}'`);
    await g.db.query(`INSERT INTO attachments (id, tenant_id, resource_type, resource_id, purpose, file_name, original_name, created_at, updated_at)
      VALUES ('${MOVE}', '${T}', 'device', '${D1}', 'device_front', 'f', 'f.jpg', now(), now())`);
    await expect(g.m0129.down({ context: qi })).rejects.toThrow(/1 attachment\(s\) with a purpose.*restore the pre-upgrade backup/);
    await g.db.query(`DELETE FROM attachments WHERE id = '${MOVE}'`);
    await g.m0129.down({ context: qi });
    await expect(g.m0128.down({ context: qi })).rejects.toThrow(/1 device\(s\) with a QR.*restore the pre-upgrade backup/);
    expect(await rows(g.db, `SELECT qr_code FROM calibration_devices WHERE id = '${D1}'`)).toEqual([{ qr_code: QR }]);
    await g.db.query(`UPDATE calibration_devices SET qr_code = NULL WHERE id = '${D1}'`);
    // The seeded rooms are data 0128 would destroy too: the suite's own, removed by hand.
    await g.db.query(`DELETE FROM warehouses WHERE id IN ('${R1}', '${R2}')`);
    await g.m0128.down({ context: qi });
    expect(await rows(g.db, "SELECT count(*)::int AS n FROM information_schema.columns WHERE (table_name, column_name) IN (('calibration_devices', 'qr_code'), ('calibration_records', 'entry_kind'), ('attachments', 'purpose')) AND table_schema = current_schema()"))
      .toEqual([{ n: 0 }]);
    const [fn] = await rows(g.db, "SELECT prosrc FROM pg_proc WHERE proname = 'facility_resource_device'");
    expect(String(fn?.["prosrc"])).not.toContain("inspectionsession");
    await g.m0128.up({ context: qi });
    await g.m0129.up({ context: qi });
    await g.db.query(
      `INSERT INTO warehouses (id, tenant_id, client_facility_id, name, code, kind, floor, created_at, updated_at)
       VALUES ('${R1}', '${T}', '${F1}', 'Ruang 1', 'R-0001', 'room', '2', now(), now()), ('${R2}', '${T}', '${F2}', 'Ruang 1', 'R-0002', 'room', '2', now(), now())`,
    );
    expect(await objects()).toEqual(before);
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
    expect(APP_ROLE).toBe("callibrator_app");
  });
});
