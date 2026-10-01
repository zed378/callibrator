/** @jest-environment jsdom */
/**
 * A-293 (ADR-100) — the verification page forwards the certificate's
 * verification token and renders both verdicts.
 *
 * The QR code on a certificate encodes `<CERT_VERIFY_BASE_URL>/<number>?t=<token>`.
 * The page reads `t` and calls GET /api/v1/certificates/verify/<number>?token=<t>.
 * With the right token the backend answers the FULL verdict
 * (`disclosure: "full"`); with none or a wrong one the MINIMAL verdict
 * (`disclosure: "minimal"`) — no device, signer or document. The fixtures are
 * the backend's real shapes (certificatePdf.service#verifyByCertificateNumber).
 */
import { render, screen } from "@testing-library/react";

let mockSearch = "";
jest.mock("next/navigation", () => ({
  useParams: () => ({ certificateNumber: "CERT-20260929-A293-0001" }),
  useSearchParams: () => new URLSearchParams(mockSearch),
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
jest.mock("@/lib/certificatePdf", () => ({ downloadCertificatePdf: jest.fn() }));

// P10-08: the client content moved out of the (now server) page.
import CertificateVerifyPage from "../VerifyContent";

const TOKEN = "Zq3v8Xr1TtY0bN4kLmP2sW9aE6hJcF5u";
const integrity = {
  scheme: "certificate-content-v2",
  algorithm: "SHA-256",
  hash: "c2".repeat(32),
  legacyHash: "c1".repeat(32),
};

const minimal = {
  found: true,
  valid: true,
  status: "signed",
  revoked: false,
  expired: false,
  withdrawn: false,
  certificateNumber: "CERT-20260929-A293-0001",
  type: "calibration",
  issuedTo: "RS Harapan",
  issueDate: "2026-09-01T00:00:00.000Z",
  validUntil: "2099-01-01T00:00:00.000Z",
  integrity,
  disclosure: "minimal",
};

const full = {
  ...minimal,
  disclosure: "full",
  standard: "ISO 17025",
  device: { name: "Defibrillator", serialNumber: "SN-SECRET" },
  signedBy: "Citra Dewi",
  signedAt: "2026-09-01T00:00:00.000Z",
  integrityHash: integrity.legacyHash,
  verifyUrl: `https://app.test/verify/CERT-20260929-A293-0001?t=${TOKEN}`,
  document: null,
  documentUrl: null,
};

const serve = (data: unknown) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, status: 200, data }),
  }) as unknown as typeof fetch;
};

beforeEach(() => {
  mockSearch = "";
});

describe("verification page — the verification token (A-293)", () => {
  it("forwards the QR code's `t` to the API as `token`", async () => {
    mockSearch = `t=${TOKEN}`;
    serve(full);
    render(<CertificateVerifyPage />);

    expect(await screen.findByText("VALID")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/v1/certificates/verify/CERT-20260929-A293-0001?token=${TOKEN}`,
    );
  });

  it("a bare number (an old QR code, or a typed number) calls the API without a token", async () => {
    serve(minimal);
    render(<CertificateVerifyPage />);

    expect(await screen.findByText("VALID")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith("/api/v1/certificates/verify/CERT-20260929-A293-0001");
  });

  it("renders the minimal verdict: status, issuer, dates and hashes, and says where the details are", async () => {
    serve(minimal);
    render(<CertificateVerifyPage />);

    expect(await screen.findByText("VALID")).toBeInTheDocument();
    expect(screen.getByText("RS Harapan")).toBeInTheDocument();
    expect(screen.getByText(integrity.hash)).toBeInTheDocument();
    // The legacy hash comes from `integrity` when no top-level integrityHash is sent.
    expect(screen.getByText(integrity.legacyHash)).toBeInTheDocument();
    expect(
      screen.getByText(/Scan the QR code on the certificate for the full details/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Device")).not.toBeInTheDocument();
    expect(screen.queryByText("Signed by")).not.toBeInTheDocument();
    expect(screen.queryByText("Standard")).not.toBeInTheDocument();
  });

  it("renders the full verdict as before, without the minimal note", async () => {
    mockSearch = `t=${TOKEN}`;
    serve(full);
    render(<CertificateVerifyPage />);

    expect(await screen.findByText("Defibrillator · SN SN-SECRET")).toBeInTheDocument();
    expect(screen.getByText("Citra Dewi")).toBeInTheDocument();
    expect(screen.queryByText(/Scan the QR code on the certificate for the full details/i)).not.toBeInTheDocument();
  });
});
