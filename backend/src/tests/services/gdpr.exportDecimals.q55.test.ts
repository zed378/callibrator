/**
 * Q-55 / D-21 — a DECIMAL reaches the Article 15 export as a number.
 *
 * The export reads each subject table with `raw: true` (D-24, keyset pages),
 * which bypasses the model's DECIMAL getters: a work order's `estimatedCost`
 * reached `subject_records.json` as the pg driver's string ("1250.50") while
 * the API answers the same field as the number 1250.5. Fail-before: both
 * costs were strings in the file.
 *
 * The rows come back as pg returns them (NUMERIC as a string); the attribute
 * list is the REAL model's (`maintenanceWorkOrder.model`), and the file is
 * written by the REAL fs.promises.writeFile into a temp directory and parsed
 * back, as gdpr.exportStream.d24 does.
 */
import * as os from "os";
import * as path from "path";
import type * as FsModule from "fs";
import type * as EventsModule from "events";
import type * as SequelizeModule from "sequelize";
import type defineWorkOrderModel from "../../models/maintenanceWorkOrder.model";

const realFs = jest.requireActual<typeof FsModule>("fs");
const realWriteFile = realFs.promises.writeFile;

type Row = Record<string, unknown>;
const mockTables = new Map<string, Row[]>();

jest.mock("../../models", () => {
  const { Sequelize } = jest.requireActual<typeof SequelizeModule>("sequelize");
  const defineWorkOrder = jest.requireActual<typeof defineWorkOrderModel>("../../models/maintenanceWorkOrder.model");
  const WorkOrder = defineWorkOrder(new Sequelize({ dialect: "postgres", logging: false }));
  const table = (name: string) => ({
    findAll: jest.fn(async () => Promise.resolve((mockTables.get(name) ?? []).map((r) => ({ ...r })))),
  });
  const models: Record<string, unknown> = {
    User: { findOne: jest.fn(async () => Promise.resolve({ id: "subject", email: "s@example.test", role: { name: "USER" } })) },
    Role: {},
    StockTransfer: table("StockTransfer"),
    StockAdjustment: table("StockAdjustment"),
    StockOpname: table("StockOpname"),
    CalibrationRecord: table("CalibrationRecord"),
    Certificate: table("Certificate"),
    // The real model's attributes; the rows as pg answers them.
    MaintenanceWorkOrder: { ...table("MaintenanceWorkOrder"), getAttributes: () => WorkOrder.getAttributes() },
    Notification: table("Notification"),
    ConsentRecord: table("ConsentRecord"),
    DsarRequest: table("DsarRequest"),
    AuditLog: table("AuditLog"),
  };
  models["Session"] = { unscoped: () => table("Session") };
  return models;
});

// archiver 8 is ESM with named classes; the service does `new ZipArchive(...)` (P6-02).
jest.mock("archiver", () => ({
  ZipArchive: function MockZipArchive() {
    const { EventEmitter } = jest.requireActual<typeof EventsModule>("events");
    const archive = Object.assign(new EventEmitter(), {
      pipe: () => undefined,
      directory: () => undefined,
      finalize: () => setImmediate(() => archive.emit("end")),
    });
    return archive;
  },
}));
// A-364: the export writes its audit row in a managed transaction; no
// connection here, so the double runs the callback as sequelize.transaction(cb) does.
jest.mock("../../config", () => ({
  db: { transaction: async (cb: (t: object) => Promise<unknown>) => cb({ id: "tx" }) },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import * as fs from "fs";
import type * as GdprService from "../../services/gdpr.service";

const gdprService = jest.requireActual<typeof GdprService>("../../services/gdpr.service");

let outDir = "";
let createWriteStream: jest.SpiedFunction<typeof FsModule.createWriteStream>;

beforeEach(async () => {
  mockTables.clear();
  outDir = await realFs.promises.mkdtemp(path.join(os.tmpdir(), "dsar-q55-"));
  jest.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined);
  jest
    .spyOn(fs.promises, "writeFile")
    .mockImplementation((file, content) => realWriteFile(path.join(outDir, path.basename(file as string)), content));
  const stat: Partial<fs.Stats> = { size: 1 };
  jest.spyOn(fs.promises, "stat").mockResolvedValue(stat as fs.Stats);
  jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined);
  // On the REAL module object, as the service's `import fs from "fs"` reads it:
  // `import * as fs` here is a namespace COPY, so a spy on it left the real
  // createWriteStream in place. It wrote an empty ZIP into backend/exports, and
  // on a fresh checkout (CI, no backend/exports) failed with ENOENT (2026-10-02).
  createWriteStream = jest
    .spyOn(realFs, "createWriteStream")
    .mockReturnValue({ on: () => undefined } as unknown as FsModule.WriteStream);
  jest.spyOn(global, "setTimeout").mockImplementation((() => 0) as unknown as typeof setTimeout);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await realFs.promises.rm(outDir, { recursive: true, force: true });
});

describe("Q-55 — the DSAR export carries DECIMAL columns as numbers", () => {
  it("a work order's costs are numbers (NULL stays NULL); other columns and other tables are untouched", async () => {
    mockTables.set("MaintenanceWorkOrder", [
      { id: "wo-1", assignedTo: "subject", title: "PM", estimatedCost: "1250.50", actualCost: null, resolutionNotes: "12.50" },
      { id: "wo-2", assignedTo: "subject", title: "Repair", estimatedCost: "0.00", actualCost: "999999999999.99" },
    ]);
    mockTables.set("Notification", [{ id: "n-1", userId: "subject", title: "10.00" }]);

    await gdprService.exportUserData("tenant-1" as never, "subject" as never);
    // The ZIP went to the double, not to a real file under backend/exports.
    expect(createWriteStream).toHaveBeenCalledTimes(1);

    const written = JSON.parse(await realFs.promises.readFile(path.join(outDir, "subject_records.json"), "utf8")) as Record<
      string,
      Row[]
    >;
    expect(written["MaintenanceWorkOrder"]).toEqual([
      { id: "wo-1", assignedTo: "subject", title: "PM", estimatedCost: 1250.5, actualCost: null, resolutionNotes: "12.50" },
      { id: "wo-2", assignedTo: "subject", title: "Repair", estimatedCost: 0, actualCost: 999999999999.99 },
    ]);
    // A table whose model has no DECIMAL (here a double without attributes) is written as read.
    expect(written["Notification"]).toEqual([{ id: "n-1", userId: "subject", title: "10.00" }]);
  });
});
