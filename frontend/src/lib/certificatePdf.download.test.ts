/** @jest-environment jsdom */
/**
 * M-11 (ADR-095) — the rendered certificate reaches the user as a Blob
 * download named after the certificate number. The renderer itself is proven
 * against real jsPDF in certificatePdf.test.ts; here jsPDF and qrcode are
 * doubled so only the hand-off to the browser is under test.
 */
import type { CertificateDocument } from "@/api/services/calibration.service";

jest.mock("jspdf", () => {
  class FakePdf {
    internal = { pageSize: { getWidth: () => 595 } };
    splitTextToSize = (t: string) => [t];
    getTextWidth = () => 10;
    output = () => Uint8Array.from([0x25, 0x50, 0x44, 0x46]).buffer;
  }
  return {
    jsPDF: new Proxy(FakePdf, {
      construct(Target) {
        const instance = new Target() as unknown as Record<string, unknown>;
        return new Proxy(instance, {
          get: (obj, key: string) => (key in obj ? obj[key] : () => undefined),
        });
      },
    }),
  };
});
jest.mock("qrcode", () => ({
  __esModule: true,
  default: { toDataURL: jest.fn().mockResolvedValue("data:image/png;base64,AAAA") },
}));

import { BLOB_URL_LIFETIME_MS, downloadCertificatePdf } from "./certificatePdf";

const doc = {
  certificateNumber: "CERT/2026 0001",
  type: "calibration",
  status: "signed",
  verifyUrl: "https://kalibrasi.example/verify/x",
  integrity: { scheme: "certificate-content-v2", algorithm: "SHA-256", hash: "ab", legacyHash: "cd" },
} as unknown as CertificateDocument;

describe("downloadCertificatePdf (M-11)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.assign(URL, {
      createObjectURL: jest.fn(() => "blob:certificate"),
      revokeObjectURL: jest.fn(),
    });
  });
  afterEach(() => jest.useRealTimers());

  it("clicks a download link for a PDF Blob, named after the certificate number, then releases it a minute later", async () => {
    const clicked: { href: string; download: string }[] = [];
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download });
    });

    await downloadCertificatePdf(doc);

    const blob = (URL.createObjectURL as jest.Mock).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/pdf");
    expect(clicked).toEqual([{ href: "blob:certificate", download: "CERT_2026_0001.pdf" }]);
    expect(document.querySelector("a[download]")).toBeNull();
    // Still readable after the click returns — a download manager or viewer reads it later.
    jest.advanceTimersByTime(BLOB_URL_LIFETIME_MS - 1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:certificate");
  });
});
