/** @jest-environment node */
/**
 * P22-06 — the browser's XLSX writer (09 § 4.3): the parts a spreadsheet application needs, a bold
 * grey header, thin borders, dates as REAL date cells, column widths, a frozen header row and an
 * autofilter; text as inline strings (a leading `=` is never a formula); XML-forbidden characters
 * dropped; notes above the header move the header, the freeze and the filter down.
 */
import { unzipSync, strFromU8 } from "fflate";
import { buildXlsx, columnName, excelSerial, sheetName, sheetXml, xmlText, XLSX_MIME } from "./xlsx";

describe("P22-06 — xlsx", () => {
  it("column names, Excel serial days, sheet names and XML text", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(excelSerial("1900-03-01")).toBe(61);
    expect(excelSerial("2026-10-10")).toBe(46305);
    expect(excelSerial("2026-10-10T08:00:00Z")).toBe(46305);
    expect(excelSerial("10/10/2026")).toBeNull();
    expect(sheetName("Rekap: 2026/10 [a]*?")).toBe("Rekap  2026 10  a");
    expect(sheetName("   ")).toBe("Sheet1");
    expect(sheetName("x".repeat(40))).toHaveLength(31);
    expect(xmlText(`a<b>&"c"\u0001\u0008\u000b`)).toBe("a&lt;b&gt;&amp;&quot;c&quot;");
    expect(XLSX_MIME).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  it("the sheet: header styled, a date cell, a number, an empty cell, text never a formula; frozen header and autofilter", () => {
    const xml = sheetXml({
      name: "S",
      columns: ["No", "Name", "Date"],
      widths: [6, 30],
      rows: [
        [1, "=HYPERLINK(\"x\")", { day: "2026-10-10" }],
        [2, null, { day: "not a day" }],
        [Number.NaN, "", null],
      ],
    });
    expect(xml).toContain('<c r="A1" s="2" t="inlineStr"><is><t xml:space="preserve">No</t></is></c>');
    expect(xml).toContain('<c r="B2" s="1" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;x&quot;)</t></is></c>');
    expect(xml).not.toContain("<f>");
    expect(xml).toContain('<c r="C2" s="3"><v>46305</v></c>');
    expect(xml).toContain('<c r="C3" s="1" t="inlineStr"><is><t xml:space="preserve">not a day</t></is></c>');
    expect(xml).toContain('<c r="A2" s="1"><v>1</v></c>');
    expect(xml).toContain('<c r="A4" s="1"/>');
    expect(xml).toContain('<c r="B3" s="1"/>');
    expect(xml).toContain('<col min="3" max="3" width="14" customWidth="1"/>');
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(xml).toContain('<autoFilter ref="A1:C4"/>');
    expect(xml).toContain('<dimension ref="A1:C4"/>');
  });

  it("notes above the header move the header, the freeze and the filter down", () => {
    const xml = sheetXml({ name: "S", columns: ["A"], rows: [["x"]], notes: ["Links expire in 15 minutes"] });
    expect(xml).toContain('<c r="A1" s="4" t="inlineStr"><is><t xml:space="preserve">Links expire in 15 minutes</t></is></c>');
    expect(xml).toContain('<c r="A2" s="2"');
    expect(xml).toContain('<pane ySplit="2" topLeftCell="A3"');
    expect(xml).toContain('<autoFilter ref="A2:A3"/>');
  });

  it("the workbook: a zip of the six parts, the sheet named, the filter defined, the date format declared", () => {
    const bytes = buildXlsx({ name: "Rekap 'Oktober'", columns: ["No", "Date"], rows: [[1, { day: "2026-10-10" }]] });
    expect(bytes).toBeInstanceOf(Uint8Array);
    const parts = unzipSync(bytes);
    expect(Object.keys(parts).sort()).toEqual(
      ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"].sort(),
    );
    const workbook = strFromU8(parts["xl/workbook.xml"] as Uint8Array);
    expect(workbook).toContain('<sheet name="Rekap \'Oktober\'" sheetId="1" r:id="rId1"/>');
    expect(workbook).toContain("'Rekap ''Oktober'''!$A$1:$B$2");
    expect(strFromU8(parts["xl/styles.xml"] as Uint8Array)).toContain('formatCode="yyyy-mm-dd"');
    expect(strFromU8(parts["xl/worksheets/sheet1.xml"] as Uint8Array)).toContain('<c r="B2" s="3"><v>46305</v></c>');
  });
});
