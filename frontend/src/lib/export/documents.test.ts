/**
 * P22-06 — the export documents as data (09 § 3.3, § 4.3): a device as the inventory prints it (a
 * store is no room; the technician is the latest calibration's performer, else the registrant; an
 * erased person "Redacted"); the PDF's QR order and the XLSX's latest-calibration order; the two
 * sheets' columns and cells (real dates; the inventory date never in the calibration column; the
 * recap's room snapshot and input day); the recap orders; the file names of the upstream.
 */
import type { components } from "@/api/typed";
import {
  byLatestCalibration,
  byQr,
  fileSafe,
  inventoryFileName,
  inventoryRow,
  inventorySheet,
  localDay,
  recapFileName,
  recapOrder,
  recapSheet,
  type ExportLabels,
  type InventoryRow,
  type RecapChoice,
} from "./documents";

type Device = components["schemas"]["CalibrationDevice"];
type CalibrationRecord = components["schemas"]["CalibrationRecord"];

const labels: ExportLabels = { col: (k) => `[${k}]`, condition: (v) => `cond:${v ?? "unset"}`, redacted: "Redacted" };

const device = (over: Partial<Device> = {}): Device => ({
  id: "d1",
  tenantId: "t",
  name: "Pump",
  serialNumber: "SN-1",
  manufacturer: "Make",
  model: "M-1",
  category: null,
  status: "active",
  locationId: null,
  installationDate: null,
  nextCalibrationDate: null,
  calibrationIntervalDays: null,
  remarks: null,
  iotEnabled: false,
  isDeleted: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

const row = (over: Partial<InventoryRow>): InventoryRow => ({
  id: "x",
  facility: null,
  name: "A",
  make: null,
  type: null,
  qrCode: null,
  serial: null,
  room: null,
  floor: null,
  condition: "",
  technician: null,
  inventoryDate: null,
  calibrationDate: null,
  frontPhotoId: null,
  platePhotoId: null,
  ...over,
});

const record = (over: Partial<CalibrationRecord>): CalibrationRecord => ({
  id: "r1",
  tenantId: "t",
  deviceId: "d1",
  performedBy: null,
  apiKeyId: null,
  calibrationDate: "2026-10-01",
  dueDate: null,
  standard: null,
  results: null,
  measurementUncertainty: null,
  isCompliant: null,
  certificateNumber: null,
  certificateFileUrl: null,
  notes: null,
  isDeleted: false,
  supersedesId: null,
  correctionReason: null,
  supersededById: null,
  supersededAt: null,
  voidReason: null,
  voidedBy: null,
  createdAt: "2026-10-02T05:00:00Z",
  updatedAt: "2026-10-02T05:00:00Z",
  ...over,
});

describe("P22-06 — export documents", () => {
  it("a device as the inventory prints it", () => {
    const full = inventoryRow(
      device({
        qrCode: "QR-1",
        clientFacility: { id: "f", name: "Clinic", code: "C" },
        warehouse: { id: "w", name: "ICU", code: "I", floor: "2", kind: "room" },
        condition: "good",
        inventoriedOn: "2026-09-01",
        lastCalibration: { recordId: "r", date: "2026-10-01T00:00:00Z", entryKind: "external_date", externalLabName: null, performerDisplay: { name: "Tech", redacted: false } },
        registrantDisplay: { name: "Registrant", role: null, organisation: null },
        frontPhotoAttachmentId: "p1",
        serialPlatePhotoAttachmentId: "p2",
      }),
      labels,
    );
    expect(full).toEqual({
      id: "d1",
      facility: "Clinic",
      name: "Pump",
      make: "Make",
      type: "M-1",
      qrCode: "QR-1",
      serial: "SN-1",
      room: "ICU",
      floor: "2",
      condition: "cond:good",
      technician: "Tech",
      inventoryDate: "2026-09-01",
      calibrationDate: "2026-10-01",
      frontPhotoId: "p1",
      platePhotoId: "p2",
    });
    const bare = inventoryRow(
      device({
        model: null,
        deviceType: { id: "t", name: "Infusion pump" },
        warehouse: { id: "s", name: "Depot", code: "D", floor: "1", kind: "store" },
        lastCalibration: { recordId: "r", date: "x", entryKind: "full_record", externalLabName: null, performerDisplay: { name: null, redacted: true } },
        registrantDisplay: { name: "Registrant", role: null, organisation: null },
      }),
      labels,
    );
    expect(bare).toMatchObject({ type: "Infusion pump", room: null, floor: null, technician: "Redacted", calibrationDate: null, condition: "cond:unset", qrCode: null });
    expect(inventoryRow(device({ registrantDisplay: { name: "Reg", role: null, organisation: null } }), labels).technician).toBe("Reg");
    expect(inventoryRow(device({ registrantDisplay: { name: "", role: null, organisation: null } }), labels).technician).toBeNull();
    expect(inventoryRow(device({ model: null }), labels).type).toBeNull();
    expect(inventoryRow(device({ warehouse: null }), labels).room).toBeNull();
  });

  it("orders: QR ascending (none last, numeric), then name; latest calibration descending (none last), then name", () => {
    const rows = [row({ name: "B", qrCode: null }), row({ name: "C", qrCode: "QR-10" }), row({ name: "A", qrCode: "QR-9" }), row({ name: "A2", qrCode: "QR-9" })];
    expect([...rows].sort(byQr).map((r) => r.name)).toEqual(["A", "A2", "C", "B"]);
    const cal = [row({ name: "X", calibrationDate: null }), row({ name: "Y", calibrationDate: "2026-01-01" }), row({ name: "Z", calibrationDate: "2026-05-01" }), row({ name: "W", calibrationDate: null })];
    expect([...cal].sort(byLatestCalibration).map((r) => r.name)).toEqual(["Z", "Y", "W", "X"]);
    expect([row({ name: "N", calibrationDate: "2026-01-01" }), row({ name: "M", calibrationDate: null })].sort(byLatestCalibration).map((r) => r.name)).toEqual(["N", "M"]);
  });

  it("the inventory sheet: 13 columns, numbered in its order, two date columns as real dates", () => {
    const sheet = inventorySheet([row({ name: "Old", calibrationDate: "2026-01-01", inventoryDate: "2025-01-01" }), row({ name: "New", calibrationDate: "2026-06-01" })], labels, "Inventory");
    expect(sheet.columns).toHaveLength(13);
    expect(sheet.columns[11]).toBe("[calibrationDate]");
    expect(sheet.columns[12]).toBe("[inventoryDate]");
    expect(sheet.rows[0]?.[0]).toBe(1);
    expect(sheet.rows[0]?.[2]).toBe("New");
    expect(sheet.rows[1]?.[11]).toEqual({ day: "2026-01-01" });
    expect(sheet.rows[1]?.[12]).toEqual({ day: "2025-01-01" });
    expect(sheet.rows[0]?.[12]).toBeNull();
  });

  it("the recap sheet: 12 columns, the room snapshot, the input day in the browser's zone, the performer or Redacted", () => {
    const choice: RecapChoice = { dateField: "created", fromDay: "2026-10-01", toDay: "2026-10-31", latestOnly: false };
    const sheet = recapSheet(
      [
        record({
          id: "a",
          createdAt: "2026-10-03T00:00:00Z",
          device: { id: "d", name: "Pump", serialNumber: "S", manufacturer: "M", model: "T", qrCode: "Q" },
          room: { name: "ICU", floor: "2" },
          clientFacility: { id: "f", name: "Clinic", code: null },
          performerDisplay: { name: "Tech", role: null, organisation: null, redacted: false },
        }),
        record({ id: "b", createdAt: "2026-10-05T00:00:00Z", calibrationDate: "bad", performerDisplay: { name: null, role: null, organisation: null, redacted: true } }),
      ],
      choice,
      labels,
      "Calibrations",
    );
    expect(sheet.columns).toHaveLength(12);
    expect(sheet.rows[0]).toEqual([1, null, null, null, null, null, null, null, null, null, { day: localDay("2026-10-05T00:00:00Z") }, "Redacted"]);
    expect(sheet.rows[1]).toEqual([2, "Clinic", "Pump", "M", "T", "Q", "S", "ICU", "2", { day: "2026-10-01" }, { day: localDay("2026-10-03T00:00:00Z") }, "Tech"]);
    expect(recapSheet([record({ createdAt: "garbage" })], choice, labels, "C").rows[0]?.[10]).toBeNull();
    expect(localDay(null)).toBeNull();
  });

  it("recap orders: a calibration RANGE ascending by calibration date; a day, an input range or the latest list newest input first", () => {
    const a = record({ id: "a", calibrationDate: "2026-10-05", createdAt: "2026-10-01T00:00:00Z" });
    const b = record({ id: "b", calibrationDate: "2026-10-01", createdAt: "2026-10-09T00:00:00Z" });
    const c = record({ id: "c", calibrationDate: "2026-10-01", createdAt: "2026-10-09T00:00:00Z" });
    const range: RecapChoice = { dateField: "calibration", fromDay: "2026-10-01", toDay: "2026-10-31", latestOnly: false };
    expect([a, c, b].sort(recapOrder(range)).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect([a, b, c].sort(recapOrder({ ...range, toDay: "2026-10-01" })).map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect([a, b].sort(recapOrder({ ...range, latestOnly: true })).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("file names: the upstream's four recaps, the latest list, the inventory; unsafe characters replaced", () => {
    const base: RecapChoice = { dateField: "created", fromDay: "2026-10-01", toDay: "2026-10-01", latestOnly: false };
    expect(recapFileName(base, "2026-10-10")).toBe("rekap_kalibrasi_harian_2026-10-01.xlsx");
    expect(recapFileName({ ...base, toDay: "2026-10-31" }, "x")).toBe("rekap_rentang_input_2026-10-01_sd_2026-10-31.xlsx");
    expect(recapFileName({ ...base, dateField: "calibration" }, "x")).toBe("rekap_tgl_kalibrasi_2026-10-01.xlsx");
    expect(recapFileName({ ...base, dateField: "calibration", toDay: "2026-10-31" }, "x")).toBe("rekap_rentang_kalibrasi_2026-10-01_sd_2026-10-31.xlsx");
    expect(recapFileName({ ...base, latestOnly: true }, "2026-10-10")).toBe("daftar_kalibrasi_terakhir_2026-10-10.xlsx");
    expect(inventoryFileName("RS Sehat / Ruang 1", "2026-10-10", "pdf")).toBe("inventaris_RS_Sehat_Ruang_1_2026-10-10.pdf");
    expect(inventoryFileName(null, "2026-10-10", "xlsx")).toBe("inventaris_2026-10-10.xlsx");
    expect(fileSafe("///")).toBe("export");
  });
});
