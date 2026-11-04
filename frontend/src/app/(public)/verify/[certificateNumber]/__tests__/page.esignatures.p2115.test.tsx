/** @jest-environment jsdom */
/**
 * P21-15 (ADR-140 § 6) — the certificate's public verification links to the personal e-signatures
 * affixed to it (full verdict only), and hands them to the renderer so each lands in its signature
 * block. The certificate's own verdict does not change. Fixtures follow the backend's shape
 * (certificatePdf.service#verifyByCertificateNumber).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useParams: () => ({ certificateNumber: "CERT-100" }),
  useSearchParams: () => new URLSearchParams("t=token"),
}));
const mockDownload = jest.fn();
jest.mock("@/lib/certificatePdf", () => ({
  downloadCertificatePdf: (...args: unknown[]) => mockDownload(...args),
}));

import CertificateVerifyPage from "../VerifyContent";

const integrity = { scheme: "certificate-content-v3", algorithm: "SHA-256", hash: "c2".repeat(32), legacyHash: "c1".repeat(32) };
const document = { certificateNumber: "CERT-100", status: "signed", calibratedBy: "Ani", approvedBy: "Budi", signedBy: "Citra", verifyUrl: "https://x.test/verify/CERT-100", integrity };
const MARKS = [
  { meaning: "performed", name: "Ani", role: "TEKNISI", organisation: null, signedAt: "2026-09-01T08:00:00.000Z", specimenSvg: "<svg/>", verifyUrl: "https://x.test/s/1?t=a" },
  { meaning: "approved", name: "Budi", role: null, organisation: null, signedAt: "2026-09-02T08:00:00.000Z", specimenSvg: "<svg/>", verifyUrl: "https://x.test/s/2?t=b" },
];

const serve = (data: Record<string, unknown>) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      data: { found: true, valid: true, disclosure: "full", status: "signed", certificateNumber: "CERT-100", type: "calibration", integrity, ...data },
    }),
  }) as unknown as typeof fetch;
};

describe("P21-15 — /verify links the affixed e-signatures and renders them in the PDF", () => {
  beforeEach(() => mockDownload.mockReset());

  it("lists each e-signature with its meaning, signer, date and the link to its own verification", async () => {
    serve({ document, esignatures: MARKS });
    render(<CertificateVerifyPage />);
    const links = await screen.findAllByRole("link", { name: /Verify this e-signature/ });
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://x.test/s/1?t=a", "https://x.test/s/2?t=b"]);
    expect(screen.getByRole("heading", { name: "E-signatures" })).toBeInTheDocument();
    expect(screen.getByText(/\(TEKNISI\)/)).toBeInTheDocument();
  });

  it("the download hands the marks to the renderer", async () => {
    serve({ document, esignatures: MARKS });
    render(<CertificateVerifyPage />);
    mockDownload.mockResolvedValueOnce(undefined);
    fireEvent.click(await screen.findByRole("button", { name: "Download certificate PDF" }));
    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith(document, MARKS));
  });

  it("no e-signatures (or the minimal verdict): no section, and the download is called as before", async () => {
    serve({ document, esignatures: [] });
    render(<CertificateVerifyPage />);
    mockDownload.mockResolvedValueOnce(undefined);
    fireEvent.click(await screen.findByRole("button", { name: "Download certificate PDF" }));
    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith(document));
    expect(screen.queryByRole("heading", { name: "E-signatures" })).not.toBeInTheDocument();
  });
});
