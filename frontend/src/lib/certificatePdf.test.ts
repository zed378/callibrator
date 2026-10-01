/** @jest-environment node */
/**
 * M-11 (ADR-095) — the certificate PDF is rendered in the browser from the
 * backend's certificate DOCUMENT. These render a REAL PDF with jsPDF (the node
 * build: this file runs in the node environment) and read the bytes back:
 * jsPDF writes uncompressed content streams, so every printed string is
 * visible in the file as a `(…) Tj` operand.
 */
import QRCode from "qrcode";
import {
  certificatePdfFileName,
  pdfDate,
  pdfText,
  renderCertificatePdf,
} from "./certificatePdf";
import type { CertificateDocument } from "@/api/services/calibration.service";

const HASH = "3f".repeat(32);

const doc = (over: Partial<CertificateDocument> = {}): CertificateDocument => ({
  certificateNumber: "CERT-20260929-RSH-0001",
  type: "calibration",
  status: "signed",
  issuedBy: "RS Harapan Kita",
  device: { name: "Infusion pump", serialNumber: "SN-4471", manufacturer: "B. Braun", model: "Perfusor" },
  standard: "ISO 17025",
  issueDate: "2026-09-01T00:00:00.000Z",
  validUntil: "2027-09-01T00:00:00.000Z",
  summary: "All points within tolerance",
  conditions: "23 C, 45 % RH",
  notes: "Re-verified after repair",
  calibratedBy: "Ani Putri",
  approvedBy: "Budi Santoso",
  signedBy: "Citra Dewi",
  signedAt: "2026-09-02T08:00:00.000Z",
  verifyUrl: "https://kalibrasi.example/verify/CERT-20260929-RSH-0001",
  integrity: {
    scheme: "certificate-content-v2",
    algorithm: "SHA-256",
    hash: HASH,
    legacyHash: "aa".repeat(32),
  },
  ...over,
});

const latin1 = (bytes: ArrayBuffer): string => Buffer.from(bytes).toString("latin1");

describe("renderCertificatePdf (M-11)", () => {
  it("produces a real PDF", async () => {
    const pdf = latin1(await renderCertificatePdf(doc()));
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("prints every certificate field, the verification URL and the v2 integrity hash", async () => {
    const pdf = latin1(await renderCertificatePdf(doc()));
    for (const printed of [
      "RS Harapan Kita",
      "CALIBRATION CERTIFICATE",
      "CERT-20260929-RSH-0001",
      "Infusion pump",
      "SN-4471",
      "B. Braun",
      "Perfusor",
      "ISO 17025",
      "2026-09-01",
      "2027-09-01",
      "All points within tolerance",
      "23 C, 45 % RH",
      "Re-verified after repair",
      "Ani Putri",
      "Budi Santoso",
      "Citra Dewi",
      "DIGITALLY SIGNED - 2026-09-02",
      "https://kalibrasi.example/verify/CERT-20260929-RSH-0001",
      HASH,
    ]) {
      expect({ printed, found: pdf.includes(`(${printed})`) }).toEqual({ printed, found: true });
    }
    // Parentheses inside a PDF string are escaped.
    expect(pdf).toContain(String.raw`(Integrity \(certificate-content-v2, SHA-256\):)`);
  });

  it("embeds the QR code of the server's verification URL as an image", async () => {
    const qr = jest.spyOn(QRCode, "toDataURL");
    const pdf = latin1(await renderCertificatePdf(doc()));
    expect(qr).toHaveBeenCalledWith(
      "https://kalibrasi.example/verify/CERT-20260929-RSH-0001",
      expect.objectContaining({ margin: 1, width: 240 }),
    );
    expect(pdf).toMatch(/\/Subtype \/Image/);
    // …and draws it on the page.
    expect(pdf).toMatch(/\/I\d+ Do/);
  });

  it("A-293: the QR carries the server's verifyUrl verbatim, verification token included", async () => {
    const tokened = "https://kalibrasi.example/verify/CERT-20260929-RSH-0001?t=Zq3v8Xr1TtY0bN4kLmP2sW9aE6hJcF5u";
    const qr = jest.spyOn(QRCode, "toDataURL");
    await renderCertificatePdf(doc({ verifyUrl: tokened }));
    expect(qr).toHaveBeenCalledWith(tokened, expect.objectContaining({ margin: 1, width: 240 }));
  });

  it("puts no watermark on a signed certificate", async () => {
    const pdf = latin1(await renderCertificatePdf(doc()));
    // The only "SIGNED" is the status pill, drawn upright.
    expect(pdf.match(/\(SIGNED\) Tj/g)).toHaveLength(1);
  });

  it.each([
    ["draft", "DRAFT"],
    ["pending_approval", "PENDING APPROVAL"],
    ["approved", "APPROVED"],
    ["revoked", "REVOKED"],
  ])("watermarks a %s certificate (%s twice: the watermark and the pill)", async (status, label) => {
    const pdf = latin1(await renderCertificatePdf(doc({ status })));
    expect(pdf.split(`(${label}) Tj`).length - 1).toBe(2);
  });

  it("prints no signer before signing", async () => {
    const pdf = latin1(await renderCertificatePdf(doc({ status: "approved", signedBy: null, signedAt: null })));
    expect(pdf).toContain("(SIGNED BY) Tj");
    expect(pdf).not.toContain("(Citra Dewi)");
  });

  it("renders a sparse document with placeholders instead of failing", async () => {
    const pdf = latin1(
      await renderCertificatePdf(
        doc({
          status: "unknown_state",
          issuedBy: null,
          device: null,
          standard: null,
          issueDate: null,
          validUntil: null,
          summary: null,
          conditions: null,
          notes: null,
          calibratedBy: null,
          approvedBy: null,
        }),
      ),
    );
    expect(pdf).toContain("(Calibration laboratory)");
    expect(pdf).toContain("(UNKNOWN_STATE)");
  });
});

describe("pdfText / pdfDate / certificatePdfFileName", () => {
  it("prints an empty value as a dash", () => {
    expect(pdfText(null)).toBe("-");
    expect(pdfText(undefined)).toBe("-");
    expect(pdfText("")).toBe("-");
  });

  it("folds accents and typographic punctuation, and never prints a character outside Latin-1", () => {
    expect(pdfText("Rumah Sakit Cipto Mangunkusumo — Ruang “Élite” ’24")).toBe(
      'Rumah Sakit Cipto Mangunkusumo - Ruang "Elite" \'24',
    );
    expect(pdfText("温度 ok")).toBe("?? ok");
    expect(pdfText("line one\nline two")).toBe("line one\nline two");
  });

  it("prints dates as yyyy-mm-dd", () => {
    expect(pdfDate("2026-09-01T23:30:00.000Z")).toBe("2026-09-01");
    expect(pdfDate(null)).toBe("-");
  });

  it("saves under the certificate number, made safe for a file name", () => {
    expect(certificatePdfFileName("CERT-20260929-RSH-0001")).toBe("CERT-20260929-RSH-0001.pdf");
    expect(certificatePdfFileName("CERT/../x y")).toBe("CERT_.._x_y.pdf");
  });
});
