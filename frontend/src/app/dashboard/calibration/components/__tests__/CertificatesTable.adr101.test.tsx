/** @jest-environment jsdom */
/**
 * F2 / ADR-101 — the certificate row actions follow the backend state machine
 * (certificate.service TRANSITION_REFUSALS) and separation of duties:
 *
 *   draft             → Submit for approval (never Approve: the backend 409s)
 *   pending_approval  → Approve, unless the signed-in user drafted or
 *                       submitted it — then Approve is disabled and the rule
 *                       is explained next to it
 *   approved          → E-Sign
 *   any but revoked   → Revoke
 *
 * Fail-before: the table offered Approve on a DRAFT, had no Submit action and
 * nothing at all on pending_approval, so the certificate could not be
 * completed from the UI.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Certificate } from "@/api/services/calibration.service";

jest.mock("@/api/services/calibration.service", () => ({
  calibrationService: { getCertificateDocument: jest.fn() },
}));
jest.mock("@/lib/certificatePdf", () => ({ downloadCertificatePdf: jest.fn() }));
jest.mock("@/stores/toastStore", () => ({ useToastStore: () => ({ addToast: jest.fn() }) }));

import { CertificatesTable } from "../CertificatesTable";

const ME = "11111111-1111-4111-8111-111111111111";
const SOMEONE = "22222222-2222-4222-8222-222222222222";

const make = (status: Certificate["status"], extra: Partial<Certificate> = {}): Certificate =>
  ({
    id: `id-${status}`,
    tenantId: "t",
    deviceId: "d",
    certificateNumber: `CERT-${status}`,
    type: "calibration",
    status,
    createdBy: SOMEONE,
    submittedBy: SOMEONE,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    ...extra,
  }) as Certificate;

const handlers = () => ({
  onSubmitCertificate: jest.fn(),
  openApproveModal: jest.fn(),
  openSignModal: jest.fn(),
  openRevokeModal: jest.fn(),
});

const renderRow = (cert: Certificate, h = handlers(), hasWriteAccess = true) => {
  render(
    <CertificatesTable
      certificates={{ success: true, data: [cert], meta: { page: 1, limit: 10, totalPages: 1, total: 1 } }}
      isCalibLoading={false}
      pageSize={10}
      onPageChange={jest.fn()}
      hasWriteAccess={hasWriteAccess}
      currentUserId={ME}
      {...h}
    />,
  );
  return h;
};

const button = (name: RegExp) => screen.queryByRole("button", { name });

describe("CertificatesTable — actions follow the state machine (F2)", () => {
  it("a draft offers Submit for approval, and no Approve", () => {
    const cert = make("draft");
    const h = renderRow(cert);
    expect(button(/^approve/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Submit certificate ${cert.certificateNumber} for approval` }));
    expect(h.onSubmitCertificate).toHaveBeenCalledWith(cert);
    expect(button(/revoke/i)).not.toBeNull();
  });

  it("a certificate pending approval offers Approve to another user", () => {
    const cert = make("pending_approval");
    const h = renderRow(cert);
    const approve = screen.getByRole("button", { name: `Approve certificate ${cert.certificateNumber}` });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    expect(h.openApproveModal).toHaveBeenCalledWith(cert);
    expect(button(/submit/i)).toBeNull();
    expect(button(/e-sign/i)).toBeNull();
  });

  it.each([
    ["drafted", { createdBy: ME }],
    ["submitted", { submittedBy: ME }],
  ])("ADR-101: the user who %s it cannot approve it — disabled, with the reason", (_how, authorship) => {
    const cert = make("pending_approval", authorship);
    const h = renderRow(cert);
    const approve = screen.getByRole("button", { name: /^approve$/i });
    expect(approve).toBeDisabled();
    const reason = document.getElementById(approve.getAttribute("aria-describedby") ?? "");
    expect(reason).not.toBeNull();
    expect(reason?.textContent).toMatch(/another user must approve it/i);
    expect(reason?.textContent).toMatch(/separation of duties/i);
    fireEvent.click(approve);
    expect(h.openApproveModal).not.toHaveBeenCalled();
  });

  it("an approved certificate offers E-Sign and Revoke, not Approve", () => {
    renderRow(make("approved"));
    expect(button(/e-sign/i)).not.toBeNull();
    expect(button(/revoke/i)).not.toBeNull();
    expect(button(/^approve/i)).toBeNull();
  });

  it("a revoked certificate offers no transition", () => {
    renderRow(make("revoked"));
    const row = screen.getByText("CERT-revoked").closest("tr") as HTMLElement;
    expect(within(row).queryByRole("button", { name: /^(submit|approve|e-sign|revoke)/i })).toBeNull();
  });

  it("without `certificate` write, no transition is offered at all", () => {
    renderRow(make("pending_approval"), handlers(), false);
    expect(button(/^approve/i)).toBeNull();
    expect(button(/revoke/i)).toBeNull();
  });
});
