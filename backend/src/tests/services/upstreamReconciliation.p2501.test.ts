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
  Object.assign(db, { role: "callibrator_transform", present: false, completeness: { staged: 0, mapped: 0, quarantined: 0 }, perFacility: [], bad: 0 });
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
      ["R-3", "manual"],
      ["R-4", "manual"],
      ["R-5", "manual"],
      ["R-6", "manual"],
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
    // Staged and stored both answer 2 for F1, nothing for F2: equal, so both pass.
    expect(answer.facilities.map((f) => f.checks.map((c) => [c.expected, c.actual, c.status]))).toEqual([
      [
        [2, 2, "pass"],
        [2, 2, "pass"],
        [2, 2, "pass"],
      ],
      [
        [0, 0, "pass"],
        [0, 0, "pass"],
        [0, 0, "pass"],
      ],
    ]);
    // Every staged statement names a table through the allow-list, the run bound as $1.
    const staged = query.mock.calls.filter(([text]) => text.includes("upstream_import.\"stg_"));
    expect(staged.length).toBe(SOURCES + 3);
    for (const [, options] of staged as unknown as [string, { bind: unknown[] }][]) {
      expect(options.bind[0]).toBe(RUN);
    }
  });
});
