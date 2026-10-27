/**
 * P25-01 — services/upstreamReconciliation.service.ts on the REAL models and
 * the REAL tenant hooks over the in-memory store (fixtures/memoryDb).
 * Doubled: the transform connection, answering each statement by its shape —
 * the SQL itself runs on PostgreSQL 18 in upstreamTransform.p2402g.live
 * ("P25-01/P25-02 on the IPM world").
 *
 * What it holds: a reconciliation runs only for a TRANSFORMED run of a
 * provider tenant (404 `UPSTREAM_SQL_IMPORT_NOT_FOUND`, 409
 * `RUN_NOT_TRANSFORMED`), only on the transform role; every check is a
 * count, never a value; a mismatch is a `fail`, never a thrown error; R-10
 * sums every staged source the step registry names; a check not automated
 * answers `manual`; the connection is closed whatever happens.
 *
 * TypeScript without jest's hoisting: the mocks are registered first, then
 * every runtime module is loaded with `jest.requireActual`.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as ServiceModule from "../../services/upstreamReconciliation.service";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const HOME = "a2501000-0000-4000-8000-0000000000a1";
const RUN = "a2501000-0000-4000-8000-0000000000e1";
const OTHER = "a2501000-0000-4000-8000-0000000000e2";
const F1 = "a2501000-0000-4000-8000-0000000000f1";
const F2 = "a2501000-0000-4000-8000-0000000000f2";

/** What the doubled database answers. */
const db = {
  role: "callibrator_transform",
  present: false,
  completeness: { staged: 0, mapped: 0, quarantined: 0 },
  perFacility: [] as { facilityId: string; n: number }[],
  sections: [] as { facility: string; staged: number; landed: number; stored: number; outcomeMatch: number; readingMatch: number }[],
  users: { landed: 0, matching: 0 },
  bad: 0,
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
  if (text.includes("AS matching")) {
    return Promise.resolve([db.users]);
  }
  if (text.includes('AS "facility"')) {
    return Promise.resolve(db.sections);
  }
  if (text.includes("AS staged")) {
    return Promise.resolve([db.completeness]);
  }
  if (text.includes('"facilityId"')) {
    return Promise.resolve(db.perFacility);
  }
  return Promise.resolve([{ n: db.bad }]);
});
const transaction = jest.fn((fn: (t: object) => Promise<unknown>) => fn({}));
const connection = { close, transaction, query };
jest.mock("../../config/upstreamImport", () => ({
  ...jest.requireActual<object>("../../config/upstreamImport"),
  createTransformDb: () => connection,
  transformRoleName: () => "callibrator_transform",
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const service = jest.requireActual<typeof ServiceModule>("../../services/upstreamReconciliation.service");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the tenant context, loaded after the config mock
const { tenantStorage } = require("../../middlewares/tenantContext.middleware") as { tenantStorage: { run(ctx: object, fn: () => void): void } };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the registry R-10 walks, loaded after the mocks
const { TRANSFORM_STEPS } = require("../../services/upstreamImport/transform/steps") as { TRANSFORM_STEPS: readonly { sources: readonly unknown[] }[] };

const SOURCES = TRANSFORM_STEPS.flatMap((s) => s.sources).length;
/** The twelve upstream result tables of 05 § 3.1 (R-3 … R-6 read each once). */
const RESULT_TABLES = 12;

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
    transformSummary: { durationMs: 12, steps: [{ step: "client_facilities", durationMs: 1, sources: [] }] },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...values,
  });
};

const seedFacilities = (): void => {
  mdb.seed("ClientFacility", [
    { id: F2, tenantId: HOME, code: "F-0002", name: "Dua", kind: "clinic", status: "active" },
    { id: F1, tenantId: HOME, code: "F-0001", name: "Satu", kind: "hospital", status: "active" },
  ]);
};

beforeEach(() => {
  mdb.reset();
  jest.clearAllMocks();
  Object.assign(db, { role: "callibrator_transform", present: false, completeness: { staged: 0, mapped: 0, quarantined: 0 }, perFacility: [], sections: [], users: { landed: 0, matching: 0 }, bad: 0 });
});

describe("P25-01 the reconciliation request", () => {
  it("refuses an unknown run (404) and a run that is not transformed or names no provider (409), each with its code", async () => {
    await expect(asSuperAdmin(() => service.reconcileRun(RUN))).rejects.toMatchObject({ status: 404, publicCode: "UPSTREAM_SQL_IMPORT_NOT_FOUND" });
    seedRun(RUN, { transformStatus: "transforming" });
    await expect(asSuperAdmin(() => service.reconcileRun(RUN))).rejects.toMatchObject({ status: 409, publicCode: "RUN_NOT_TRANSFORMED" });
    seedRun(OTHER, { transformTenantId: null });
    await expect(asSuperAdmin(() => service.reconcileRun(OTHER))).rejects.toMatchObject({ status: 409, publicCode: "RUN_NOT_TRANSFORMED" });
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses a connection that is not the transform role (500), and closes it", async () => {
    seedRun(RUN);
    db.role = "postgres";
    await expect(asSuperAdmin(() => service.reconcileRun(RUN))).rejects.toMatchObject({ status: 500 });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("an empty run passes: per-facility rows by code, the run-level checks, the manual ones named NOT AUTOMATED", async () => {
    seedRun(RUN);
    seedFacilities();
    const answer = await asSuperAdmin(() => service.reconcileRun(RUN));
    expect(answer).toMatchObject({ runId: RUN, providerTenantId: HOME, transformSummary: { durationMs: 12, steps: 1 } });
    expect(answer.facilities.map((f) => [f.clientFacilityId, f.facilityCode])).toEqual([
      [F1, "F-0001"],
      [F2, "F-0002"],
    ]);
    for (const row of answer.facilities) {
      expect(Object.keys(row).sort()).toEqual(["checks", "clientFacilityId", "facilityCode"]);
      expect(row.checks.map((c) => [c.check, c.status])).toEqual([
        ["R-1", "pass"],
        ["R-2", "pass"],
        ["R-3", "pass"],
        ["R-4", "pass"],
        ["R-5", "pass"],
        ["R-6", "pass"],
        ["R-7", "pass"],
      ]);
    }
    expect(answer.runChecks.map((c) => [c.check, c.status])).toEqual([
      ["R-10", "pass"],
      ["R-11", "pass"],
      ["RC-F1", "pass"],
      ["RC-F2", "pass"],
      ["RC-F3", "pass"],
      ["RC-F5", "pass"],
      ["R-9", "pass"],
      ["R-8", "manual"],
      ["R-9", "manual"],
      ["RC-F4", "manual"],
      ["R-12", "manual"],
    ]);
    expect(answer.runChecks.filter((c) => c.status === "manual" && c.check !== "RC-F4").every((c) => c.note.startsWith("NOT AUTOMATED"))).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("a mismatch is a fail with its delta, never a throw; R-10 sums every staged source of the registry", async () => {
    seedRun(RUN, { transformSummary: null });
    seedFacilities();
    db.present = true;
    db.completeness = { staged: 3, mapped: 1, quarantined: 1 };
    db.perFacility = [{ facilityId: F1, n: 2 }];
    db.bad = 4;
    const answer = await asSuperAdmin(() => service.reconcileRun(RUN));
    expect(answer.transformSummary).toBeNull();
    const r10 = answer.runChecks.find((c) => c.check === "R-10");
    expect(r10).toMatchObject({ status: "fail", expected: 3 * SOURCES, actual: 2 * SOURCES, delta: -SOURCES, quarantined: SOURCES });
    expect(answer.runChecks.find((c) => c.check === "RC-F1")).toMatchObject({ status: "fail", expected: 0, actual: 4, delta: 4 });
    // Staged and stored both answer 2 for F1, nothing for F2: equal, so both pass (R-1, R-2, R-7).
    const counted = (check: string) => answer.facilities.map((f) => f.checks.find((c) => c.check === check)).map((c) => [c?.expected, c?.actual, c?.status]);
    for (const name of ["R-1", "R-2", "R-7"]) {
      expect(counted(name)).toEqual([
        [2, 2, "pass"],
        [0, 0, "pass"],
      ]);
    }
    // Every staged statement names a table through the allow-list, the run bound as $1.
    const staged = query.mock.calls.filter(([text]) => text.includes("upstream_import.\"stg_"));
    // R-10 over every source, R-1/R-2/R-7, R-3 … R-6 once per result table, and R-9.
    expect(staged.length).toBe(SOURCES + 3 + RESULT_TABLES + 1);
    for (const [, options] of staged as unknown as [string, { bind: unknown[] }][]) {
      expect(options.bind[0]).toBe(RUN);
    }
  });

  it("R-3 … R-6 per facility: row-level counts over the twelve result tables, a mismatch a fail naming its sections", async () => {
    seedRun(RUN);
    seedFacilities();
    db.present = true;
    // Every result table answers the same row for F1: 2 mapped, 2 landed, 1 in F1, 1 outcome and 2 readings matching.
    db.sections = [{ facility: F1, staged: 2, landed: 2, stored: 1, outcomeMatch: 1, readingMatch: 2 }];
    const answer = await asSuperAdmin(() => service.reconcileRun(RUN));
    const f1 = answer.facilities.find((f) => f.clientFacilityId === F1)?.checks ?? [];
    const byCheck = (name: string) => f1.find((c) => c.check === name);
    expect(byCheck("R-3")).toMatchObject({ status: "fail", expected: 24, actual: 12, delta: -12 });
    expect(byCheck("R-3")?.note).toContain("differ: battery, completeness, consumable, electrical_safety, electrical_supply, environment, function");
    expect(byCheck("R-3")?.note.length).toBeLessThanOrEqual(280);
    expect(byCheck("R-4")).toMatchObject({ status: "fail", expected: 24, actual: 12 });
    // R-5: performance and battery only; R-6: the environment table only.
    expect(byCheck("R-5")).toMatchObject({ status: "pass", expected: 4, actual: 4 });
    expect(byCheck("R-6")).toMatchObject({ status: "pass", expected: 2, actual: 2 });
    // F2 has no rows: every section check passes at zero.
    const f2 = answer.facilities.find((f) => f.clientFacilityId === F2)?.checks ?? [];
    expect(f2.filter((c) => ["R-3", "R-4", "R-5", "R-6"].includes(c.check)).map((c) => [c.expected, c.actual, c.status])).toEqual([
      [0, 0, "pass"],
      [0, 0, "pass"],
      [0, 0, "pass"],
      [0, 0, "pass"],
    ]);
  });

  it("R-4 binds each section's code map (04 § 5) and R-6 the environment ranges (Q-21), never a staged value", async () => {
    seedRun(RUN);
    seedFacilities();
    db.present = true;
    await asSuperAdmin(() => service.reconcileRun(RUN));
    const calls = query.mock.calls as unknown as [string, { bind: unknown[] }][];
    const sectionCall = (table: string) => calls.find(([text, options]) => text.includes('AS "facility"') && options.bind[1] === table)?.[1].bind ?? [];
    /** The bound run, table and tenant, then the code map as code → outcome (the order of a pair list is not its meaning). */
    const codeMap = (table: string) => {
      const [run, name, tenant, codes, outcomes, ...rest] = sectionCall(table) as [string, string, string, string[], (string | null)[], ...unknown[]];
      return { head: [run, name, tenant], map: Object.fromEntries(codes.map((c, i) => [c, outcomes[i]])), rest };
    };
    expect(codeMap("trx_pemeriksaan_fisik")).toEqual({ head: [RUN, "trx_pemeriksaan_fisik", HOME], map: { "1": "good", "0": "minor_damage", "-1": "major_damage" }, rest: [] });
    expect(codeMap("trx_konsumabel").map).toEqual({ "1": "available", "0": "not_available", "-1": "empty" });
    expect(codeMap("trx_kinerja_alat").map).toEqual({ "1": "pass", "0": "fail" });
    // Measured sections: "1" is measured (no outcome), "-1" not applicable.
    expect(codeMap("trx_keamanan_listrik").map).toEqual({ "1": null, "-1": "not_applicable" });
    // The environment section has no codes; its ranges: temperature -20 … 80 °C, humidity 0 … 100 %.
    expect(codeMap("trx_kondisi_lingkungan")).toEqual({ head: [RUN, "trx_kondisi_lingkungan", HOME], map: {}, rest: [["1", "2"], [-20, 0], [80, 100]] });
  });

  it("R-9: imported accounts against the role their group gives, bound as the pairs of P18-01 § 2.1", async () => {
    seedRun(RUN);
    seedFacilities();
    db.present = true;
    db.users = { landed: 5, matching: 4 };
    const answer = await asSuperAdmin(() => service.reconcileRun(RUN));
    expect(answer.runChecks.find((c) => c.check === "R-9")).toMatchObject({ status: "fail", expected: 5, actual: 4, delta: -1 });
    const calls = query.mock.calls as unknown as [string, { bind: unknown[] }][];
    const bind = calls.find(([text]) => text.includes("AS matching"))?.[1].bind ?? [];
    expect(bind.slice(0, 2)).toEqual([RUN, HOME]);
    const [groups, roles] = bind.slice(2) as [string[], string[]];
    expect(groups.map((g, i) => `${g}=${String(roles[i])}`).sort()).toEqual([
      "admin=CALIBRATOR ADMIN",
      "client=HEALTHCARE ADMIN",
      "client=ROOM USER",
      "teknisi_client=HEALTHCARE TECHNICIAN",
      "user=TECHNICIAN",
    ]);
  });
});
