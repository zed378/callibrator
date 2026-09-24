/**
 * S-03 / S-14 — scheduledBackup.service, the branches the end-to-end tick in
 * tests/middlewares/backup.test.js does not reach: failures are recorded and
 * surfaced, never swallowed; expiry falls back to createdAt + retentionDays;
 * each tenant runs in its own tenant context.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "s03-svc-"));
const mockBackupDir = path.join(mockRoot, "backup", "tenant-backups");

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb) => cb("TX")) },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../services/tenantBackup.service", () => ({
  BACKUP_DIR: mockBackupDir,
  createBackup: jest.fn(),
}));
jest.mock("../../models", () => ({
  Tenant: { findAll: jest.fn() },
  TenantBackup: {
    STATUS: { COMPLETED: "completed", DELETED: "deleted" },
    BACKUP_TYPES: { FULL: "full" },
    DEFAULT_RETENTION_DAYS: 30,
    update: jest.fn(),
    findAll: jest.fn(),
  },
}));

const svc = require("../../services/scheduledBackup.service");
const { Tenant, TenantBackup } = require("../../models");
const tenantBackupService = require("../../services/tenantBackup.service");
const auditService = require("../../services/audit.service");
const { db } = require("../../config");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-24T00:00:00Z");
const ago = (days) => new Date(NOW.getTime() - days * DAY);

const row = (over) => {
  const r = { status: "completed", retentionDays: 30, expiresAt: null, ...over };
  r.update = jest.fn(async (v) => Object.assign(r, v));
  r.destroy = jest.fn(async () => {});
  return r;
};
const inDir = (name) => path.join(mockBackupDir, name);

let stderr;
beforeEach(() => {
  jest.clearAllMocks();
  fs.rmSync(path.join(mockRoot, "backup"), { recursive: true, force: true });
  fs.mkdirSync(mockBackupDir, { recursive: true });
  delete process.env.BACKUP_KEEP_MIN;
  delete process.env.BACKUP_RETENTION_DAYS;
  stderr = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
  Tenant.findAll.mockResolvedValue([]);
  TenantBackup.findAll.mockResolvedValue([]);
});

afterAll(() => {
  fs.rmSync(mockRoot, { recursive: true, force: true });
});

describe("effectiveExpiry and isInsideBackupDir", () => {
  it("uses expiresAt when stamped, else createdAt + retentionDays, else the default retention", () => {
    expect(svc.effectiveExpiry({ expiresAt: ago(1), createdAt: ago(99) })).toEqual(ago(1));
    expect(svc.effectiveExpiry({ createdAt: ago(10), retentionDays: 7 })).toEqual(ago(3));
    expect(svc.effectiveExpiry({ createdAt: ago(10), retentionDays: null })).toEqual(
      new Date(ago(10).getTime() + 30 * DAY),
    );
    process.env.BACKUP_RETENTION_DAYS = "5";
    expect(svc.effectiveExpiry({ createdAt: ago(10), retentionDays: 0 })).toEqual(ago(5));
    process.env.BACKUP_RETENTION_DAYS = "not-a-number";
    expect(svc.effectiveExpiry({ createdAt: ago(10) })).toEqual(new Date(ago(10).getTime() + 30 * DAY));
  });

  it("is inside only strictly under the backup directory", () => {
    expect(svc.isInsideBackupDir(inDir("a.zip"))).toBe(true);
    expect(svc.isInsideBackupDir(mockBackupDir)).toBe(false);
    expect(svc.isInsideBackupDir(`${mockBackupDir}-evil${path.sep}a.zip`)).toBe(false);
    expect(svc.isInsideBackupDir(path.join(mockBackupDir, "..", "x.zip"))).toBe(false);
    expect(svc.isInsideBackupDir(null)).toBe(false);
    expect(svc.isInsideBackupDir("")).toBe(false);
  });
});

describe("backupTenant", () => {
  it("runs createBackup, then stamps expiresAt and writes the CREATE audit row in one transaction", async () => {
    tenantBackupService.createBackup.mockResolvedValue({
      data: { id: "b1", backupPath: inDir("tenant_t1.zip") },
    });
    process.env.BACKUP_RETENTION_DAYS = "14";

    const out = await svc.backupTenant("t1", NOW);

    expect(tenantBackupService.createBackup).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t1", createdById: null, retentionDays: 14, tag: "scheduled" }),
    );
    expect(out.expiresAt).toEqual(new Date(NOW.getTime() + 14 * DAY));
    expect(TenantBackup.update).toHaveBeenCalledWith(
      { expiresAt: out.expiresAt },
      { where: { id: "b1", tenantId: "t1" }, transaction: "TX" },
    );
    const [entry, opts] = auditService.logAction.mock.calls[0];
    expect(opts).toEqual({ transaction: "TX" });
    expect(entry).toMatchObject({
      tenantId: "t1",
      systemActor: "system:scheduled-backup",
      action: "CREATE",
      resourceType: "TenantBackup",
      resourceId: "b1",
      changes: { fileName: "tenant_t1.zip", fileSize: null, recordCount: null, retentionDays: 14 },
    });
  });

  it("records the file name as empty when the row carries no path", async () => {
    tenantBackupService.createBackup.mockResolvedValue({ data: { id: "b1", fileSize: "7", recordCount: 0 } });
    await svc.backupTenant("t1", NOW);
    expect(auditService.logAction.mock.calls[0][0].changes).toMatchObject({
      fileName: "",
      fileSize: "7",
      recordCount: 0,
    });
  });

  it.each([[null], [{}], [{ data: {} }]])("refuses a createBackup result without a row (%j)", async (result) => {
    tenantBackupService.createBackup.mockResolvedValue(result);
    await expect(svc.backupTenant("t1", NOW)).rejects.toThrow("createBackup returned no backup row");
    expect(auditService.logAction).not.toHaveBeenCalled();
  });
});

describe("runScheduledBackup", () => {
  it("backs up each tenant inside that tenant's context, and records ok", async () => {
    Tenant.findAll.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
    const seen = [];
    tenantBackupService.createBackup.mockImplementation(async ({ tenantId }) => {
      seen.push(tenantStorage.getStore());
      return { data: { id: `b-${tenantId}` } };
    });

    const out = await svc.runScheduledBackup({ now: NOW });

    expect(seen).toEqual([
      { tenantId: "t1", isSuperAdmin: false, isSystemTask: false },
      { tenantId: "t2", isSuperAdmin: false, isSystemTask: false },
    ]);
    expect(Tenant.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ skipTenantScope: true, attributes: ["id"] }),
    );
    expect(out.ok).toBe(true);
    expect(out.backedUp).toEqual([
      { tenantId: "t1", backupId: "b-t1" },
      { tenantId: "t2", backupId: "b-t2" },
    ]);
    expect(stderr).not.toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(svc.statusFilePath(), "utf8")).ok).toBe(true);
  });

  it("one tenant's failure does not stop the next, and fails the run visibly", async () => {
    Tenant.findAll.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
    tenantBackupService.createBackup
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce({ data: { id: "b2" } });

    const out = await svc.runScheduledBackup({ now: NOW });

    expect(out.ok).toBe(false);
    expect(out.failed).toEqual([{ tenantId: "t1", error: "disk full" }]);
    expect(out.backedUp).toEqual([{ tenantId: "t2", backupId: "b2" }]);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("[scheduled-backup] FAILED"));
    expect(JSON.parse(fs.readFileSync(svc.statusFilePath(), "utf8"))).toMatchObject({
      ok: false,
      failed: [{ tenantId: "t1", error: "disk full" }],
    });
  });

  it("a failure before any tenant (the tenant query) is recorded, not thrown", async () => {
    Tenant.findAll.mockRejectedValue(new Error("db down"));
    const out = await svc.runScheduledBackup({ now: NOW });
    expect(out).toMatchObject({ ok: false, error: "db down" });
    expect(stderr).toHaveBeenCalled();
  });

  it("a status file that cannot be written is reported in the outcome", async () => {
    jest.spyOn(fs.promises, "writeFile").mockRejectedValueOnce(new Error("EROFS"));
    const out = await svc.runScheduledBackup({ now: NOW });
    expect(out.statusFileError).toBe("EROFS");
  });

  it("defaults now to the current time", async () => {
    const out = await svc.runScheduledBackup();
    expect(Date.parse(out.startedAt)).not.toBeNaN();
  });
});

describe("pruneExpiredBackups", () => {
  it("keeps the newest keepMin of every tenant, prunes older expired ones, and leaves unexpired ones", async () => {
    for (const n of ["a1", "a2", "a3", "b1"]) {
      fs.writeFileSync(inDir(`${n}.zip`), n);
    }
    const a1 = row({ id: "a1", tenantId: "A", filePath: inDir("a1.zip"), createdAt: ago(1) });
    const a2 = row({ id: "a2", tenantId: "A", filePath: inDir("a2.zip"), createdAt: ago(40) });
    const a3 = row({ id: "a3", tenantId: "A", filePath: inDir("a3.zip"), createdAt: ago(50), expiresAt: ago(-5) });
    const b1 = row({ id: "b1", tenantId: "B", filePath: inDir("b1.zip"), createdAt: ago(400) });
    TenantBackup.findAll.mockResolvedValue([a1, a2, a3, b1]);

    const out = await svc.pruneExpiredBackups({ now: NOW, keepMin: 1 });

    expect(TenantBackup.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "completed" }, skipTenantScope: true }),
    );
    expect(out.pruned).toEqual([{ tenantId: "A", backupId: "a2" }]);
    expect(out.kept).toBe(2);
    expect(fs.existsSync(inDir("a1.zip"))).toBe(true);
    expect(fs.existsSync(inDir("a2.zip"))).toBe(false);
    expect(fs.existsSync(inDir("a3.zip"))).toBe(true); // expiresAt in the future
    expect(fs.existsSync(inDir("b1.zip"))).toBe(true); // B's only backup
    expect(a2.update).toHaveBeenCalledWith({ status: "deleted" }, { transaction: "TX" });
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "A",
        systemActor: "system:scheduled-backup",
        action: "DELETE",
        resourceId: "a2",
        changes: expect.objectContaining({ operation: "BACKUP_PRUNE", fileName: "a2.zip", keepMin: 1 }),
      }),
      { transaction: "TX" },
    );
  });

  it("reads keepMin from BACKUP_KEEP_MIN, defaulting to 3", async () => {
    const rows = [0, 1, 2, 3].map((i) =>
      row({ id: `r${i}`, tenantId: "A", filePath: null, createdAt: ago(100 + i) }),
    );
    TenantBackup.findAll.mockResolvedValue(rows);
    expect((await svc.pruneExpiredBackups({ now: NOW })).pruned.map((p) => p.backupId)).toEqual(["r3"]);

    TenantBackup.findAll.mockResolvedValue(rows.map((r) => ({ ...r })));
    process.env.BACKUP_KEEP_MIN = "2";
    expect((await svc.pruneExpiredBackups({ now: NOW })).pruned.map((p) => p.backupId)).toEqual([
      "r2",
      "r3",
    ]);
  });

  it("runs with no options (now = the current time, keepMin from the environment)", async () => {
    TenantBackup.findAll.mockResolvedValue([]);
    await expect(svc.pruneExpiredBackups()).resolves.toEqual({
      pruned: [],
      kept: 0,
      refused: [],
      errors: [],
    });
  });

  it("prunes a row with no file (backupPath fallback, and none at all)", async () => {
    fs.writeFileSync(inDir("legacy.zip"), "x");
    const legacy = row({ id: "l", tenantId: "A", backupPath: inDir("legacy.zip"), createdAt: ago(90) });
    const nofile = row({ id: "n", tenantId: "A", createdAt: ago(95) });
    TenantBackup.findAll.mockResolvedValue([legacy, nofile]);

    const out = await svc.pruneExpiredBackups({ now: NOW, keepMin: 0 });

    expect(out.pruned.map((p) => p.backupId)).toEqual(["l", "n"]);
    expect(fs.existsSync(inDir("legacy.zip"))).toBe(false);
    expect(auditService.logAction.mock.calls[1][0].changes.fileName).toBeNull();
  });

  it("a row whose transaction fails keeps its file, and is reported", async () => {
    fs.writeFileSync(inDir("keep.zip"), "x");
    const r = row({ id: "k", tenantId: "A", filePath: inDir("keep.zip"), createdAt: ago(90) });
    TenantBackup.findAll.mockResolvedValue([r]);
    db.transaction.mockRejectedValueOnce(new Error("audit insert failed"));

    const out = await svc.pruneExpiredBackups({ now: NOW, keepMin: 0 });

    expect(out.pruned).toEqual([]);
    expect(out.errors).toEqual([{ tenantId: "A", backupId: "k", stage: "row", error: "audit insert failed" }]);
    expect(fs.existsSync(inDir("keep.zip"))).toBe(true);
  });

  it("an already-missing file is fine; any other unlink error is reported", async () => {
    const gone = row({ id: "g", tenantId: "A", filePath: inDir("gone.zip"), createdAt: ago(90) });
    const stuck = row({ id: "s", tenantId: "A", filePath: inDir("stuck.zip"), createdAt: ago(91) });
    TenantBackup.findAll.mockResolvedValue([gone, stuck]);
    const eperm = Object.assign(new Error("EPERM"), { code: "EPERM" });
    jest
      .spyOn(fs.promises, "unlink")
      .mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
      .mockRejectedValueOnce(eperm);

    const out = await svc.pruneExpiredBackups({ now: NOW, keepMin: 0 });

    expect(out.pruned.map((p) => p.backupId)).toEqual(["g", "s"]);
    expect(out.errors).toEqual([{ tenantId: "A", backupId: "s", stage: "file", error: "EPERM" }]);
  });
});
