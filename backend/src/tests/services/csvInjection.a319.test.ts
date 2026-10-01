/**
 * A-319 — every CSV the API exports is RFC 4180 quoted and neutralises
 * spreadsheet formulas (OWASP "CSV Injection").
 *
 * Before A-319 two exports wrote tenant-typed text into a spreadsheet as-is:
 *  - `stock.service#exportInventoryCsv` quoted a cell only for `,` `"` CR LF,
 *    so an item name `=HYPERLINK(...)` ran as a formula when opened;
 *  - `finance.service#getDepreciationReport` quoted the device name only and
 *    wrote the serial number bare, so `=cmd|...` ran and a serial holding a
 *    comma shifted every later column of its row.
 * `reporting.service#toCsv` neutralised formulas but quoted only on demand.
 *
 * Now all three write through `utils/csv.util`: every field is quoted
 * (RFC 4180, `"` doubled), rows end in CRLF, and a cell starting with
 * `=` `+` `-` `@` TAB or CR is prefixed with `'` — except a plain number, so
 * a quantity of -5 stays a number.
 *
 * Only the database is a double; the services and the helper are real.
 */
import type StockService from "../../services/stock.service";
import type FinanceService from "../../services/finance.service";
import type ReportingService from "../../services/reporting.service";

const mockStock = { findAll: jest.fn() };
const mockAssetFinance = { findAll: jest.fn() };

jest.mock("../../models", () => ({
  Stock: mockStock,
  StockTransfer: {},
  StockAdjustment: {},
  StockOpname: {},
  Warehouse: {},
  StorageLocation: {},
  User: {},
  AssetFinance: mockAssetFinance,
  CalibrationDevice: {},
  Vendor: {},
  CalibrationRecord: {},
  Certificate: {},
  MaintenanceWorkOrder: {},
}));
jest.mock("../../config", () => ({ db: { transaction: jest.fn() } }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../services/webhook.service", () => ({ emitAfterCommit: jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above */
const stockService = require("../../services/stock.service") as typeof StockService;
const financeService = require("../../services/finance.service") as typeof FinanceService;
const reportingService = require("../../services/reporting.service") as typeof ReportingService;
/* eslint-enable @typescript-eslint/no-require-imports */

/** A minimal RFC 4180 reader: the records, each a list of field values. */
const parseCsv = (text: string): string[][] => {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (quoted) {
      if (c === '"' && text.charAt(i + 1) === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\r" && text.charAt(i + 1) === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      i += 1;
    } else {
      field += c;
    }
  }
  record.push(field);
  records.push(record);
  return records;
};

/** Every field of every record is wrapped in double quotes. */
const everyFieldQuoted = (text: string): boolean =>
  text.split("\r\n").every((line) => /^"(?:[^"]|"")*"(?:,"(?:[^"]|"")*")*$/s.test(line));

const HOSTILE: readonly [string, string, string, string, string, string] = ["=HYPERLINK(\"http://evil\",\"x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcalc"];

describe("A-319 — stock inventory CSV", () => {
  beforeEach(() => {
    mockStock.findAll.mockResolvedValue([
      {
        itemName: HOSTILE[0],
        sku: HOSTILE[1],
        serialNumber: HOSTILE[3],
        quantity: -5,
        minQuantity: 0,
        description: HOSTILE[2],
        warehouse: { name: HOSTILE[4] },
        location: { name: HOSTILE[5] },
      },
      { itemName: "Gloves, nitrile", sku: null, serialNumber: "S\"1", quantity: 10, minQuantity: 2, description: null, warehouse: null, location: null },
    ]);
  });

  it("neutralises every formula-leading cell and keeps a plain negative number", async () => {
    const csv = (await stockService.exportInventoryCsv("t1" as never)).data;
    const [header, hostile, plain] = parseCsv(csv);
    expect(header).toEqual(["Item Name", "SKU", "Serial Number", "Warehouse", "Storage Location", "Quantity", "Min Quantity", "Description"]);
    expect(hostile).toEqual([`'${HOSTILE[0]}`, `'${HOSTILE[1]}`, `'${HOSTILE[3]}`, `'${HOSTILE[4]}`, `'${HOSTILE[5]}`, "-5", "0", `'${HOSTILE[2]}`]);
    expect(plain).toEqual(["Gloves, nitrile", "", "S\"1", "", "", "10", "2", ""]);
  });

  it("quotes every field and ends each record in CRLF (RFC 4180)", async () => {
    const csv = (await stockService.exportInventoryCsv("t1" as never)).data;
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(everyFieldQuoted(csv)).toBe(true);
  });
});

describe("A-319 — finance depreciation CSV", () => {
  beforeEach(() => {
    mockAssetFinance.findAll.mockResolvedValue([
      {
        id: "f1",
        deviceId: "d1",
        purchasePrice: 1000,
        salvageValue: 100,
        usefulLifeYears: 5,
        purchaseDate: "2029-01-01",
        depreciationMethod: "straight_line",
        device: { name: "=cmd|' /c calc'!A1", serialNumber: "SN,42" },
      },
      {
        id: "f2",
        deviceId: "d2",
        purchasePrice: 500,
        salvageValue: 0,
        usefulLifeYears: 2,
        purchaseDate: "2029-06-01",
        depreciationMethod: "declining_balance",
        device: { name: "Pump", serialNumber: "@SUM(A1)" },
      },
    ]);
  });

  it("neutralises the device name and the serial, and quotes the serial so a comma stays in its column", async () => {
    const report = await financeService.getDepreciationReport("t1" as never, { asOf: "2030-01-01" });
    const records = parseCsv(report.data.csv);
    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(record).toHaveLength(12);
    }
    expect(records[1]?.slice(0, 2)).toEqual(["'=cmd|' /c calc'!A1", "SN,42"]);
    expect(records[2]?.slice(0, 2)).toEqual(["Pump", "'@SUM(A1)"]);
    expect(everyFieldQuoted(report.data.csv)).toBe(true);
  });
});

describe("A-319 — reporting toCsv uses the same rules", () => {
  it("quotes every field, ends records in CRLF and neutralises formulas", () => {
    const csv = reportingService.toCsv(
      [{ key: "name", label: "Name" }, { key: "qty", label: "Qty" }],
      [{ name: "=1+1", qty: -3 }, { name: "plain", qty: "7" }],
    );
    expect(csv).toBe('"Name","Qty"\r\n"\'=1+1","-3"\r\n"plain","7"');
  });
});
