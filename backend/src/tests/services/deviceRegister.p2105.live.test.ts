/**
 * P21-02a + P21-05 against a REAL PostgreSQL 18, AS `callibrator_app` (liveBoot#enterAppRole):
 * the register's writes and the calibration dates meet 0128's CHECKs and triggers and the grants
 * that memoryDb does not have.
 *
 *  - a device created with a QR and a room found-or-created: the room INSERT (warehouses, kind
 *    `room`, the device's facility), the QR shape CHECK, `calibration_devices_location_facility`,
 *    the explicit `manual` source the source trigger keeps; the QR lookup by the normalised value;
 *    a taken QR is the service's 409 (no 23505 reaches the caller);
 *  - the quick entry: an `external_date` record the external CHECKs admit (a laboratory, no
 *    results), the explicit `record` source, the derived date; a same-day entry with a notice;
 *  - G-11 on the real schema: an older full record does not move the date back; voiding the
 *    newest falls back to the previous record (the void's lifecycle UPDATE as the app role);
 *  - the effective-record read MEASURED (ADR-133 Am. 2 § 3): over 20,000 records of 2,000 devices,
 *    the per-device latest read (an index scan) and the page read (200 devices); the plans and
 *    times are written to stdout for the record, each under 100 ms.
 *
 *   docker run -d --name p2105-pg18 -e POSTGRES_PASSWORD=p2105pass \
 *     -p 127.0.0.1:55215:5432 pgvector/pgvector:pg18
 *   P2105_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55215 DB_NAME=p2105_scratch \
 *     DB_USER=postgres DB_PASS=p2105pass npm test -- src/tests/services/deviceRegister.p2105.live --coverage=false
 *   docker rm -f p2105-pg18
 * (or `npm run test:live -- --only=p2105`)
 *
 * Synthetic values only (QR prefix `TST`).
 */
import { env } from "../../config/env";
import { rows, seedSql, type LiveDb, type Row } from "../fixtures/ipmLive";
import type DeviceService from "../../services/calibrationDevices.service";
import type RecordService from "../../services/calibrationRecords.service";
import type * as DatesService from "../../services/calibrationDates.service";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import type * as LiveBoot from "../fixtures/liveBoot";
import type { ClientFacilityId, TenantId, UserId } from "../../types/ids";

const live = env("P2105_PG_LIVE_TEST") === "1" ? describe : describe.skip;

const T = "c2105000-0000-4000-8000-000000000001";
const ROLE = "c2105000-0000-4000-8000-000000000002";
const U1 = "c2105000-0000-4000-8000-0000000000a1";
const F1 = "c2105000-0000-4000-8000-0000000000f1";
const F2 = "c2105000-0000-4000-8000-0000000000f2";
const D1 = "c2105000-0000-4000-8000-0000000000d1";
/** The page read as Sequelize sends it: a literal list of 200 device ids. */
const PAGE_IDS = Array.from({ length: 200 }, (_, n) => `'c2105000-0000-4000-8001-${(n + 1).toString(16).padStart(12, "0")}'`).join(", ");

interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<{ name: string }[]> };
  devices: typeof DeviceService;
  records: typeof RecordService;
  dates: typeof DatesService;
  tenantStorage: typeof TenantContext.tenantStorage;
  boot: typeof LiveBoot;
}

/* eslint-disable @typescript-eslint/no-require-imports -- one module graph, loaded in isolation; typed by the members used */
const startProcess = (): Graph => {
  let graph: Graph | undefined;
  jest.isolateModules(() => {
    const db = (require("../../config") as { db: LiveDb }).db;
    db.options.logging = false;
    require("../../models");
    graph = {
      db,
      migrator: (require("../../config/migrator") as { migrator: Graph["migrator"] }).migrator,
      devices: require("../../services/calibrationDevices.service") as typeof DeviceService,
      records: require("../../services/calibrationRecords.service") as typeof RecordService,
      dates: require("../../services/calibrationDates.service") as typeof DatesService,
      tenantStorage: (require("../../middlewares/tenantContext.middleware") as typeof TenantContext).tenantStorage,
      boot: require("../fixtures/liveBoot") as typeof LiveBoot,
    };
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

live("P21-02a + P21-05 — the register and the calibration dates on PostgreSQL 18, as callibrator_app", () => {
  let g: Graph;
  const ctx = <R>(work: () => Promise<R>): Promise<R> =>
    g.tenantStorage.run({ tenantId: T as TenantId, isSuperAdmin: false, isSystemTask: false, userId: U1, clientFacilityId: null as ClientFacilityId | null, facilityBound: false }, work);
  const actor = { userId: U1, apiKeyId: null, ipAddress: "127.0.0.1", userAgent: "live" };
  const one = async (sql: string, replacements: object = {}): Promise<Row> => (await rows(g.db, sql, replacements))[0] as Row;
  const nextDate = async (device: string): Promise<{ date: string | null; source: unknown }> => {
    const row = await one("SELECT to_char(next_calibration_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, next_calibration_date_source::text AS s FROM calibration_devices WHERE id = :d", { d: device });
    return { date: (row["d"] as string | null) ?? null, source: row["s"] ?? null };
  };

  beforeAll(async () => {
    g = startProcess();
    await g.db.sync();
    await g.migrator.up();
    for (const sql of seedSql({ tenant: T, role: ROLE, users: [U1], facilities: [[F1, "F-2105-1"], [F2, "F-2105-2"]], devices: [[D1, F1, "SN-2105-1"]], tag: "p2105" })) {
      await g.db.query(sql);
    }
    await g.db.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, created_at, updated_at) VALUES
         (gen_random_uuid(), :t, 'device_qr_code_prefix', 'TST', now(), now()),
         (gen_random_uuid(), :t, 'tenant_time_zone', 'UTC', now(), now())`,
      { replacements: { t: T } },
    );
    await g.db.query("UPDATE calibration_devices SET status = 'active', calibration_interval_days = 365 WHERE tenant_id = :t", { replacements: { t: T } });
    // The measured volume: 2,000 devices of F2 with 10 records each (one in ten superseded, one in twenty voided).
    await g.db.query(
      `INSERT INTO calibration_devices (id, tenant_id, client_facility_id, name, status, created_at, updated_at)
       SELECT ('c2105000-0000-4000-8001-' || lpad(to_hex(n), 12, '0'))::uuid, :t, :f2, 'Alat volume ' || n, 'active', now(), now()
         FROM generate_series(1, 2000) AS n`,
      { replacements: { t: T, f2: F2 } },
    );
    await g.db.query(
      `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, is_deleted, created_at, updated_at)
       SELECT gen_random_uuid(), :t, ('c2105000-0000-4000-8001-' || lpad(to_hex(d), 12, '0'))::uuid, :u,
              timestamp '2016-01-01' + (r || ' years')::interval, (r % 20 = 0), now(), now()
         FROM generate_series(1, 2000) AS d, generate_series(1, 10) AS r`,
      { replacements: { t: T, u: U1 } },
    );
    await g.db.query("ANALYZE calibration_records");
    await g.boot.enterAppRole(g.db as unknown as Parameters<typeof LiveBoot.enterAppRole>[0]);
  }, 300_000);

  afterAll(async () => {
    await g.db.close();
  });

  it("a device with a QR and a room found or created: the room row, the QR's shape, the location trigger, `manual`", async () => {
    const created = await ctx(() =>
      g.devices.createCalibrationDevice(T as TenantId, { name: "Alat QR", clientFacilityId: F1, qrCode: "42", room: { name: "Ruang Sintetis", floor: "2" }, nextCalibrationDate: "2027-01-01T00:00:00.000Z" }, actor),
    );
    expect(created.status).toBe(201);
    const id = String((created.data as unknown as Row)["id"]);
    const row = await one(
      `SELECT d.qr_code, d.next_calibration_date_source::text AS source, w.kind::text AS kind, w.client_facility_id AS facility, d.registrant_snapshot->>'name' AS registrant
         FROM calibration_devices d JOIN warehouses w ON w.id = d.location_id WHERE d.id = :id`,
      { id },
    );
    expect(row).toEqual({ qr_code: "TST000042", source: "manual", kind: "room", facility: F1, registrant: "T 0" });
    const again = await ctx(() => g.devices.createCalibrationDevice(T as TenantId, { name: "Alat QR 2", clientFacilityId: F1, room: { name: "ruang  sintetis", floor: "2" } }, actor));
    expect(String((await one("SELECT location_id FROM calibration_devices WHERE id = :id", { id: (again.data as unknown as Row)["id"] }))["location_id"])).toBe(
      String((await one("SELECT location_id FROM calibration_devices WHERE id = :id", { id }))["location_id"]),
    );
    const found = await ctx(() => g.devices.fetchCalibrationDeviceByQr(T as TenantId, "tst 000042", U1));
    expect(found.data?.["id"]).toBe(id);
    await expect(ctx(() => g.devices.createCalibrationDevice(T as TenantId, { name: "Alat dup", clientFacilityId: F1, qrCode: "42" }, actor))).rejects.toMatchObject({
      status: 409,
      publicCode: "DEVICE_QR_TAKEN",
    });
  });

  it("the quick entry: an external date the CHECKs admit, `record`, the derived date, a same-day notice", async () => {
    const first = await ctx(() => g.dates.recordExternalCalibration(T as TenantId, { calibrationDeviceId: D1, calibrationDate: "2026-09-01", externalLabName: "Lab Sintetis", dueDate: "2027-08-15" }, actor));
    expect(first.record).toMatchObject({ entryKind: "external_date", externalLabName: "Lab Sintetis" });
    expect(await nextDate(D1)).toEqual({ date: "2027-08-15", source: "record" });
    const again = await ctx(() => g.dates.recordExternalCalibration(T as TenantId, { calibrationDeviceId: D1, calibrationDate: "2026-09-01", externalLabName: "Lab Sintetis" }, actor));
    expect(again.notices).toHaveLength(1);
    expect(await nextDate(D1)).toEqual({ date: "2027-09-01", source: "record" });
  });

  it("G-11: an older full record keeps the date; voiding the newest falls back", async () => {
    const before = await nextDate(D1);
    const older = await ctx(() => g.records.createCalibrationRecord(T as TenantId, U1 as UserId, { deviceId: D1, calibrationDate: "2024-01-01T00:00:00.000Z" }, actor));
    expect(older.status).toBe(201);
    expect(await nextDate(D1)).toEqual(before);
    const newest = await one("SELECT id FROM calibration_records WHERE device_id = :d AND superseded_by_id IS NULL AND is_deleted = false ORDER BY calibration_date DESC, created_at DESC, id DESC LIMIT 1", { d: D1 });
    const voided = await ctx(() => g.records.voidCalibrationRecord(T as TenantId, U1 as UserId, String(newest["id"]), { reason: "entered in error" }, actor));
    expect(voided.status).toBe(200);
    // The remaining newest is the first quick entry (2026-09-01, stated due 2027-08-15).
    expect(await nextDate(D1)).toEqual({ date: "2027-08-15", source: "record" });
  });

  it("MEASURED: the effective-record reads over 20,000 records (ADR-133 Am. 2 § 3)", async () => {
    const plan = async (sql: string): Promise<{ text: string; ms: number }> => {
      const out = await rows(g.db, `EXPLAIN (ANALYZE, BUFFERS) ${sql}`, { t: T });
      const text = out.map((r) => String(r["QUERY PLAN"])).join("\n");
      const ms = Number(/Execution Time: ([\d.]+) ms/.exec(text)?.[1] ?? "NaN");
      return { text, ms };
    };
    const latest = await plan(
      `SELECT id, calibration_date, due_date FROM calibration_records
        WHERE tenant_id = :t AND device_id = 'c2105000-0000-4000-8001-0000000003e8' AND superseded_by_id IS NULL AND is_deleted = false AND deleted_at IS NULL
        ORDER BY calibration_date DESC, created_at DESC, id DESC LIMIT 1`,
    );
    const page = await plan(
      `SELECT id, device_id, calibration_date FROM calibration_records
        WHERE tenant_id = :t AND device_id IN (${PAGE_IDS})
          AND superseded_by_id IS NULL AND is_deleted = false AND deleted_at IS NULL
        ORDER BY calibration_date DESC, created_at DESC, id DESC`,
    );
    process.stdout.write(`\n[p2105 measure] latest-effective (one device):\n${latest.text}\n[p2105 measure] page (200 devices):\n${page.text}\n`);
    // The per-device read is an index scan (0119's (tenant_id, client_facility_id, device_id)); the page
    // read reads a tenth of this table, where a sequential scan is a fair plan. Both stay cheap.
    expect(latest.text).toMatch(/Index (Only )?Scan using calibration_records_/);
    for (const p of [latest, page]) {
      expect(p.ms).toBeLessThan(100);
    }
  });
});
