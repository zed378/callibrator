/** @jest-environment jsdom */
/**
 * P21-15 (ADR-140; spec v2 § 5) — the shared e-signature pieces: the specimen as an image data URI,
 * the API error's code and explanation, the credential fields, an application's card (integrity, the
 * verify link, the QR drawn in the browser), and the signature pad (strokes to `<path>` SVG the
 * backend's allow-list accepts, an uploaded PNG/JPEG embedded as one data-URI `<image>`, the upload's
 * type and size refused before anything is sent, Clear). Real: the contracts' allow-list. axe.
 */
import React from "react";
import { TextEncoder } from "node:util";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { specimenProblem } from "@callibrator/contracts/esignatures";
import { axeViolations } from "@/tests/a11y/axe";

Object.defineProperty(globalThis, "TextEncoder", { value: TextEncoder, configurable: true, writable: true });
jest.mock("qrcode", () => ({ __esModule: true, default: { toDataURL: jest.fn(async () => "data:image/png;base64,UVI=") } }));

import QRCode from "qrcode";
import { ApplicationCard, CredentialFields, EMPTY_CREDENTIAL, SpecimenImage, VerifyQr, apiError, specimenSrc } from "../esignatureUi";
import { MAX_UPLOAD_BYTES, SignaturePad, imageToSvg, strokesToSvg } from "../SignaturePad";
import type { EsignatureApplication } from "@/api/services/personalEsignature.service";

const SPECIMEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg>';
const APPLICATION: EsignatureApplication = {
  id: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a",
  documentType: "calibration_record",
  documentId: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
  documentTitle: "Calibration record",
  meaning: "performed",
  signer: { name: "Teknisi Sintetis", role: "TECHNICIAN", organisation: null },
  specimenSvg: SPECIMEN,
  keyFingerprint: "f".repeat(64),
  contentScheme: "calrec-data-v1",
  contentHash: "a".repeat(64),
  authMethod: "password",
  signedAt: "2030-01-15T09:30:00.123Z",
  verifyUrl: "https://app.example.test/s/1?t=x",
  integrity: "intact",
};

describe("the shared pieces", () => {
  it("specimenSrc: a base64 data URI of the UTF-8 SVG; SpecimenImage renders nothing for an empty specimen", () => {
    expect(specimenSrc("<svg>é</svg>")).toBe(`data:image/svg+xml;base64,${Buffer.from("<svg>é</svg>").toString("base64")}`);
    const { container } = render(<SpecimenImage svg="" alt="x" />);
    expect(container.innerHTML).toBe("");
  });

  it("apiError: the backend's code and explanation; an Error's message; a fallback", () => {
    expect(apiError({ response: { status: 409, data: { code: "ESIG_NONE", message: "Create your e-signature first." } } })).toEqual({ status: 409, code: "ESIG_NONE", message: "Create your e-signature first." });
    expect(apiError(new Error("network"))).toEqual({ status: null, code: null, message: "network" });
    expect(apiError(null)).toEqual({ status: null, code: null, message: "The request failed." });
  });

  it("CredentialFields: a password by default, an authenticator code for MFA; never autocompleted", () => {
    const onChange = jest.fn();
    const { rerender } = render(<CredentialFields value={EMPTY_CREDENTIAL} onChange={onChange} idPrefix="t" />);
    const field = screen.getByLabelText("Password *");
    expect([field.getAttribute("type"), field.getAttribute("autocomplete")]).toEqual(["password", "off"]);
    fireEvent.change(field, { target: { value: "secret" } });
    expect(onChange).toHaveBeenCalledWith({ authMethod: "password", credential: "secret" });
    rerender(<CredentialFields value={{ authMethod: "mfa", credential: "" }} onChange={onChange} idPrefix="t" />);
    expect(screen.getByLabelText("Authenticator code *").getAttribute("inputmode")).toBe("numeric");
  });

  it("ApplicationCard: the specimen, who, what, when, integrity, the verify link and its QR; axe", async () => {
    const { container, rerender } = render(<ul><ApplicationCard application={APPLICATION} /></ul>);
    expect(screen.getByRole("img", { name: "E-signature of Teknisi Sintetis" })).toBeTruthy();
    expect(screen.getByText("Content unchanged since signing")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Verify this signature/ }).getAttribute("href")).toBe(APPLICATION.verifyUrl);
    await waitFor(() => expect(screen.getByRole("img", { name: "Verification QR for Teknisi Sintetis's signature" })).toBeTruthy());
    expect(await axeViolations(container)).toEqual([]);
    rerender(<ul><ApplicationCard application={{ ...APPLICATION, integrity: "changed", meaning: "acknowledged" }} /></ul>);
    expect(screen.getByText("Content changed since signing")).toBeTruthy();
    rerender(<ul><ApplicationCard application={{ ...APPLICATION, integrity: null, meaning: "other" as never }} /></ul>);
    expect(screen.queryByText(/since signing/)).toBeNull();
  });

  it("VerifyQr: no QR when the library fails (the link still works)", async () => {
    (QRCode.toDataURL as jest.Mock).mockRejectedValueOnce(new Error("no canvas"));
    const { container, unmount } = render(<VerifyQr url="https://x.test" label="QR" />);
    await act(async () => undefined);
    expect(container.innerHTML).toBe("");
    unmount();
  });
});

describe("the signature pad", () => {
  it("strokes become path-only SVG the allow-list accepts; a single tap is a dot; an empty stroke is dropped", () => {
    const svg = strokesToSvg([[[1.234, 2], [3, 4]], [[5, 6]], []]);
    expect(svg).toContain('<path d="M1.2 2 L3 4"/>');
    expect(svg).toContain('<path d="M5 6 L5 6"/>');
    expect(specimenProblem(svg)).toBeNull();
    expect(specimenProblem(imageToSvg("data:image/png;base64,iVBORw0KGgo="))).toBeNull();
  });

  it("drawing hands the parent the SVG; Clear hands it null", () => {
    const onChange = jest.fn();
    render(<SignaturePad onChange={onChange} />);
    const canvas = screen.getByRole("img", { name: /Signature drawing area/ });
    fireEvent.pointerMove(canvas, { clientX: 1, clientY: 1 });
    fireEvent.pointerUp(canvas);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 15 });
    fireEvent.pointerUp(canvas);
    expect(String(onChange.mock.calls[0]?.[0])).toMatch(/^<svg .*<path d="M/);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("an upload: PNG or JPEG only, at most 180 KB, embedded as a data-URI image", async () => {
    const onChange = jest.fn();
    render(<SignaturePad onChange={onChange} />);
    const input = screen.getByLabelText("Upload an image");
    fireEvent.change(input, { target: { files: [new File(["x"], "a.gif", { type: "image/gif" })] } });
    expect(screen.getByRole("alert").textContent).toBe("Choose a PNG or JPEG image.");
    const big = new File(["x"], "a.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: MAX_UPLOAD_BYTES + 1 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(screen.getByRole("alert").textContent).toBe("The image is larger than 180 KB.");
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([137, 80, 78, 71])], "a.png", { type: "image/png" })] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.stringContaining('<image href="data:image/png;base64,')));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(input, { target: { files: [] } });
  });
});
