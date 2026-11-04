/** @jest-environment jsdom */
/**
 * P21-15 (ADR-140 § 6) — the certificates table's PDF puts the affixed e-signatures in the signature
 * blocks (each application as a mark); when none can be read the PDF is rendered as before. The
 * E-signatures action opens the certificate's e-signatures.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Certificate } from "@/api/services/calibration.service";

const mockGetDocument = jest.fn();
jest.mock("@/api/services/calibration.service", () => ({
  calibrationService: { getCertificateDocument: (...a: unknown[]) => mockGetDocument(...a) },
}));
const mockDownload = jest.fn();
jest.mock("@/lib/certificatePdf", () => ({
  downloadCertificatePdf: (...a: unknown[]) => mockDownload(...a),
}));
const mockToast = jest.fn();
jest.mock("@/stores/toastStore", () => ({
  useToastStore: () => ({ addToast: mockToast }),
}));

const mockApplications = jest.fn();
jest.mock("@/api/services/personalEsignature.service", () => ({
  personalEsignatureService: { certificateApplications: (...a: unknown[]) => mockApplications(...a) },
}));

import { CertificatesTable } from "../CertificatesTable";

const cert = {
  id: "5a0e8400-e29b-41d4-a716-446655440050",
  tenantId: "t",
  deviceId: "d",
  certificateNumber: "CERT-20260929-RSH-0001",
  type: "calibration",
  status: "signed",
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
} as Certificate;

const renderTable = () =>
  render(
    <CertificatesTable
      certificates={{ success: true, data: [cert], meta: { page: 1, limit: 10, totalPages: 1, total: 1 } }}
      isCalibLoading={false}
      pageSize={10}
      onPageChange={jest.fn()}
      hasWriteAccess={false}
      openApproveModal={jest.fn()}
      openSignModal={jest.fn()}
      openRevokeModal={jest.fn()}
      openEsignatures={mockOpen}
    />,
  );
const mockOpen = jest.fn();

describe("CertificatesTable — the affixed e-signatures (P21-15)", () => {
  beforeEach(() => {
    mockGetDocument.mockReset();
    mockDownload.mockReset();
    mockApplications.mockReset();
  });

  it("each application becomes a mark in the PDF; the E-signatures action opens the certificate", async () => {
    const document = { certificateNumber: cert.certificateNumber };
    mockGetDocument.mockResolvedValueOnce(document);
    mockApplications.mockResolvedValueOnce([
      { meaning: "approved", signer: { name: "Budi", role: "ADMIN", organisation: null }, signedAt: "2030-01-15T09:30:00.123Z", specimenSvg: "<svg/>", verifyUrl: "https://x.test/s/1?t=a" },
    ]);
    mockDownload.mockResolvedValueOnce(undefined);
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Download PDF of certificate CERT-20260929-RSH-0001" }));
    await waitFor(() =>
      expect(mockDownload).toHaveBeenCalledWith(document, [
        { meaning: "approved", name: "Budi", role: "ADMIN", organisation: null, signedAt: "2030-01-15T09:30:00.123Z", specimenSvg: "<svg/>", verifyUrl: "https://x.test/s/1?t=a" },
      ]),
    );
    fireEvent.click(screen.getByRole("button", { name: "E-signatures" }));
    expect(mockOpen).toHaveBeenCalledWith(cert);
  });

  it("when the e-signatures cannot be read, the PDF is rendered as before", async () => {
    const document = { certificateNumber: cert.certificateNumber };
    mockGetDocument.mockResolvedValueOnce(document);
    mockApplications.mockRejectedValueOnce(new Error("down"));
    mockDownload.mockResolvedValueOnce(undefined);
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Download PDF of certificate CERT-20260929-RSH-0001" }));
    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith(document));
  });
});