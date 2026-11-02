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
  photoRows: [] as Record<string, string | null>[],
  manifests: [] as string[],
  absent: [] as string[],
  devices: [] as Record<string, unknown>[],
  references: [] as { facilityId: string; gone: number; none: number }[],
  kept: [] as { facilityId: string; q21: number; q23: number }[],
  users: [] as Record<string, number>[],
};
const close = jest.fn(() => Promise.resolve());
/** The transform connection as `sql()` sees it: `query(text, { type, bind, transaction })`. */
const query = jest.fn((text: string, options?: { bind?: unknown[] }) => {
  if (text.includes("current_user")) {
    return Promise.resolve([{ currentUser: db.role }]);
  }
  if (text.includes("AS foto_depan")) {
    return Promise.resolve(db.photoRows);
  }
  if (text.includes("AS present")) {
    const table = String(options?.bind?.[0]);
    return Promise.resolve([{ present: db.present && !db.absent.some((t) => table.endsWith(`stg_${t}`)) }]);
  }
  if (text.includes("AS q11")) {
    return Promise.resolve(db.devices);
  }
  if (text.includes("AS gone")) {
    return Promise.resolve(db.references);
  }
  if (text.includes("AS q21")) {
    return Promise.resolve(db.kept);
  }
  if (text.includes('AS "notImported"')) {
    return Promise.resolve(db.users);
  }
  if (text.includes('"sourceTable"')) {
    return Promise.resolve(db.quarantine);
  }
  return Promise.resolve(db.perFacility);
});
const transaction = jest.fn((fn: (t: object) => Promise<unknown>) => fn({}));
const connection = { close, transaction, query };
jest.mock("../../services/upstreamImport/transformFiles", () => ({
  manifestsOf: () => Promise.resolve(db.manifests),
}));
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
  Object.assign(db, { role: "callibrator_transform", quarantine: [], perFacility: [], present: false, photoRows: [], manifests: [], absent: [], devices: [], references: [], kept: [], users: [] });
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

  it("a clean run: every computed finding passes, per facility and at the run level", async () => {
    seedRun(RUN);
    const answer = await asSuperAdmin(() => service.reportDataQuality(RUN));
    expect(answer).toMatchObject({ runId: RUN, providerTenantId: HOME, totals: [] });
    expect(answer.runFindings.map((f) => [f.finding, f.status, f.count])).toEqual(
      ["Q-28", "F-DUP-HASH", "F-DUP-NAME", "Q-16", "U-1", "U-2", "U-3", "U-4", "U-5", "U-6"].map((id) => [id, "pass", 0]),
    );
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
        ["Q-28", "pass", 0],
        ["Q-8", "pass", 0],
        ["Q-9", "pass", 0],
        ["Q-2", "pass", 0],
        ["Q-3", "pass", 0],
        ["Q-10", "pass", 0],
        ...["Q-5", "Q-6", "Q-7", "Q-11", "Q-15", "Q-17", "Q-18-NULL", "Q-20", "Q-21", "Q-22", "Q-23", "Q-24", "Q-27"].map((id) => [id, "pass", 0]),
      ]);
      expect(row.findings.find((f) => f.finding === "Q-28")?.note).toContain("unreferenced files are a run-level finding");
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
    for (const [text, options] of (query.mock.calls.slice(1) as unknown as [string, { bind: unknown[] }][]).filter(([t]) => !t.includes("AS present") && !t.includes("former_users"))) {
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
    expect([pick(f2, "Q-4")?.status, pick(f2, "Q-14")?.status, pick(f2, "Q-28")?.status]).toEqual(["pass", "pass", "pass"]);
    const calls = query.mock.calls as unknown as [string, { bind?: unknown[] }][];
    const q4 = calls.filter(([, o]) => o.bind?.[2] === "no_device").map(([, o]) => o.bind);
    expect(q4).toEqual([
      [RUN, "trx_hasil_pemeriksaan", "no_device"],
      [RUN, "trx_hasil_maintenance", "no_device"],
      [RUN, "trx_rekomendasi_hasil_pekerjaan", "no_device"],
      [RUN, "trx_catatan", "no_device"],
    ]);
    const q28 = calls.filter(([text]) => text.includes("'file_missing'")).map(([, o]) => o.bind);
    expect(q28).toEqual([
      [RUN, "foto_depan"],
      [RUN, "foto_sn"],
    ]);
  });

  it("duplicates (Q-8, Q-9) and orphans (Q-2 over the 16 IPM tables, Q-3 devices, Q-10 calibrations), per facility", async () => {
    seedRun(RUN);
    db.present = true;
    db.perFacility = [{ facilityId: F1, n: 1 }];
    const answer = await asSuperAdmin(() => service.reportDataQuality(RUN));
    const [f1, f2] = answer.facilities;
    const counts = (row: typeof f1) =>
      ["Q-8", "Q-9", "Q-2", "Q-3", "Q-10"].map((id) => {
        const f = row?.findings.find((x) => x.finding === id);
        return [id, f?.status, f?.count];
      });
    expect(counts(f1)).toEqual([
      ["Q-8", "flagged", 4],
      ["Q-9", "flagged", 1],
      ["Q-2", "flagged", 16],
      ["Q-3", "flagged", 1],
      ["Q-10", "flagged", 1],
    ]);
    expect(counts(f2).every(([, status, count]) => status === "pass" && count === 0)).toBe(true);
    // The performer is matched against the users step's mapping; each table bound, the run first.
    const calls = query.mock.calls as unknown as [string, { bind: unknown[] }][];
    const performer = calls.filter(([text]) => text.includes("um.source_table = 'users'")).map(([, o]) => o.bind[1]);
    expect(performer).toEqual([
      "trx_hasil_pemeriksaan", "trx_hasil_maintenance", "trx_rekomendasi_hasil_pekerjaan", "trx_catatan",
      "trx_alat_kerja_digunakan", "trx_battery", "trx_fungsi_alat", "trx_keamanan_listrik", "trx_kelengkapan_alat", "trx_kinerja_alat",
      "trx_kondisi_kelistrikan", "trx_kondisi_lingkungan", "trx_konsumabel", "trx_pemeliharaan_alat", "trx_pemeriksaan_fisik",
      "trx_pemeriksaan_keamanan_lain", "trx_inventory", "trx_kalibrasi",
    ]);
  });

  it("Q-28 unreferenced (run level): manifest files in the photo folders no staged row names, by step 9's <folder>/<name>", async () => {
    seedRun(RUN);
    db.present = true;
    const line = (sourcePath: string, outcome: string, extra: Record<string, string> = {}): string => JSON.stringify({ sourcePath, outcome, ...extra });
    db.manifests = [
      [
        line("foto_depan/a1.jpg", "ingested", { storageKey: "k1", storedSha256: "s1", sourceSha256: "h1", detectedType: "jpeg" }),
        line("foto_sn/a1sn.png", "ingested", { storageKey: "k2", storedSha256: "s2", sourceSha256: "h2", detectedType: "png" }),
        line("foto_depan/orphan.jpg", "ingested", { storageKey: "k3", storedSha256: "s3", sourceSha256: "h3", detectedType: "jpeg" }),
        line("foto_sn/virus.jpg", "quarantined", { reason: "virus_found" }),
        line("dokumen/other.pdf", "quarantined", { reason: "type_refused" }),
        "{torn",
      ].join("\n"),
    ];
    // The front named by URL (the host stripped, as step 9 does), the serial plate by its bare name.
    db.photoRows = [{ foto_depan: "https://old.example.test/uploads/foto_depan/a1.jpg?x=1", foto_sn: " a1sn.png " }, { foto_depan: null, foto_sn: "" }];
    const answer = await asSuperAdmin(() => service.reportDataQuality(RUN));
    // orphan.jpg and the quarantined virus.jpg are on disk and unnamed; another folder is not a photo folder.
    expect(answer.runFindings[0]).toEqual(expect.objectContaining({ finding: "Q-28", status: "flagged", count: 2 }));
  });

  it("the rest of 03 § 7, per facility: the device counts, the item references, Q-5, Q-22 and the readings kept raw", async () => {
    seedRun(RUN);
    db.present = true;
    db.perFacility = [{ facilityId: F2, n: 2 }];
    db.devices = [{ facilityId: F1, q11: 1, q15: 2, q17: 3, q18Nulled: 4, q20: 5, q24: 6, q27: 7 }];
    db.references = [{ facilityId: F1, gone: 1, none: 2 }];
    db.kept = [{ facilityId: F1, q21: 8, q23: 9 }];
    const answer = await asSuperAdmin(() => service.reportDataQuality(RUN));
    const [f1, f2] = answer.facilities;
    const count = (row: typeof f1, id: string): number | undefined => row?.findings.find((f) => f.finding === id)?.count;
    expect(["Q-11", "Q-15", "Q-17", "Q-18-NULL", "Q-20", "Q-24", "Q-27", "Q-21", "Q-23"].map((id) => count(f1, id))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // Seven result tables carry an item reference.
    expect(count(f1, "Q-6")).toBe(7);
    expect(count(f1, "Q-7")).toBe(14);
    expect(count(f1, "Q-5")).toBe(0);
    // Sixteen IPM tables for Q-5, one performance table for Q-22; the placeholders are bound, as literals of 03 Q-17.
    expect(count(f2, "Q-5")).toBe(32);
    expect(count(f2, "Q-22")).toBe(2);
    const calls = query.mock.calls as unknown as [string, { bind: unknown[] }][];
    const device = calls.find(([text]) => text.includes("AS q11"));
    expect(device?.[1].bind).toEqual([RUN, HOME, expect.arrayContaining(["none", "n/a", "tidak ada"])]);
    expect(device?.[0]).toContain("array_agg");
  });

  it("the staged tables a dump may lack: nothing counted, Q-11 joins nothing", async () => {
    seedRun(RUN);
    db.present = true;
    db.absent = ["trx_kalibrasi", "trx_kinerja_alat", "trx_fungsi_alat", "trx_catatan", "users", "trx_inventory_file"];
    const answer = await asSuperAdmin(() => service.reportDataQuality(RUN));
    const calls = query.mock.calls as unknown as [string][];
    expect(calls.find(([text]) => text.includes("AS q11"))?.[0]).toContain("NULL::text[] AS days");
    expect(answer.runFindings.every((f) => f.count === 0)).toBe(true);
    db.absent = ["trx_inventory"];
    expect((await asSuperAdmin(() => service.reportDataQuality(RUN))).facilities[0]?.findings.find((f) => f.finding === "Q-5")?.count).toBe(0);
  });

  it("run level: duplicate files by content and by reference, Q-16, and the users section", async () => {
    seedRun(RUN);
    db.present = true;
    const ingested = (sourcePath: string, sha: string): string =>
      JSON.stringify({ sourcePath, outcome: "ingested", storageKey: `k-${sourcePath}`, storedSha256: sha, sourceSha256: `h-${sourcePath}`, detectedType: "jpeg" });
    db.manifests = [[ingested("foto_depan/a.jpg", "same"), ingested("foto_sn/b.jpg", "same"), ingested("foto_sn/c.jpg", "other")].join("\n")];
    db.photoRows = [
      { foto_depan: "a.jpg", foto_sn: "b.jpg" },
      { foto_depan: "a.jpg", foto_sn: null },
    ];
    db.perFacility = [{ facilityId: F1, n: 3 }];
    db.users = [{ notImported: 1, inactive: 2, noMail: 3, unnamed: 4, sharedMail: 5 }];
    const answer = await asSuperAdmin(() => service.reportDataQuality(RUN));
    const count = (id: string): number | undefined => answer.runFindings.find((f) => f.finding === id)?.count;
    expect(["F-DUP-HASH", "F-DUP-NAME", "Q-16", "U-1", "U-2", "U-3", "U-4", "U-5", "U-6"].map(count)).toEqual([1, 1, 3, 1, 2, 5, 3, 4, 3]);
    expect(answer.runFindings.find((f) => f.finding === "U-4")?.status).toBe("flagged");
  });
});
