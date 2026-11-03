/** @jest-environment jsdom */
/**
 * P21-15 (ADR-140; spec v2 § 5) — a calibration record's e-signatures: the applications listed, none
 * said; Sign as `performed` for the performer and `reviewed` for anyone else; ESIG_NONE explained with
 * the profile link; a reader without calibration write sees no Sign; a failed read is said; the
 * submit disabled while pending. The service is mocked.
 */
import React from "react";
import { TextEncoder } from "node:util";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

Object.defineProperty(globalThis, "TextEncoder", { value: TextEncoder, configurable: true, writable: true });
jest.mock("qrcode", () => ({ __esModule: true, default: { toDataURL: jest.fn(async () => "data:image/png;base64,UVI=") } }));
jest.mock("@/api/services/personalEsignature.service", () => ({
  personalEsignatureService: { recordApplications: jest.fn(), signRecord: jest.fn() },
}));

import { personalEsignatureService } from "@/api/services/personalEsignature.service";
import { RecordEsignaturesModal } from "../RecordEsignaturesModal";
import type { Calibration } from "@/api/services/calibration.service";

const service = personalEsignatureService as unknown as Record<"recordApplications" | "signRecord", jest.Mock>;
const RECORD = { id: "r1", performedBy: "u1" } as unknown as Calibration;
const APPLICATION = {
  id: "a1",
  documentType: "calibration_record",
  documentId: "r1",
  documentTitle: "Calibration record",
  meaning: "performed",
  signer: { name: "Teknisi Sintetis", role: null, organisation: null },
  specimenSvg: "<svg></svg>",
  keyFingerprint: "f".repeat(64),
  contentScheme: "calrec-data-v1",
  contentHash: "a".repeat(64),
  authMethod: "password",
  signedAt: "2030-01-15T09:30:00.123Z",
  verifyUrl: "https://app.example.test/s/a1?t=x",
  integrity: "intact",
};

beforeEach(() => jest.resetAllMocks());

describe("P21-15 — the record's e-signatures", () => {
  it("the performer signs as performed: the attestation, the credential, the list refreshed", async () => {
    service.recordApplications.mockResolvedValueOnce([]).mockResolvedValueOnce([APPLICATION]);
    let release: (v: unknown) => void = () => undefined;
    service.signRecord.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    render(<RecordEsignaturesModal record={RECORD} currentUserId="u1" canSign onClose={jest.fn()} />);
    expect(await screen.findByText("No one has signed this record yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign as performed" }));
    expect(screen.getByText(/you performed this calibration/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Password *"), { target: { value: "synthetic-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Sign" }) as HTMLButtonElement).disabled).toBe(true));
    release(APPLICATION);
    expect(await screen.findByText("Teknisi Sintetis")).toBeTruthy();
    expect(service.signRecord).toHaveBeenCalledWith("r1", { meaning: "performed", authMethod: "password", credential: "synthetic-secret" });
  });

  it("anyone else signs as reviewed; ESIG_NONE is explained with the profile link; Cancel and close", async () => {
    service.recordApplications.mockResolvedValue([APPLICATION]);
    service.signRecord.mockRejectedValueOnce({ response: { status: 409, data: { code: "ESIG_NONE", message: "Create your e-signature first, in Profile → E-signature." } } });
    const onClose = jest.fn();
    render(<RecordEsignaturesModal record={RECORD} currentUserId="u2" canSign onClose={onClose} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign as reviewed" }));
    expect(screen.getByText(/you reviewed this calibration record/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Password *"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Create your e-signature first/);
    expect(screen.getByRole("link", { name: "Open my profile" }).getAttribute("href")).toBe("/dashboard/profile");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("a reader without calibration write sees no Sign; a failed read is said; no record, nothing open", async () => {
    service.recordApplications.mockRejectedValueOnce(new Error("Network down"));
    const { rerender } = render(<RecordEsignaturesModal record={RECORD} currentUserId={undefined} canSign={false} onClose={jest.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Network down");
    expect(screen.queryByRole("button", { name: /Sign as/ })).toBeNull();
    rerender(<RecordEsignaturesModal record={null} currentUserId={undefined} canSign={false} onClose={jest.fn()} />);
  });
});
