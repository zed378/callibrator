/** @jest-environment jsdom */
/**
 * M-11 (ADR-095) — the certificates table's PDF button fetches the
 * certificate DOCUMENT from the backend (GET /certificates/:id/document) and
 * renders the PDF in the browser from it; it no longer renders from the list
 * row, which carries neither the verification URL nor the integrity hash.
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
    />,
  );

describe("CertificatesTable — PDF (M-11)", () => {
  beforeEach(() => {
    mockGetDocument.mockReset();
    mockDownload.mockReset();
    mockToast.mockReset();
  });

  it("renders the PDF from the backend's document for that certificate", async () => {
    const document = { certificateNumber: cert.certificateNumber, integrity: { hash: "h" } };
    mockGetDocument.mockResolvedValueOnce(document);
    mockDownload.mockResolvedValueOnce(undefined);
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Download PDF of certificate CERT-20260929-RSH-0001" }));

    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith(document));
    expect(mockGetDocument).toHaveBeenCalledWith(cert.id);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("reports a failure (the document could not be fetched) and renders nothing", async () => {
    mockGetDocument.mockRejectedValueOnce(new Error("Certificate not found"));
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Download PDF of certificate CERT-20260929-RSH-0001" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({ type: "error", title: "Certificate not found" }),
    );
    expect(mockDownload).not.toHaveBeenCalled();
  });
});
