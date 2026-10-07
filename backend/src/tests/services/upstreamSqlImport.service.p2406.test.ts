/**
 * P24-06 — services/upstreamSqlImport.service.ts on the REAL models, the REAL
 * audit and notification services and the REAL tenant hooks over the
 * in-memory store (fixtures/memoryDb). Doubled: the batch-job queue (the job
 * is run by calling the handler), the virus scanner, the staging connection
 * and the pipeline (each tested on its own and live), the e-mail queue.
 *
 * Every transition is a conditional UPDATE with its audit row in one
 * transaction; a final one stores the uploader's notification in their home
 * tenant; a refusal is a 409 that explains the state; the file is deleted as
 * soon as it has served; nothing from the dump reaches a row, an audit row or
 * a notification.
 *
 * TypeScript without jest's hoisting: the mocks are registered first, then
 * every runtime module is loaded with `jest.requireActual`.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { gzipSync } from "zlib";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as ServiceModule from "../../services/upstreamSqlImport.service";
import type * as PipelineModule from "../../services/upstreamImport/importPipeline";
import type * as PathModule from "path";
import { environment } from "../../config/env";

/** The process environment (config/env.ts); tests set variables on it, read per call. */
const penv = environment();

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "p2406-svc-"));

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../utils/upload.util", () => ({
  quarantinePath: (...parts: string[]) => jest.requireActual<typeof PathModule>("path").join(TMP, ...parts),
}));
const createJob = jest.fn();
const registerHandler = jest.fn();
jest.mock("../../services/batchJob.service", () => ({
  createJob: (...a: unknown[]) => createJob(...a) as unknown,
  registerHandler: (...a: unknown[]) => registerHandler(...a) as unknown,
}));
const scanFile = jest.fn();
jest.mock("../../services/virusScan.service", () => ({ scanFile: (...a: unknown[]) => scanFile(...a) as unknown }));
jest.mock("../../services/emailQueue.service", () => ({ queueNotificationEmail: jest.fn(() => Promise.resolve()) }));
const stagingClose = jest.fn(() => Promise.resolve());
const commit = jest.fn(() => Promise.resolve());
const rollback = jest.fn(() => Promise.resolve());
jest.mock("../../config/upstreamImport", () => ({
  ...jest.requireActual<object>("../../config/upstreamImport"),
  createStagingDb: () => ({ transaction: () => Promise.resolve({ commit, rollback }), close: stagingClose }),
}));
const beginStaging = jest.fn();
const purgeRun = jest.fn();
jest.mock("../../services/upstreamImport/stagingLoader", () => ({
  beginStaging: (...a: unknown[]) => beginStaging(...a) as unknown,
  purgeRun: (...a: unknown[]) => purgeRun(...a) as unknown,
}));
const runPipeline = jest.fn();
jest.mock("../../services/upstreamImport/importPipeline", () => ({
  ...jest.requireActual<object>("../../services/upstreamImport/importPipeline"),
  runPipeline: (...a: unknown[]) => runPipeline(...a) as unknown,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const service = jest.requireActual<typeof ServiceModule>("../../services/upstreamSqlImport.service");
/** What the service registered with the batch-job runner when it loaded (before any clearAllMocks). */
const [registeredType, registeredHandler] = registerHandler.mock.calls[0] as [string, (job: { id: string }) => Promise<unknown>];
const { ImportFailure, ImportCancelled } = jest.requireActual<typeof PipelineModule>("../../services/upstreamImport/importPipeline");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the real barrel, loaded after the config mock
const models = require("../../models") as { UpstreamSqlImport: { update: (...a: unknown[]) => Promise<[number]>; create: (...a: unknown[]) => Promise<unknown>; findOne: (...a: unknown[]) => Promise<unknown> } };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the tenant context, loaded after the config mock
const { tenantStorage } = require("../../middlewares/tenantContext.middleware") as { tenantStorage: { run(ctx: object, fn: () => void): void } };

const PLATFORM = "00000000-0000-4000-8000-000000000001";
const HOME = "a2406000-0000-4000-8000-0000000000a1";
const USER = "a2406000-0000-4000-8000-0000000000b1";
const NAMELESS = "a2406000-0000-4000-8000-0000000000b2";
const JOB = "a2406000-0000-4000-8000-0000000000c1";
const actor = { userId: USER, tenantId: HOME, ipAddress: "203.0.113.46", userAgent: "jest" };
const DUMP = "-- MariaDB dump\nCREATE TABLE `t` (`a` int);\nINSERT INTO `t` VALUES (1);\n";
const SECRET = "Synthetic Secret Value 0042";

type RunRow = Record<string, unknown>;

const asSuperAdmin = <T>(work: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    tenantStorage.run({ tenantId: null, isSuperAdmin: true, isSystemTask: false }, () => {
      work().then(resolve, reject);
    });
  });
const asPlatformJob = <T>(work: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    tenantStorage.run({ tenantId: PLATFORM, isSuperAdmin: false, isSystemTask: false }, () => {
      work().then(resolve, reject);
    });
  });

let n = 0;
/** A file as multer leaves it in the quarantine. */
const quarantined = (body: string | Buffer): { path: string; size: number } => {
  n += 1;
  const file = path.join(TMP, `upload-${String(n)}`);
  fs.writeFileSync(file, body);
  return { path: file, size: fs.statSync(file).size };
};
const runs = (): RunRow[] => mdb.rows("UpstreamSqlImport");
const run = (id: string): RunRow => runs().find((r) => r["id"] === id) as RunRow;
const audits = (id: string): RunRow[] => mdb.rows("AuditLog").filter((a) => a["resourceId"] === id);
const notifications = (): RunRow[] => mdb.rows("Notification");
const upload = (body: string | Buffer, dataClass = "synthetic", who: ServiceModule.Actor = actor): Promise<ServiceModule.RunView> =>
  asSuperAdmin(() => service.uploadDump(quarantined(body), { dataClass }, who));
const tables = { t: { staged: true, reason: null, columns: 1, excludedColumns: 0, rowsLoaded: 1, rowsRejected: 2, rowsNotExtracted: 0, rejections: { invalid_date: 2 }, notes: { zero_date: 1 } } };
const summary = { statements: { create_table: 1, insert: 1 }, comments: 1, conditionalComments: 0, delimiterRegions: 0, truncated: false, completionMarker: false };

beforeEach(() => {
  mdb.reset();
  fs.rmSync(path.join(TMP, "upstream-sql"), { recursive: true, force: true });
  jest.clearAllMocks();
  createJob.mockResolvedValue({ id: JOB });
  scanFile.mockResolvedValue({ clean: true, provider: "none" });
  beginStaging.mockResolvedValue(undefined);
  purgeRun.mockResolvedValue([]);
  runPipeline.mockResolvedValue({ tables, summary, bytesRead: 10, uncompressedBytes: 10 });
  mdb.seed("Tenant", [
    { id: PLATFORM, name: "Callibrator Platform", code: "PLATFORM", status: "active" },
    { id: HOME, name: "Home", code: "HOME", status: "active" },
  ]);
  mdb.seed("User", [
    { id: USER, tenantId: HOME, username: "op", email: "op@home.test", password: "x", firstName: "Op", lastName: "Erator", status: "ACTIVE", isActive: true },
    { id: NAMELESS, tenantId: HOME, username: "nameless", email: "n@home.test", password: "x", firstName: "", lastName: "", status: "ACTIVE", isActive: true },
  ]);
  delete penv["UPSTREAM_REAL_DATA_ALLOWED"];
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("P24-06 upload", () => {
  it("accepts a SQL dump into the dump directory, records it with its SHA-256 and audit row, and queues its job", async () => {
    const view = await upload(DUMP);
    expect(view).toMatchObject({ status: "uploaded", dataClass: "synthetic", compression: "none", sizeBytes: DUMP.length, attempt: 1, fileRetained: true, cancellable: true, retryable: false, progress: 0 });
    expect(view.uploadedBy).toEqual({ id: USER, name: "Op Erator" });
    expect(view).not.toHaveProperty("filePath");
    const row = run(view.id);
    expect(row).toMatchObject({ batchJobId: JOB, notifyTenantId: HOME, filePath: path.join(TMP, "upstream-sql", `${view.id}.dump`) });
    expect(fs.readFileSync(row["filePath"] as string, "utf8")).toBe(DUMP);
    expect(createJob).toHaveBeenCalledWith(PLATFORM, USER, "upstream-sql-import", 0);
    expect(audits(view.id)).toEqual([
      expect.objectContaining({ tenantId: PLATFORM, userId: USER, action: "CREATE", resourceType: "UpstreamSqlImport", ipAddress: "203.0.113.46" }),
    ]);
    expect(audits(view.id)[0]?.["changes"]).toMatchObject({ operation: "UPSTREAM_SQL_IMPORT_UPLOAD", sha256: view.sha256, dataClass: "synthetic", after: { status: "uploaded" } });
  });

  it("sniffs gzip by its magic bytes and the decompressed head; a BOM is allowed; a principal with no home tenant is notified in PLATFORM", async () => {
    const view = await upload(gzipSync(Buffer.from(`\uFEFF${DUMP}`)), "synthetic", { ...actor, tenantId: null });
    expect(view.compression).toBe("gzip");
    expect(run(view.id)["notifyTenantId"]).toBe(PLATFORM);
  });

  it("reads a head of 64 KiB from a large file, and accepts a gzip stream cut inside the window", async () => {
    const big = `-- dump\n${"-- padding\n".repeat(20_000)}`;
    expect((await upload(big)).status).toBe("uploaded");
    mdb.reset();
    mdb.seed("Tenant", { id: PLATFORM, name: "P", code: "PLATFORM", status: "active" });
    expect((await upload(gzipSync(Buffer.from(big)).subarray(0, 60))).compression).toBe("gzip");
  });

  it.each([
    ["an empty file", "", 400, "The file is empty"],
    ["a non-dump text", "hello world", 400, "not a SQL dump"],
    ["a binary file", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]), 400, "not a SQL dump"],
    ["invalid UTF-8", Buffer.from([0x2d, 0x2d, 0x20, 0xff, 0xfe]), 400, "not a SQL dump"],
    ["a corrupt gzip", Buffer.from([0x1f, 0x8b, 0x08, 0, 1, 2, 3]), 400, "not a SQL dump"],
  ])("refuses %s (%s) and deletes it", async (_label, body, status, message) => {
    const file = quarantined(body);
    await expect(asSuperAdmin(() => service.uploadDump(file, { dataClass: "synthetic" }, actor))).rejects.toMatchObject({ status, message: expect.stringContaining(message) as unknown });
    expect(fs.existsSync(file.path)).toBe(false);
    expect(runs()).toEqual([]);
  });

  it("refuses a missing or unknown dataClass (validation, 400) and deletes the file", async () => {
    const file = quarantined(DUMP);
    await expect(asSuperAdmin(() => service.uploadDump(file, { dataClass: "maybe" }, actor))).rejects.toMatchObject({ status: 400, message: "Validation failed" });
    expect(fs.existsSync(file.path)).toBe(false);
  });

  it("the DPIA gate: a file declared real is a 403 while UPSTREAM_REAL_DATA_ALLOWED is off — accepted when it is on", async () => {
    await expect(upload(DUMP, "real")).rejects.toMatchObject({ status: 403, message: expect.stringContaining("UPSTREAM_REAL_DATA_ALLOWED") as unknown });
    penv["UPSTREAM_REAL_DATA_ALLOWED"] = "true";
    expect((await upload(DUMP, "real")).dataClass).toBe("real");
  });

  it("one active run at a time: a second upload is a 409 naming the active run", async () => {
    const first = await upload(DUMP);
    await expect(upload(DUMP)).rejects.toMatchObject({ status: 409, message: expect.stringContaining(first.id.slice(0, 8)) as unknown });
  });

  it("a unique-index race (two uploads at once) is a 409, whether or not the winner is visible yet", async () => {
    const dir = path.join(TMP, "upstream-sql");
    fs.mkdirSync(dir, { recursive: true });
    const before = fs.readdirSync(dir);
    const unique = Object.assign(new Error("dup"), { name: "SequelizeUniqueConstraintError" });
    const create = jest.spyOn(models.UpstreamSqlImport, "create").mockRejectedValueOnce(unique);
    await expect(upload(DUMP)).rejects.toMatchObject({ status: 409, message: "Another import is in progress." });
    create.mockRejectedValueOnce(unique);
    const findOne = jest.spyOn(models.UpstreamSqlImport, "findOne").mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "f00dfeed-0000", status: "parsing" });
    await expect(upload(DUMP)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("f00dfeed") as unknown });
    findOne.mockRestore();
    create.mockRestore();
    // The losers' files were moved into the dump directory, then deleted.
    expect(fs.readdirSync(dir)).toEqual(before);
  });
});

describe("P24-06 the worker", () => {
  const job = (): Promise<{ processedItems: number }> => asPlatformJob(() => service.runImportJob({ id: JOB }));

  it("uploaded → scanning → parsing → loaded: counts written, the file deleted, every step audited, the uploader notified", async () => {
    const view = await upload(DUMP);
    runPipeline.mockImplementationOnce(async (options: { onProgress: (p: object) => Promise<boolean> }) => {
      expect(await options.onProgress({ bytesRead: 5, uncompressedBytes: 5, tables })).toBe(false);
      expect(run(view.id)["status"]).toBe("parsing");
      expect(Number(run(view.id)["bytesRead"])).toBe(5);
      return { tables, summary, bytesRead: 10, uncompressedBytes: 10 };
    });
    expect(await job()).toEqual({ processedItems: 1 });
    const row = run(view.id);
    expect(row).toMatchObject({ status: "loaded", rowsLoaded: 1, rowsRejected: 2, rowsNotExtracted: 0, filePath: null, transformStatus: "not_available" });
    expect(row["fileDeletedAt"]).toBeInstanceOf(Date);
    expect(fs.readdirSync(path.join(TMP, "upstream-sql"))).toEqual([]);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(stagingClose).toHaveBeenCalledTimes(1);
    expect(purgeRun).toHaveBeenCalledWith(expect.anything(), view.id);
    expect(audits(view.id).map((a) => [(a["changes"] as { after: { status: string } }).after.status, a["actorName"] ?? a["userId"]])).toEqual([
      ["uploaded", USER],
      ["scanning", "system:upstream-sql-import"],
      ["parsing", "system:upstream-sql-import"],
      ["loaded", "system:upstream-sql-import"],
    ]);
    const [note] = notifications();
    expect(note).toMatchObject({ tenantId: HOME, userId: USER, type: "SYSTEM", title: "SQL dump import loaded", actionUrl: `/dashboard/upstream-sql-import?run=${view.id}` });
    expect(String(note?.["message"])).toContain("t: 1 loaded, 2 rejected");
    expect(String(note?.["message"])).toContain("Rejected by reason: invalid_date 2.");
    expect(String(note?.["message"])).toContain(view.sha256);
    const loaded = await service.getRun(view.id);
    expect(loaded).toMatchObject({ progress: 1, durationMs: expect.any(Number) as unknown, tables: [{ table: "t", ...tables.t }] });
  });

  it("nothing from the dump reaches the run, an audit row or a notification", async () => {
    await upload(`${DUMP}INSERT INTO t VALUES ('${SECRET}');\n`);
    await job();
    expect(JSON.stringify([runs(), mdb.rows("AuditLog"), notifications()])).not.toContain(SECRET);
  });

  it("a job with no queued run, or whose run another worker claimed, completes without work", async () => {
    expect(registeredType).toBe("upstream-sql-import");
    expect(await asPlatformJob(() => registeredHandler({ id: JOB }))).toEqual({ processedItems: 0 });
    expect(await job()).toEqual({ processedItems: 0 });
    await upload(DUMP);
    const update = jest.spyOn(models.UpstreamSqlImport, "update").mockResolvedValueOnce([0]);
    expect(await job()).toEqual({ processedItems: 0 });
    update.mockRestore();
  });

  it("the scanning → parsing step lost to a cancellation: the job completes without parsing", async () => {
    await upload(DUMP);
    const real = models.UpstreamSqlImport.update.bind(models.UpstreamSqlImport);
    const update = jest.spyOn(models.UpstreamSqlImport, "update").mockImplementationOnce(real).mockResolvedValueOnce([0]);
    expect(await job()).toEqual({ processedItems: 0 });
    expect(runPipeline).not.toHaveBeenCalled();
    update.mockRestore();
  });

  it.each([
    [
      "a file gone from disk",
      (id: string) => {
        fs.rmSync(run(id)["filePath"] as string);
      },
      "FILE_MISSING",
      false,
    ],
    [
      "a file changed since upload",
      (id: string) => {
        fs.appendFileSync(run(id)["filePath"] as string, "-- x\n");
      },
      "INTEGRITY_MISMATCH",
      true,
    ],
    ["an infected file", () => scanFile.mockResolvedValueOnce({ clean: false, provider: "clamav", reason: "Eicar-Signature" }), "INFECTED", false],
    ["a scanner that could not scan", () => scanFile.mockResolvedValueOnce({ clean: false, provider: "clamav", reason: "scan-error: ECONNREFUSED" }), "SCAN_FAILED", true],
    ["an unknown scan provider", () => scanFile.mockResolvedValueOnce({ clean: false, provider: "x", reason: "provider-not-implemented" }), "SCAN_FAILED", true],
    ["a staging connection that is not the import role", () => beginStaging.mockRejectedValueOnce(new Error("role")), "STAGING_ROLE_INVALID", true],
    ["a truncated dump", () => runPipeline.mockRejectedValueOnce(new ImportFailure("TRUNCATED_INPUT", "t")), "TRUNCATED_INPUT", true],
    ["a staging statement error", () => runPipeline.mockRejectedValueOnce(Object.assign(new Error("e"), { parent: { code: "22P02" } })), "STAGING_FAILED", true],
    ["an error with no SQLSTATE", () => runPipeline.mockRejectedValueOnce(new Error("e")), "STAGING_FAILED", true],
  ] as const)("%s fails the run %s, the job FAILED, the file kept only when a retry could use it", async (_label, arrange, code, kept) => {
    const view = await upload(DUMP);
    arrange(view.id);
    await expect(job()).rejects.toThrow(new RegExp(`${view.id} failed: ${code}`));
    const row = run(view.id);
    expect(row).toMatchObject({ status: "failed", errorCode: code });
    expect(row["filePath"] !== null).toBe(kept);
    expect(row["fileRetainUntil"] instanceof Date).toBe(kept);
    expect(notifications().map((x) => x["title"])).toEqual(["SQL dump import failed"]);
    expect(String(notifications()[0]?.["message"])).toContain(`${code}: `);
    const shown = await service.getRun(view.id);
    expect(shown).toMatchObject({ errorCode: code, retryable: kept, cancellable: false });
    expect(shown.errorSummary).toEqual(expect.any(String));
  });

  it("the real-data gate is checked again by the worker", async () => {
    penv["UPSTREAM_REAL_DATA_ALLOWED"] = "true";
    const view = await upload(DUMP, "real");
    delete penv["UPSTREAM_REAL_DATA_ALLOWED"];
    await expect(job()).rejects.toThrow(/REAL_DATA_NOT_ALLOWED/);
    expect(run(view.id)).toMatchObject({ status: "failed", errorCode: "REAL_DATA_NOT_ALLOWED" });
    expect(scanFile).not.toHaveBeenCalled();
  });

  it("a cancellation asked while scanning stops before parsing; one asked while parsing rolls staging back; both delete the file", async () => {
    const first = await upload(DUMP);
    scanFile.mockImplementationOnce(async () => {
      await asSuperAdmin(() => service.cancelRun(first.id, actor));
      return { clean: true, provider: "none" };
    });
    expect(await job()).toEqual({ processedItems: 0 });
    expect(run(first.id)).toMatchObject({ status: "cancelled", filePath: null, cancelledBy: USER });
    expect(runPipeline).not.toHaveBeenCalled();

    const second = await upload(DUMP);
    runPipeline.mockImplementationOnce(async (options: { onProgress: (p: object) => Promise<boolean> }) => {
      await asSuperAdmin(() => service.cancelRun(second.id, actor));
      if (await options.onProgress({ bytesRead: 1, uncompressedBytes: 1, tables: {} })) {
        throw new ImportCancelled();
      }
      return {};
    });
    expect(await job()).toEqual({ processedItems: 0 });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(run(second.id)).toMatchObject({ status: "cancelled", filePath: null });
    expect(fs.readdirSync(path.join(TMP, "upstream-sql"))).toEqual([]);
    expect(notifications().map((x) => x["title"])).toEqual(["SQL dump import cancelled", "SQL dump import cancelled"]);
  });

  it("a run whose uploader is gone finishes without a notification", async () => {
    const view = await upload(DUMP);
    await models.UpstreamSqlImport.update({ uploadedBy: null }, { where: { id: view.id } });
    await job();
    expect(run(view.id)["status"]).toBe("loaded");
    expect(notifications()).toEqual([]);
    expect((await service.getRun(view.id)).uploadedBy).toBeNull();
  });
});

describe("P24-06 cancel, retry, list", () => {
  it("cancels a queued run at once (file deleted, uploader notified); a second ask on a finished run is a 409", async () => {
    const view = await upload(DUMP);
    const cancelled = await asSuperAdmin(() => service.cancelRun(view.id, actor));
    expect(cancelled).toMatchObject({ status: "cancelled", fileRetained: false, cancellable: false });
    expect(fs.existsSync(path.join(TMP, "upstream-sql", `${view.id}.dump`))).toBe(false);
    expect(audits(view.id).map((a) => (a["changes"] as { after: { status: string } }).after.status)).toEqual(["uploaded", "cancelled"]);
    await expect(asSuperAdmin(() => service.cancelRun(view.id, actor))).rejects.toMatchObject({ status: 409, message: expect.stringContaining("is cancelled") as unknown });
  });

  it("asks a scanning or parsing run to stop (audited), and answers the same run when asked twice", async () => {
    const view = await upload(DUMP);
    await models.UpstreamSqlImport.update({ status: "parsing" }, { where: { id: view.id } });
    const asked = await asSuperAdmin(() => service.cancelRun(view.id, actor));
    expect(asked).toMatchObject({ status: "parsing", cancellable: false, cancelRequestedAt: expect.any(String) as unknown });
    expect(await asSuperAdmin(() => service.cancelRun(view.id, actor))).toEqual(asked);
    expect((audits(view.id)[1]?.["changes"] as { operation: string }).operation).toBe("UPSTREAM_SQL_IMPORT_CANCEL_REQUESTED");
  });

  it("a cancellation that loses a race to the worker is a 409", async () => {
    const view = await upload(DUMP);
    const update = jest.spyOn(models.UpstreamSqlImport, "update").mockResolvedValueOnce([0]);
    await expect(asSuperAdmin(() => service.cancelRun(view.id, actor))).rejects.toMatchObject({ status: 409, message: expect.stringContaining("just started") as unknown });
    await models.UpstreamSqlImport.update({ status: "scanning" }, { where: { id: view.id } });
    update.mockResolvedValueOnce([0]);
    await expect(asSuperAdmin(() => service.cancelRun(view.id, actor))).rejects.toMatchObject({ status: 409, message: expect.stringContaining("just finished") as unknown });
    update.mockRestore();
  });

  it("retries a failed run with its file: attempt + 1, counts reset, a new job; refuses everything else with a reason", async () => {
    const view = await upload(DUMP);
    runPipeline.mockRejectedValueOnce(new ImportFailure("TRUNCATED_INPUT", "t"));
    await expect(asPlatformJob(() => service.runImportJob({ id: JOB }))).rejects.toThrow();
    const retried = await asSuperAdmin(() => service.retryRun(view.id, actor));
    expect(retried).toMatchObject({ status: "uploaded", attempt: 2, errorCode: null, rowsLoaded: 0, fileRetained: true });
    expect(createJob).toHaveBeenCalledTimes(2);
    await expect(asSuperAdmin(() => service.retryRun(view.id, actor))).rejects.toMatchObject({ status: 409, message: expect.stringContaining("only a failed run") as unknown });
    await expect(asSuperAdmin(() => service.retryRun("a2406000-0000-4000-8000-00000000dead", actor))).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to retry a run whose file is gone, a real run while the gate is off, and while another run is active", async () => {
    const view = await upload(DUMP);
    await models.UpstreamSqlImport.update({ status: "failed", errorCode: "INFECTED", filePath: null }, { where: { id: view.id } });
    await expect(asSuperAdmin(() => service.retryRun(view.id, actor))).rejects.toMatchObject({ status: 409, message: expect.stringContaining("deleted") as unknown });
    await models.UpstreamSqlImport.update({ filePath: path.join(TMP, "x"), dataClass: "real", fileDeletedAt: null }, { where: { id: view.id } });
    await expect(asSuperAdmin(() => service.retryRun(view.id, actor))).rejects.toMatchObject({ status: 403, message: expect.stringContaining("declared real") as unknown });
    await models.UpstreamSqlImport.update({ dataClass: "synthetic" }, { where: { id: view.id } });
    const other = await upload(DUMP);
    await expect(asSuperAdmin(() => service.retryRun(view.id, actor))).rejects.toMatchObject({ status: 409, message: expect.stringContaining(other.id.slice(0, 8)) as unknown });
  });

  it("a retry that loses a race is a 409 (state changed, or the unique index)", async () => {
    const view = await upload(DUMP);
    await models.UpstreamSqlImport.update({ status: "failed", errorCode: "TRUNCATED_INPUT" }, { where: { id: view.id } });
    const update = jest.spyOn(models.UpstreamSqlImport, "update").mockResolvedValueOnce([0]);
    await expect(asSuperAdmin(() => service.retryRun(view.id, actor))).rejects.toMatchObject({ status: 409, message: expect.stringContaining("just changed") as unknown });
    const unique = Object.assign(new Error("dup"), { name: "SequelizeUniqueConstraintError" });
    update.mockRejectedValueOnce(unique);
    await expect(asSuperAdmin(() => service.retryRun(view.id, actor))).rejects.toMatchObject({ status: 409, message: "Another import is in progress." });
    update.mockRejectedValueOnce(unique);
    // findByPk is findOne underneath: the first call (loading the run) goes through.
    const realFindOne = models.UpstreamSqlImport.findOne.bind(models.UpstreamSqlImport);
    const findOne = jest
      .spyOn(models.UpstreamSqlImport, "findOne")
      .mockImplementationOnce(realFindOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "beefcafe-0000", status: "scanning" });
    await expect(asSuperAdmin(() => service.retryRun(view.id, actor))).rejects.toMatchObject({ status: 409, message: expect.stringContaining("beefcafe") as unknown });
    update.mockRejectedValueOnce(new Error("other"));
    await expect(asSuperAdmin(() => service.retryRun(view.id, actor))).rejects.toThrow("other");
    findOne.mockRestore();
    update.mockRestore();
  });

  it("lists newest first with a top-level meta, filters by status, names the uploader (or null), and 404s an unknown run", async () => {
    mdb.seed("UpstreamSqlImport", [
      { id: "a2406000-0000-4000-8000-000000000d01", status: "cancelled", dataClass: "synthetic", compression: "none", sizeBytes: 0, sha256: "a".repeat(64), uploadedBy: NAMELESS, notifyTenantId: HOME, createdAt: new Date("2026-10-01") },
      { id: "a2406000-0000-4000-8000-000000000d02", status: "failed", errorCode: "INTERRUPTED", dataClass: "synthetic", compression: "none", sizeBytes: 100, bytesRead: 50, sha256: "b".repeat(64), uploadedBy: "a2406000-0000-4000-8000-00000000ffff", notifyTenantId: HOME, createdAt: new Date("2026-10-02") },
    ]);
    const all = await asSuperAdmin(() => service.listRuns({ page: 1, limit: 20 }));
    expect(all.meta).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1 });
    expect(all.rows.map((r) => [r.status, r.uploadedBy, r.progress])).toEqual([
      ["failed", { id: "a2406000-0000-4000-8000-00000000ffff", name: null }, 0.5],
      ["cancelled", { id: NAMELESS, name: null }, 0],
    ]);
    const failed = await asSuperAdmin(() => service.listRuns({ status: "failed", page: 1, limit: 1 }));
    expect(failed.rows.map((r) => r.errorSummary)).toEqual([expect.stringContaining("worker") as unknown]);
    await expect(service.getRun("a2406000-0000-4000-8000-00000000dead")).rejects.toMatchObject({ status: 404 });
    await expect(asSuperAdmin(() => service.cancelRun("a2406000-0000-4000-8000-00000000dead", actor))).rejects.toMatchObject({ status: 404 });
    mdb.seed("UpstreamSqlImport", { id: "a2406000-0000-4000-8000-000000000d03", status: "loaded", dataClass: "synthetic", compression: "none", sizeBytes: 0, sha256: "c".repeat(64), uploadedBy: null, notifyTenantId: HOME, createdAt: new Date("2026-09-30") });
    expect((await asSuperAdmin(() => service.listRuns({ status: "loaded", page: 1, limit: 20 }))).rows.map((r) => r.progress)).toEqual([1]);
  });

  it("settings: the limits, the shared DPIA gate, and no stage 2", () => {
    penv["UPSTREAM_IMPORT_MAX_BYTES"] = "1000";
    expect(service.getSettings()).toEqual({ maxUploadBytes: 1000, maxUncompressedBytes: 2048 * 1024 * 1024, failedRetentionDays: 7, realDataAllowed: false, transformAvailable: false });
    delete penv["UPSTREAM_IMPORT_MAX_BYTES"];
  });
});

describe("P24-06 the sweep and the reconciliation", () => {
  const seedRun = (id: string, values: RunRow): void => {
    mdb.seed("UpstreamSqlImport", { id, dataClass: "synthetic", compression: "none", sizeBytes: 1, sha256: "d".repeat(64), uploadedBy: USER, notifyTenantId: HOME, createdAt: new Date(), updatedAt: new Date(), ...values });
  };

  it("fails an active run whose job ended or vanished, or that was never queued; leaves a running or freshly queued one", async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000);
    mdb.seed("BatchJob", [
      { id: "a2406000-0000-4000-8000-000000000e01", tenantId: PLATFORM, type: "upstream-sql-import", status: "FAILED" },
      { id: "a2406000-0000-4000-8000-000000000e02", tenantId: PLATFORM, type: "upstream-sql-import", status: "PROCESSING" },
      { id: "a2406000-0000-4000-8000-000000000e03", tenantId: PLATFORM, type: "upstream-sql-import", status: "PENDING" },
    ]);
    seedRun("a2406000-0000-4000-8000-000000000f01", { status: "parsing", batchJobId: "a2406000-0000-4000-8000-000000000e01" });
    expect(await asPlatformJob(() => service.reconcileInterrupted())).toBe(1);
    seedRun("a2406000-0000-4000-8000-000000000f02", { status: "scanning", batchJobId: "a2406000-0000-4000-8000-000000000e02" });
    expect(await asPlatformJob(() => service.reconcileInterrupted())).toBe(0);
    await models.UpstreamSqlImport.update({ status: "loaded", filePath: null }, { where: { id: "a2406000-0000-4000-8000-000000000f02" } });
    seedRun("a2406000-0000-4000-8000-000000000f03", { status: "uploaded", batchJobId: "a2406000-0000-4000-8000-000000000e03" });
    expect(await asPlatformJob(() => service.reconcileInterrupted())).toBe(0);
    await models.UpstreamSqlImport.update({ status: "cancelled", filePath: null }, { where: { id: "a2406000-0000-4000-8000-000000000f03" } });
    seedRun("a2406000-0000-4000-8000-000000000f06", { status: "uploaded", batchJobId: null });
    expect(await asPlatformJob(() => service.reconcileInterrupted())).toBe(0);
    await models.UpstreamSqlImport.update({ status: "cancelled", filePath: null }, { where: { id: "a2406000-0000-4000-8000-000000000f06" } });
    seedRun("a2406000-0000-4000-8000-000000000f04", { status: "uploaded", batchJobId: null, updatedAt: old });
    expect(await asPlatformJob(() => service.reconcileInterrupted())).toBe(1);
    seedRun("a2406000-0000-4000-8000-000000000f05", { status: "scanning", batchJobId: "a2406000-0000-4000-8000-00000000eeee" });
    const update = jest.spyOn(models.UpstreamSqlImport, "update").mockResolvedValueOnce([0]);
    expect(await asPlatformJob(() => service.reconcileInterrupted())).toBe(0);
    update.mockRestore();
    expect(await asPlatformJob(() => service.reconcileInterrupted())).toBe(1);
    expect(runs().filter((r) => r["errorCode"] === "INTERRUPTED").map((r) => r["id"])).toEqual([
      "a2406000-0000-4000-8000-000000000f01",
      "a2406000-0000-4000-8000-000000000f04",
      "a2406000-0000-4000-8000-000000000f05",
    ]);
    expect(notifications().filter((x) => x["title"] === "SQL dump import failed")).toHaveLength(3);
  });

  it("deletes a failed run's file past its retention (audited), and an orphan file once it is an hour old", async () => {
    const dir = path.join(TMP, "upstream-sql");
    fs.rmSync(dir, { recursive: true, force: true });
    expect(await service.sweepUpstreamSqlImports()).toEqual({ interrupted: 0, purged: 0, orphans: 0 });
    fs.mkdirSync(path.join(dir, "a-directory"), { recursive: true });
    const expired = path.join(dir, "expired.dump");
    const kept = path.join(dir, "kept.dump");
    const orphan = path.join(dir, "orphan.dump");
    const young = path.join(dir, "young.dump");
    for (const f of [expired, kept, orphan, young]) {
      fs.writeFileSync(f, "x");
    }
    const hourAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(orphan, hourAgo, hourAgo);
    seedRun("a2406000-0000-4000-8000-000000000f11", { status: "failed", errorCode: "TRUNCATED_INPUT", filePath: expired, fileRetainUntil: new Date(Date.now() - 1000) });
    seedRun("a2406000-0000-4000-8000-000000000f12", { status: "failed", errorCode: "TRUNCATED_INPUT", filePath: kept, fileRetainUntil: new Date(Date.now() + 86_400_000) });
    expect(await service.sweepUpstreamSqlImports()).toEqual({ interrupted: 0, purged: 1, orphans: 1 });
    expect(fs.readdirSync(dir).sort()).toEqual(["a-directory", "kept.dump", "young.dump"]);
    expect(run("a2406000-0000-4000-8000-000000000f11")).toMatchObject({ filePath: null });
    expect((audits("a2406000-0000-4000-8000-000000000f11")[0]?.["changes"] as { operation: string }).operation).toBe("UPSTREAM_SQL_IMPORT_FILE_PURGED");
  });

  it("a file that cannot be deleted is logged, not thrown", async () => {
    const dir = path.join(TMP, "upstream-sql", "stuck.dump");
    fs.mkdirSync(dir, { recursive: true });
    seedRun("a2406000-0000-4000-8000-000000000f21", { status: "failed", errorCode: "TRUNCATED_INPUT", filePath: dir, fileRetainUntil: new Date(Date.now() - 1000) });
    expect((await service.sweepUpstreamSqlImports()).purged).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("P24-06 the notification's text", () => {
  it("counts and codes only: a run with no start reports 0 s; a table with nothing loaded is listed with its reason", () => {
    const text = service.summaryText({
      id: "a2406000-0000-4000-8000-000000000a01",
      status: "cancelled",
      attempt: 1,
      sha256: "e".repeat(64),
      startedAt: null,
      finishedAt: new Date(),
      errorCode: null,
      rowsLoaded: 0,
      rowsRejected: 0,
      rowsNotExtracted: 4,
      tables: { b: { staged: false, reason: "not_migrated", columns: 0, excludedColumns: 0, rowsLoaded: 0, rowsRejected: 0, rowsNotExtracted: 4, rejections: {}, notes: {} }, a: { staged: true, reason: null, columns: 1, excludedColumns: 0, rowsLoaded: 2, rowsRejected: 3, rowsNotExtracted: 0, rejections: { value_type_mismatch: 1, invalid_date: 2 }, notes: {} } },
    } as unknown as Parameters<typeof service.summaryText>[0]);
    expect(text.title).toBe("SQL dump import cancelled");
    expect(text.message).toContain(", 0 s. SHA-256");
    expect(text.message.split("\n").slice(2)).toEqual([
      "- a: 2 loaded, 3 rejected",
      "- b: 0 loaded, 4 not extracted (not_migrated)",
      "Rejected by reason: invalid_date 2, value_type_mismatch 1.",
    ]);
    expect(service.looksLikeSqlDump(Buffer.alloc(0))).toBe(false);
  });
});
