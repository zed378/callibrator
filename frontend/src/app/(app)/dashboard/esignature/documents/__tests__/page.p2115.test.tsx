/** @jest-environment jsdom */
/**
 * P21-15 (ADR-140; spec v2 § 5) — Sign a document: the file hashed IN THE BROWSER (never uploaded),
 * the title taken from its name, a meaning, the credential; the signature sheet with the link, QR and
 * Print; what I have signed; a refusal shown as its explanation; a browser that cannot hash said.
 * Real: WebCrypto (node's). Mocked: the services, the layout, the QR.
 */
import React from "react";
import { webcrypto, createHash } from "node:crypto";
import { TextEncoder } from "node:util";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

Object.defineProperty(globalThis, "TextEncoder", { value: TextEncoder, configurable: true, writable: true });
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true, writable: true });
jest.mock("qrcode", () => ({ __esModule: true, default: { toDataURL: jest.fn(async () => "data:image/png;base64,UVI=") } }));
jest.mock("@/components/layouts/DashboardLayout", () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock("@/api/services/personalEsignature.service", () => ({ personalEsignatureService: { signDocument: jest.fn() } }));
jest.mock("@/api/typed", () => ({ typedApi: { GET: jest.fn() }, unwrap: (r: { data: unknown }) => r.data }));

import { personalEsignatureService } from "@/api/services/personalEsignature.service";
import { typedApi } from "@/api/typed";
import SignDocumentPage from "../page";

const sign = personalEsignatureService.signDocument as jest.Mock;
const list = typedApi.GET as unknown as jest.Mock;
const BYTES = new TextEncoder().encode("synthetic document");
const HASH = createHash("sha256").update(BYTES).digest("hex");
const APPLICATION = {
  id: "a1",
  documentType: "document",
  documentId: null,
  documentTitle: "Laporan.pdf",
  meaning: "authored",
  signer: { name: "Teknisi Sintetis", role: null, organisation: null },
  specimenSvg: "<svg></svg>",
  keyFingerprint: "f".repeat(64),
  contentScheme: "file-sha256",
  contentHash: HASH,
  authMethod: "password",
  signedAt: "2030-01-15T09:30:00.123Z",
  verifyUrl: "https://app.example.test/s/a1?t=x",
  integrity: null,
};

const pick = (file: File): void => {
  Object.defineProperty(file, "arrayBuffer", { value: async () => BYTES.buffer });
  fireEvent.change(screen.getByLabelText("File"), { target: { files: [file] } });
};

beforeEach(() => {
  jest.resetAllMocks();
  window.print = jest.fn();
});

describe("P21-15 — Sign a document", () => {
  it("hashes in the browser, signs the hash with the title and meaning, shows the sheet, refreshes what I signed", async () => {
    list.mockResolvedValueOnce({ data: { data: [] } }).mockResolvedValueOnce({ data: { data: [APPLICATION] } });
    sign.mockResolvedValueOnce(APPLICATION);
    render(<SignDocumentPage />);
    expect(await screen.findByText("Nothing yet.")).toBeTruthy();
    pick(new File([BYTES], "Laporan.pdf"));
    expect(await screen.findByText(new RegExp(`SHA-256: ${HASH}`))).toBeTruthy();
    expect((screen.getByLabelText("Title *") as HTMLInputElement).value).toBe("Laporan.pdf");
    fireEvent.change(screen.getByLabelText("Password *"), { target: { value: "synthetic-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    expect(await screen.findByRole("heading", { name: "Signature sheet — Laporan.pdf" })).toBeTruthy();
    expect(sign).toHaveBeenCalledWith({ title: "Laporan.pdf", contentHash: HASH, sizeBytes: BYTES.length, meaning: "authored", authMethod: "password", credential: "synthetic-secret" });
    fireEvent.click(screen.getByRole("button", { name: /Print the signature sheet/ }));
    expect(window.print).toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByText("Teknisi Sintetis").length).toBe(2));
  });

  it("a refusal is its explanation; a failed list is an empty one; no file chosen does nothing; a browser that cannot hash is said", async () => {
    list.mockRejectedValue(new Error("down"));
    sign.mockRejectedValueOnce({ response: { status: 409, data: { code: "ESIG_NONE", message: "Create your e-signature first, in Profile → E-signature." } } });
    render(<SignDocumentPage />);
    fireEvent.change(screen.getByLabelText("File"), { target: { files: [] } });
    pick(new File([BYTES], "a.txt"));
    await screen.findByText(new RegExp(HASH));
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Edited" } });
    fireEvent.change(screen.getByLabelText("Password *"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Create your e-signature first/);
    const broken = new File([BYTES], "b.txt");
    Object.defineProperty(broken, "arrayBuffer", { value: async () => Promise.reject(new Error("no")) });
    fireEvent.change(screen.getByLabelText("File"), { target: { files: [broken] } });
    expect((await screen.findByRole("alert")).textContent).toBe("This browser cannot compute the file's hash.");
  });
});
