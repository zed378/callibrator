/** @jest-environment jsdom */
/**
 * P21-15 (ADR-140; spec v2 § 5) — Profile → E-signature: none yet → draw → preview → save with the
 * credential; the active one with its version and fingerprint, the earlier versions, Replace, Revoke
 * with a reason; a refusal shown as the backend's explanation; the save refused before a drawing; the
 * load error said. The service is mocked; the pad's drawing is real. axe.
 */
import React from "react";
import { TextEncoder } from "node:util";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

Object.defineProperty(globalThis, "TextEncoder", { value: TextEncoder, configurable: true, writable: true });
jest.mock("@/api/services/personalEsignature.service", () => ({
  personalEsignatureService: { mine: jest.fn(), save: jest.fn(), revoke: jest.fn() },
}));

import { personalEsignatureService } from "@/api/services/personalEsignature.service";
import { EsignatureSettings } from "../EsignatureSettings";

const service = personalEsignatureService as unknown as Record<"mine" | "save" | "revoke", jest.Mock>;
const SPECIMEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg>';
const ACTIVE = { id: "e1", version: 2, status: "active", specimenSvg: SPECIMEN, keyFingerprint: "ab".repeat(32), createdAt: "2030-01-10T08:00:00.000Z", supersededAt: null, revokedAt: null };
const OLD = { ...ACTIVE, id: "e0", version: 1, status: "superseded", supersededAt: "2030-01-10T08:00:00.000Z" };
const REVOKED = { ...ACTIVE, id: "e9", version: 3, status: "revoked", revokedAt: "2030-02-01T00:00:00.000Z" };

const draw = (): void => {
  const canvas = screen.getByRole("img", { name: /Signature drawing area/ });
  fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, pointerId: 1 });
  fireEvent.pointerMove(canvas, { clientX: 25, clientY: 15 });
  fireEvent.pointerUp(canvas);
};

beforeEach(() => jest.resetAllMocks());

describe("P21-15 — Profile → E-signature", () => {
  it("none yet: create — a drawing is required, previewed, then saved with the credential; axe", async () => {
    service.mine.mockResolvedValueOnce({ active: null, history: [] }).mockResolvedValueOnce({ active: ACTIVE, history: [] });
    service.save.mockResolvedValueOnce(ACTIVE);
    const { container } = render(<EsignatureSettings />);
    expect(await screen.findByText("You have no e-signature yet.")).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Create my e-signature" }));
    fireEvent.change(screen.getByLabelText("Password *"), { target: { value: "synthetic-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save e-signature" }));
    expect(screen.getByRole("alert").textContent).toBe("Draw or upload your signature first.");
    draw();
    expect(screen.getByRole("img", { name: "Preview of your e-signature" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save e-signature" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Your e-signature is saved."));
    expect(service.save).toHaveBeenCalledWith({ specimenSvg: expect.stringContaining("<path d=") as unknown, authMethod: "password", credential: "synthetic-secret" });
    expect(screen.getByText("ab".repeat(32))).toBeTruthy();
  });

  it("a refused save shows the backend's explanation; Cancel goes back", async () => {
    service.mine.mockResolvedValueOnce({ active: ACTIVE, history: [OLD, REVOKED] });
    service.save.mockRejectedValueOnce({ response: { status: 401, data: { message: "Invalid password for e-signature." } } });
    render(<EsignatureSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    draw();
    fireEvent.change(screen.getByLabelText("Password *"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Save e-signature" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Invalid password for e-signature."));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Earlier versions (2)")).toBeTruthy();
    expect(screen.getByText(/Version 1 · superseded on/)).toBeTruthy();
    expect(screen.getByText(/Version 3 · revoked on/)).toBeTruthy();
  });

  it("revoke with a reason and the credential; a refusal is shown; the load error is said", async () => {
    service.mine.mockResolvedValueOnce({ active: ACTIVE, history: [] }).mockResolvedValueOnce({ active: null, history: [REVOKED] });
    service.revoke.mockRejectedValueOnce({ response: { status: 409, data: { code: "ESIG_NONE", message: "Create your e-signature first, in Profile → E-signature." } } }).mockResolvedValueOnce(REVOKED);
    render(<EsignatureSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    fireEvent.change(screen.getByLabelText("Reason *"), { target: { value: "Lost my laptop" } });
    fireEvent.change(screen.getByLabelText("Password *"), { target: { value: "synthetic-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Revoke e-signature" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Create your e-signature first/));
    fireEvent.click(screen.getByRole("button", { name: "Revoke e-signature" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/revoked/));
    expect(service.revoke).toHaveBeenLastCalledWith({ authMethod: "password", credential: "synthetic-secret", reason: "Lost my laptop" });
    fireEvent.click(screen.getByRole("button", { name: "Create my e-signature" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });

  it("a failed read is said, not an empty state", async () => {
    service.mine.mockRejectedValueOnce(new Error("Network down"));
    render(<EsignatureSettings />);
    expect((await screen.findByRole("alert")).textContent).toBe("Network down");
    expect(screen.queryByText("You have no e-signature yet.")).toBeNull();
  });
});
