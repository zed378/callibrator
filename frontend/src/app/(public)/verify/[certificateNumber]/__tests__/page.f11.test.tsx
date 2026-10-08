/** @jest-environment jsdom */
/**
 * F-11 — the public verification page's PDF link.
 *
 * The backend's `documentUrl` is already a same-origin API path
 * (certificatePdf.service.js mintDocumentUrl:
 * `/api/v1/certificates/verify/<n>/document?token=…`), which the browser
 * reaches through the Next `/api` proxy. The page prefixed
 * NEXT_PUBLIC_API_BASE_URL onto it, sending an auditor's browser to the
 * backend origin — unpublished on the documented deployment, so the link was
 * dead there.
 */
import { render, screen } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useParams: () => ({ certificateNumber: "CERT-011" }),
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

// P10-08: the client content moved out of the (now server) page.
import CertificateVerifyPage from "../VerifyContent";

const DOCUMENT_PATH =
  "/api/v1/certificates/verify/CERT-011/document?token=1790000000.abcdef";

const verifyData = (overrides: Record<string, unknown>) => ({
  found: true,
  valid: true,
  status: "signed",
  revoked: false,
  expired: false,
  withdrawn: false,
  certificateNumber: "CERT-011",
  type: "calibration",
  standard: null,
  issuedTo: "Test Hospital",
  device: null,
  issueDate: "2026-01-01T00:00:00.000Z",
  validUntil: "2099-01-01T00:00:00.000Z",
  signedBy: "QA Manager",
  signedAt: "2026-01-02T00:00:00.000Z",
  integrityHash: "cd".repeat(32),
  verifyUrl: "https://example.test/verify/CERT-011",
  documentUrl: DOCUMENT_PATH,
  ...overrides,
});

const serve = (data: unknown) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, status: 200, data }),
  }) as unknown as typeof fetch;
};

describe("certificate verification page — the PDF link (F-11)", () => {
  it("links and frames the document at the same-origin path the backend issued, unprefixed", async () => {
    serve(verifyData({}));
    render(<CertificateVerifyPage />);

    const link = await screen.findByRole("link", { name: /open pdf/i });
    expect(link.getAttribute("href")).toBe(DOCUMENT_PATH);
    expect(screen.getByTitle("Certificate CERT-011").getAttribute("src")).toBe(DOCUMENT_PATH);
  });

  it("reduces an absolute backend URL to its same-origin API path", async () => {
    serve(verifyData({ documentUrl: `http://backend:3000${DOCUMENT_PATH}` }));
    render(<CertificateVerifyPage />);

    const link = await screen.findByRole("link", { name: /open pdf/i });
    expect(link.getAttribute("href")).toBe(DOCUMENT_PATH);
  });

  it("renders no document link for a value that is not an API path", async () => {
    serve(verifyData({ documentUrl: "https://elsewhere.example/cert.pdf" }));
    render(<CertificateVerifyPage />);

    expect(await screen.findByText("Details")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open pdf/i })).not.toBeInTheDocument();
  });
});
