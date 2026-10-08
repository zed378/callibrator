/**
 * P20-07 against a REAL PostgreSQL 18 — a device MOVED between two client facilities, as the move
 * operation (P21-09) will do it, AS `callibrator_app` (ADR-124 Am. 2 § 2; spec
 * MEMORY/specs/P19-04-client-facilities.md § 5.1, § 5.4, § 11.2; G-25 `deviceMove.p2007.live`).
 *
 * The spec left one thing "expected, not proven": that the ON UPDATE CASCADE of the composite keys
 * fires the children's triggers correctly WITHOUT the application role's column grants (it has
 * UPDATE on calibration_records' lifecycle columns only — 0057). Proven here:
 *
 *  - the move transaction as callibrator_app: insert the move row (in_progress), name it in
 *    `callibrator.facility_move`, UPDATE the device → records, certificates, work orders, readings
 *    and the NC follow along ONE cascade path each (RI actions run as the table owner), 0057's
 *    replaced trigger and every child guard admit exactly that change; the files of the device and
 *    of every moved child updated (and flagged for re-key); the move completed; the two audit rows
 *    (MOVE_DEVICE_OUT in the old facility, MOVE_DEVICE_IN in the new) written; COMMIT passes the
 *    deferred checks (certificate → record key, AM-7 both sides, the move completed);
 *  - has_column_privilege(callibrator_app, calibration_records.client_facility_id, UPDATE) is false
 *    — so the cascade did not use it;
 *  - under the move, a record's OTHER content is still refused (0057), and a child cannot be moved
 *    to a third facility;
 *  - a move that forgets the files is refused at COMMIT (AM-7 follow); one left in progress too;
 *  - a rolled-back move leaves no move row, no audit row and every child where it was;
 *  - an in-progress move row is invisible to ANOTHER session: naming it there admits nothing;
 *  - a move into a facility already holding the serial is refused (UD-9, per facility).
 *
 *   docker run -d --name p2007-pg18b -e POSTGRES_PASSWORD=p2007pass -p 127.0.0.1:55208:5432 pgvector/pgvector:pg18
 *   P2007_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55208 DB_NAME=p2007move_scratch DB_USER=postgres DB_PASS=p2007pass \
 *     npm test -- src/tests/migrations/deviceMove.p2007.live --coverage=false
 *   docker rm -f p2007-pg18b
 */
import { Sequelize, type Transaction } from "sequelize";
import { env } from "../../config/env";

const live = env("P2007_PG_LIVE_TEST") === "1" ? describe : describe.skip;

const APP_ROLE = "callibrator_app";
const T = "c2007000-0000-4000-8000-000000000001";
const ROLE = "c2007000-0000-4000-8000-000000000002";
const USER = "c2007000-0000-4000-8000-000000000003";
const F1 = "c2007000-0000-4000-8000-0000000000f1";
const F2 = "c2007000-0000-4000-8000-0000000000f2";
const F3 = "c2007000-0000-4000-8000-0000000000f3";
const DEVICE = "c2007000-0000-4000-8000-0000000000d1";
const TWIN = "c2007000-0000-4000-8000-0000000000d2";
const R1 = "c2007000-0000-4000-8000-0000000000e1";
const R2 = "c2007000-0000-4000-8000-0000000000e2";
const MOVE = "c2007000-0000-4000-8000-0000000000a1";

const CHILDREN = ["calibration_records", "certificates", "maintenance_work_orders", "iot_readings", "non_conformances"] as const;

type Row = Record<string, unknown>;

jest.setTimeout(600000);

live("P20-07 — a device move cascades along one path, as callibrator_app (PostgreSQL 18)", () => {
  let admin: Sequelize;
  let db: Sequelize;
  let other: Sequelize;
  let applied: string[] = [];

  const open = (name: string): Sequelize =>
    new Sequelize(name, env("DB_USER") ?? "", env("DB_PASS") ?? "", {
      host: env("DB_HOST") ?? "",
      port: Number(env("DB_PORT") ?? "5432"),
      dialect: "postgres",
      logging: false,
    });

  const q = async (sql: string, transaction?: Transaction, replacements: Record<string, unknown> = {}): Promise<Row[]> =>
    (await db.query(sql, transaction ? { transaction, replacements } : { replacements }))[0] as unknown as Row[];

  /** Where every row of the device is now: table → facility codes. */
  const where = async (): Promise<Record<string, string[]>> => {
    const out: Record<string, string[]> = {};
    for (const table of ["calibration_devices", ...CHILDREN, "attachments"]) {
      const key = table === "calibration_devices" ? "x.id" : table === "attachments" ? "x.resource_id IS NOT NULL AND x.tenant_id" : "x.device_id";
      const value = table === "attachments" ? `'${T}'` : `'${DEVICE}'`;
      const found = await q(
        `SELECT DISTINCT f.code FROM ${table} x JOIN client_facilities f ON f.id = x.client_facility_id WHERE ${key} = ${value} ORDER BY 1`,
      );
      out[table] = found.map((r) => String(r["code"]));
    }
    return out;
  };

  /** The move as P21-09's service will write it, inside `t`, as the application role. */
  const move = async (t: Transaction, { files = true, complete = true, to = F2 } = {}): Promise<void> => {
    await db.query(`SET LOCAL ROLE ${APP_ROLE}`, { transaction: t });
    await db.query(
      `INSERT INTO client_facility_moves (id, tenant_id, device_id, from_client_facility_id, to_client_facility_id, reason, moved_by, created_at)
       VALUES ('${MOVE}', '${T}', '${DEVICE}', '${F1}', '${to}', 'Dipindah ke klien lain', '${USER}', now())`,
      { transaction: t },
    );
    await db.query(`SELECT set_config('callibrator.facility_move', '${MOVE}', true)`, { transaction: t });
    await db.query(`UPDATE calibration_devices SET client_facility_id = '${to}' WHERE id = '${DEVICE}'`, { transaction: t });
    if (files) {
      await db.query(
        `UPDATE attachments SET client_facility_id = '${to}', rekey_pending = true
          WHERE tenant_id = '${T}' AND client_facility_id = '${F1}'
            AND (resource_id = '${DEVICE}' OR resource_id IN (SELECT id FROM calibration_records WHERE device_id = '${DEVICE}')
                 OR resource_id IN (SELECT id FROM certificates WHERE device_id = '${DEVICE}')
                 OR resource_id IN (SELECT id FROM maintenance_work_orders WHERE device_id = '${DEVICE}'))`,
        { transaction: t },
      );
    }
    if (complete) {
      await db.query(
        `UPDATE client_facility_moves SET status = 'completed', completed_at = now(),
                counts = '{"calibration_records": 2, "certificates": 2, "maintenance_work_orders": 1, "iot_readings": 3, "non_conformances": 1, "attachments_rekey": 4}'
          WHERE id = '${MOVE}'`,
        { transaction: t },
      );
    }
    for (const [facility, op] of [[F1, "MOVE_DEVICE_OUT"], [to, "MOVE_DEVICE_IN"]] as const) {
      await db.query(
        `INSERT INTO audit_logs (id, tenant_id, user_id, actor_type, action, resource_type, resource_id, client_facility_id, changes, created_at)
         VALUES (gen_random_uuid(), '${T}', '${USER}', 'user', 'UPDATE', 'CalibrationDevice', '${DEVICE}', '${facility}',
                 jsonb_build_object('operation', '${op}', 'moveId', '${MOVE}', 'from', '${F1}', 'to', '${to}'), now())`,
        { transaction: t },
      );
    }
  };

  const failure = (err: unknown): string => {
    const e = err as { parent?: { code?: string; message?: string }; original?: { code?: string; message?: string } };
    const p = e.parent ?? e.original;
    return `${p?.code ?? "?"} ${p?.message ?? String(err)}`;
  };

  /** Run `work` and COMMIT; the error the database raised (statement or commit), or null. */
  const attempt = async (work: (t: Transaction) => Promise<void>): Promise<string | null> => {
    const t = await db.transaction();
    try {
      await work(t);
    } catch (err) {
      await t.rollback();
      return failure(err);
    }
    try {
      await t.commit();
      return null;
    } catch (err) {
      return failure(err);
    }
  };

  const seed = async (): Promise<void> => {
    const user = `'${USER}'`;
    for (const sql of [
      `INSERT INTO roles (id, name, created_at, updated_at) VALUES ('${ROLE}', 'SUPERVISOR', now(), now())`,
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES ('${T}', 'Penyedia Kalibrasi Sintetis', 'p2007m', 'm@example.test', now(), now())`,
      `INSERT INTO client_facilities (id, tenant_id, name, code, kind, created_at, updated_at) VALUES
         ('${F1}', '${T}', 'Rumah Sakit Asal', 'F-0001', 'hospital', now(), now()),
         ('${F2}', '${T}', 'Klinik Tujuan', 'F-0002', 'clinic', now(), now()),
         ('${F3}', '${T}', 'Puskesmas Lain', 'F-0003', 'health_centre', now(), now())`,
      `INSERT INTO users (id, tenant_id, role_id, username, email, password, first_name, last_name, created_at, updated_at) VALUES (${user}, '${T}', '${ROLE}', 'mover', 'mover@example.test', 'x', 'M', 'V', now(), now())`,
      `INSERT INTO calibration_devices (id, tenant_id, client_facility_id, name, serial_number, created_at, updated_at) VALUES
         ('${DEVICE}', '${T}', '${F1}', 'Infusion pump sintetis', 'SN-MOVE-1', now(), now()),
         ('${TWIN}', '${T}', '${F3}', 'Kembaran', 'SN-MOVE-1', now(), now())`,
      // A record, then its correction (R1 superseded by R2) — the 0057 lifecycle on moved rows.
      `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, created_at, updated_at) VALUES ('${R1}', '${T}', '${DEVICE}', ${user}, now(), now(), now())`,
      `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, supersedes_id, correction_reason, created_at, updated_at) VALUES ('${R2}', '${T}', '${DEVICE}', ${user}, now(), '${R1}', 'Koreksi', now(), now())`,
      `UPDATE calibration_records SET superseded_by_id = '${R2}', superseded_at = now() WHERE id = '${R1}'`,
      `INSERT INTO certificates (id, tenant_id, device_id, calibration_record_id, certificate_number, verification_token, status, created_at, updated_at) VALUES
         (gen_random_uuid(), '${T}', '${DEVICE}', '${R2}', 'CERT-M-1', 'mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm1', 'signed', now(), now()),
         (gen_random_uuid(), '${T}', '${DEVICE}', NULL, 'CERT-M-2', 'mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm2', 'revoked', now(), now())`,
      `INSERT INTO maintenance_work_orders (id, tenant_id, device_id, title, created_at, updated_at) VALUES (gen_random_uuid(), '${T}', '${DEVICE}', 'Servis', now(), now())`,
      `INSERT INTO iot_readings (id, tenant_id, device_id, timestamp, metrics, created_at) SELECT gen_random_uuid(), '${T}', '${DEVICE}', now() - g * interval '1 minute', '{}', now() FROM generate_series(1, 3) g`,
      `INSERT INTO non_conformances (id, tenant_id, nc_number, title, description, reported_by, device_id, date_identified, created_at, updated_at) VALUES (gen_random_uuid(), '${T}', 'NC-M-1', 't', 'd', ${user}, '${DEVICE}', now(), now(), now())`,
      `INSERT INTO attachments (id, tenant_id, resource_type, resource_id, file_name, original_name, storage_key, created_at, updated_at) VALUES
         (gen_random_uuid(), '${T}', 'device', '${DEVICE}', 'a', 'a.jpg', 't/${T}/attachments/a.jpg', now(), now()),
         (gen_random_uuid(), '${T}', 'calibrationrecord', '${R1}', 'b', 'b.pdf', NULL, now(), now()),
         (gen_random_uuid(), '${T}', 'Certificate', (SELECT id FROM certificates WHERE certificate_number = 'CERT-M-1'), 'c', 'c.pdf', NULL, now(), now()),
         (gen_random_uuid(), '${T}', 'workorder', (SELECT id FROM maintenance_work_orders WHERE device_id = '${DEVICE}'), 'd', 'd.jpg', NULL, now(), now())`,
    ]) {
      await db.query(sql).catch((e: unknown) => {
        throw new Error(`seed failed: ${failure(e)} — ${sql.slice(0, 90)}`);
      });
    }
  };

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to rebuild DB_NAME="${name}": use a scratch database (see the header)`);
    }
    admin = open("postgres");
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
    let migrator: { up(): Promise<{ name: string }[]> } | undefined;
    /* eslint-disable @typescript-eslint/no-require-imports -- the real boot step (models, sync, migrator) on the scratch database */
    jest.isolateModules(() => {
      db = (require("../../config") as { db: Sequelize }).db;
      (db as unknown as { options: { logging: unknown } }).options.logging = false;
      require("../../models");
      migrator = (require("../../config/migrator") as { migrator: { up(): Promise<{ name: string }[]> } }).migrator;
    });
    /* eslint-enable @typescript-eslint/no-require-imports */
    await db.sync();
    applied = (await migrator?.up() ?? []).map((m) => m.name);
    other = open(name);
  });

  afterAll(async () => {
    await other.close();
    await db.close();
    await admin.close();
  });

  it("the schema: every migration applied; the cascade cannot borrow a grant the app role does not have", async () => {
    // The seven of P20-07, in order (later migrations — 0124, P20-06 — follow them).
    const first = applied.indexOf("0117-client-facilities.js");
    expect(applied.slice(first, first + 7)).toEqual([
      "0117-client-facilities.js", "0118-facility-devices.js", "0119-facility-calibration-records.js", "0120-facility-certificates.js",
      "0121-facility-work-orders.js", "0122-facility-iot-readings.js", "0123-facility-nullable.js",
    ]);
    await seed();
    expect(
      await q(`SELECT has_column_privilege('${APP_ROLE}', 'calibration_records', 'client_facility_id', 'UPDATE') AS records,
                      has_column_privilege('${APP_ROLE}', 'certificates', 'client_facility_id', 'UPDATE') AS certificates`),
    ).toEqual([{ records: false, certificates: true }]);
    expect(await where()).toEqual(Object.fromEntries(["calibration_devices", ...CHILDREN, "attachments"].map((t) => [t, ["F-0001"]])));
  });

  it("a move that forgets the files is refused at COMMIT (AM-7 follow) — and leaves everything where it was", async () => {
    expect(await attempt((t) => move(t, { files: false }))).toMatch(/^23514 .*client facility changed but \d attachment\(s\) still carry the old one/);
    expect((await where())["calibration_records"]).toEqual(["F-0001"]);
    expect(await q("SELECT count(*)::int AS n FROM client_facility_moves")).toEqual([{ n: 0 }]);
  });

  it("a move left in progress is refused at COMMIT", async () => {
    expect(await attempt((t) => move(t, { complete: false }))).toMatch(/^23514 device move .* was not completed in its transaction/);
    expect(await q("SELECT count(*)::int AS n FROM audit_logs WHERE resource_type = 'CalibrationDevice'")).toEqual([{ n: 0 }]);
  });

  it("a move into a facility already holding the serial is refused (UD-9: unique per facility)", async () => {
    expect(await attempt((t) => move(t, { to: F3 }))).toMatch(/^23505 .*calibration_devices_tenant_facility_serial_unique/);
  });

  it("under the move, a record's other content is still immutable, and a child cannot go to a third facility", async () => {
    expect(
      await attempt(async (t) => {
        await move(t);
        await db.query(`UPDATE calibration_records SET client_facility_id = '${F3}' WHERE id = '${R1}'`, { transaction: t });
      }),
    ).toMatch(/^42501 /);
    expect(
      await attempt(async (t) => {
        await move(t);
        await db.query(`UPDATE calibration_records SET standard = 'diubah' WHERE id = '${R1}'`, { transaction: t });
      }),
    ).toMatch(/^42501 /);
    expect((await where())["calibration_devices"]).toEqual(["F-0001"]);
  });

  it("an in-progress move row is invisible to another session: naming it there admits nothing", async () => {
    const t = await db.transaction();
    try {
      await db.query(`SET LOCAL ROLE ${APP_ROLE}`, { transaction: t });
      await db.query(
        `INSERT INTO client_facility_moves (id, tenant_id, device_id, from_client_facility_id, to_client_facility_id, reason, moved_by, created_at)
         VALUES ('${MOVE}', '${T}', '${DEVICE}', '${F1}', '${F2}', 'x', '${USER}', now())`,
        { transaction: t },
      );
      const t2 = await other.transaction();
      try {
        await other.query(`SET LOCAL ROLE ${APP_ROLE}`, { transaction: t2 });
        await other.query(`SELECT set_config('callibrator.facility_move', '${MOVE}', true)`, { transaction: t2 });
        // The check every guard makes (an UPDATE here would only wait on session 1's key lock on the device).
        const admits = `SELECT facility_move_admits('${T}', '${DEVICE}', '${F1}', '${F2}') AS ok`;
        expect((await other.query(admits, { transaction: t2 }))[0]).toEqual([{ ok: false }]);
        await db.query(`SELECT set_config('callibrator.facility_move', '${MOVE}', true)`, { transaction: t });
        expect((await db.query(admits, { transaction: t }))[0]).toEqual([{ ok: true }]);
      } finally {
        await t2.rollback();
      }
    } finally {
      await t.rollback();
    }
  });

  it("THE MOVE, as callibrator_app: every child follows along one cascade path, the files are moved and flagged, two audit rows — committed", async () => {
    const auditBefore = await q("SELECT count(*)::int AS n FROM audit_logs");
    expect(await attempt((t) => move(t))).toBeNull();
    expect(await where()).toEqual(Object.fromEntries(["calibration_devices", ...CHILDREN, "attachments"].map((t) => [t, ["F-0002"]])));
    // Nothing else of a record changed: the correction chain and the void/supersession stamps are intact.
    expect(await q("SELECT id, supersedes_id, superseded_by_id IS NOT NULL AS superseded FROM calibration_records ORDER BY id")).toEqual([
      { id: R1, supersedes_id: null, superseded: true },
      { id: R2, supersedes_id: R1, superseded: false },
    ]);
    expect(await q("SELECT count(*)::int AS n FROM attachments WHERE rekey_pending")).toEqual([{ n: 4 }]);
    expect(await q("SELECT status::text, completed_at IS NOT NULL AS done, counts->>'iot_readings' AS iot FROM client_facility_moves")).toEqual([
      { status: "completed", done: true, iot: "3" },
    ]);
    expect(
      await q(`SELECT f.code, a.changes->>'operation' AS op FROM audit_logs a JOIN client_facilities f ON f.id = a.client_facility_id
                WHERE a.resource_type = 'CalibrationDevice' ORDER BY f.code`),
    ).toEqual([
      { code: "F-0001", op: "MOVE_DEVICE_OUT" },
      { code: "F-0002", op: "MOVE_DEVICE_IN" },
    ]);
    expect(await q("SELECT count(*)::int AS n FROM audit_logs")).toEqual([{ n: Number(auditBefore[0]?.["n"]) + 2 }]);
    // The completed move is final.
    const err = await attempt(async (t) => {
      await db.query(`UPDATE client_facility_moves SET status = 'in_progress', completed_at = NULL WHERE id = '${MOVE}'`, { transaction: t });
    });
    expect(err).toMatch(/^42501 .*only completes, once/);
    // And a completed move admits nothing later: naming it again cannot move the device back.
    expect(
      await attempt(async (t) => {
        await db.query(`SELECT set_config('callibrator.facility_move', '${MOVE}', true)`, { transaction: t });
        await db.query(`UPDATE calibration_devices SET client_facility_id = '${F1}' WHERE id = '${DEVICE}'`, { transaction: t });
      }),
    ).toMatch(/^42501 .*changed only by an audited device move/);
  });
});
