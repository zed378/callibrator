/** @jest-environment node */
/**
 * A-303 — the certificate PDF prints the issuing laboratory's address and
 * contact under its name (ISO/IEC 17025 7.8.2), from the document's `issuer`.
 *
 * REAL jsPDF, read back from the bytes: in the Helvetica fallback (fetch fails)
 * every string is a `(…) Tj` literal; with the embedded Unicode font a string
 * is a glyph run decoded through the PDF's own ToUnicode CMaps (the
 * certificatePdf.unicode.test.ts method).
 *
 * The integrity hash printed is the server's, untouched: the issuer is a live
 * tenant row and is not hashed (backend certificateDocument.service).
 */
import { readFileSync } from "fs";
import path from "path";
import { CONTENT_AS_OF_SIGNING, issuerLines, renderCertificatePdf, resetCertificateFontCache } from "./certificatePdf";
import type { CertificateDocument, CertificateIssuer } from "@/api/services/calibration.service";

const PUBLIC = path.join(__dirname, "../../public");
const HASH = "7c".repeat(32);

const ISSUER: CertificateIssuer = {
  name: "Lab Kalibrasi Sehat",
  email: "lab@sehat.example.id",
  phone: "+62 21-555 0100",
  address: "Jl. Kesehatan No. 10",
  city: "Jakarta Pusat",
  state: "DKI Jakarta",
  zipCode: "10110",
  country: "Indonesia",
  website: "https://sehat.example.id",
};

const doc = (over: Partial<CertificateDocument> = {}): CertificateDocument => ({
  certificateNumber: "CERT-20260930-LKS-0001",
  type: "calibration",
  status: "signed",
  issuedBy: ISSUER.name,
  issuer: ISSUER,
  device: { name: "Infusion pump", serialNumber: "SN-1", manufacturer: "B. Braun", model: "Perfusor" },
  standard: "ISO 17025",
  issueDate: "2026-09-01T00:00:00.000Z",
  validUntil: "2027-09-01T00:00:00.000Z",
  summary: null,
  conditions: null,
  notes: null,
  calibratedBy: "Ani Putri",
  approvedBy: "Budi Santoso",
  signedBy: "Citra Dewi",
  signedAt: "2026-09-02T08:00:00.000Z",
  verifyUrl: "https://kalibrasi.example/verify/CERT-20260930-LKS-0001",
  integrity: { scheme: "certificate-content-v2", algorithm: "SHA-256", hash: HASH, legacyHash: "aa".repeat(32) },
  ...over,
});

const ADDRESS_LINE = "Jl. Kesehatan No. 10, Jakarta Pusat, DKI Jakarta 10110, Indonesia";
const CONTACT_LINE = "Tel. +62 21-555 0100 | lab@sehat.example.id | https://sehat.example.id";

const latin1 = (bytes: ArrayBuffer): string => Buffer.from(bytes).toString("latin1");

/** Every hex-string Tj operand, decoded through every ToUnicode CMap in the PDF. */
const printedTexts = (bytes: ArrayBuffer): string[] => {
  const pdf = latin1(bytes);
  const cmaps = [...pdf.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)].map((block) => {
    const map = new Map<string, string>();
    for (const [, gid, uni] of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
      const units = uni.match(/.{4}/g) ?? [];
      map.set(gid.toLowerCase(), String.fromCharCode(...units.map((u) => parseInt(u, 16))));
    }
    return map;
  });
  const out: string[] = [];
  for (const [, hex] of pdf.matchAll(/<([0-9a-f]+)> Tj/gi)) {
    const gids = hex.toLowerCase().match(/.{4}/g) ?? [];
    for (const cmap of cmaps) out.push(gids.map((g) => cmap.get(g) ?? "?").join(""));
  }
  return out;
};

beforeEach(() => resetCertificateFontCache());
afterEach(() => jest.restoreAllMocks());

describe("issuerLines (A-303)", () => {
  it("joins the address parts and the contact parts, skipping what is empty", () => {
    expect(issuerLines(ISSUER)).toEqual([ADDRESS_LINE, CONTACT_LINE]);
    expect(issuerLines({ ...ISSUER, state: null, zipCode: "", phone: null, website: null })).toEqual([
      "Jl. Kesehatan No. 10, Jakarta Pusat, Indonesia",
      "lab@sehat.example.id",
    ]);
    expect(issuerLines({ ...ISSUER, state: "", zipCode: "10110" })[0]).toBe("Jl. Kesehatan No. 10, Jakarta Pusat, 10110, Indonesia");
  });

  it("is empty for no issuer, or an issuer with nothing but a name", () => {
    expect(issuerLines(null)).toEqual([]);
    expect(issuerLines(undefined)).toEqual([]);
    expect(
      issuerLines({ name: "Lab", email: null, phone: null, address: null, city: null, state: null, zipCode: null, country: null, website: null }),
    ).toEqual([]);
  });
});

describe("renderCertificatePdf prints the issuer (A-303)", () => {
  it("Helvetica fallback: the address and contact lines under the name, the tagline replaced, the hash untouched", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    const pdf = latin1(await renderCertificatePdf(doc()));
    expect(pdf).toContain(`(${ADDRESS_LINE}) Tj`);
    expect(pdf).toContain(`(${CONTACT_LINE}) Tj`);
    expect(pdf).toContain(`(${ISSUER.name}) Tj`);
    expect(pdf).not.toContain("(CALIBRATION MANAGEMENT SYSTEM) Tj");
    expect(pdf).toContain(`(${HASH})`);
  });

  it("keeps the tagline when the document has no issuer block (an older backend) or nothing to print", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    const older: CertificateDocument = doc();
    delete older.issuer;
    expect(latin1(await renderCertificatePdf(older))).toContain("(CALIBRATION MANAGEMENT SYSTEM) Tj");
    expect(latin1(await renderCertificatePdf(doc({ issuer: null })))).toContain("(CALIBRATION MANAGEMENT SYSTEM) Tj");
  });

  it("embedded Unicode font: a non-Latin-1 address prints exactly", async () => {
    jest
      .spyOn(global, "fetch")
      .mockImplementation(async (url) => new Response(readFileSync(path.join(PUBLIC, String(url)))));
    const texts = printedTexts(
      await renderCertificatePdf(doc({ issuer: { ...ISSUER, address: "Đường Lê Lợi 12", city: "Đà Nẵng", state: null, zipCode: null, country: "Việt Nam" } })),
    );
    expect(texts).toContain("Đường Lê Lợi 12, Đà Nẵng, Việt Nam");
    expect(texts).toContain(CONTACT_LINE);
  });
});

describe("a long issuer line (A-303)", () => {
  it("is set smaller instead of wrapping into the rule, and still printed whole", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    const long = "Jl. Prof. Dr. H. M. Husni Thamrin Kav. 28-30";
    const pdf = latin1(await renderCertificatePdf(doc({ issuer: { ...ISSUER, address: long } })));
    const line = `${long}, Jakarta Pusat, DKI Jakarta 10110, Indonesia`;
    expect(pdf).toContain(`(${line}) Tj`);
    // Set below 8 pt, not at the default size.
    const before = pdf.slice(0, pdf.indexOf(`(${line}) Tj`));
    const lastSize = [...before.matchAll(/\/F\d+ ([\d.]+) Tf/g)].pop()?.[1];
    expect(Number(lastSize)).toBeLessThan(8);
    expect(Number(lastSize)).toBeGreaterThanOrEqual(6);
  });
});

describe("ADR-107: a certificate printed from its signing snapshot", () => {
  it("says so under the integrity hash, and prints the v3 scheme the server gave", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    const pdf = latin1(
      await renderCertificatePdf(
        doc({ contentAsOf: "signing", integrity: { scheme: "certificate-content-v3", algorithm: "SHA-256", hash: HASH, legacyHash: "aa".repeat(32) } }),
      ),
    );
    expect(pdf).toContain(`(${CONTENT_AS_OF_SIGNING}) Tj`);
    expect(pdf).toContain(String.raw`(Integrity \(certificate-content-v3, SHA-256\):)`);
  });

  it("a live (draft or pre-ADR-107) certificate carries no such line", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    expect(latin1(await renderCertificatePdf(doc({ contentAsOf: "live" })))).not.toContain(CONTENT_AS_OF_SIGNING);
    expect(latin1(await renderCertificatePdf(doc()))).not.toContain(CONTENT_AS_OF_SIGNING);
  });
});
