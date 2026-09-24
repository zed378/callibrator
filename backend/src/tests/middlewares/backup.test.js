/**
 * S-03 / S-14 — one BACKUP_SCHEDULER tick, end to end, on a real disk.
 *
 * The cron callback registered by cronBackup() is captured and run against a
 * temporary storage root (storagePath is pointed at it). The tenant-backup
 * service and the models are stand-ins: what is under test is WHAT THE JOB
 * DOES — does a tick produce a backup file for every tenant, where the writer
 * writes; does it attribute it; and does pruning leave the backup directory
 * alone.
 *
 * S-03 before: the tick zipped `data/` and `log/` from beside __dirname
 * (inside the pkg snapshot in production) and backed up no tenant at all.
 * S-14 before: the pruner `fse.remove`d every ENTRY of storagePath("backup")
 * older than 30 days by mtime — including the `tenant-backups` directory and
 * every backup in it.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "s03-backup-"));
const mockBackupDir = path.join(mockRoot, "backup", "tenant-backups");
const mockTable = [];
let mockSeq = 0;

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
  validate: jest.requireActual("node-cron").validate,
}));
jest.mock("../../utils/storagePath.util", () => (...parts) =>
  require("path").join(mockRoot, ...parts),
);
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb) => cb("TX")) },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

// The writer: a real file under BACKUP_DIR and a row in mockTable, as
// tenantBackup.service#createBackup produces.
jest.mock("../../services/tenantBackup.service", () => {
  const fsm = require("fs");
  const p = require("path");
  return {
    BACKUP_DIR: mockBackupDir,
    createBackup: jest.fn(async ({ tenantId, retentionDays }) => {
      mockSeq += 1;
      fsm.mkdirSync(mockBackupDir, { recursive: true });
      const filePath = p.join(mockBackupDir, `tenant_${tenantId}_b${mockSeq}.zip`);
      fsm.writeFileSync(filePath, `backup of ${tenantId}`);
      const row = {
        id: `b${mockSeq}`,
        tenantId,
        status: "completed",
        filePath,
        fileSize: 20,
        recordCount: 2,
        retentionDays,
        expiresAt: null,
        createdAt: new Date(),
      };
      mockTable.push(row);
      return { data: row };
    }),
  };
});

const mockRow = (over) => {
  const row = {
    status: "completed",
    retentionDays: 30,
    expiresAt: null,
    ...over,
  };
  row.update = jest.fn(async (v) => Object.assign(row, v));
  row.destroy = jest.fn(async () => {
    row.deletedAt = new Date();
  });
  return row;
};

jest.mock("../../models", () => ({
  Tenant: {
    findAll: jest.fn(async () => [{ id: "tenant-a" }, { id: "tenant-b" }]),
  },
  TenantBackup: {
    STATUS: { COMPLETED: "completed", DELETED: "deleted" },
    BACKUP_TYPES: { FULL: "full" },
    DEFAULT_RETENTION_DAYS: 30,
    update: jest.fn(),
    findAll: jest.fn(async () =>
      mockTable
        .filter((r) => r.status === "completed" && !r.deletedAt)
        .sort((a, b) =>
          a.tenantId === b.tenantId ? b.createdAt - a.createdAt : a.tenantId < b.tenantId ? -1 : 1,
        ),
    ),
  },
}));

const cron = require("node-cron");
const { cronBackup } = require("../../middlewares/backup.middleware");
const auditService = require("../../services/audit.service");
const tenantBackupService = require("../../services/tenantBackup.service");

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);

const tick = async () => {
  const callback = cron.schedule.mock.calls.at(-1)[1];
  await callback();
};

afterAll(() => {
  fs.rmSync(mockRoot, { recursive: true, force: true });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockTable.length = 0;
  fs.rmSync(path.join(mockRoot, "backup"), { recursive: true, force: true });
  process.env.BACKUP_SCHEDULER = "0 3 * * 0";
  delete process.env.BACKUP_KEEP_MIN;
});

describe("S-03 — a tick backs up every tenant, into the backup volume", () => {
  it("writes one tenant backup per tenant under storagePath('backup','tenant-backups'), attributed to the system actor", async () => {
    cronBackup();
    expect(cron.schedule).toHaveBeenCalledWith("0 3 * * 0", expect.any(Function));

    await tick();

    const files = fs.readdirSync(mockBackupDir).sort();
    expect(files).toEqual(["tenant_tenant-a_b1.zip", "tenant_tenant-b_b2.zip"]);
    expect(tenantBackupService.createBackup).toHaveBeenCalledTimes(2);

    const creates = auditService.logAction.mock.calls.filter(([e]) => e.action === "CREATE");
    expect(creates).toHaveLength(2);
    for (const [entry, opts] of creates) {
      expect(entry).toMatchObject({
        systemActor: "system:scheduled-backup",
        resourceType: "TenantBackup",
      });
      expect(entry.userId).toBeUndefined();
      expect(opts).toEqual({ transaction: "TX" });
    }

    const status = JSON.parse(
      fs.readFileSync(path.join(mockRoot, "backup", "last-scheduled-backup.json"), "utf8"),
    );
    expect(status).toMatchObject({ ok: true, tenants: 2 });
  });
});

describe("S-14 — pruning never deletes the backup directory, and keeps the newest", () => {
  it("an old tenant-backups DIRECTORY holding backups survives the tick", async () => {
    fs.mkdirSync(mockBackupDir, { recursive: true });
    const kept = path.join(mockBackupDir, "tenant_tenant-a_old.zip");
    fs.writeFileSync(kept, "x");
    mockTable.push(
      mockRow({ id: "old-a", tenantId: "tenant-a", filePath: kept, createdAt: ago(40), expiresAt: ago(10) }),
    );
    const old = ago(60);
    fs.utimesSync(kept, old, old);
    fs.utimesSync(mockBackupDir, old, old);
    fs.utimesSync(path.dirname(mockBackupDir), old, old);

    cronBackup();
    await tick();

    expect(fs.existsSync(mockBackupDir)).toBe(true);
    // expired, but among tenant-a's newest three: kept
    expect(fs.existsSync(kept)).toBe(true);
  });

  it("prunes expired backups beyond the newest N of a tenant, file and row together", async () => {
    process.env.BACKUP_KEEP_MIN = "1";
    fs.mkdirSync(mockBackupDir, { recursive: true });
    const expired = path.join(mockBackupDir, "tenant_tenant-a_expired.zip");
    const fresh = path.join(mockBackupDir, "tenant_tenant-a_fresh.zip");
    fs.writeFileSync(expired, "x");
    fs.writeFileSync(fresh, "x");
    const expiredRow = mockRow({
      id: "exp-a", tenantId: "tenant-a", filePath: expired, createdAt: ago(45), expiresAt: ago(15),
    });
    mockTable.push(
      expiredRow,
      mockRow({ id: "fresh-a", tenantId: "tenant-a", filePath: fresh, createdAt: ago(2), expiresAt: null }),
    );

    cronBackup();
    await tick();

    expect(fs.existsSync(expired)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(expiredRow.status).toBe("deleted");
    expect(expiredRow.destroy).toHaveBeenCalledWith({ transaction: "TX" });
    const deletes = auditService.logAction.mock.calls.filter(([e]) => e.action === "DELETE");
    expect(deletes.map(([e]) => e.resourceId)).toEqual(["exp-a"]);
    expect(deletes[0][0].systemActor).toBe("system:scheduled-backup");
  });

  it("never deletes a file outside the backup directory, whatever the row says", async () => {
    process.env.BACKUP_KEEP_MIN = "1";
    const outside = path.join(mockRoot, "uploads", "precious.pdf");
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, "evidence");
    mockTable.push(
      mockRow({ id: "evil", tenantId: "tenant-a", filePath: outside, createdAt: ago(90), expiresAt: ago(60) }),
      mockRow({
        id: "trav", tenantId: "tenant-a",
        filePath: path.join(mockBackupDir, "..", "..", "uploads", "precious.pdf"),
        createdAt: ago(80), expiresAt: ago(50),
      }),
    );

    cronBackup();
    await tick();

    expect(fs.readFileSync(outside, "utf8")).toBe("evidence");
    const status = JSON.parse(
      fs.readFileSync(path.join(mockRoot, "backup", "last-scheduled-backup.json"), "utf8"),
    );
    expect(status.ok).toBe(false);
    expect(status.prune.refused.map((r) => r.backupId).sort()).toEqual(["evil", "trav"]);
  });
});

describe("cronBackup — the schedule", () => {
  it("does not schedule when disabled", () => {
    process.env.BACKUP_SCHEDULER = "disabled";
    expect(cronBackup()).toBe(false);
    process.env.BACKUP_SCHEDULER = "off";
    expect(cronBackup()).toBe(false);
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  it("refuses an invalid expression loudly, on stderr too", () => {
    process.env.BACKUP_SCHEDULER = "every tuesday";
    const stderr = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(cronBackup()).toBe(false);
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("NOT started"));
  });

  it("defaults to daily at midnight", () => {
    delete process.env.BACKUP_SCHEDULER;
    expect(cronBackup()).toBe(true);
    expect(cron.schedule).toHaveBeenCalledWith("0 0 * * *", expect.any(Function));
  });

  it("a crash inside the run is surfaced, not thrown into node-cron", async () => {
    jest.isolateModules(() => {
      jest.doMock("../../services/scheduledBackup.service", () => ({
        runScheduledBackup: jest.fn().mockRejectedValue(new Error("boom")),
      }));
      require("../../middlewares/backup.middleware").cronBackup();
    });
    const stderr = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(tick()).resolves.toBeUndefined();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("crashed: boom"));
    jest.dontMock("../../services/scheduledBackup.service");
  });
});
