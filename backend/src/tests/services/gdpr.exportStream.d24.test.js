/**
 * D-24 (ADR-070) — the Article 15 (DSAR) export is streamed and complete.
 *
 * It read every subject table whole into memory, then JSON.stringify'd the
 * lot, and truncated at 1,000 rows per table (5,000 audit rows) — an answer
 * that silently stopped, built in memory that grew with the subject's history.
 * Now each table is read a keyset page (500, by id) at a time and each page is
 * written through Node's own fs.promises.writeFile(iterable) before the next
 * is read.
 *
 * Tested at a realistic size — 12,345 audit rows and 2,501 notifications for
 * one subject — through the REAL writeFile into a temp directory, so the JSON
 * that reaches disk is parsed back and counted. The SQL shape of each read
 * (tenant AND subject predicate, ORDER BY id, LIMIT 500) is pinned in
 * gdpr.subject.a151.a154 and gdpr.a180; this proves completeness and bounds.
 */

const os = require("os");
const path = require("path");
const realFs = jest.requireActual("fs");
// Captured before any spy: `fs` below is this same module object.
const realWriteFile = realFs.promises.writeFile;
const realReadFile = realFs.promises.readFile;

const mockTables = {};
const mockReads = [];

jest.mock("../../models", () => {
  const { Op } = require("sequelize");
  // A keyset reader: honours where.id[Op.gt], ORDER BY id ASC and the limit.
  const table = (name) => ({
    findAll: jest.fn(async ({ where, limit, order }) => {
      mockReads.push({ name, limit, order });
      const after = where.id ? where.id[Op.gt] : null;
      return (mockTables[name] || [])
        .filter((r) => after === null || r.id > after)
        .slice(0, limit)
        .map((r) => ({ ...r }));
    }),
  });
  const models = {
    User: {
      findOne: jest.fn(async () => ({ id: "subject", email: "s@example.test", role: { name: "USER" } })),
    },
    Role: {},
    StockTransfer: table("StockTransfer"),
    StockAdjustment: table("StockAdjustment"),
    StockOpname: table("StockOpname"),
    CalibrationRecord: table("CalibrationRecord"),
    Certificate: table("Certificate"),
    MaintenanceWorkOrder: table("MaintenanceWorkOrder"),
    Notification: table("Notification"),
    ConsentRecord: table("ConsentRecord"),
    DsarRequest: table("DsarRequest"),
    AuditLog: table("AuditLog"),
  };
  models.Session = { unscoped: () => table("Session") };
  return models;
});

jest.mock("archiver", () => () => {
  const EventEmitter = require("events");
  const archive = new EventEmitter();
  archive.pipe = () => {};
  archive.directory = () => {};
  archive.finalize = () => setImmediate(() => archive.emit("end"));
  return archive;
});

jest.mock("../../config", () => ({ db: {} }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const fs = require("fs");
const gdprService = require("../../services/gdpr.service");

const rows = (n, make) =>
  Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(7, "0")}`, ...make(i) }));

let outDir;

beforeEach(async () => {
  jest.clearAllMocks();
  mockReads.length = 0;
  for (const key of Object.keys(mockTables)) {
    delete mockTables[key];
  }
  process.env.GDPR_ENABLED = "true";
  outDir = await realFs.promises.mkdtemp(path.join(os.tmpdir(), "dsar-d24-"));
  jest.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined);
  // The REAL writeFile, redirected into the temp directory: it consumes the
  // service's async iterable exactly as production does.
  jest
    .spyOn(fs.promises, "writeFile")
    .mockImplementation((file, content) =>
      realWriteFile(path.join(outDir, path.basename(file)), content),
    );
  jest.spyOn(fs.promises, "stat").mockResolvedValue({ size: 1 });
  jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined);
  jest.spyOn(fs, "createWriteStream").mockReturnValue({ on: () => {} });
  jest.spyOn(global, "setTimeout").mockImplementation(() => 0);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await realFs.promises.rm(outDir, { recursive: true, force: true });
});

const readJson = async (name) => JSON.parse(await realReadFile(path.join(outDir, name), "utf8"));

describe("D-24 — DSAR export streams every row, a page at a time", () => {
  it("writes all 12,345 audit rows and 2,501 notifications — nothing truncated — reading at most 500 per query", async () => {
    mockTables.AuditLog = rows(12345, (i) => ({ action: "UPDATE", n: i }));
    mockTables.Notification = rows(2501, (i) => ({ title: `n${i}` }));
    mockTables.ConsentRecord = rows(3, () => ({ purpose: "marketing" }));

    await gdprService.exportUserData("tenant-1", "subject");

    const audit = await readJson("audit_logs.json");
    expect(audit).toHaveLength(12345);
    expect(audit[12344]).toEqual({ id: "id-0012344", action: "UPDATE", n: 12344 });
    expect(new Set(audit.map((r) => r.id)).size).toBe(12345);

    const subject = await readJson("subject_records.json");
    expect(subject.Notification).toHaveLength(2501);
    expect(subject.StockTransfer).toEqual([]);

    const privacy = await readJson("privacy_records.json");
    expect(privacy.consentHistory).toHaveLength(3);
    expect(privacy.dsarRequests).toEqual([]);
    expect(privacy.sessions).toEqual([]);

    for (const read of mockReads) {
      expect(read.limit).toBe(500);
      expect(read.order).toEqual([["id", "ASC"]]);
    }
    // ceil(12345 / 500) = 25 pages; 2501 = 5 full pages + 1 row + 0 → 6 reads.
    expect(mockReads.filter((r) => r.name === "AuditLog")).toHaveLength(25);
    expect(mockReads.filter((r) => r.name === "Notification")).toHaveLength(6);
  });

  it("an exact multiple of the page size ends with one empty read, and every row is written once", async () => {
    mockTables.AuditLog = rows(1000, () => ({}));

    await gdprService.exportUserData("tenant-1", "subject");

    expect(await readJson("audit_logs.json")).toHaveLength(1000);
    expect(mockReads.filter((r) => r.name === "AuditLog")).toHaveLength(3);
  });

  it("an impersonated session is still withheld, row by row, while streaming (A-180)", async () => {
    mockTables.Session = [
      { id: "s1", impersonator_id: null, ip_address: "10.0.0.1" },
      { id: "s2", impersonator_id: "operator", ip_address: "10.9.9.9", user_agent: "op", device: "op" },
    ];

    await gdprService.exportUserData("tenant-1", "subject");

    const { sessions } = await readJson("privacy_records.json");
    expect(sessions).toEqual([
      { id: "s1", impersonator_id: null, ip_address: "10.0.0.1" },
      { id: "s2", ip_address: null, user_agent: null, device: null, impersonated: true },
    ]);
  });

  it("a read that fails mid-stream fails the export (A-151), not a truncated file presented as complete", async () => {
    mockTables.Notification = rows(1200, () => ({}));
    const { Notification } = require("../../models");
    const real = Notification.findAll.getMockImplementation();
    let calls = 0;
    Notification.findAll.mockImplementation(async (options) => {
      calls += 1;
      if (calls === 2) {
        throw new Error("connection reset");
      }
      return real(options);
    });

    await expect(gdprService.exportUserData("tenant-1", "subject")).rejects.toMatchObject({
      status: 500,
      message: "Failed to export user data",
    });
    Notification.findAll.mockImplementation(real);
  });
});
