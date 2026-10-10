/**
 * P22-06 (ADR-126 § 8; `docs/UPSTREAM/09-REPORT-LAYOUTS.md` § 4.3) — a one-sheet XLSX written IN
 * THE BROWSER: the Office Open XML parts, zipped with `fflate` (already in the bundle through
 * jsPDF; now a direct dependency). No backend XLSX, no stored file.
 *
 * What 09 § 4.3 asks of every export, against the upstream's: a bold header row on light grey,
 * thin borders, **dates as real date cells** (not text), column widths, a **frozen header row** and
 * an **autofilter**. Text is written as inline strings, so a value beginning with `=` is shown as
 * written and never evaluated (no formula injection). Characters XML 1.0 cannot carry are dropped.
 */
import { zipSync, strToU8 } from "fflate";

/** One cell: text, a number, a calendar day (`YYYY-MM-DD`, written as a date cell) or empty. */
export type XlsxCell = string | number | { day: string } | null;

export interface XlsxSheet {
  /** The sheet's name (cut to Excel's 31 characters; `[]:*?/\` removed). */
  name: string;
  /** The header row's labels. */
  columns: readonly string[];
  /** Column widths in characters (default 14). */
  widths?: readonly number[];
  rows: readonly (readonly XlsxCell[])[];
  /** Lines written above the header (e.g. a note); the header and freeze move down with them. */
  notes?: readonly string[];
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export const xmlText = (value: string): string =>
  value.replace(INVALID_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `0` → `A`, `25` → `Z`, `26` → `AA`. */
export const columnName = (index: number): string => {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** A calendar day as Excel's serial number (days since 1899-12-30), or null when it is not one. */
export const excelSerial = (day: string): number | null => {
  const m = DAY.exec(day);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / 86_400_000) + 25_569;
};

export const sheetName = (name: string): string => name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet1";

/** Styles: 0 default · 1 body (thin border) · 2 header (bold, light grey, border) · 3 date (border, yyyy-mm-dd) · 4 note (bold). */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const textCell = (ref: string, value: string, style: number): string =>
  `<c r="${ref}" s="${String(style)}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;

const cell = (ref: string, value: XlsxCell): string => {
  if (value === null || value === "") return `<c r="${ref}" s="1"/>`;
  if (typeof value === "number") return Number.isFinite(value) ? `<c r="${ref}" s="1"><v>${String(value)}</v></c>` : `<c r="${ref}" s="1"/>`;
  if (typeof value === "string") return textCell(ref, value, 1);
  const serial = excelSerial(value.day);
  return serial === null ? textCell(ref, value.day, 1) : `<c r="${ref}" s="3"><v>${String(serial)}</v></c>`;
};

/** The worksheet part. */
export const sheetXml = (sheet: XlsxSheet): string => {
  const notes = sheet.notes ?? [];
  const headerRow = notes.length + 1;
  const last = columnName(Math.max(0, sheet.columns.length - 1));
  const lastRow = headerRow + sheet.rows.length;
  const widths = sheet.columns.map((_, i) => sheet.widths?.[i] ?? 14);
  const cols = `<cols>${widths.map((w, i) => `<col min="${String(i + 1)}" max="${String(i + 1)}" width="${String(w)}" customWidth="1"/>`).join("")}</cols>`;
  const noteRows = notes.map((note, i) => `<row r="${String(i + 1)}">${textCell(`A${String(i + 1)}`, note, 4)}</row>`).join("");
  const header = `<row r="${String(headerRow)}">${sheet.columns.map((c, i) => textCell(`${columnName(i)}${String(headerRow)}`, c, 2)).join("")}</row>`;
  const body = sheet.rows
    .map((row, r) => {
      const n = headerRow + 1 + r;
      return `<row r="${String(n)}">${sheet.columns.map((_, i) => cell(`${columnName(i)}${String(n)}`, row[i] ?? null)).join("")}</row>`;
    })
    .join("");
  const pane = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${String(headerRow)}" topLeftCell="A${String(headerRow + 1)}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${last}${String(lastRow)}"/>${pane}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${noteRows}${header}${body}</sheetData>` +
    `<autoFilter ref="A${String(headerRow)}:${last}${String(lastRow)}"/></worksheet>`
  );
};

/** The workbook (one sheet) as XLSX bytes. */
export const buildXlsx = (sheet: XlsxSheet): Uint8Array<ArrayBuffer> => {
  const name = sheetName(sheet.name);
  const filterName = `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${xmlText(name.replace(/'/g, "''"))}'!$A$${String((sheet.notes?.length ?? 0) + 1)}:$${columnName(Math.max(0, sheet.columns.length - 1))}$${String((sheet.notes?.length ?? 0) + 1 + sheet.rows.length)}</definedName></definedNames>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlText(name)}" sheetId="1" r:id="rId1"/></sheets>${filterName}</workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(STYLES),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml(sheet)),
  };
  // A copy on its own ArrayBuffer: a Blob part (the download) takes no shared buffer.
  return new Uint8Array(zipSync(files, { level: 6 }));
};
