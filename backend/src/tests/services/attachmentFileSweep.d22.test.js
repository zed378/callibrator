/**
 * D-22 (ADR-083) — the files of soft-deleted attachments were never removed.
 *
 * A parent's cascade (ADR-070) soft-deletes its attachments and keeps their
 * files so a restore can bring them back; nothing removed them afterwards.
 * The sweep removes the bytes of a row deleted longer than the retention
 * window (90 days default, never below 30) — never a live row, never a row
 * inside the window, never a path outside the uploads tree — marks the row
 * (`file_purged_at`) and writes one system-actor DELETE audit row per
 * attachment in the batch's transaction. A file that cannot be removed is not
 * marked, so the next run retries it. Bounded per batch and per run, walked
 * per tenant by keyset in the tenant's context.
 *
 * The statements are proven against PostgreSQL 18 in dataLayer.dbD.live.test.js.
 */

const fs = require("fs");
const { Op } = require("sequelize");

const mockStore = { tenants: [], rows: [] };

const mockMatches = (row, where) => {
  const { Op: SOp } = require("sequelize");
  if (row.tenantId !== where.tenantId || row.filePurgedAt !== null) {
    return false;
  }
  if (where.id && !(row.id > where.id[SOp.gt])) {
    return false;
  }
  return where[SOp.or].some((clause) =>
    clause.isDeleted
      ? row.isDeleted === true && row.updatedAt < clause.updatedAt[SOp.lt]
      : row.deletedAt !== null && row.deletedAt < clause.deletedAt[SOp.lt],
  );
};

const mockUnscoped = {
  findAll: jest.fn(async ({ where, limit }) =>
    mockStore.rows
      .filter((row) => mockMatches(row, where))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, limit)
      .map((row) => ({ ...row })),
  ),
  update: jest.fn(async (values, { where }) => {
    const row = mockStore.rows.find((r) => r.id === where.id && r.tenantId === where.tenantId);
    Object.assign(row, values);
    return [1];
  }),
};

jest.mock("../../models", () => ({
  Tenant: {
    findAll: jest.fn(async ({ where, limit }) => {
      const { Op: SOp } = require("sequelize");
      const after = where.id ? where.id[SOp.gt] : "";
      return mockStore.tenants
        .filter((id) => id > after)
        .sort()
        .slice(0, limit)
        .map((id) => ({ id }));
    }),
  },
  Attachment: { unscoped: () => mockUnscoped },
}));
jest.mock("../../config", () => ({ db: { transaction: jest.fn(async (cb) => cb("TX")) } }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../utils/jobContext.util", () => ({ runForTenant: jest.fn(async (tenantId, fn) => fn()) }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
const mockScopedStorage = { delete: jest.fn().mockResolvedValue({ deleted: true }) };
jest.mock("../../services/storage", () => ({ getTenantStorage: jest.fn(async () => mockScopedStorage) }));
jest.mock("../../services/attachment.service", () => ({
  resolveAbsPath: jest.fn((row) => {
    if (row.folder.includes("..")) {
      throw new Error("Invalid attachment path");
    }
    return `/uploads/${row.folder}/${row.fileName}`;
  }),
}));

const { Tenant } = require("../../models");
const auditService = require("../../services/audit.service");
const storage = require("../../services/storage");
const { runForTenant } = require("../../utils/jobContext.util");
const { logger } = require("../../middlewares/activityLog.middleware");
const { SYSTEM_ACTORS } = require("../../constants/systemActors");
const sweep = require("../../services/attachmentFileSweep.service");

const NOW = new Date("2026-09-27T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY);

let seq = 0;
const row = (tenantId, over = {}) => ({
  id: `a-${String(++seq).padStart(4, "0")}`,
  tenantId,
  resourceType: "certificate",
  resourceId: "c-1",
  folder: "attachments",
  fileName: `f-${seq}.pdf`,
  storageKey: null,
  originalName: "evidence.pdf",
  checksum: "abc",
  isDeleted: true,
  deletedAt: null,
  updatedAt: daysAgo(120),
  filePurgedAt: null,
  ...over,
});

const ENV = ["ATTACHMENT_FILE_RETENTION_DAYS", "ATTACHMENT_FILE_SWEEP_BATCH", "ATTACHMENT_FILE_SWEEP_MAX_ROWS"];
let unlink;

beforeEach(() => {
  jest.clearAllMocks();
  for (const name of ENV) {
    delete process.env[name];
  }
  mockStore.tenants = ["tenant-a", "tenant-b"];
  mockStore.rows = [];
  unlink = jest.spyOn(fs.promises, "unlink").mockResolvedValue(undefined);
});

describe("D-22 (ADR-083) — retention window", () => {
  it("defaults to 90 days, honours the variable, and never goes below 30", () => {
    expect(sweep.retentionDays()).toBe(90);
    process.env.ATTACHMENT_FILE_RETENTION_DAYS = "365";
    expect(sweep.retentionDays()).toBe(365);
    process.env.ATTACHMENT_FILE_RETENTION_DAYS = "7";
    expect(sweep.retentionDays()).toBe(30);
    process.env.ATTACHMENT_FILE_RETENTION_DAYS = "nonsense";
    expect(sweep.retentionDays()).toBe(90);
  });
});

describe("D-22 (ADR-083) — sweepDeletedAttachmentFiles", () => {
  it("removes the files of rows deleted past the window, and never a live row or one inside it", async () => {
    const live = row("tenant-a", { isDeleted: false, updatedAt: daysAgo(400) });
    const recent = row("tenant-a", { updatedAt: daysAgo(89) });
    const recentParanoid = row("tenant-a", { isDeleted: false, deletedAt: daysAgo(10), updatedAt: daysAgo(10) });
    const old = row("tenant-a");
    const oldParanoid = row("tenant-b", { isDeleted: false, deletedAt: daysAgo(100), updatedAt: daysAgo(100) });
    mockStore.rows = [live, recent, recentParanoid, old, oldParanoid];

    const summary = await sweep.sweepDeletedAttachmentFiles({ now: NOW });

    expect(summary).toEqual({
      tenants: 2,
      examined: 2,
      removed: 2,
      absent: 0,
      outsideUploads: 0,
      failed: 0,
      retentionDays: 90,
      cutoff: daysAgo(90).toISOString(),
      stoppedEarly: false,
    });
    expect(unlink.mock.calls.map(([p]) => p)).toEqual([
      `/uploads/attachments/${old.fileName}`,
      `/uploads/attachments/${oldParanoid.fileName}`,
    ]);
    const purged = mockStore.rows.filter((r) => r.filePurgedAt).map((r) => r.id);
    expect(purged).toEqual([old.id, oldParanoid.id]);
    expect(mockStore.rows.find((r) => r.id === old.id).filePurgedAt).toEqual(NOW);

    // The read is the deleted-and-expired predicate, locked, paranoid off.
    const [{ where, lock, skipLocked, paranoid, transaction }] = mockUnscoped.findAll.mock.calls[0];
    expect(where[Op.or]).toEqual([
      { isDeleted: true, updatedAt: { [Op.lt]: daysAgo(90) } },
      { deletedAt: { [Op.lt]: daysAgo(90) } },
    ]);
    expect(where.filePurgedAt).toBeNull();
    expect({ lock, skipLocked, paranoid, transaction }).toEqual({
      lock: true,
      skipLocked: true,
      paranoid: false,
      transaction: "TX",
    });
  });

  it("works per tenant in the tenant's context, one system-actor DELETE audit row per attachment, in the batch's transaction", async () => {
    const a = row("tenant-a", { resourceType: "KanbanCard", resourceId: "card-1" });
    mockStore.rows = [a];

    await sweep.sweepDeletedAttachmentFiles({ now: NOW });

    expect(runForTenant.mock.calls.map(([tenantId]) => tenantId)).toEqual(["tenant-a", "tenant-b"]);
    expect(auditService.logAction).toHaveBeenCalledTimes(1);
    expect(auditService.logAction).toHaveBeenCalledWith(
      {
        tenantId: "tenant-a",
        systemActor: SYSTEM_ACTORS.ATTACHMENT_FILE_SWEEP,
        action: "DELETE",
        resourceType: "Attachment",
        resourceId: a.id,
        changes: {
          operation: "file-purge",
          file: "removed",
          storageObject: false,
          deletedSince: daysAgo(120).toISOString(),
          olderThan: daysAgo(90).toISOString(),
          retentionDays: 90,
          originalName: "evidence.pdf",
          checksum: "abc",
          resource: { type: "KanbanCard", id: "card-1" },
        },
      },
      { transaction: "TX" },
    );
    expect(mockUnscoped.update).toHaveBeenCalledWith(
      { filePurgedAt: NOW },
      { where: { id: a.id, tenantId: "tenant-a" }, paranoid: false, transaction: "TX" },
    );
  });

  it("a file already gone is marked and audited as absent; a migrated row's storage object is removed too", async () => {
    const gone = row("tenant-a");
    const migrated = row("tenant-a", { storageKey: "t/tenant-a/attachments/x.pdf", deletedAt: daysAgo(200) });
    mockStore.rows = [gone, migrated];
    unlink.mockImplementation(async (p) => {
      if (p.endsWith(gone.fileName)) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
    });

    const summary = await sweep.sweepDeletedAttachmentFiles({ now: NOW });

    expect(summary).toEqual(expect.objectContaining({ examined: 2, removed: 1, absent: 1, failed: 0 }));
    expect(storage.getTenantStorage).toHaveBeenCalledWith("tenant-a");
    expect(mockScopedStorage.delete).toHaveBeenCalledWith("t/tenant-a/attachments/x.pdf");
    const changes = auditService.logAction.mock.calls.map(([entry]) => entry.changes);
    expect(changes.map((c) => [c.file, c.storageObject, c.deletedSince])).toEqual([
      ["absent", false, daysAgo(120).toISOString()],
      ["removed", true, daysAgo(200).toISOString()],
    ]);
  });

  it("never removes anything outside the uploads tree: the row is recorded and not looked at again", async () => {
    const escaping = row("tenant-a", { folder: "../../etc" });
    mockStore.rows = [escaping];

    const summary = await sweep.sweepDeletedAttachmentFiles({ now: NOW });

    expect(unlink).not.toHaveBeenCalled();
    expect(summary).toEqual(expect.objectContaining({ examined: 1, removed: 0, outsideUploads: 1 }));
    expect(auditService.logAction.mock.calls[0][0].changes.file).toBe("outside-uploads");
    expect(escaping.filePurgedAt).toEqual(NOW);
  });

  it("a file that cannot be removed is not marked or audited, is logged, and does not stop the rows after it", async () => {
    const stuck = row("tenant-a");
    const next = row("tenant-a");
    const objectStuck = row("tenant-a", { storageKey: "t/tenant-a/attachments/y.pdf" });
    mockStore.rows = [stuck, next, objectStuck];
    unlink.mockImplementation(async (p) => {
      if (p.endsWith(stuck.fileName)) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
    });
    mockScopedStorage.delete.mockRejectedValueOnce(new Error("bucket unreachable"));

    const summary = await sweep.sweepDeletedAttachmentFiles({ now: NOW });

    expect(summary).toEqual(expect.objectContaining({ examined: 3, removed: 1, failed: 2 }));
    expect(stuck.filePurgedAt).toBeNull();
    expect(objectStuck.filePurgedAt).toBeNull();
    expect(next.filePurgedAt).toEqual(NOW);
    expect(auditService.logAction.mock.calls.map(([entry]) => entry.resourceId)).toEqual([next.id]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("could not be removed"),
      expect.objectContaining({ attachmentId: stuck.id, error: "EACCES" }),
    );
  });

  it("is bounded: batches walk each tenant by keyset, and the run stops at its bound and says so", async () => {
    process.env.ATTACHMENT_FILE_SWEEP_BATCH = "2";
    process.env.ATTACHMENT_FILE_SWEEP_MAX_ROWS = "5";
    mockStore.rows = [
      row("tenant-a"),
      row("tenant-a"),
      row("tenant-a"),
      row("tenant-b"),
      row("tenant-b"),
      row("tenant-b"),
    ];

    const summary = await sweep.sweepDeletedAttachmentFiles({ now: NOW });

    expect(summary).toEqual(expect.objectContaining({ examined: 5, removed: 5, stoppedEarly: true }));
    const limits = mockUnscoped.findAll.mock.calls.map(([{ limit }]) => limit);
    // tenant-a: 2 + 1 (the short page ends it); tenant-b: 2, the run's last 2.
    expect(limits).toEqual([2, 2, 2]);
    // The second batch of tenant-a starts after the last id of the first.
    const second = mockUnscoped.findAll.mock.calls[1][0].where;
    expect(second.id[Op.gt]).toBe(mockStore.rows[1].id);
    expect(mockStore.rows.filter((r) => r.filePurgedAt === null)).toHaveLength(1);
  });

  it("stops before the next tenant once the run's bound is spent", async () => {
    process.env.ATTACHMENT_FILE_SWEEP_MAX_ROWS = "1";
    mockStore.rows = [row("tenant-a"), row("tenant-b")];

    const summary = await sweep.sweepDeletedAttachmentFiles({ now: NOW });

    expect(summary).toEqual(expect.objectContaining({ tenants: 1, examined: 1, stoppedEarly: true }));
    expect(runForTenant).toHaveBeenCalledTimes(1);
  });

  it("reads the tenants a page at a time, soft-deleted tenants included", async () => {
    mockStore.tenants = Array.from({ length: 501 }, (_, i) => `t-${String(i).padStart(4, "0")}`);

    const summary = await sweep.sweepDeletedAttachmentFiles({ now: NOW });

    expect(summary.tenants).toBe(501);
    expect(Tenant.findAll).toHaveBeenCalledTimes(2);
    expect(Tenant.findAll.mock.calls[0][0]).toEqual({
      where: {},
      attributes: ["id"],
      order: [["id", "ASC"]],
      limit: 500,
      paranoid: false,
    });
    expect(Tenant.findAll.mock.calls[1][0].where).toEqual({ id: { [Op.gt]: "t-0499" } });
  });

  it("an empty platform is a quiet no-op", async () => {
    mockStore.tenants = [];
    const summary = await sweep.sweepDeletedAttachmentFiles();
    expect(summary).toEqual(expect.objectContaining({ tenants: 0, examined: 0, stoppedEarly: false }));
  });
});
