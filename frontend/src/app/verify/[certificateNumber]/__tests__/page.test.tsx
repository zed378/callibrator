/** @jest-environment jsdom */
/**
 * A-130 (F-11, ADR-051 A-107) — the public verification page reports a
 * withdrawn (soft-deleted) certificate as withdrawn, not as "not found".
 *
 * The fixtures are the backend's real shape: certificatePdf.service
 * #verifyByCertificateNumber answers `{ success, status, data }` with `data`
 * `{ found, valid, status, revoked, expired, withdrawn, ..., documentUrl }`;
 * a deleted certificate is read with `paranoid: false`, never valid, and its
 * document is not published (documentUrl null).
 */
import { render, screen } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useParams: () => ({ certificateNumber: "CERT-009" }),
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

import CertificateVerifyPage from "../page";

const verifyData = (overrides: Record<string, unknown>) => ({
  found: true,
  valid: false,
  status: "revoked",
  revoked: true,
  expired: false,
  withdrawn: true,
  certificateNumber: "CERT-009",
  type: "calibration",
  standard: null,
  issuedTo: "Test Hospital",
  device: null,
  issueDate: "2025-01-01T00:00:00.000Z",
  validUntil: "2099-01-01T00:00:00.000Z",
  signedBy: null,
  signedAt: null,
  integrityHash: "ab".repeat(32),
  verifyUrl: "https://example.test/verify/CERT-009",
  documentUrl: null,
  ...overrides,
});

const serve = (data: unknown) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, status: 200, data }),
  }) as unknown as typeof fetch;
};

describe("certificate verification page — withdrawn certificates (A-130)", () => {
  it("a deleted REVOKED certificate still reads as revoked", async () => {
    serve(verifyData({}));
    render(<CertificateVerifyPage />);

    expect(await screen.findByText("Certificate revoked")).toBeInTheDocument();
    expect(screen.queryByText("Certificate not found")).not.toBeInTheDocument();
  });

  it("a deleted certificate that was not revoked reads as withdrawn — never as not found or valid", async () => {
    serve(verifyData({ status: "approved", revoked: false }));
    render(<CertificateVerifyPage />);

    expect(await screen.findByText("Certificate withdrawn")).toBeInTheDocument();
    expect(
      screen.getByText("This certificate was withdrawn by the issuer and is no longer valid."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Certificate not found")).not.toBeInTheDocument();
    expect(screen.queryByText("Certificate is valid")).not.toBeInTheDocument();
  });
});
