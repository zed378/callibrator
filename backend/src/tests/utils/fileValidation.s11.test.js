/**
 * S-11 — the attachment types the route allows must be uploadable, and only
 * with content of the declared kind.
 *
 * Every case writes a REAL file to a temp directory and runs the real
 * validateFileMagicBytes over it: nothing here mocks fs or the validator. The
 * OOXML fixtures are genuine ZIP containers built with JSZip (already a
 * dependency), laid out like the packages Word and Excel write.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const JSZip = require("jszip");
const { validateFileMagicBytes } = require("../../utils/fileValidation.util");

const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOC = "application/msword";
const XLS = "application/vnd.ms-excel";

const RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="%TARGET%"/>' +
  "</Relationships>";

const contentTypes = (overrides) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  overrides +
  "</Types>";

const zipBuffer = (zip) =>
  zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

/** A minimal but well-formed WordprocessingML package. */
const buildDocx = () => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    contentTypes(
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    ),
  );
  zip.file("_rels/.rels", RELS.replace("%TARGET%", "word/document.xml"));
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:body><w:p><w:r><w:t>Calibration procedure</w:t></w:r></w:p></w:body></w:document>",
  );
  return zipBuffer(zip);
};

/** A minimal but well-formed SpreadsheetML package with one sheet. */
const buildXlsx = () => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    contentTypes(
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    ),
  );
  zip.file("_rels/.rels", RELS.replace("%TARGET%", "xl/workbook.xml"));
  zip.file(
    "xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Readings" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Reading</t></is></c></row>' +
      '<row r="2"><c r="A2"><v>37.2</v></c></row>' +
      "</sheetData></worksheet>",
  );
  return zipBuffer(zip);
};

/**
 * An OLE2 Compound File: a version-3 CFB header (signature, minor 0x3E,
 * major 3, byte order FFFE, 512-byte sectors, 64-byte mini sectors) and one
 * sector. The validator reads only the signature, which is what Word 97-2003
 * and Excel 97-2003 files begin with.
 */
const buildOle2 = () => {
  const buf = Buffer.alloc(1024, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buf, 0);
  buf.writeUInt16LE(0x003e, 0x18);
  buf.writeUInt16LE(0x0003, 0x1a);
  buf.writeUInt16LE(0xfffe, 0x1c);
  buf.writeUInt16LE(9, 0x1e);
  buf.writeUInt16LE(6, 0x20);
  buf.writeUInt32LE(0xfffffffe, 0x30);
  buf.fill(0xff, 512);
  return buf;
};

/** Offset of the ZIP end-of-central-directory record. */
const eocdOffset = (buf) =>
  buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

describe("S-11 — attachment types validated against real file content", () => {
  let dir;
  let docx;
  let xlsx;

  const write = (name, content) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
  };

  beforeAll(async () => {
    // The mocked suite in fileValidation.test.js spies on fs.promises; none of
    // that may leak in here.
    jest.restoreAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "s11-"));
    docx = await buildDocx();
    xlsx = await buildXlsx();
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("accepted", () => {
    it("S-11: a real .xlsx passes as spreadsheetml.sheet", async () => {
      await expect(
        validateFileMagicBytes(write("readings.xlsx", xlsx), XLSX),
      ).resolves.toBe(XLSX);
    });

    it("S-11: a real .docx passes as wordprocessingml.document", async () => {
      await expect(
        validateFileMagicBytes(write("procedure.docx", docx), DOCX),
      ).resolves.toBe(DOCX);
    });

    it("S-11: an OLE2 .xls passes as application/vnd.ms-excel", async () => {
      await expect(
        validateFileMagicBytes(write("legacy.xls", buildOle2()), XLS),
      ).resolves.toBe(XLS);
    });

    it("S-11: an OLE2 .doc passes as application/msword", async () => {
      await expect(
        validateFileMagicBytes(write("legacy.doc", buildOle2()), DOC),
      ).resolves.toBe(DOC);
    });

    it("S-11: a .csv passes as text/csv", async () => {
      const csv = "serial,reading,unit\nDEV-001,37.2,°C\nDEV-002,36.9,°C\n";
      await expect(
        validateFileMagicBytes(write("readings.csv", csv), "text/csv"),
      ).resolves.toBe("text/csv");
    });

    it("S-11: a UTF-8 .txt passes as text/plain", async () => {
      const txt = "Kalibrasi selesai — suhu ruang 23 °C, µ = 0.02\r\n";
      await expect(
        validateFileMagicBytes(write("notes.txt", txt), "text/plain"),
      ).resolves.toBe("text/plain");
    });

    it("S-11: a .csv larger than the 8 KiB inspection window passes", async () => {
      const csv = "serial,reading\n" + "DEV-001,37.2\n".repeat(2000);
      await expect(
        validateFileMagicBytes(write("big.csv", csv), "text/csv"),
      ).resolves.toBe("text/csv");
    });
  });

  describe("refused, naming the declared type", () => {
    it("S-11: a .txt renamed to .xlsx is refused", async () => {
      const file = write("renamed.xlsx", "just some notes, not a workbook\n");
      await expect(validateFileMagicBytes(file, XLSX)).rejects.toMatchObject({
        status: 400,
        message: `File content does not match declared type "${XLSX}"`,
      });
    });

    it("S-11: a plain zip without [Content_Types].xml declared as docx is refused", async () => {
      const zip = new JSZip();
      zip.file("word/document.xml", "<w:document/>");
      zip.file("readme.txt", "an archive, not an OPC package");
      const file = write("archive.docx", await zipBuffer(zip));
      await expect(validateFileMagicBytes(file, DOCX)).rejects.toMatchObject({
        status: 400,
        message: `File content does not match declared type "${DOCX}"`,
      });
    });

    it("S-11: a docx declared as xlsx is refused", async () => {
      const file = write("procedure.xlsx", docx);
      await expect(validateFileMagicBytes(file, XLSX)).rejects.toMatchObject({
        status: 400,
        message: `File content does not match declared type "${XLSX}"`,
      });
    });

    it("S-11: an xlsx declared as docx is refused", async () => {
      const file = write("readings.docx", xlsx);
      await expect(validateFileMagicBytes(file, DOCX)).rejects.toThrow(
        `declared type "${DOCX}"`,
      );
    });

    it("S-11: a binary with a NUL byte declared as text/plain is refused", async () => {
      const file = write(
        "binary.txt",
        Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x01, 0x02]),
      );
      await expect(
        validateFileMagicBytes(file, "text/plain"),
      ).rejects.toMatchObject({
        status: 400,
        message: 'File content does not match declared type "text/plain"',
      });
    });

    it("S-11: an OLE2 file declared as text/csv is refused", async () => {
      const file = write("legacy.csv", buildOle2());
      await expect(validateFileMagicBytes(file, "text/csv")).rejects.toThrow(
        'declared type "text/csv"',
      );
    });

    it("S-11: a text file declared as application/vnd.ms-excel is refused", async () => {
      const file = write("notes.xls", "serial,reading\n");
      await expect(validateFileMagicBytes(file, XLS)).rejects.toThrow(
        `declared type "${XLS}"`,
      );
    });
  });

  describe("malformed ZIP containers declared as OOXML are refused", () => {
    it("S-11: a ZIP local header with no end-of-central-directory record", async () => {
      const buf = Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.alloc(200, 0x41),
      ]);
      await expect(
        validateFileMagicBytes(write("truncated.xlsx", buf), XLSX),
      ).rejects.toThrow(`declared type "${XLSX}"`);
    });

    it("S-11: a ZIP shorter than an end-of-central-directory record", async () => {
      const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
      await expect(
        validateFileMagicBytes(write("tiny.docx", buf), DOCX),
      ).rejects.toThrow(`declared type "${DOCX}"`);
    });

    it("S-11: a central directory that points past the end of the file", async () => {
      const buf = Buffer.from(xlsx);
      buf.writeUInt32LE(0xffffffff, eocdOffset(buf) + 16);
      await expect(
        validateFileMagicBytes(write("zip64ish.xlsx", buf), XLSX),
      ).rejects.toThrow(`declared type "${XLSX}"`);
    });

    it("S-11: an entry count larger than the central directory holds", async () => {
      const buf = Buffer.from(xlsx);
      const eocd = eocdOffset(buf);
      buf.writeUInt16LE(buf.readUInt16LE(eocd + 10) + 1, eocd + 10);
      await expect(
        validateFileMagicBytes(write("overcount.xlsx", buf), XLSX),
      ).rejects.toThrow(`declared type "${XLSX}"`);
    });

    it("S-11: a central directory header with a bad signature", async () => {
      const buf = Buffer.from(xlsx);
      const cdOffset = buf.readUInt32LE(eocdOffset(buf) + 16);
      buf[cdOffset] = 0x00;
      await expect(
        validateFileMagicBytes(write("badcd.xlsx", buf), XLSX),
      ).rejects.toThrow(`declared type "${XLSX}"`);
    });
  });

  describe("unchanged behaviour", () => {
    it("S-11: an xlsx declared as application/zip is still verified as zip", async () => {
      await expect(
        validateFileMagicBytes(write("readings.zip", xlsx), "application/zip"),
      ).resolves.toBe("application/zip");
    });
  });
});
