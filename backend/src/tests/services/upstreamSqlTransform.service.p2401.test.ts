/**
 * P24-01 — services/upstreamSqlTransform.service.ts on the REAL models, the REAL audit service
 * and the REAL tenant hooks over the in-memory store (fixtures/memoryDb). Doubled: the batch-job
 * queue (the job is run by calling the handler), the transform connection and the runner (tested
 * on its own, and live in upstreamImportTransform.p2401.live), and the step registry (so a test
 * can say whether the steps are built).
 *
 * What it holds: a transform is requested only for a LOADED, idle run of a server whose steps are
 * built, never for real data while the DPIA gate is off; every transition is a conditional
 * UPDATE with its audit row; a failure records its code and nothing else; an interrupted
 * transform is failed `INTERRUPTED` by the sweep's reconciliation.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as ServiceModule from "../../services/upstreamSqlTransform.service";
import type * as RunnerModule from "../../services/upstreamImport/transform/runner";
import type * as CodedErrorModule from "../../utils/codedError.util";
import { environment } from "../../config/env";

const penv = environment();

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
const createJob = jest.fn();
const registerHandler = jest.fn();
jest.mock("../../services/batchJob.service", () => ({
  createJob: (...a: unknown[]) => createJob(...a) as unknown,
  registerHandler: (...a: unknown[]) => registerHandler(...a) as unknown,
}));
const close = jest.fn(() => Promise.resolve());
const connection = { close };
jest.mock("../../config/upstreamImport", () => ({
  ...jest.requireActual<object>("../../config/upstreamImport"),
  createTransformDb: () => connection,
}));
const built = { value: true };
jest.mock("../../services/upstreamImport/transform/steps", () => ({
  TRANSFORM_STEPS: [],
  isBuilt: () => built.value,
}));
const runTransform = jest.fn();
jest.mock("../../services/upstreamImport/transform/runner", () => ({
  ...jest.requireActual<object>("../../services/upstreamImport/transform/runner"),
  runTransform: (...a: unknown[]) => runTransform(...a) as unknown,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const service = jest.requireActual<typeof ServiceModule>("../../services/upstreamSqlTransform.service");
const [registeredType, registeredHandler] = registerHandler.mock.calls[0] as [string, (job: { id: string }) => Promise<unknown>];
const { TransformFailure } = jest.requireActual<typeof RunnerModule>("../../services/upstreamImport/transform/runner");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the real barrel, loaded after the config mock
const models = require("../../models") as { UpstreamSqlImport: { update: (...a: unknown[]) => Promise<[number]> } };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the tenant context, loaded after the config mock
const { tenantStorage } = require("../../middlewares/tenantContext.middleware") as { tenantStorage: { run(ctx: object, fn: () => void): void } };

const PLATFORM = "00000000-0000-4000-8000-000000000001";
const HOME = "a2401000-0000-4000-8000-0000000000a1";
const USER = "a2401000-0000-4000-8000-0000000000b1";
const RUN = "a2401000-0000-4000-8000-0000000000f1";
const OTHER = "a2401000-0000-4000-8000-0000000000f2";
const JOB = "a2401000-0000-4000-8000-0000000000c1";
const actor = { userId: USER, ipAddress: "203.0.113.47", userAgent: "jest" };
const SUMMARY = {
  durationMs: 12,
  steps: [{ step: "client_facilities", durationMs: 5, sources: [{ table: "mst_faskes", staged: 3, mapped: 2, unchanged: 0, quarantined: { no_device: 1 } }] }],
};

type RunRow = Record<string, unknown>;

const as = <T>(ctx: object, work: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    tenantStorage.run(ctx, () => {
      work().then(resolve, reject);
    });
  });
const asSuperAdmin = <T>(work: () => Promise<T>): Promise<T> => as({ tenantId: null, isSuperAdmin: true, isSystemTask: false }, work);
const asPlatformJob = <T>(work: () => Promise<T>): Promise<T> => as({ tenantId: PLATFORM, isSuperAdmin: false, isSystemTask: false }, work);

const seedRun = (id: string, values: RunRow = {}): void => {
  mdb.seed("UpstreamSqlImport", {
    id,
    status: "loaded",
    transformStatus: "not_available",
    dataClass: "synthetic",
    compression: "none",
    sizeBytes: 1,
    sha256: "d".repeat(64),
    uploadedBy: USER,
    notifyTenantId: HOME,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...values,
  });
};
const row = (id: string): RunRow => mdb.rows("UpstreamSqlImport").find((r) => r["id"] === id) as RunRow;
const audits = (id: string): RunRow[] => mdb.rows("AuditLog").filter((a) => a["resourceId"] === id);
const request = (id = RUN): Promise<void> => asSuperAdmin(() => service.requestTransform(id, actor));
const refusal = async (id = RUN): Promise<{ status: number; code: string }> => {
  const err = (await request(id).then(
    () => null,
    (e: unknown) => e,
  )) as CodedErrorModule.CodedError | null;
  return { status: err?.status ?? 0, code: err?.publicCode ?? "" };
};

beforeEach(() => {
  mdb.reset();
  jest.clearAllMocks();
  built.value = true;
  createJob.mockResolvedValue({ id: JOB });
  runTransform.mockResolvedValue(SUMMARY);
  mdb.seed("Tenant", [
    { id: PLATFORM, name: "Callibrator Platform", code: "PLATFORM", status: "active" },
    { id: HOME, name: "Home", code: "HOME", status: "active" },
  ]);
  mdb.seed("User", { id: USER, tenantId: HOME, username: "op", email: "op@home.test", password: "x", firstName: "Op", lastName: "E", status: "ACTIVE", isActive: true });
  delete penv["UPSTREAM_REAL_DATA_ALLOWED"];
});

describe("P24-01 the transform request", () => {
  it("queues a loaded run: transform_requested, its requester and time, the audit row, the job remembered", async () => {
    seedRun(RUN);
    await request();
    expect(row(RUN)).toMatchObject({ transformStatus: "transform_requested", transformRequestedBy: USER, transformBatchJobId: JOB, transformErrorCode: null });
    expect(row(RUN)["transformRequestedAt"]).toBeInstanceOf(Date);
    expect(createJob).toHaveBeenCalledWith(PLATFORM, USER, "upstream-sql-transform", 0);
    expect(audits(RUN)).toEqual([expect.objectContaining({ tenantId: PLATFORM, userId: USER, action: "UPDATE", resourceType: "UpstreamSqlImport", ipAddress: "203.0.113.47" })]);
    expect(audits(RUN)[0]?.["changes"]).toEqual({
      operation: "UPSTREAM_SQL_IMPORT_TRANSFORM_STATE",
      before: { transformStatus: "not_available" },
      after: { transformStatus: "transform_requested" },
    });
  });

  it("a transformed or failed run may be asked again (idempotent by row hash); its earlier outcome is cleared", async () => {
    seedRun(RUN, { transformStatus: "transformed", transformFinishedAt: new Date() });
    await request();
    seedRun(OTHER, { transformStatus: "transform_failed", transformErrorCode: "TRANSFORM_INCOMPLETE" });
    await models.UpstreamSqlImport.update({ transformStatus: "transformed" }, { where: { id: RUN } });
    await request(OTHER);
    expect(row(OTHER)).toMatchObject({ transformStatus: "transform_requested", transformErrorCode: null, transformFinishedAt: null });
  });

  it("refuses with a top-level code: unknown run 404; steps not built, run not loaded, transform in progress 409; real data 403", async () => {
    expect(await refusal()).toEqual({ status: 404, code: "UPSTREAM_SQL_IMPORT_NOT_FOUND" });
    seedRun(RUN);
    built.value = false;
    expect(await refusal()).toEqual({ status: 409, code: "TRANSFORM_NOT_AVAILABLE" });
    built.value = true;
    seedRun(OTHER, { status: "parsing" });
    expect(await refusal(OTHER)).toEqual({ status: 409, code: "RUN_NOT_LOADED" });
    await models.UpstreamSqlImport.update({ transformStatus: "transforming" }, { where: { id: RUN } });
    expect(await refusal()).toEqual({ status: 409, code: "TRANSFORM_IN_PROGRESS" });
    await models.UpstreamSqlImport.update({ transformStatus: "not_available", dataClass: "real" }, { where: { id: RUN } });
    expect(await refusal()).toEqual({ status: 403, code: "REAL_DATA_NOT_ALLOWED" });
    penv["UPSTREAM_REAL_DATA_ALLOWED"] = "true";
    await request();
    expect(row(RUN)["transformStatus"]).toBe("transform_requested");
    expect(createJob).toHaveBeenCalledTimes(1);
  });

  it("another run's transform in progress (the partial unique index) and a lost race are 409 TRANSFORM_IN_PROGRESS; other errors propagate", async () => {
    seedRun(RUN);
    const update = jest.spyOn(models.UpstreamSqlImport, "update");
    update.mockRejectedValueOnce(Object.assign(new Error("unique"), { name: "SequelizeUniqueConstraintError" }));
    expect(await refusal()).toEqual({ status: 409, code: "TRANSFORM_IN_PROGRESS" });
    update.mockResolvedValueOnce([0]);
    expect(await refusal()).toEqual({ status: 409, code: "TRANSFORM_IN_PROGRESS" });
    update.mockRejectedValueOnce(new Error("connection lost"));
    await expect(request()).rejects.toThrow("connection lost");
    update.mockRestore();
    expect(createJob).not.toHaveBeenCalled();
  });

  it("transformAvailable and isTransformRequestable follow the steps and the run", () => {
    expect(service.transformAvailable()).toBe(true);
    expect(service.isTransformRequestable({ status: "loaded", transformStatus: "not_available" })).toBe(true);
    expect(service.isTransformRequestable({ status: "loaded", transformStatus: "transforming" })).toBe(false);
    expect(service.isTransformRequestable({ status: "failed", transformStatus: "not_available" })).toBe(false);
    built.value = false;
    expect(service.transformAvailable()).toBe(false);
    expect(service.isTransformRequestable({ status: "loaded", transformStatus: "not_available" })).toBe(false);
  });
});

describe("P24-01 the worker", () => {
  it("registers its own batch-job type; a job with no requested transform, or a lost claim, completes without work", async () => {
    expect(registeredType).toBe("upstream-sql-transform");
    expect(await asPlatformJob(() => registeredHandler({ id: JOB }))).toEqual({ processedItems: 0 });
    seedRun(RUN, { transformStatus: "transform_requested", transformBatchJobId: JOB, transformRequestedAt: new Date() });
    const update = jest.spyOn(models.UpstreamSqlImport, "update").mockResolvedValueOnce([0]);
    expect(await asPlatformJob(() => service.runTransformJob({ id: JOB }))).toEqual({ processedItems: 0 });
    update.mockRestore();
    expect(runTransform).not.toHaveBeenCalled();
  });

  it("runs the transform on the transform connection: transforming, then transformed with its summary; the connection closed", async () => {
    seedRun(RUN, { transformStatus: "transform_requested", transformBatchJobId: null, transformRequestedAt: new Date() });
    expect(await asPlatformJob(() => service.runTransformJob({ id: JOB }))).toEqual({ processedItems: 2 });
    expect(runTransform).toHaveBeenCalledWith(expect.objectContaining({ runId: RUN, db: connection, runner: connection, role: "callibrator_transform", steps: [] }));
    expect(row(RUN)).toMatchObject({ transformStatus: "transformed", transformBatchJobId: JOB, transformSummary: SUMMARY });
    expect(row(RUN)["transformErrorCode"] ?? null).toBeNull();
    expect(row(RUN)["transformStartedAt"]).toBeInstanceOf(Date);
    expect(row(RUN)["transformFinishedAt"]).toBeInstanceOf(Date);
    expect(audits(RUN).map((a) => (a["changes"] as { after: unknown }).after)).toEqual([{ transformStatus: "transforming" }, { transformStatus: "transformed" }]);
    expect(audits(RUN).every((a) => a["actorName"] === "system:upstream-sql-import" && a["userId"] === null)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a stated failure keeps its code", new TransformFailure("TRANSFORM_INCOMPLETE", "1 row"), "TRANSFORM_INCOMPLETE"],
    ["any other error is TRANSFORM_FAILED (its SQLSTATE in the log only)", Object.assign(new Error("boom"), { parent: { code: "23503" } }), "TRANSFORM_FAILED"],
    ["an error with no SQLSTATE is TRANSFORM_FAILED too", new Error("plain"), "TRANSFORM_FAILED"],
  ])("%s: transform_failed, the job fails, the connection closed", async (_label, error, code) => {
    seedRun(RUN, { transformStatus: "transform_requested", transformBatchJobId: JOB, transformRequestedAt: new Date() });
    runTransform.mockRejectedValueOnce(error);
    await expect(asPlatformJob(() => service.runTransformJob({ id: JOB }))).rejects.toThrow(`Upstream SQL transform ${RUN} failed: ${code}`);
    expect(row(RUN)).toMatchObject({ transformStatus: "transform_failed", transformErrorCode: code });
    expect(row(RUN)["transformSummary"] ?? null).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("re-checks the DPIA gate: a real run is failed REAL_DATA_NOT_ALLOWED before the runner reads a row", async () => {
    seedRun(RUN, { dataClass: "real", transformStatus: "transform_requested", transformBatchJobId: JOB, transformRequestedAt: new Date() });
    await expect(asPlatformJob(() => service.runTransformJob({ id: JOB }))).rejects.toThrow("REAL_DATA_NOT_ALLOWED");
    expect(runTransform).not.toHaveBeenCalled();
    expect(row(RUN)["transformErrorCode"]).toBe("REAL_DATA_NOT_ALLOWED");
  });
});

describe("P24-01 the interrupted transform", () => {
  it("fails a transform whose job ended or vanished, or that was never queued; leaves a running or freshly requested one", async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000);
    mdb.seed("BatchJob", [
      { id: "a2401000-0000-4000-8000-000000000e01", tenantId: PLATFORM, type: "upstream-sql-transform", status: "FAILED" },
      { id: "a2401000-0000-4000-8000-000000000e02", tenantId: PLATFORM, type: "upstream-sql-transform", status: "PROCESSING" },
    ]);
    seedRun("a2401000-0000-4000-8000-000000000f11", { transformStatus: "transforming", transformBatchJobId: "a2401000-0000-4000-8000-000000000e01" });
    expect(await asPlatformJob(() => service.reconcileInterruptedTransforms())).toBe(1);
    seedRun("a2401000-0000-4000-8000-000000000f12", { transformStatus: "transforming", transformBatchJobId: "a2401000-0000-4000-8000-000000000e02" });
    expect(await asPlatformJob(() => service.reconcileInterruptedTransforms())).toBe(0);
    await models.UpstreamSqlImport.update({ transformStatus: "transformed" }, { where: { id: "a2401000-0000-4000-8000-000000000f12" } });
    seedRun("a2401000-0000-4000-8000-000000000f13", { transformStatus: "transform_requested", transformBatchJobId: null });
    expect(await asPlatformJob(() => service.reconcileInterruptedTransforms())).toBe(0);
    await models.UpstreamSqlImport.update({ transformStatus: "transformed" }, { where: { id: "a2401000-0000-4000-8000-000000000f13" } });
    seedRun("a2401000-0000-4000-8000-000000000f14", { transformStatus: "transform_requested", transformBatchJobId: null, updatedAt: old });
    const update = jest.spyOn(models.UpstreamSqlImport, "update").mockResolvedValueOnce([0]);
    expect(await asPlatformJob(() => service.reconcileInterruptedTransforms())).toBe(0);
    update.mockRestore();
    expect(await asPlatformJob(() => service.reconcileInterruptedTransforms())).toBe(1);
    expect(mdb.rows("UpstreamSqlImport").filter((r) => r["transformErrorCode"] === "INTERRUPTED").map((r) => r["id"])).toEqual([
      "a2401000-0000-4000-8000-000000000f11",
      "a2401000-0000-4000-8000-000000000f14",
    ]);
    expect(audits("a2401000-0000-4000-8000-000000000f11")[0]?.["changes"]).toMatchObject({ transformErrorCode: "INTERRUPTED", jobStatus: "FAILED" });
    expect(audits("a2401000-0000-4000-8000-000000000f14")[0]?.["changes"]).toMatchObject({ jobStatus: null });
  });
});
