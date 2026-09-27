/**
 * W-15 (ADR-079) — an expired GDPR export is deleted by the retention sweep,
 * whatever process wrote it.
 *
 * The ZIP of a subject-access export used to be deleted only by a 168-hour
 * `setTimeout` in the process that built it: a restart inside the week left
 * the subject's personal data on disk for good. Every export now writes a
 * manifest (owner, expiry) FIRST, and gdpr.service#purgeExpiredExports, run
 * by the nightly sweep, deletes what has expired and writes an audit row.
 *
 * Real files in a temporary directory; the audit row on PostgreSQL 18 is in
 * gdprExport.w15.live.test.js.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "w15-exports-"));
jest.mock("../../utils/storagePath.util", () => (...parts) => require("path").join(mockRoot, ...parts));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const auditService = require("../../services/audit.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const gdpr = require("../../services/gdpr.service");

const DIR = path.join(mockRoot, "exports");
const HOUR = 3600000;
const T0 = Date.parse("2026-09-01T00:00:00.000Z");

/** Lay down an export as exportUserData leaves it: manifest, ZIP, and optionally the working dir. */
const writeExport = ({ id, tenantId = "t1", userId = "u1", expiresAt, manifest = true, zip = true, workDir = false }) => {
  fs.mkdirSync(DIR, { recursive: true });
  if (manifest) {
    fs.writeFileSync(
      path.join(DIR, `${id}.json`),
      typeof manifest === "string"
        ? manifest
        : JSON.stringify({ exportId: id, tenantId, userId, createdAt: new Date(T0).toISOString(), expiresAt }),
    );
  }
  if (zip) {fs.writeFileSync(path.join(DIR, `${id}.zip`), "PK personal data");}
  if (workDir) {
    fs.mkdirSync(path.join(DIR, id), { recursive: true });
    fs.writeFileSync(path.join(DIR, id, "user_profile.json"), "{}");
  }
};
const exists = (name) => fs.existsSync(path.join(DIR, name));

describe("W-15 — the retention sweep deletes expired GDPR exports", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.rmSync(DIR, { recursive: true, force: true });
  });
  afterAll(() => fs.rmSync(mockRoot, { recursive: true, force: true }));

  it("an export whose process died (no timer left anywhere) is deleted by the next sweep, and a row says so", async () => {
    const id = `export-${T0}-0a1b2c3d`;
    writeExport({ id, tenantId: "t1", userId: "u1", expiresAt: new Date(T0 + 168 * HOUR).toISOString(), workDir: true });
    let context;
    auditService.logAction.mockImplementationOnce(async () => {
      context = tenantStorage.getStore();
    });

    const result = await gdpr.purgeExpiredExports({ now: new Date(T0 + 169 * HOUR) });

    expect(result).toEqual({ deleted: 1, errors: 0 });
    expect(exists(`${id}.zip`)).toBe(false);
    expect(exists(id)).toBe(false);
    expect(exists(`${id}.json`)).toBe(false);
    expect(auditService.logAction).toHaveBeenCalledWith({
      tenantId: "t1",
      systemActor: "system:retention-purge",
      action: "DELETE",
      resourceType: "DataExport",
      resourceId: id,
      changes: {
        operation: "GDPR_EXPORT_EXPIRED",
        actor: "system:retention-purge",
        subjectUserId: "u1",
        createdAt: new Date(T0).toISOString(),
        expiresAt: new Date(T0 + 168 * HOUR).toISOString(),
      },
    });
    // Written in the export's own tenant context (W-12).
    expect(context).toMatchObject({ tenantId: "t1" });
  });

  it("an export that has not expired is left alone", async () => {
    const id = `export-${T0}-11111111`;
    writeExport({ id, expiresAt: new Date(T0 + 168 * HOUR).toISOString() });

    const result = await gdpr.purgeExpiredExports({ now: new Date(T0 + 167 * HOUR) });

    expect(result).toEqual({ deleted: 0, errors: 0 });
    expect(exists(`${id}.zip`)).toBe(true);
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("an audit row that fails keeps the manifest, so the next sweep retries the record; the data is already gone", async () => {
    const id = `export-${T0}-22222222`;
    writeExport({ id, expiresAt: new Date(T0).toISOString() });
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    const first = await gdpr.purgeExpiredExports({ now: new Date(T0 + HOUR) });
    expect(first).toEqual({ deleted: 0, errors: 1 });
    expect(exists(`${id}.zip`)).toBe(false);
    expect(exists(`${id}.json`)).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(`could not delete ${id}: audit insert failed`));

    const second = await gdpr.purgeExpiredExports({ now: new Date(T0 + HOUR) });
    expect(second).toEqual({ deleted: 1, errors: 0 });
    expect(exists(`${id}.json`)).toBe(false);
  });

  it("an export from before W-15 (no manifest) expires by the time in its id; it is deleted and logged, not audited", async () => {
    const id = `export-${T0}-33333333`;
    writeExport({ id, manifest: false, workDir: true });

    expect(await gdpr.purgeExpiredExports({ now: new Date(T0 + 167 * HOUR) })).toEqual({ deleted: 0, errors: 0 });
    expect(await gdpr.purgeExpiredExports({ now: new Date(T0 + 168 * HOUR) })).toEqual({ deleted: 1, errors: 0 });

    expect(exists(`${id}.zip`)).toBe(false);
    expect(exists(id)).toBe(false);
    expect(auditService.logAction).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("no manifest"));
  });

  it("a manifest whose expiry does not parse is treated as expired: personal data with no readable expiry is not kept", async () => {
    const id = `export-${Date.now()}-44444444`;
    writeExport({ id, expiresAt: "whenever" });
    expect(await gdpr.purgeExpiredExports()).toEqual({ deleted: 1, errors: 0 });
    expect(exists(`${id}.zip`)).toBe(false);
  });

  it("a manifest that is not JSON is an error, and its files are kept for a person to look at", async () => {
    const id = `export-${T0}-55555555`;
    writeExport({ id, manifest: "{not json" });
    const result = await gdpr.purgeExpiredExports({ now: new Date(T0 + 1000 * HOUR) });
    expect(result).toEqual({ deleted: 0, errors: 1 });
    expect(exists(`${id}.zip`)).toBe(true);
  });

  it("files that are not exports are never touched", async () => {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, "README.txt"), "operator note");
    fs.writeFileSync(path.join(DIR, "export-notanid.zip"), "x");
    expect(await gdpr.purgeExpiredExports({ now: new Date(T0 + 10000 * HOUR) })).toEqual({ deleted: 0, errors: 0 });
    expect(exists("README.txt")).toBe(true);
    expect(exists("export-notanid.zip")).toBe(true);
  });

  it("no exports directory yet is not an error", async () => {
    expect(await gdpr.purgeExpiredExports()).toEqual({ deleted: 0, errors: 0 });
  });

  it("an exports directory that cannot be read is an error, reported", async () => {
    fs.mkdirSync(path.dirname(DIR), { recursive: true });
    fs.writeFileSync(DIR, "a file where the directory should be");
    const result = await gdpr.purgeExpiredExports();
    expect(result).toEqual({ deleted: 0, errors: 1 });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("GDPR export sweep could not read"));
    fs.rmSync(DIR, { force: true });
  });
});
