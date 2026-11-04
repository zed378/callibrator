/** @jest-environment jsdom */
/**
 * P21-15 (ADR-140 § 6; spec v2 § 5) — a certificate's e-signatures: the applications listed, none said;
 * Sign as `performed` for the calibrator and `approved` for the approver or signer; anyone else sees
 * no Sign; ESIG_NONE explained with the profile link; a failed read is said. The service is mocked.
 */
import React from "react";
import { TextEncoder } from "node:util";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

Object.defineProperty(globalThis, "TextEncoder", { value: TextEncoder, configurable: true, writable: true });
jest.mock("qrcode", () => ({ __esModule: true, default: { toDataURL: jest.fn(async () => "data:image/png;base64,UVI=") } }));
jest.mock("@/api/services/personalEsignature.service", () => ({
  personalEsignatureService: { certificateApplications: jest.fn(), signCertificate: jest.fn() },
}));

import { personalEsignatureService } from "@/api/services/personalEsignature.service";
import { CertificateEsignaturesModal } from "../CertificateEsignaturesModal";
import type { Certificate } from "@/api/services/calibration.service";

const service = personalEsignatureService as unknown as Record<"certificateApplications" | "signCertificate", jest.Mock>;
const CERT = { id: "c1", calibratedBy: "u1", approvedBy: "u2", signedBy: "u3" } as unknown as Certificate;
const APPLICATION = {
  id: "a1",
  documentType: "certificate",
  documentId: "c1",
  documentTitle: "Certificate C-1",
  meaning: "approved",
  signer: { name: "Penyetuju Sintetis", role: null, organisation: null },
  specimenSvg: "<svg></svg>",
  keyFingerprint: "f".repeat(64),
  contentScheme: "cert-data-v1",
  contentHash: "a".repeat(64),
  authMethod: "password",
  signedAt: "2030-01-15T09:30:00.123Z",
  verifyUrl: "https://app.example.test/s/a1?t=x",
  integrity: "intact",
};

beforeEach(() => jest.resetAllMocks());

describe("P21-15 — the certificate's e-signatures", () => {
  it.each([
    ["u1", "performed", /you performed the calibration/],
    ["u2", "approved", /you approved this certificate/],
    ["u3", "approved", /you approved this certificate/],
  ])("user %s signs as %s, the list refreshed", async (user, meaning, attestation) => {
    service.certificateApplications.mockResolvedValueOnce([]).mockResolvedValueOnce([APPLICATION]);
    service.signCertificate.mockResolvedValueOnce(APPLICATION);
    render(<CertificateEsignaturesModal certificate={CERT} currentUserId={user} canSign onClose={jest.fn()} />);
    expect(await screen.findByText("No e-signature is affixed to this certificate yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Sign as ${meaning}` }));
    expect(screen.getByText(attestation)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Password *"), { target: { value: "synthetic-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    expect(await screen.findByText("Penyetuju Sintetis")).toBeTruthy();
    expect(service.signCertificate).toHaveBeenCalledWith("c1", { meaning, authMethod: "password", credential: "synthetic-secret" });
  });

  it("anyone else sees no Sign; ESIG_NONE is explained; a failed read is said; no certificate, nothing open", async () => {
    service.certificateApplications.mockResolvedValueOnce([APPLICATION]);
    const { rerender } = render(<CertificateEsignaturesModal certificate={CERT} currentUserId="u9" canSign onClose={jest.fn()} />);
    expect(await screen.findByText("Penyetuju Sintetis")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sign as/ })).toBeNull();
    service.certificateApplications.mockResolvedValueOnce([]);
    service.signCertificate.mockRejectedValueOnce({ response: { status: 409, data: { code: "ESIG_NONE", message: "Create your e-signature first, in Profile → E-signature." } } });
    rerender(<CertificateEsignaturesModal certificate={{ ...CERT, id: "c2" } as Certificate} currentUserId="u1" canSign onClose={jest.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign as performed" }));
    fireEvent.change(screen.getByLabelText("Password *"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Create your e-signature first/);
    expect(screen.getByRole("link", { name: "Open my profile" })).toBeTruthy();
    service.certificateApplications.mockRejectedValueOnce(new Error("Network down"));
    rerender(<CertificateEsignaturesModal certificate={{ ...CERT, id: "c3" } as Certificate} currentUserId={undefined} canSign onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByText("Network down")).toBeTruthy());
    rerender(<CertificateEsignaturesModal certificate={null} currentUserId={undefined} canSign={false} onClose={jest.fn()} />);
  });
});
