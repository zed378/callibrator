/**
 * P22-06 (F-65 … F-69; `docs/UPSTREAM/09-REPORT-LAYOUTS.md` § 3.3, § 4.3) — the export documents as
 * plain data: which rows, in which order, under which columns and file name. The API rows come from
 * the paged reads (`pagedRead.ts`); the bytes are written by `inventoryPdf.ts` and `xlsx.ts`.
 *
 * The 09 targets' fixes over the upstream, kept here:
 *  - the inventory PDF prints our condition vocabulary, a generation date and page numbers, and
 *    its facility signature block names the DOCUMENT's facility (not "the last row");
 *  - the inventory XLSX never puts the inventory date in the calibration-date column (two columns);
 *    "technician" is the latest calibration's performer, else the device's registrant;
 *  - the recaps print the room recorded with the calibration (its snapshot), real date cells and the
 *    performer's display ("Redacted" when the person was erased);
 *  - no permanent photo URL is written anywhere (the XLSX has no photo column).
 */
import type { components } from "@/api/typed";
import type { XlsxCell, XlsxSheet } from "./xlsx";

type Device = components["schemas"]["CalibrationDevice"];
type CalibrationRecord = components["schemas"]["CalibrationRecord"];

/** The words a document is printed with (the page's language). */
export interface ExportLabels {
  /** Column headers, by key. */
  col: (key: ColumnKey) => string;
  condition: (value: string | null | undefined) => string;
  redacted: string;
}

export type ColumnKey =
  | "no"
  | "facility"
  | "device"
  | "make"
  | "type"
  | "qr"
  | "serial"
  | "room"
  | "floor"
  | "condition"
  | "technician"
  | "inventoryDate"
  | "calibrationDate"
  | "inputDate"
  | "enteredBy"
  | "frontPhoto"
  | "platePhoto";

const day = (value: string | null | undefined): string | null => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);
const dayCell = (value: string | null | undefined): XlsxCell => {
  const d = day(value);
  return d ? { day: d } : null;
};
/** An instant's calendar day in the browser's zone (an input date is an instant, not a day). */
export const localDay = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const localDayCell = (iso: string | null | undefined): XlsxCell => {
  const d = localDay(iso);
  return d ? { day: d } : null;
};
const nameOf = (display: unknown, redacted: string): string | null => {
  if (typeof display !== "object" || display === null) return null;
  const d = display as { name?: unknown; redacted?: unknown };
  if (d.redacted === true) return redacted;
  return typeof d.name === "string" && d.name !== "" ? d.name : null;
};

/** One device as the inventory documents print it. */
export interface InventoryRow {
  id: string;
  facility: string | null;
  name: string;
  make: string | null;
  type: string | null;
  qrCode: string | null;
  serial: string | null;
  room: string | null;
  floor: string | null;
  condition: string;
  technician: string | null;
  inventoryDate: string | null;
  calibrationDate: string | null;
  frontPhotoId: string | null;
  platePhotoId: string | null;
}

/** "Type" upstream is the model; our device type, when set, is printed first. */
const typeOf = (d: Device): string | null => d.model ?? d.deviceType?.name ?? null;

export const inventoryRow = (d: Device, labels: ExportLabels): InventoryRow => ({
  id: d.id,
  facility: d.clientFacility?.name ?? null,
  name: d.name,
  make: d.manufacturer,
  type: typeOf(d),
  qrCode: d.qrCode ?? null,
  serial: d.serialNumber,
  room: d.warehouse?.kind === "store" ? null : (d.warehouse?.name ?? null),
  floor: d.warehouse?.kind === "store" ? null : (d.warehouse?.floor ?? null),
  condition: labels.condition(d.condition),
  technician: nameOf(d.lastCalibration?.performerDisplay, labels.redacted) ?? nameOf(d.registrantDisplay, labels.redacted),
  inventoryDate: day(d.inventoriedOn),
  calibrationDate: day(d.lastCalibration?.date),
  frontPhotoId: d.frontPhotoAttachmentId ?? null,
  platePhotoId: d.serialPlatePhotoAttachmentId ?? null,
});

const compareText = (a: string | null, b: string | null): number => (a ?? "￿").localeCompare(b ?? "￿", undefined, { numeric: true });

/** The inventory PDF's order (09 § 3.1): QR ascending (no sticker last), then name. */
export const byQr = (a: InventoryRow, b: InventoryRow): number => compareText(a.qrCode, b.qrCode) || compareText(a.name, b.name);

/** The inventory XLSX's order (09 § 4.1): latest calibration date descending (none last), then name. */
export const byLatestCalibration = (a: InventoryRow, b: InventoryRow): number => {
  if (a.calibrationDate !== b.calibrationDate) {
    if (a.calibrationDate === null) return 1;
    if (b.calibrationDate === null) return -1;
    return a.calibrationDate < b.calibrationDate ? 1 : -1;
  }
  return compareText(a.name, b.name);
};

const INVENTORY_XLSX_COLUMNS: readonly ColumnKey[] = [
  "no",
  "facility",
  "device",
  "make",
  "type",
  "qr",
  "serial",
  "room",
  "floor",
  "condition",
  "technician",
  "calibrationDate",
  "inventoryDate",
];

export const inventorySheet = (rows: readonly InventoryRow[], labels: ExportLabels, title: string): XlsxSheet => ({
  name: title,
  columns: INVENTORY_XLSX_COLUMNS.map(labels.col),
  widths: [6, 28, 30, 18, 18, 14, 18, 20, 8, 14, 24, 14, 14],
  rows: [...rows]
    .sort(byLatestCalibration)
    .map((r, i) => [
      i + 1,
      r.facility,
      r.name,
      r.make,
      r.type,
      r.qrCode,
      r.serial,
      r.room,
      r.floor,
      r.condition,
      r.technician,
      r.calibrationDate ? { day: r.calibrationDate } : null,
      r.inventoryDate ? { day: r.inventoryDate } : null,
    ]),
});

/** The recap's choice (09 § 4.2): which date, which days, latest per device or every record. */
export interface RecapChoice {
  dateField: "calibration" | "created";
  fromDay: string;
  toDay: string;
  latestOnly: boolean;
}

const RECAP_COLUMNS: readonly ColumnKey[] = ["no", "facility", "device", "make", "type", "qr", "serial", "room", "floor", "calibrationDate", "inputDate", "enteredBy"];

/** The recap's order (09 § 4.2): a calibration-date RANGE ascending by calibration date; the others newest input first. */
export const recapOrder = (choice: RecapChoice) => (a: CalibrationRecord, b: CalibrationRecord): number => {
  if (choice.dateField === "calibration" && choice.fromDay !== choice.toDay && !choice.latestOnly) {
    return a.calibrationDate.localeCompare(b.calibrationDate) || a.id.localeCompare(b.id);
  }
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
};

export const recapSheet = (records: readonly CalibrationRecord[], choice: RecapChoice, labels: ExportLabels, title: string): XlsxSheet => ({
  name: title,
  columns: RECAP_COLUMNS.map(labels.col),
  widths: [6, 28, 30, 18, 18, 14, 18, 20, 8, 14, 14, 24],
  rows: [...records].sort(recapOrder(choice)).map((r, i) => [
    i + 1,
    r.clientFacility?.name ?? null,
    r.device?.name ?? null,
    r.device?.manufacturer ?? null,
    r.device?.model ?? null,
    r.device?.qrCode ?? null,
    r.device?.serialNumber ?? null,
    r.room?.name ?? null,
    r.room?.floor ?? null,
    dayCell(r.calibrationDate),
    localDayCell(r.createdAt),
    nameOf(r.performerDisplay, labels.redacted),
  ]),
});

/** A file-name part: letters, digits, `-` and `_` only. */
export const fileSafe = (value: string): string => value.normalize("NFKD").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "export";

/** The recap's file name, as the upstream named its four recaps (09 § 4.2); the latest list as its own. */
export const recapFileName = (choice: RecapChoice, today: string): string => {
  if (choice.latestOnly) return `daftar_kalibrasi_terakhir_${today}.xlsx`;
  const single = choice.fromDay === choice.toDay;
  if (choice.dateField === "created") return single ? `rekap_kalibrasi_harian_${choice.fromDay}.xlsx` : `rekap_rentang_input_${choice.fromDay}_sd_${choice.toDay}.xlsx`;
  return single ? `rekap_tgl_kalibrasi_${choice.fromDay}.xlsx` : `rekap_rentang_kalibrasi_${choice.fromDay}_sd_${choice.toDay}.xlsx`;
};

export const inventoryFileName = (facility: string | null, today: string, ext: "pdf" | "xlsx"): string =>
  `inventaris_${facility ? `${fileSafe(facility)}_` : ""}${today}.${ext}`;
