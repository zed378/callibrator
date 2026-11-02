/**
 * P25-03 — services/upstreamReportDiff.service.ts on the REAL models and tenant hooks over the
 * in-memory store. Doubled: the transform connection, answering each statement by its shape — the
 * SQL itself runs on PostgreSQL 18 in upstreamTransform.p2402g.live, and the comparison has its own
 * suite (upstreamReportDiff.compare.p2503).
 *
 * What it holds: a diff runs only for a TRANSFORMED run of a provider tenant, only on the transform
 * role; the sample is bound and ordered by the session key; the staged rows are found by that key;
 * nothing but counts and fixed codes leaves; the connection is closed whatever happens.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as ServiceModule from "../../services/upstreamReportDiff.service";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const HOME = "a2503000-0000-4000-8000-0000000000a1";
const RUN = "a2503000-0000-4000-8000-0000000000e1";
const OTHER = "a2503000-0000-4000-8000-0000000000e2";
const F1 = "a2503000-0000-4000-8000-0000000000f1";
const S1 = "a2503000-0000-4000-8000-0000000000b1";
const R1 = "a2503000-0000-4000-8000-0000000000c1";
const KEY = "QR-SINTETIS|2025-05-10";

const session = {
  id: S1,
  legacyKey: KEY,
  facilityId: F1,
  day: "2025-05-10",
  performer: { name: "Teknisi Sintetis" },
  device: { name: "Pompa Sintetis", manufacturer: null, model: null, serialNumber: null, qrCode: "QR-SINTETIS" },
  facility: { name: "RS Sintetis" },
  room: "ICU",
  legacyVisitNumber: null,
  inspectionOutcome: null,
  maintenanceOutcome: null,
  recommendation: null,
  notes: null,
};
const result = { id: R1, sessionId: S1, label: "Item sintetis", outcome: "pass", cleanliness: null, measuredValue: null, measuredValue1: null, measuredValue2: null, rawValue: null, setting: null, reference: null, symbol: null, warnFlag: false };

/** What the doubled database answers. */
const db = {
  role: "callibrator_transform",
  present: true,
  absent: [] as string[],
  population: [{ n: 5 }] as { n: number }[],
  sessions: [] as Record<string, unknown>[],
  results: [] as Record<string, unknown>[],
  stagedRows: [] as Record<string, unknown>[],
  devices: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
};
const close = jest.fn(() => Promise.resolve());
/** The transform connection as `sql()` sees it: `query(text, { type, bind, transaction })`. */
const query = jest.fn((text: string, options?: { bind?: unknown[] }) => {
  if (text.includes("current_user")) {
    return Promise.resolve([{ currentUser: db.role }]);
  }
  if (text.includes("AS present")) {
    const table = String(options?.bind?.[0]);
    return Promise.resolve([{ present: db.present && !db.absent.some((t) => table.endsWith(`stg_${t}`)) }]);
  }
  if (text.includes("t.name, z.value")) {
    return Promise.resolve([{ name: "Penyedia", zone: "Asia/Jakarta" }]);
  }
  if (text.includes("count(*)::int AS n FROM inspection_sessions")) {
    return Promise.resolve(db.population);
  }
  if (text.includes("FROM inspection_sessions s")) {
    return Promise.resolve(db.sessions);
  }
  if (text.includes("FROM inspection_results r")) {
    return Promise.resolve(db.results);
  }
  if (text.includes("CROSS JOIN LATERAL")) {
    const table = String(options?.bind?.[3]);
    return Promise.resolve(db.stagedRows.filter((r) => r["table"] === table));
  }
  if (text.includes("y.shared")) {
    return Promise.resolve(db.devices);
  }
  return Promise.resolve(db.users);
});
const transaction = jest.fn((fn: (t: object) => Promise<unknown>) => fn({}));
const connection = { close, transaction, query };
jest.mock("../../config/upstreamImport", () => ({
  ...jest.requireActual<object>("../../config/upstreamImport"),
  createTransformDb: () => connection,
  transformRoleName: () => "callibrator_transform",
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const service = jest.requireActual<typeof ServiceModule>("../../services/upstreamReportDiff.service");
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

const field = (answer: Awaited<ReturnType<typeof service.diffRun>>, name: string) => answer.fields.find((f) => f.field === name);

beforeEach(() => {
  mdb.reset();
  jest.clearAllMocks();
  Object.assign(db, {
    role: "callibrator_transform",
    present: true,
    absent: [],
    population: [{ n: 5 }],
    sessions: [],
    results: [],
    stagedRows: [],
    devices: [],
    users: [],
  });
});

describe("P25-03 the report diff", () => {
  it("refuses an unknown run (404) and a run that is not transformed or names no provider (409), each with its code", async () => {
    await expect(asSuperAdmin(() => service.diffRun(RUN, 10))).rejects.toMatchObject({ status: 404, publicCode: "UPSTREAM_SQL_IMPORT_NOT_FOUND" });
    seedRun(RUN, { transformStatus: "transforming" });
    await expect(asSuperAdmin(() => service.diffRun(RUN, 10))).rejects.toMatchObject({ status: 409, publicCode: "RUN_NOT_TRANSFORMED" });
    seedRun(OTHER, { transformTenantId: null });
    await expect(asSuperAdmin(() => service.diffRun(OTHER, 10))).rejects.toMatchObject({ status: 409, publicCode: "RUN_NOT_TRANSFORMED" });
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses a connection that is not the transform role (500), and closes it", async () => {
    seedRun(RUN);
    db.role = "postgres";
    await expect(asSuperAdmin(() => service.diffRun(RUN, 10))).rejects.toMatchObject({ status: 500 });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("a run with no imported session: every field passes on nothing compared, and no count comes back undefined", async () => {
    seedRun(RUN);
    db.population = [];
    const answer = await asSuperAdmin(() => service.diffRun(RUN, 10));
    expect(answer.sample).toEqual({ requested: 10, population: 0, sessions: 0, facilities: 0 });
    expect(answer.fields).toHaveLength(16);
    expect(answer.fields.every((f) => f.status === "pass" && f.compared === 0)).toBe(true);
  });

  it("the sample is bound; the staged side is found by the key; counts leave, values do not", async () => {
    seedRun(RUN);
    db.sessions = [session];
    db.results = [result];
    db.devices = [{ qr: "QR-SINTETIS", row: { nama_alat: "Pompa Sintetis", no_qrcode: "QR-SINTETIS", nama_ruangan: "ICU" }, facilityName: "RS Sintetis", shared: false }];
    db.users = [{ id: "7", name: "Teknisi Sintetis", imported: true }];
    db.stagedRows = [
      { table: "trx_fungsi_alat", key: KEY, row: { id: 1, id_user: 7, description: "Item sintetis", status: "1" }, targetId: R1, quarantined: false },
      { table: "trx_fungsi_alat", key: KEY, row: { id: 2, id_user: 7, description: "Item kedua", status: "9" }, targetId: null, quarantined: true },
    ];
    const answer = await asSuperAdmin(() => service.diffRun(RUN, 10));
    expect(answer).toMatchObject({ runId: RUN, providerTenantId: HOME, sample: { requested: 10, population: 5, sessions: 1, facilities: 1 } });
    expect(field(answer, "device.name")).toMatchObject({ status: "pass", equal: 1 });
    expect(field(answer, "results.rows")).toMatchObject({ status: "pass", explained: 1 });
    expect(field(answer, "results.values")).toMatchObject({ status: "pass", equal: 1 });
    expect(field(answer, "technician")).toMatchObject({ status: "pass", equal: 1 });
    expect(answer.fields.every((f) => f.status === "pass")).toBe(true);
    const calls = query.mock.calls as unknown as [string, { bind: unknown[] }][];
    expect(calls.find(([text]) => text.includes("FROM inspection_sessions s"))?.[1].bind).toEqual([HOME, "Asia/Jakarta", 10]);
    expect(calls.find(([text]) => text.includes("FROM inspection_sessions s"))?.[0]).toContain("ORDER BY md5(s.legacy_key)");
    expect(calls.find(([text]) => text.includes("FROM inspection_results r"))?.[1].bind).toEqual([HOME, [S1]]);
    expect(calls.find(([text]) => text.includes("CROSS JOIN LATERAL"))?.[1].bind).toEqual([RUN, expect.any(String), "Asia/Jakarta", expect.any(String), [KEY]]);
    expect(calls.find(([text]) => text.includes("y.shared"))?.[1].bind).toEqual([RUN, ["QR-SINTETIS"]]);
    const text = JSON.stringify(answer);
    for (const value of ["QR-SINTETIS", "Pompa", "RS Sintetis", "Teknisi", "Item", "ICU"]) {
      expect(text).not.toContain(value);
    }
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("a QR holding the key's separator keeps its whole text; a stored session with no snapshots reads as empty", async () => {
    seedRun(RUN);
    db.sessions = [
      { ...session, legacyKey: "QR|X|2025-05-10", performer: null, device: null, facility: null },
      { ...session, id: "a2503000-0000-4000-8000-0000000000b2", legacyKey: "QR-LAIN|2025-05-11" },
    ];
    db.results = [result, { ...result, id: "a2503000-0000-4000-8000-0000000000c2" }];
    const answer = await asSuperAdmin(() => service.diffRun(RUN, 10));
    const calls = query.mock.calls as unknown as [string, { bind: unknown[] }][];
    expect(calls.find(([text]) => text.includes("y.shared"))?.[1].bind).toEqual([RUN, ["QR|X", "QR-LAIN"]]);
    expect(answer.sample).toMatchObject({ sessions: 2, facilities: 1 });
    // No staged rows behind the stored results: the diff shows it, it does not throw.
    expect(field(answer, "results.rows")).toMatchObject({ status: "fail", differs: 1 });
  });

  it("the staged tables a dump may lack: no facility name, no device, no users", async () => {
    seedRun(RUN);
    db.sessions = [session];
    db.absent = ["mst_faskes", "users", "trx_catatan"];
    db.devices = [{ qr: "QR-SINTETIS", row: {}, facilityName: null, shared: false }];
    await asSuperAdmin(() => service.diffRun(RUN, 10));
    const calls = query.mock.calls as unknown as [string][];
    expect(calls.find(([text]) => text.includes("y.shared"))?.[0]).toContain('NULL AS "facilityName"');
    expect(calls.filter(([text]) => text.includes("CROSS JOIN LATERAL"))).toHaveLength(15);
    db.absent = ["trx_inventory"];
    const answer = await asSuperAdmin(() => service.diffRun(RUN, 10));
    expect(field(answer, "device.name")).toMatchObject({ status: "fail", differs: 1 });
  });
});
