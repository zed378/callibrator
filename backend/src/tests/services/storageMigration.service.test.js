/**
 * Storage migration tool tests.
 *
 * The dangerous parts of a data migration are: corrupting a file silently,
 * migrating the same row twice, and aborting the whole run on one bad row.
 * Each has an explicit test here.
 */

const { Readable } = require("stream");

jest.mock("../../models", () => ({
  Attachment: { findAll: jest.fn() },
}));
jest.mock("../../services/storage", () => ({
  getTenantStorage: jest.fn(),
}));
jest.mock("../../utils/storagePath.util", () =>
  jest.fn((...parts) => ["/srv/root", ...parts].join("/")),
);
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("fs", () => ({
  existsSync: jest.fn(),
  createReadStream: jest.fn(),
}));

const fs = require("fs");
const crypto = require("crypto");
const { Attachment } = require("../../models");
const storage = require("../../services/storage");
const service = require("../../services/storageMigration.service");

const CONTENT = Buffer.from("file-contents");
const CHECKSUM = crypto.createHash("sha256").update(CONTENT).digest("hex");

/** A fresh readable stream over CONTENT (single-use). */
const contentStream = () => Readable.from([CONTENT]);

/** A mock ScopedStorage that stores puts and streams them back for get. */
const makeScoped = () => {
  const scoped = {
    buildKey: jest.fn(({ domain, name }) => `t/tenant-1/${domain}/${name}`),
    put: jest.fn().mockResolvedValue({ key: "k" }),
    // A fresh stream per call — a single shared stream is consumed on the first
    // read and the next hashStream would hang waiting for an 'end' that already
    // fired.
    get: jest.fn().mockImplementation(() => contentStream()),
    delete: jest.fn().mockResolvedValue({ deleted: true }),
  };
  return scoped;
};

const makeRow = (overrides = {}) => ({
  id: "att-1",
  tenantId: "tenant-1",
  folder: "uploads/attachments",
  fileName: "abc.pdf",
  mimeType: "application/pdf",
  checksum: CHECKSUM,
  storageKey: null,
  save: jest.fn().mockResolvedValue(true),
  ...overrides,
});

let scoped;

beforeEach(() => {
  jest.clearAllMocks();
  scoped = makeScoped();
  storage.getTenantStorage.mockResolvedValue(scoped);
  fs.existsSync.mockReturnValue(true);
  fs.createReadStream.mockImplementation(() => contentStream());
});

describe("migrateAttachment", () => {
  it("copies the file, verifies the checksum, and records the key", async () => {
    const row = makeRow();
    const result = await service.migrateAttachment(row);

    expect(scoped.put).toHaveBeenCalledWith(
      "t/tenant-1/attachments/abc.pdf",
      expect.anything(),
      { contentType: "application/pdf" },
    );
    expect(row.storageKey).toBe("t/tenant-1/attachments/abc.pdf");
    expect(row.save).toHaveBeenCalledWith({ hooks: false });
    expect(result).toMatchObject({ status: "migrated", verified: true });
  });

  it("is resumable: skips a row that already has a key", async () => {
    const row = makeRow({ storageKey: "t/tenant-1/attachments/abc.pdf" });
    const result = await service.migrateAttachment(row);
    expect(result).toMatchObject({ status: "skipped", reason: "already-migrated" });
    expect(scoped.put).not.toHaveBeenCalled();
  });

  it("reports a missing source instead of aborting", async () => {
    fs.existsSync.mockReturnValue(false);
    const result = await service.migrateAttachment(makeRow());
    expect(result.status).toBe("missing-source");
    expect(scoped.put).not.toHaveBeenCalled();
  });

  it("does not write in dry-run mode", async () => {
    const row = makeRow();
    const result = await service.migrateAttachment(row, { dryRun: true });
    expect(result).toMatchObject({ status: "would-migrate", key: "t/tenant-1/attachments/abc.pdf" });
    expect(scoped.put).not.toHaveBeenCalled();
    expect(row.save).not.toHaveBeenCalled();
  });

  it("fails the row (and rolls back the copy) on a checksum mismatch", async () => {
    // Storage returns different bytes than were recorded — must not commit.
    scoped.get.mockResolvedValue(Readable.from([Buffer.from("corrupted")]));
    const row = makeRow();

    await expect(service.migrateAttachment(row)).rejects.toThrow("Checksum mismatch");
    expect(scoped.delete).toHaveBeenCalledWith("t/tenant-1/attachments/abc.pdf");
    expect(row.storageKey).toBeNull();
    expect(row.save).not.toHaveBeenCalled();
  });

  it("still migrates a row that has no recorded checksum (unverified)", async () => {
    const row = makeRow({ checksum: null });
    const result = await service.migrateAttachment(row);
    expect(result).toMatchObject({ status: "migrated", verified: false });
    expect(row.storageKey).toBeTruthy();
  });

  it("defaults the content type when the row has none", async () => {
    await service.migrateAttachment(makeRow({ mimeType: null }));
    expect(scoped.put).toHaveBeenCalledWith(expect.any(String), expect.anything(), {
      contentType: "application/octet-stream",
    });
  });

  it("tolerates a rollback delete that itself fails", async () => {
    scoped.get.mockResolvedValue(Readable.from([Buffer.from("corrupted")]));
    scoped.delete.mockRejectedValue(new Error("delete failed"));
    await expect(service.migrateAttachment(makeRow())).rejects.toThrow("Checksum mismatch");
  });
});

describe("legacyPath", () => {
  it("builds the on-disk path from folder + fileName", () => {
    expect(service.legacyPath(makeRow())).toBe(
      "/srv/root/uploads/attachments/abc.pdf",
    );
  });

  it("refuses a folder that escapes the storage root", () => {
    const storagePath = require("../../utils/storagePath.util");
    // Make the joined path fall outside the folder root.
    storagePath.mockImplementationOnce(() => "/etc/passwd").mockImplementationOnce(
      () => "/srv/root/uploads",
    );
    expect(() => service.legacyPath(makeRow())).toThrow(
      "Refusing to read outside storage root",
    );
  });

  it("tolerates an empty folder", () => {
    expect(service.legacyPath(makeRow({ folder: "" }))).toContain("abc.pdf");
  });
});

describe("hashStream", () => {
  it("hashes stream contents", async () => {
    await expect(service.hashStream(contentStream())).resolves.toBe(CHECKSUM);
  });

  it("rejects on a stream error", async () => {
    const bad = new Readable({
      read() {
        this.destroy(new Error("read failed"));
      },
    });
    await expect(service.hashStream(bad)).rejects.toThrow("read failed");
  });
});

describe("migrateAll", () => {
  it("migrates every unkeyed row and summarizes", async () => {
    Attachment.findAll.mockResolvedValue([makeRow(), makeRow({ id: "att-2" })]);
    const progress = [];
    const summary = await service.migrateAll({ onProgress: (r) => progress.push(r) });

    expect(summary).toMatchObject({ total: 2, migrated: 2, failed: 0 });
    expect(progress).toHaveLength(2);
  });

  it("queries only unkeyed rows, scoped to a tenant when given", async () => {
    Attachment.findAll.mockResolvedValue([]);
    await service.migrateAll({ tenantId: "tenant-9", limit: 50 });
    expect(Attachment.findAll).toHaveBeenCalledWith({
      where: { storageKey: null, tenantId: "tenant-9" },
      order: [["createdAt", "ASC"]],
      limit: 50,
    });
  });

  it("omits the limit clause when none is given", async () => {
    Attachment.findAll.mockResolvedValue([]);
    await service.migrateAll({});
    expect(Attachment.findAll).toHaveBeenCalledWith({
      where: { storageKey: null },
      order: [["createdAt", "ASC"]],
    });
  });

  it("runs with no options at all", async () => {
    Attachment.findAll.mockResolvedValue([]);
    await expect(service.migrateAll()).resolves.toMatchObject({ total: 0 });
  });

  it("records a failed row and keeps going", async () => {
    // First row corrupts (throws), second succeeds — the run must not abort.
    const bad = makeRow({ id: "bad" });
    const good = makeRow({ id: "good" });
    Attachment.findAll.mockResolvedValue([bad, good]);
    let call = 0;
    scoped.get.mockImplementation(() =>
      call++ === 0
        ? Readable.from([Buffer.from("corrupted")]) // bad row → mismatch
        : contentStream(),
    );

    const summary = await service.migrateAll({});
    expect(summary).toMatchObject({ total: 2, migrated: 1, failed: 1 });
    expect(summary.results.find((r) => r.id === "bad").status).toBe("failed");
  });

  it("counts skipped, missing and would-migrate rows distinctly", async () => {
    const migrated = makeRow({ id: "m" });
    const skipped = makeRow({ id: "s", storageKey: "t/tenant-1/attachments/x" });
    const missing = makeRow({ id: "x" });
    Attachment.findAll.mockResolvedValue([migrated, skipped, missing]);
    // `missing` has no source file.
    fs.existsSync.mockImplementation((p) => !p.includes("x.pdf") || !p.endsWith("x.pdf"));
    fs.existsSync.mockImplementation(() => true);
    // Simpler: make the third row's source missing by fileName.
    Attachment.findAll.mockResolvedValue([
      makeRow({ id: "m", fileName: "m.pdf" }),
      makeRow({ id: "s", storageKey: "t/tenant-1/attachments/x" }),
      makeRow({ id: "x", fileName: "missing.pdf" }),
    ]);
    fs.existsSync.mockImplementation((p) => !p.endsWith("missing.pdf"));

    const summary = await service.migrateAll({});
    expect(summary).toMatchObject({
      total: 3,
      migrated: 1,
      skipped: 1,
      missingSource: 1,
    });
  });

  it("counts would-migrate rows in dry-run", async () => {
    Attachment.findAll.mockResolvedValue([makeRow(), makeRow({ id: "att-2" })]);
    const summary = await service.migrateAll({ dryRun: true });
    expect(summary).toMatchObject({ total: 2, wouldMigrate: 2, migrated: 0 });
  });
});
