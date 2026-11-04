/** @jest-environment node */
/**
 * P21-15 (ADR-140 § 6) — the certificate renderer places each affixed e-signature in its signature
 * block: the specimen (rasterised in the browser), the role and e-signing date under the name, and the
 * mark's own verification QR. A block without one prints exactly as before. A REAL PDF (jsPDF, node
 * build): printed strings are visible as `(…) Tj` operands. The browser canvas is stubbed for the
 * rasteriser's own cases.
 */
import QRCode from "qrcode";
import { marksForBlocks, rasterizeSpecimen, renderCertificatePdf, type CertificateEsignatureMark } from "./certificatePdf";
import type { CertificateDocument } from "@/api/services/calibration.service";

const doc: CertificateDocument = {
  certificateNumber: "CERT-1",
  type: "calibration",
  status: "signed",
  issuedBy: "Lab Sintetis",
  device: { name: "Pump", serialNumber: "SN-1", manufacturer: "M", model: "P" },
  standard: "ISO 17025",
  issueDate: "2026-09-01T00:00:00.000Z",
  validUntil: "2027-09-01T00:00:00.000Z",
  summary: "OK",
  conditions: "23 C",
  notes: "",
  calibratedBy: "Ani Putri",
  approvedBy: "Budi Santoso",
  signedBy: "Citra Dewi",
  signedAt: "2026-09-02T08:00:00.000Z",
  verifyUrl: "https://kalibrasi.example/verify/CERT-1",
  integrity: { scheme: "certificate-content-v3", algorithm: "SHA-256", hash: "3f".repeat(32), legacyHash: "aa".repeat(32) },
} as CertificateDocument;

const mark = (meaning: string, name: string, n: number): CertificateEsignatureMark => ({
  meaning,
  name,
  role: "TEKNISI",
  organisation: null,
  signedAt: `2026-09-0${String(n)}T08:00:00.000Z`,
  specimenSvg: "<svg/>",
  verifyUrl: `https://kalibrasi.example/s/${String(n)}?t=x`,
});

const latin1 = (bytes: ArrayBuffer): string => Buffer.from(bytes).toString("latin1");

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as Record<string, unknown>)["Image"];
  delete (globalThis as Record<string, unknown>)["document"];
});

describe("marksForBlocks", () => {
  it("Calibrated By takes the performed mark; Approved By and Signed By the approved marks by name, else in order; none is null", () => {
    const performed = mark("performed", "Ani Putri", 1);
    const approver = mark("approved", "Budi Santoso", 2);
    const signer = mark("approved", "Citra Dewi", 3);
    expect(marksForBlocks(doc, [signer, approver, performed])).toEqual([performed, approver, signer]);
    const a = mark("approved", "Someone", 4);
    const b = mark("approved", "Else", 5);
    expect(marksForBlocks(doc, [a, b])).toEqual([null, a, b]);
    expect(marksForBlocks({ calibratedBy: null, approvedBy: null, signedBy: null } as never, [a])).toEqual([null, a, null]);
    expect(marksForBlocks(doc, [])).toEqual([null, null, null]);
  });
});

describe("renderCertificatePdf with e-signatures", () => {
  it("each mark's QR and its role and date are printed; without a canvas the specimen is left out, never a failure", async () => {
    const qr = jest.spyOn(QRCode, "toDataURL");
    const pdf = latin1(await renderCertificatePdf(doc, [mark("performed", "Ani Putri", 1), mark("approved", "Budi Santoso", 2)]));
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(qr).toHaveBeenCalledWith("https://kalibrasi.example/s/1?t=x", expect.objectContaining({ width: 96 }));
    expect(qr).toHaveBeenCalledWith("https://kalibrasi.example/s/2?t=x", expect.objectContaining({ width: 96 }));
    expect(pdf).toContain("(TEKNISI · e-signed 2026-09-01)");
    expect(pdf).toContain("(TEKNISI · e-signed 2026-09-02)");
  });

  it("without marks the blocks print as before: one QR (the certificate's), no e-signing line", async () => {
    const qr = jest.spyOn(QRCode, "toDataURL");
    const pdf = latin1(await renderCertificatePdf(doc));
    expect(qr).toHaveBeenCalledTimes(1);
    expect(pdf).not.toContain("e-signed");
  });

  it("with a canvas, the specimen is drawn as a PNG in its block; a mark with no role prints its date alone", async () => {
    stubCanvas({ draw: true });
    const pdf = latin1(await renderCertificatePdf(doc, [{ ...mark("performed", "Ani Putri", 1), role: null }]));
    expect(pdf.match(/\(([^()]*e-signed[^()]*)\)/)?.[1]).toBe("e-signed 2026-09-01");
    expect(pdf).toMatch(/\/Subtype \/Image/);
  });
});

interface Stub {
  draw?: boolean;
  noContext?: boolean;
  fail?: boolean;
  throwOnDraw?: boolean;
  throwOnCreate?: boolean;
}

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function stubCanvas(stub: Stub): void {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      if (stub.throwOnCreate) throw new Error("no");
      setTimeout(() => (stub.fail ? this.onerror?.() : this.onload?.()), 0);
    }
  }
  (globalThis as Record<string, unknown>)["Image"] = FakeImage;
  (globalThis as Record<string, unknown>)["document"] = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () =>
        stub.noContext
          ? null
          : {
              drawImage: () => {
                if (stub.throwOnDraw) throw new Error("tainted");
              },
            },
      toDataURL: () => PNG,
    }),
  };
}

describe("rasterizeSpecimen", () => {
  it("a PNG data URL from the canvas; null without a context, on a decode error, on a draw error, or with no Image at all", async () => {
    stubCanvas({ draw: true });
    expect(await rasterizeSpecimen("<svg/>")).toBe(PNG);
    stubCanvas({ noContext: true });
    expect(await rasterizeSpecimen("<svg/>")).toBeNull();
    stubCanvas({ fail: true });
    expect(await rasterizeSpecimen("<svg/>")).toBeNull();
    stubCanvas({ throwOnDraw: true });
    expect(await rasterizeSpecimen("<svg/>")).toBeNull();
    stubCanvas({ throwOnCreate: true });
    expect(await rasterizeSpecimen("<svg/>")).toBeNull();
    delete (globalThis as Record<string, unknown>)["Image"];
    expect(await rasterizeSpecimen("<svg/>")).toBeNull();
  });
});
