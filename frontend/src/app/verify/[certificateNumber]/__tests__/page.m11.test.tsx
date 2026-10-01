/** @jest-environment jsdom */
/**
 * M-11 (ADR-095) — the public verification page renders a signed
 * certificate's PDF in the browser from the published `document`, and shows
 * the v2 integrity hash that PDF prints beside the v1 hash earlier PDFs print.
 *
 * Fixtures are the backend's real shape (certificatePdf.service
 * #verifyByCertificateNumber): `document` is present only for a signed,
 * non-withdrawn certificate.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useParams: () => ({ certificateNumber: "CERT-100" }),
  // A-293: the QR code\'s verification token (`t`); none here.
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("next/link", () => {
  return function Link({ children, href }: { children: React.ReactNode; href: string }) {
    return <a href={href}>{children}</a>;
  };
});
jest.mock("@/components/motion/AuroraBackground", () => {
  return function AuroraBackground() {
    return null;
  };
});
const mockDownload = jest.fn();
jest.mock("@/lib/certificatePdf", () => ({
  downloadCertificatePdf: (...args: unknown[]) => mockDownload(...args),
}));

// P10-08: the client content moved out of the (now server) page.
import CertificateVerifyPage from "../VerifyContent";

const V2 = "c2".repeat(32);
const V1 = "c1".repeat(32);
const integrity = { scheme: "certificate-content-v2", algorithm: "SHA-256", hash: V2, legacyHash: V1 };
const document = {
  certificateNumber: "CERT-100",
  type: "calibration",
  status: "signed",
  issuedBy: "RS Harapan",
  device: { name: "Infusion pump", serialNumber: "SN-9", manufacturer: "B", model: "M" },
  standard: "ISO 17025",
  issueDate: "2026-09-01T00:00:00.000Z",
  validUntil: "2099-09-01T00:00:00.000Z",
  summary: "ok",
  conditions: null,
  notes: null,
  calibratedBy: "Ani",
  approvedBy: "Budi",
  signedBy: "Citra",
  signedAt: "2026-09-02T00:00:00.000Z",
  verifyUrl: "https://kalibrasi.example/verify/CERT-100",
  integrity,
};

const serve = (data: Record<string, unknown>) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      status: 200,
      data: {
        found: true,
        valid: true,
        status: "signed",
        revoked: false,
        expired: false,
        withdrawn: false,
        certificateNumber: "CERT-100",
        type: "calibration",
        integrityHash: V1,
        integrity,
        verifyUrl: "https://kalibrasi.example/verify/CERT-100",
        documentUrl: null,
        ...data,
      },
    }),
  }) as unknown as typeof fetch;
};

describe("certificate verification page — the PDF is rendered in the browser (M-11)", () => {
  beforeEach(() => mockDownload.mockReset());

  it("offers the signed certificate's PDF and renders it from the published document", async () => {
    serve({ document });
    render(<CertificateVerifyPage />);

    const button = await screen.findByRole("button", { name: "Download certificate PDF" });
    mockDownload.mockResolvedValueOnce(undefined);
    fireEvent.click(button);

    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith(document));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when the PDF cannot be generated", async () => {
    serve({ document });
    render(<CertificateVerifyPage />);

    mockDownload.mockRejectedValueOnce(new Error("no canvas"));
    fireEvent.click(await screen.findByRole("button", { name: "Download certificate PDF" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The PDF could not be generated");
  });

  it("shows the v2 hash the PDF prints, and the v1 hash earlier documents print", async () => {
    serve({ document });
    render(<CertificateVerifyPage />);

    expect(await screen.findByText(V2)).toBeInTheDocument();
    expect(screen.getByText("Integrity hash (SHA-256, certificate-content-v2)")).toBeInTheDocument();
    expect(screen.getByText(V1)).toBeInTheDocument();
    expect(
      screen.getByText("Integrity hash on documents issued before 29 Sep 2026 (SHA-256)"),
    ).toBeInTheDocument();
  });

  it("offers no PDF when nothing is published (revoked, withdrawn, unsigned)", async () => {
    serve({ valid: false, status: "revoked", revoked: true, document: null });
    render(<CertificateVerifyPage />);

    expect(await screen.findByText("REVOKED")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download certificate PDF" })).not.toBeInTheDocument();
  });

  it("keeps showing a PDF stored at issue, framed, beside the rendered one", async () => {
    serve({ document, documentUrl: "/api/v1/certificates/verify/CERT-100/document?token=1.x" });
    render(<CertificateVerifyPage />);

    expect(await screen.findByText("Document stored at issue")).toBeInTheDocument();
    expect(screen.getByTitle("Certificate CERT-100")).toHaveAttribute(
      "src",
      "/api/v1/certificates/verify/CERT-100/document?token=1.x",
    );
  });
});
