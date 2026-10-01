/** @jest-environment node */
/**
 * ADR-095 follow-up (O-5) — the certificate PDF prints names outside Latin-1.
 *
 * These render a REAL PDF with jsPDF and the REAL font files from
 * public/fonts/ (fetch is answered from disk), then read the text back the way
 * a PDF reader does: every string drawn in the embedded font is a run of glyph
 * ids (`<…> Tj`), and the font's own ToUnicode CMap, written into the PDF,
 * maps each id back to its character. A string is "printed" when some Tj
 * operand decodes to it through one of the PDF's CMaps. (Checked once by hand
 * against poppler's `pdftotext` — the record names the run.)
 */
import { readFileSync } from "fs";
import path from "path";
import {
  CERTIFICATE_FONT_URLS,
  codeMapOf,
  pdfUnicodeText,
  renderCertificatePdf,
  resetCertificateFontCache,
} from "./certificatePdf";
import type { CertificateDocument } from "@/api/services/calibration.service";

const PUBLIC = path.join(__dirname, "../../public");
const HASH = "5e".repeat(32);

const doc = (over: Partial<CertificateDocument> = {}): CertificateDocument => ({
  certificateNumber: "CERT-20260930-UNI-0001",
  type: "calibration",
  status: "signed",
  issuedBy: "Bệnh viện Đà Nẵng",
  device: { name: "Máy thở", serialNumber: "SN-Ø-17", manufacturer: "Dräger", model: "Evita V800" },
  standard: "ISO 17025",
  issueDate: "2026-09-01T00:00:00.000Z",
  validUntil: "2027-09-01T00:00:00.000Z",
  summary: "Αλέξανδρος · Анна Петрова · Şükrü Öztürk",
  conditions: "温度計 23 °C",
  notes: "مرحبا ＡＢ",
  calibratedBy: "Đặng Văn Hùng",
  approvedBy: "Łukasz Wróblewski",
  signedBy: "Zoë Brontë",
  signedAt: "2026-09-02T08:00:00.000Z",
  verifyUrl: "https://kalibrasi.example/verify/CERT-20260930-UNI-0001",
  integrity: { scheme: "certificate-content-v2", algorithm: "SHA-256", hash: HASH, legacyHash: "aa".repeat(32) },
  ...over,
});

const serveFontsFromDisk = () =>
  jest
    .spyOn(global, "fetch")
    .mockImplementation(async (url) => new Response(readFileSync(path.join(PUBLIC, String(url)))));

/** Every ToUnicode CMap in the PDF, as glyph id → text. */
const cmapsOf = (pdf: string): Map<string, string>[] =>
  [...pdf.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)].map((block) => {
    const map = new Map<string, string>();
    for (const [, gid, uni] of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
      const units = uni.match(/.{4}/g) ?? [];
      map.set(gid.toLowerCase(), String.fromCharCode(...units.map((u) => parseInt(u, 16))));
    }
    return map;
  });

/** Every hex-string Tj operand, decoded through every CMap (a wrong CMap yields noise, never a false match). */
const printedTexts = (bytes: ArrayBuffer): string[] => {
  const pdf = Buffer.from(bytes).toString("latin1");
  const cmaps = cmapsOf(pdf);
  const out: string[] = [];
  for (const [, hex] of pdf.matchAll(/<([0-9a-f]+)> Tj/gi)) {
    const gids = hex.toLowerCase().match(/.{4}/g) ?? [];
    for (const cmap of cmaps) out.push(gids.map((g) => cmap.get(g) ?? "�").join(""));
  }
  return out;
};

beforeEach(() => resetCertificateFontCache());
afterEach(() => jest.restoreAllMocks());

describe("renderCertificatePdf with the embedded Unicode font", () => {
  it("fetches the two self-hosted weights, embeds them, and prints non-Latin-1 names exactly", async () => {
    const fetchSpy = serveFontsFromDisk();
    const bytes = await renderCertificatePdf(doc());
    const pdf = Buffer.from(bytes).toString("latin1");

    expect(fetchSpy.mock.calls.map(([url]) => url).sort()).toEqual(
      [CERTIFICATE_FONT_URLS.bold, CERTIFICATE_FONT_URLS.normal].sort(),
    );
    expect(pdf).toContain("/FontName /NotoSans");
    expect(pdf.match(/\/FontFile2 /g)).toHaveLength(2);

    const texts = printedTexts(bytes);
    for (const printed of [
      "Bệnh viện Đà Nẵng", // Vietnamese (Latin Extended Additional)
      "Máy thở",
      "SN-Ø-17",
      "Dräger",
      "Đặng Văn Hùng",
      "Łukasz Wróblewski", // Latin Extended-A
      "Zoë Brontë",
      "Αλέξανδρος · Анна Петрова · Şükrü Öztürk", // Greek, Cyrillic, Turkish
      "CERT-20260930-UNI-0001",
      "CALIBRATION CERTIFICATE",
      "DIGITALLY SIGNED - 2026-09-02",
    ]) {
      expect({ printed, found: texts.includes(printed) }).toEqual({ printed, found: true });
    }
  });

  it("degrades what the font does not cover: CJK and Arabic become '?', a compatibility form folds to its letter", async () => {
    serveFontsFromDisk();
    const texts = printedTexts(await renderCertificatePdf(doc()));
    expect(texts).toContain("??? 23 °C");
    expect(texts).toContain("????? AB");
  });

  it("keeps the integrity hash exactly as the server gave it (the hash is over data, not bytes)", async () => {
    serveFontsFromDisk();
    const pdf = Buffer.from(await renderCertificatePdf(doc())).toString("latin1");
    // The hash is drawn in Courier, a standard font, as a literal string.
    expect(pdf).toContain(`(${HASH}) Tj`);
  });

  it("fetches the font once for several PDFs", async () => {
    const fetchSpy = serveFontsFromDisk();
    await renderCertificatePdf(doc());
    await renderCertificatePdf(doc());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("still renders, in Helvetica with Latin-1 folding, when the font cannot be fetched — and retries next time", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(new Response("gone", { status: 404 }));
    const pdf = Buffer.from(await renderCertificatePdf(doc())).toString("latin1");
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).not.toContain("/FontFile2");
    // What every certificate printed before the font: "Đ" and "Ł" have no
    // decomposition, so Latin-1 folding can only print "?".
    expect(pdf).toContain("(?ang Van Hung) Tj");
    expect(pdf).toContain("(?ukasz Wroblewski) Tj");
    expect(pdf).toContain("(Zoe Bronte) Tj");

    fetchSpy.mockImplementation(async (url) => new Response(readFileSync(path.join(PUBLIC, String(url)))));
    const again = Buffer.from(await renderCertificatePdf(doc())).toString("latin1");
    expect(again).toContain("/FontFile2");
  });
});

describe("pdfUnicodeText", () => {
  const latinOnly = (cp: number) => cp < 0x250;

  it("prints an empty value as a dash", () => {
    expect(pdfUnicodeText(null, latinOnly)).toBe("-");
    expect(pdfUnicodeText(undefined, latinOnly)).toBe("-");
    expect(pdfUnicodeText("", latinOnly)).toBe("-");
  });

  it("composes to NFC first, keeps line breaks, and folds or replaces what is not covered", () => {
    expect(pdfUnicodeText("Zoë", latinOnly)).toBe("Zoë");
    expect(pdfUnicodeText("a\nb", (cp) => cp !== 10 && cp < 0x80)).toBe("a\nb");
    expect(pdfUnicodeText("ặ", latinOnly)).toBe("a"); // not covered here: its base letter
    expect(pdfUnicodeText("🙂 ok", latinOnly)).toBe("? ok"); // astral, no base letter
  });
});

describe("codeMapOf", () => {
  it("reads jsPDF's parsed cmap, and refuses any other shape", () => {
    const codeMap = { 65: 36 };
    expect(codeMapOf({ metadata: { cmap: { unicode: { codeMap } } } })).toBe(codeMap);
    for (const shape of [
      null,
      "font",
      {},
      { metadata: null },
      { metadata: {} },
      { metadata: { cmap: null } },
      { metadata: { cmap: {} } },
      { metadata: { cmap: { unicode: null } } },
      { metadata: { cmap: { unicode: {} } } },
      { metadata: { cmap: { unicode: { codeMap: null } } } },
    ]) {
      expect(codeMapOf(shape)).toBeNull();
    }
  });
});
