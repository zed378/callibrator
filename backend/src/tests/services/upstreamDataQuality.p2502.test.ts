/**
 * P25-02 — services/upstreamDataQuality.service.ts on the REAL models and
 * the REAL tenant hooks over the in-memory store (fixtures/memoryDb).
 * Doubled: the transform connection, answering each statement by its shape —
 * the SQL itself runs on PostgreSQL 18 in upstreamTransform.p2402g.live
 * ("P25-01/P25-02 on the IPM world").
 *
 * What it holds: a report runs only for a TRANSFORMED run of a provider
 * tenant (404 `UPSTREAM_SQL_IMPORT_NOT_FOUND`, 409 `RUN_NOT_TRANSFORMED`),
 * only on the transform role; every number is a count per facility, never
 * a value; the run totals carry every quarantine group, a facility row only
 * the groups with a facility; a finding not automated answers `manual`.
 *
 * TypeScript without jest's hoisting: the mocks are registered first, then
 * every runtime module is loaded with `jest.requireActual`.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as ServiceModule from "../../services/upstreamDataQuality.service";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const HOME = "a2502000-0000-4000-8000-0000000000a1";
const RUN = "a2502000-0000-4000-8000-0000000000e1";
const OTHER = "a2502000-0000-4000-8000-0000000000e2";
const F1 = "a2502000-0000-4000-8000-0000000000f1";
const F2 = "a2502000-0000-4000-8000-0000000000f2";

/** What the doubled database answers. */
const db = {
  role: "callibrator_transform",
  quarantine: [] as { facilityId: string | null; sourceTable: string; reason: string; n: number }[],
  perFacility: [] as { facilityId: string; n: number }[],
  present: false,
};
const close = jest.fn(() => Promise.resolve());
/** The transform connection as `sql()` sees it: `query(text, { type, bind, transaction })`. */
const query = jest.fn((text: string) => {
  if (text.includes("current_user")) {
    return Promise.resolve([{ currentUser: db.role }]);
  }
  if (text.includes("AS present")) {
    return Promise.resolve([{ present: db.present }]);
  }
  if (text.includes('"sourceTable"')) {
    return Promise.resolve(db.quarantine);
  }
  return Promise.resolve(db.perFacility);
});
const transaction = jest.fn((fn: (t: object) => Promise<unknown>) => fn({}));
const connection = { close, transaction, query };
jest.mock("../../config/upstreamImport", () => ({
  ...jest.requireActual<object>("../../config/upstreamImport"),
  createTransformDb: () => connection,
  transformRoleName: () => "callibrator_transform",
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const service = jest.requireActual<typeof ServiceModule>("../../services/upstreamDataQuality.service");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the tenant context, loaded after the config mock
const { tenantStorage } = require("../../middlewares/tenantContext.middleware") as { tenantStorage: { run(ctx: object, fn: () => void): void } };

const asSuperAdmin = <T>(work: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    tenantStorage.run({ tenantId: null, isSuperAdmin: true, isSystemTask: false }, () => {
      work().then(resolve, reject);
    });
  });

const seedRun = (id: string, values: Record<string, unknown> = {}): void => {
  mdb.seed("UpstreamSqlImport", {
    id,
    status: "loaded",
    transformStatus: "transformed",
    dataClass: "synthetic",
    compression: "none",
    sizeBytes: 1,
    sha256: "d".repeat(64),
    uploadedBy: null,
    notifyTenantId: HOME,
    transformTenantId: HOME,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...values,
  });
};

beforeEach(() => {
  mdb.reset();
  jest.clearAllMocks();
  Object.assign(db, { role: "callibrator_transform", quarantine: [], perFacility: [], present: false });
  mdb.seed("ClientFacility", [
    { id: F1, tenantId: HOME, code: "F-0001", name: "Satu", kind: "hospital", status: "active" },
    { id: F2, tenantId: HOME, code: "F-0002", name: "Dua", kind: "clinic", status: "active" },
  ]);
});

describe("P25-02 the data-quality report", () => {
  it("refuses an unknown run (404) and a run that is not transformed or names no provider (409), each with its code", async () => {
    await expect(asSuperAdmin(() => service.reportDataQuality(RUN))).rejects.toMatchObject({ status: 404, publicCode: "UPSTREAM_SQL_IMPORT_NOT_FOUND" });
    seedRun(RUN, { transformStatus: "transforming" });
    await expect(asSuperAdmin(() => service.reportDataQuality(RUN))).rejects.toMatchObject({ status: 409, publicCode: "RUN_NOT_TRANSFORMED" });
    seedRun(OTHER, { transformTenantId: null });
    await expect(asSuperAdmin(() => service.reportDataQuality(OTHER))).rejects.toMatchObject({ status: 409, publicCode: "RUN_NOT_TRANSFORMED" });
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses a connection that is not the transform role (500), and closes it", async () => {
    seedRun(RUN);
    db.role = "postgres";
    await expect(asSuperAdmin(() => service.reportDataQuality(RUN))).rejects.toMatchObject({ status: 500 });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("a clean run: every computed finding passes; Q-28 stays manual (unreferenced files are the manifest's)", async () => {
    seedRun(RUN);
    const answer = await asSuperAdmin(() => service.reportDataQuality(RUN));
    expect(answer).toMatchObject({ runId: RUN, providerTenantId: HOME, totals: [] });
    expect(answer.facilities.map((f) => [f.clientFacilityId, f.facilityCode, f.quarantine])).toEqual([
      [F1, "F-0001", []],
      [F2, "F-0002", []],
    ]);
    for (const row of answer.facilities) {
      expect(Object.keys(row).sort()).toEqual(["clientFacilityId", "facilityCode", "findings", "quarantine"]);
      expect(row.findings.map((f) => [f.finding, f.status, f.count])).toEqual([
        ["Q-18", "pass", 0],
        ["Q-19", "pass", 0],
        ["Q-12", "pass", 0],
        ["Q-13", "pass", 0],
        ["Q-4", "pass", 0],
        ["Q-14", "pass", 0],
        ["Q-28", "manual", 0],
      ]);
      expect(row.findings.find((f) => f.finding === "Q-28")?.note).toContain("unreferenced files on disk are not counted");
    }
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("counts are per facility; the totals carry every quarantine group, a facility row only its own", async () => {
    seedRun(RUN);
    db.perFacility = [{ facilityId: F1, n: 2 }];
    db.quarantine = [
      { facilityId: null, sourceTable: "trx_hasil_pemeriksaan", reason: "no_device", n: 3 },
      { facilityId: F1, sourceTable: "trx_inventory", reason: "facility_changed", n: 1 },
      { facilityId: F1, sourceTable: "trx_kalibrasi", reason: "no_device", n: 1 },
      { facilityId: null, sourceTable: "trx_inventory", reason: "facility_changed", n: 2 },
    ];
    const answer = await asSuperAdmin(() => service.reportDataQuality(RUN));
    const [f1, f2] = answer.facilities;
    expect(f1?.findings.slice(0, 4).map((f) => [f.finding, f.status, f.count])).toEqual([
      ["Q-18", "flagged", 2],
      ["Q-19", "flagged", 2],
      ["Q-12", "flagged", 2],
      ["Q-13", "flagged", 2],
    ]);
    expect(f2?.findings.slice(0, 4).every((f) => f.status === "pass" && f.count === 0)).toBe(true);
    expect(f1?.quarantine).toEqual([
      { sourceTable: "trx_inventory", reason: "facility_changed", rows: 1 },
      { sourceTable: "trx_kalibrasi", reason: "no_device", rows: 1 },
    ]);
    expect(f2?.quarantine).toEqual([]);
    expect(answer.totals).toEqual([
      { sourceTable: "trx_hasil_pemeriksaan", reason: "no_device", rows: 3 },
      { sourceTable: "trx_inventory", reason: "facility_changed", rows: 3 },
      { sourceTable: "trx_kalibrasi", reason: "no_device", rows: 1 },
    ]);
    // The tenant is bound, never interpolated.
    for (const [text, options] of (query.mock.calls.slice(1) as unknown as [string, { bind: unknown[] }][]).filter(([t]) => !t.includes("AS present"))) {
      expect(text).not.toContain(HOME);
      expect(options.bind).toContain(text.includes("quarantine") ? RUN : HOME);
    }
  });

  it("Q-4 per session table, Q-14 per facility, Q-28 per photo folder: flagged with their counts, the run and table bound", async () => {
    seedRun(RUN);
    db.present = true;
    // Every per-facility statement answers 1 for F1: Q-4 sums the four session tables, Q-28 the two folders.
    db.perFacility = [{ facilityId: F1, n: 1 }];
    const answer = await asSuperAdmin(() => service.reportDataQuality(RUN));
    const [f1, f2] = answer.facilities;
    const pick = (row: typeof f1, id: string) => row?.findings.find((f) => f.finding === id);
    expect(pick(f1, "Q-4")).toMatchObject({ status: "flagged", count: 4 });
    expect(pick(f1, "Q-14")).toMatchObject({ status: "flagged", count: 1 });
    expect(pick(f1, "Q-28")).toMatchObject({ status: "flagged", count: 2 });
    expect([pick(f2, "Q-4")?.status, pick(f2, "Q-14")?.status, pick(f2, "Q-28")?.status]).toEqual(["pass", "pass", "manual"]);
    const calls = query.mock.calls as unknown as [string, { bind: unknown[] }][];
    const q4 = calls.filter(([text]) => text.includes("'no_device'")).map(([, o]) => o.bind);
    expect(q4).toEqual([
      [RUN, "trx_hasil_pemeriksaan"],
      [RUN, "trx_hasil_maintenance"],
      [RUN, "trx_rekomendasi_hasil_pekerjaan"],
      [RUN, "trx_catatan"],
    ]);
    const q28 = calls.filter(([text]) => text.includes("'file_missing'")).map(([, o]) => o.bind);
    expect(q28).toEqual([
      [RUN, "foto_depan"],
      [RUN, "foto_sn"],
    ]);
  });
});
