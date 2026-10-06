/**
 * P8-01 (ADR-086 Amendment 1) — `npm run migrate:storage` for every class of
 * file the application kept on disk before the cut-over: attachments (A-40,
 * storageMigration.service.test.js), and now certificate PDFs, tenant backups
 * and the public image class.
 *
 * Real files in a temporary root, copied by the REAL local driver through a
 * real ScopedStorage (the tenant guard is the real one). The rows are doubles.
 * Each class is pinned for the tool's three properties — resumable, verified,
 * non-destructive — and for the audit row of a row it rewrites.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type * as StorageModule from "../../services/storage";
import type LocalDriverClass from "../../services/storage/local.driver";
import type * as MigrationModule from "../../services/storageMigration.service";

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p801-migrate-"));
const mockRows: { certificates: Record<string, unknown>[]; backups: Record<string, unknown>[]; attachments: Record<string, unknown>[] } = {
  certificates: [],
  backups: [],
  attachments: [],
};
const mockTx = { id: "TX" };

jest.mock("../../utils/storagePath.util", () =>
  (...parts: string[]): string => jest.requireActual<typeof path>("path").join(mockRoot, ...parts),
);
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../config", () => ({ db: { transaction: jest.fn((cb: (t: object) => unknown) => Promise.resolve(cb(mockTx))) } }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({ id: "audit-1" }) }));
jest.mock("../../models", () => {
  const pager = (key: "certificates" | "backups") => jest.fn(({ where, limit }: { where: Record<string | symbol, unknown>; limit: number }) => {
    const idCond = where["id"] as Record<symbol, string> | undefined;
    const after = idCond ? idCond[Object.getOwnPropertySymbols(idCond)[0] as symbol] : null;
    return Promise.resolve(mockRows[key]
      .filter((r) => (where["tenantId"] ? r["tenantId"] === where["tenantId"] : true))
      .filter((r) => after === null || after === undefined || String(r["id"]) > after)
      .sort((a, b) => String(a["id"]).localeCompare(String(b["id"])))
      .slice(0, limit));
  });
  return {
    Attachment: { findAll: jest.fn(() => Promise.resolve(mockRows.attachments)) },
    Certificate: { findAll: pager("certificates") },
    TenantBackup: { findAll: pager("backups") },
  };
});
jest.mock("../../services/storage", () => {
  const actual = jest.requireActual<typeof StorageModule>("../../services/storage");
  const LocalDriver = jest.requireActual<typeof LocalDriverClass>("../../services/storage/local.driver");
  const p = jest.requireActual<typeof path>("path");
  const driver = (): InstanceType<typeof LocalDriver> => new LocalDriver({ root: p.join(mockRoot, "store"), name: "local" });
  return {
    ...actual,
    getTenantStorage: jest.fn((tenantId: string) => Promise.resolve(new actual.ScopedStorage(driver() as never, tenantId))),
    getGlobalStorage: jest.fn(() => Promise.resolve(new actual.ScopedStorage(driver() as never, null))),
  };
});

const migration = jest.requireActual<typeof MigrationModule>("../../services/storageMigration.service");
const logAction = jest.requireMock<{ logAction: jest.Mock }>("../../services/audit.service").logAction;

const TENANT = "11111111-1111-4111-8111-111111111111";
const sha = (b: Buffer | string): string => crypto.createHash("sha256").update(b).digest("hex");
const onDisk = (rel: string, content: string): string => {
  const abs = path.join(mockRoot, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
};
const stored = (key: string): string | null => {
  const abs = path.join(mockRoot, "store", ...key.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
};

beforeEach(() => {
  jest.clearAllMocks();
  fs.rmSync(path.join(mockRoot, "store"), { recursive: true, force: true });
  fs.rmSync(path.join(mockRoot, "uploads"), { recursive: true, force: true });
  fs.rmSync(path.join(mockRoot, "backup"), { recursive: true, force: true });
  mockRows.certificates = [];
  mockRows.backups = [];
  mockRows.attachments = [];
});
afterAll(() => {
  fs.rmSync(mockRoot, { recursive: true, force: true });
});

describe("P8-01 — certificate PDFs", () => {
  it("copies each PDF to t/<tenant>/certificates/<file>, verified; the row is never rewritten; a re-run skips", async () => {
    onDisk("uploads/certificates/a.pdf", "%PDF a");
    mockRows.certificates = [
      { id: "c1", tenantId: TENANT, filePath: "certificates/a.pdf" },
      { id: "c2", tenantId: TENANT, filePath: "certificates/gone.pdf" },
      { id: "c3", tenantId: TENANT, filePath: `t/${TENANT}/certificates/x.pdf` },
    ];
    const first = await migration.migrateCertificates({});
    expect(first).toMatchObject({ total: 3, migrated: 1, missingSource: 1, skipped: 1, failed: 0 });
    expect(stored(`t/${TENANT}/certificates/a.pdf`)).toBe("%PDF a");
    expect(fs.existsSync(path.join(mockRoot, "uploads", "certificates", "a.pdf"))).toBe(true); // non-destructive
    expect(logAction).not.toHaveBeenCalled(); // no row was changed

    const again = await migration.migrateCertificates({ tenantId: TENANT });
    expect(again).toMatchObject({ migrated: 0, skipped: 2, missingSource: 1 });
  });

  it("dry-run reports, writes nothing; an object already there with OTHER bytes fails and is not overwritten", async () => {
    onDisk("uploads/certificates/b.pdf", "%PDF b");
    mockRows.certificates = [{ id: "c1", tenantId: TENANT, filePath: "certificates/b.pdf" }];
    const progress: string[] = [];
    expect(await migration.migrateCertificates({ dryRun: true, onProgress: (r) => progress.push(r.status) })).toMatchObject({ wouldMigrate: 1 });
    expect(progress).toEqual(["would-migrate"]);
    expect(stored(`t/${TENANT}/certificates/b.pdf`)).toBeNull();

    const other = path.join(mockRoot, "store", "t", TENANT, "certificates", "b.pdf");
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(other, "something else");
    const run = await migration.migrateCertificates({});
    expect(run).toMatchObject({ failed: 1 });
    expect(run.results[0]?.["error"]).toMatch(/does not match its source/);
    expect(stored(`t/${TENANT}/certificates/b.pdf`)).toBe("something else");
  });

  it("reads 500 rows a page (D-24)", async () => {
    // Files absent on purpose: the paging is under test, not 501 copies.
    mockRows.certificates = Array.from({ length: 501 }, (_, i) => ({ id: `c${String(i).padStart(4, "0")}`, tenantId: TENANT, filePath: "certificates/absent.pdf" }));
    const run = await migration.migrateCertificates({});
    expect(run).toMatchObject({ total: 501, missingSource: 501 });
    const { Certificate } = jest.requireMock<{ Certificate: { findAll: jest.Mock } }>("../../models");
    expect(Certificate.findAll).toHaveBeenCalledTimes(2);
  });
});

describe("P8-01 — tenant backups", () => {
  it("copies a legacy backup, verified against its recorded checksum, and the row names its key — with one audit row, in one transaction", async () => {
    const abs = onDisk("backup/tenant-backups/tenant_b1.zip", "PK backup");
    const row = { id: "b1", tenantId: TENANT, filePath: abs, metadata: { checksum: sha("PK backup") }, save: jest.fn().mockResolvedValue(true) };
    mockRows.backups = [row];

    const run = await migration.migrateBackups({});

    const key = `t/${TENANT}/backups/tenant_b1.zip`;
    expect(run).toMatchObject({ migrated: 1, failed: 0 });
    expect(stored(key)).toBe("PK backup");
    expect(row.filePath).toBe(key);
    expect(row.save).toHaveBeenCalledWith({ hooks: false, transaction: mockTx });
    expect(logAction).toHaveBeenCalledWith(
      {
        tenantId: TENANT,
        systemActor: "system:storage-migration",
        action: "UPDATE",
        resourceType: "TenantBackup",
        resourceId: "b1",
        changes: { operation: "STORAGE_MIGRATE", actor: "system:storage-migration", filePath: { before: abs, after: key }, verifiedAgainst: "migrated" },
      },
      { transaction: mockTx },
    );
    expect(fs.existsSync(abs)).toBe(true); // non-destructive

    // A re-run: the row already names a key.
    expect(await migration.migrateBackups({ tenantId: TENANT })).toMatchObject({ skipped: 1, migrated: 0 });
  });

  it("refuses a path outside the backup directory and a source that no longer matches its checksum; reports a missing one", async () => {
    const outside = onDisk("uploads/precious.zip", "x");
    const altered = onDisk("backup/tenant-backups/altered.zip", "changed");
    const save = jest.fn();
    mockRows.backups = [
      { id: "b1", tenantId: TENANT, filePath: outside, save },
      { id: "b2", tenantId: TENANT, filePath: altered, metadata: { checksum: sha("original") }, save },
      { id: "b3", tenantId: TENANT, filePath: path.join(mockRoot, "backup", "tenant-backups", "gone.zip"), save },
    ];
    const run = await migration.migrateBackups({});
    expect(run).toMatchObject({ failed: 2, missingSource: 1, migrated: 0 });
    expect(run.results.map((r) => r["error"] ?? r.status)).toEqual([
      expect.stringMatching(/outside the backup directory/),
      expect.stringMatching(/does not match its recorded checksum/),
      "missing-source",
    ]);
    expect(save).not.toHaveBeenCalled();
  });

  it("dry-run copies nothing and rewrites no row", async () => {
    const abs = onDisk("backup/tenant-backups/tenant_b9.zip", "PK");
    const row = { id: "b9", tenantId: TENANT, filePath: abs, metadata: null, save: jest.fn() };
    mockRows.backups = [row];
    expect(await migration.migrateBackups({ dryRun: true })).toMatchObject({ wouldMigrate: 1 });
    expect(row.filePath).toBe(abs);
    expect(row.save).not.toHaveBeenCalled();
  });
});

describe("P8-01 — the public image class", () => {
  it("copies avatars, logos and CMS images to their platform keys; leaves what the public mount would never serve", async () => {
    onDisk("uploads/public/profile/1-a.png", "png a");
    onDisk("uploads/public/profile/default.svg", "<svg/>");
    onDisk("uploads/public/tenant/2-b.webp", "webp b");
    onDisk("uploads/public/cms/3-c.jpg", "jpg c");
    onDisk("uploads/public/cms/a b.png", "space in name");

    const run = await migration.migratePublicImages({});

    expect(run).toMatchObject({ total: 3, migrated: 3, failed: 0 });
    expect(stored("global/avatars/1-a.png")).toBe("png a");
    expect(stored("global/branding/2-b.webp")).toBe("webp b");
    expect(stored("global/content/3-c.jpg")).toBe("jpg c");
    expect(stored("global/avatars/default.svg")).toBeNull();
    expect(await migration.migratePublicImages({})).toMatchObject({ skipped: 3, migrated: 0 });
  });

  it("a copy whose read-back does not match is deleted and fails", async () => {
    onDisk("uploads/public/profile/4-d.png", "png d");
    const storageMock = jest.requireMock<typeof StorageModule>("../../services/storage");
    const real = await storageMock.getGlobalStorage();
    const corrupt = Object.assign(Object.create(Object.getPrototypeOf(real) as object) as typeof real, real, {
      get: jest.fn(async () => (await import("node:stream")).Readable.from([Buffer.from("corrupted")])),
    });
    (storageMock.getGlobalStorage as jest.Mock).mockResolvedValueOnce(corrupt);
    // exists() is false, so the copy is made, read back wrong, and removed.
    // (A second run below: the removal fails too, and the failure is still the mismatch.)
    const run = await migration.migratePublicImages({});
    expect(run).toMatchObject({ failed: 1 });
    expect(run.results[0]?.["error"]).toMatch(/Checksum mismatch/);
    expect(stored("global/avatars/4-d.png")).toBeNull();

    const real2 = await storageMock.getGlobalStorage();
    const stuck = Object.assign(Object.create(Object.getPrototypeOf(real2) as object) as typeof real2, real2, {
      get: jest.fn(async () => (await import("node:stream")).Readable.from([Buffer.from("corrupted")])),
      delete: jest.fn().mockRejectedValue(new Error("bucket unreachable")),
    });
    (storageMock.getGlobalStorage as jest.Mock).mockResolvedValueOnce(stuck);
    const again = await migration.migratePublicImages({});
    expect(again.results[0]?.["error"]).toMatch(/Checksum mismatch/);
  });
});

describe("P8-01 — migrateEverything", () => {
  it("every class runs with its defaults when called with no options", async () => {
    expect((await migration.migrateCertificates()).total).toBe(0);
    expect((await migration.migrateBackups()).total).toBe(0);
    expect((await migration.migratePublicImages()).total).toBe(0);
    expect((await migration.migrateEverything()).attachments.total).toBe(0);
  });

  it("runs every class; the public images only when the run is not limited to one tenant", async () => {
    const all = await migration.migrateEverything({});
    expect(Object.keys(all)).toEqual(["attachments", "certificates", "backups", "publicImages"]);
    expect(all.publicImages).not.toBeNull();
    const one = await migration.migrateEverything({ tenantId: TENANT });
    expect(one.publicImages).toBeNull();
  });
});
