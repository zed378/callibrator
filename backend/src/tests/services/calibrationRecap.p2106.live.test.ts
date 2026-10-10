/**
 * P21-06 against a REAL PostgreSQL 18, AS `callibrator_app`: the recap's latest-per-device read
 * (`calibrationRecap#latestRecordPage`, one `sql()` with DISTINCT ON) — the G-14 live twin of the
 * memoryDb suite that answers the statement (`calibrationRecords.recap.p2106`).
 *
 *  - provider staff: one row per device — its latest record that is not voided, by calibration
 *    date — paged and counted by the read; filters applied before the pick (entry kind, the input
 *    date's range on `created_at`);
 *  - a facility-BOUND F1 reader: F1's device only (the bound facility clause, G-14), and naming F2
 *    reads nothing (G-22);
 *  - the rows come back through the models with their recap facts.
 *
 *   docker run -d --name p2106-pg18 -e POSTGRES_PASSWORD=p2106pass \
 *     -p 127.0.0.1:55217:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=55217 DB_NAME=p2106_scratch \
 *     DB_USER=postgres DB_PASS=p2106pass npm run test:live:jest -- src/tests/services/calibrationRecap.p2106.live
 *   docker rm -f p2106-pg18
 * (or `npm run test:live -- --only=p2106`)
 *
 * Synthetic values only.
 */
import { seedSql, type LiveDb } from "../fixtures/ipmLive";
import type RecordService from "../../services/calibrationRecords.service";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import type * as LiveBoot from "../fixtures/liveBoot";
import type { ClientFacilityId, TenantId } from "../../types/ids";

const T = "c2106000-0000-4000-8000-000000000001";
const ROLE = "c2106000-0000-4000-8000-000000000002";
const U1 = "c2106000-0000-4000-8000-0000000000a1";
const F1 = "c2106000-0000-4000-8000-0000000000f1";
const F2 = "c2106000-0000-4000-8000-0000000000f2";
const D1 = "c2106000-0000-4000-8000-0000000000d1";
const D2 = "c2106000-0000-4000-8000-0000000000d2";
/** D1: an old full record, the newest (external), a newer one VOIDED. D2: one full record. */
const R = Object.freeze({
  D1_OLD: "c2106000-0000-4000-8000-0000000001a1",
  D1_NEW: "c2106000-0000-4000-8000-0000000001a2",
  D1_VOID: "c2106000-0000-4000-8000-0000000001a3",
  D2_ONE: "c2106000-0000-4000-8000-0000000001b1",
});

interface Graph {
  db: LiveDb;
  migrator: { up(options?: object): Promise<{ name: string }[]> };
  records: typeof RecordService;
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
      records: require("../../services/calibrationRecords.service") as typeof RecordService,
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

describe("P21-06 — the recap's latest-per-device read on PostgreSQL 18, as callibrator_app", () => {
  let g: Graph;
  const as = <R>(bound: boolean, work: () => Promise<R>): Promise<R> =>
    g.tenantStorage.run(
      { tenantId: T as TenantId, isSuperAdmin: false, isSystemTask: false, userId: U1, clientFacilityId: (bound ? F1 : null) as ClientFacilityId | null, facilityBound: bound },
      work,
    );
  const ids = (out: { data: { rows: unknown[] } }): string[] => out.data.rows.map((r) => (r as { id: string }).id);

  beforeAll(async () => {
    g = startProcess();
    await g.db.sync();
    await g.migrator.up();
    for (const sql of seedSql({ tenant: T, role: ROLE, users: [U1], facilities: [[F1, "F-2106-1"], [F2, "F-2106-2"]], devices: [[D1, F1, "SN-2106-1"], [D2, F2, "SN-2106-2"]], tag: "p2106" })) {
      await g.db.query(sql);
    }
    await g.db.query(
      `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, entry_kind, external_lab_name, is_deleted, void_reason, voided_by, created_at, updated_at) VALUES
         (:old, :t, :d1, :u, '2025-01-10', 'full_record', NULL, false, NULL, NULL, '2025-01-11 03:00+00', now()),
         (:new, :t, :d1, :u, '2026-01-10', 'external_date', 'Lab Sintetis', false, NULL, NULL, '2026-01-12 03:00+00', now()),
         (:void, :t, :d1, :u, '2026-06-10', 'full_record', NULL, true, 'entered in error', :u, '2026-06-11 03:00+00', now()),
         (:two, :t, :d2, :u, '2026-03-10', 'full_record', NULL, false, NULL, NULL, '2026-03-11 03:00+00', now())`,
      { replacements: { t: T, u: U1, d1: D1, d2: D2, old: R.D1_OLD, new: R.D1_NEW, void: R.D1_VOID, two: R.D2_ONE } },
    );
    await g.boot.enterAppRole(g.db as unknown as Parameters<typeof LiveBoot.enterAppRole>[0]);
  }, 300_000);

  afterAll(async () => {
    await g.db.close();
  });

  it("provider staff: one row per device, the latest not voided, by calibration date; counted by the read", async () => {
    const out = await as(false, () => g.records.fetchCalibrationRecords({ tenantId: T as TenantId, latestOnly: true, page: 1, limit: 20 }));
    expect([ids(out), out.data.meta.total]).toEqual([[R.D2_ONE, R.D1_NEW], 2]);
    const page2 = await as(false, () => g.records.fetchCalibrationRecords({ tenantId: T as TenantId, latestOnly: true, page: 2, limit: 1 }));
    expect([ids(page2), page2.data.meta.total]).toEqual([[R.D1_NEW], 2]);
  });

  it("filters apply before the pick: a full record only → D1's OLD one; the input range on created_at", async () => {
    const full = await as(false, () => g.records.fetchCalibrationRecords({ tenantId: T as TenantId, latestOnly: true, entryKind: "full_record" }));
    const input2025 = await as(false, () =>
      g.records.fetchCalibrationRecords({ tenantId: T as TenantId, latestOnly: true, dateField: "created", fromDay: "2025-01-01", toDay: "2025-12-31", sort: "createdAt" }),
    );
    expect([ids(full).sort(), ids(input2025)]).toEqual([[R.D1_OLD, R.D2_ONE].sort(), [R.D1_OLD]]);
  });

  it("a facility-bound F1 reader: F1's device only (G-14); F2 named → nothing (G-22)", async () => {
    const own = await as(true, () => g.records.fetchCalibrationRecords({ tenantId: T as TenantId, latestOnly: true }));
    const foreign = await as(true, () => g.records.fetchCalibrationRecords({ tenantId: T as TenantId, latestOnly: true, clientFacilityId: F2 }));
    const foreignList = await as(true, () => g.records.fetchCalibrationRecords({ tenantId: T as TenantId, clientFacilityId: F2 }));
    expect([ids(own), ids(foreign), ids(foreignList)]).toEqual([[R.D1_NEW], [], []]);
  });
});
