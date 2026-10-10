/** @jest-environment jsdom */
/**
 * P23-02 (P19-06 § 9.4) — the public IPM report verification. Real: the content, the contracts'
 * canonical payload and WebCrypto (node's). Mocked: `fetch`, the router hooks, the PDF download.
 *
 * Pins: the public endpoint asked with the token from `?t=` (and the token never printed); every
 * refusal one neutral "not found"; 429 / failure / no network said without the backend's words;
 * the three statuses with their words (superseded names the newer number, voided only its date);
 * the identity, signatures valid or not; the hash RECOMPUTED in the browser — matching, not matching,
 * or not possible; the PDF downloaded from the served document in the page's language; one h1; axe.
 */
import React from "react";
import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { canonicalIpmReportPayload, ipmReportPayloadOfDocument } from "@callibrator/contracts/ipmReport";
import { axeViolations } from "@/tests/a11y/axe";
import { ipmReportDoc } from "@/tests/support/ipmReportFixtures";

jest.mock("next/navigation", () => ({
  useParams: () => ({ reportNumber: "IPM-SC-20261010-007" }),
  useSearchParams: () => new URLSearchParams("t=SECRETTOKENSECRETTOKENSECRETTOK1"),
}));
jest.mock("@/lib/ipmReportDownload", () => ({ downloadIpmReportPdf: jest.fn(async () => undefined) }));

import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { id } from "@/i18n/messages/id";
import { downloadIpmReportPdf } from "@/lib/ipmReportDownload";
import { VerifyIpmContent, recomputeHash, sha256Hex } from "../VerifyIpmContent";

Object.defineProperty(globalThis, "TextEncoder", { value: TextEncoder, configurable: true, writable: true });
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true, writable: true });
const fetchMock = jest.fn();
Object.defineProperty(globalThis, "fetch", { value: fetchMock, configurable: true, writable: true });

const download = downloadIpmReportPdf as jest.Mock;
const document0 = ipmReportDoc({ verifyUrl: null });
const hashOf = async (doc: typeof document0) =>
  sha256Hex(canonicalIpmReportPayload(ipmReportPayloadOfDocument(doc as unknown as Parameters<typeof ipmReportPayloadOfDocument>[0])!));

const verdict = (over: Record<string, unknown> = {}, hash = "0".repeat(64)) => ({
  found: true,
  reportNumber: "IPM-SC-20261010-007",
  status: "issued",
  supersededBy: null,
  voidedAt: null,
  issuedAt: "2026-10-10T03:00:00.000Z",
  issuer: { name: "Synthetic Calibration Co" },
  facility: { name: "Synthetic Clinic" },
  device: { name: "Synthetic infusion pump", manufacturer: "Synthetic Make", model: "SP-1", serialNumber: "SN-0001", qrCode: "QR-000123" },
  visitNumber: 7,
  performedAt: "2026-10-10T02:00:00.000Z",
  recommendation: "needs_repair",
  signatures: document0.signatures,
  countersignEnabled: true,
  integrity: { scheme: "ipm-report-v1", hash, state: "match" },
  document: document0,
  ...over,
});

/** A fetch answer (jsdom has no Response). */
const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  fetchMock.mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: (k: string) => headers[k] ?? null } });

const renderPage = (locale: "en" | "id" = "en") =>
  render(
    <MessagesProvider locale={locale} messages={locale === "en" ? en : id}>
      <VerifyIpmContent pdfMessages={{ "ipmReport.title": "x" }} />
    </MessagesProvider>,
  );

afterEach(() => {
  fetchMock.mockReset();
  download.mockClear();
});

describe("P23-02 — the public IPM report verification", () => {
  it("issued: asked with the token, the identity and signatures, the hash recomputed and matching; the token never printed; axe-clean", async () => {
    respond(200, { data: verdict({}, await hashOf(document0)) });
    const { container } = renderPage();
    expect(await screen.findByText("Issued")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/ipm/verify/IPM-SC-20261010-007?token=SECRETTOKENSECRETTOKENSECRETTOK1");
    expect(screen.getByText("This IPM report was issued by Synthetic Calibration Co and is the current record of the visit.")).toBeInTheDocument();
    expect(screen.getByText("Synthetic infusion pump · Synthetic Make · SP-1 · SN SN-0001 · QR-000123")).toBeInTheDocument();
    expect(screen.getByText("The device must be repaired")).toBeInTheDocument();
    expect(screen.getByText(/Synthetic Technician \(HEALTHCARE TECHNICIAN\).*valid/)).toBeInTheDocument();
    expect(await screen.findByText("Recomputed in your browser: matches.")).toBeInTheDocument();
    expect(container.textContent).not.toContain("SECRETTOKEN");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Download the PDF" }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(document0, { messages: { "ipmReport.title": "x" }, language: "en", readerName: "Verification page" }));
  });

  it("superseded names the newer report; voided only its date; a hash that does not match is said", async () => {
    respond(200, { data: verdict({ status: "superseded", supersededBy: { reportNumber: "IPM-SC-20261011-002", at: "2026-10-11T02:00:00.000Z" } }) });
    const first = renderPage();
    expect(await screen.findByText("Superseded")).toBeInTheDocument();
    expect(screen.getByText("A newer version of this report exists (IPM-SC-20261011-002, 11 Oct 2026). Ask the facility for it.")).toBeInTheDocument();
    expect(await screen.findByText("Recomputed in your browser: does NOT match.")).toBeInTheDocument();
    first.unmount();
    respond(200, { data: verdict({ status: "voided", voidedAt: "2026-10-12T02:00:00.000Z", signatures: [{ ...document0.signatures[0]!, valid: false, role: null }], recommendation: null, visitNumber: null }) });
    renderPage();
    expect(await screen.findByText("This report was voided on 12 Oct 2026; the visit does not count.")).toBeInTheDocument();
    expect(screen.getByText(/does not match this content/)).toBeInTheDocument();
  });

  it("no signature; a download that fails; a preview document cannot be recomputed", async () => {
    download.mockRejectedValueOnce(new Error("x"));
    respond(200, { data: verdict({ signatures: [], document: { ...document0, reportNumber: null } }) });
    renderPage("id");
    expect(await screen.findByText("Tidak ada tanda tangan elektronik.")).toBeInTheDocument();
    expect(await screen.findByText("Peramban Anda tidak dapat menghitung ulang hash.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unduh PDF" }));
    expect(await screen.findByText("PDF tidak dapat dibuat.")).toBeInTheDocument();
    expect(await recomputeHash({ ...document0, reportNumber: null })).toBeNull();
  });

  it("every refusal is one neutral not found; rate limit, failure and no network said in the page's words", async () => {
    respond(404, { success: false, message: "No IPM report matches this link." });
    const a = renderPage();
    expect(await screen.findByText("Not found")).toBeInTheDocument();
    expect(screen.getByText("No IPM report matches this link. Check that the whole QR code was read.")).toBeInTheDocument();
    a.unmount();
    respond(429, { retryAfter: 120 });
    const b = renderPage();
    expect(await screen.findByText("Too many checks from this network. Try again in 2 minutes.")).toBeInTheDocument();
    b.unmount();
    respond(429, {}, { "retry-after": "x" });
    const c = renderPage();
    expect(await screen.findByText("Too many checks from this network. Try again in 1 minutes.")).toBeInTheDocument();
    c.unmount();
    respond(500, { message: "internal detail" });
    const d = renderPage();
    expect(await screen.findByText("The report could not be checked right now. Try again later.")).toBeInTheDocument();
    expect(screen.queryByText("internal detail")).not.toBeInTheDocument();
    d.unmount();
    fetchMock.mockRejectedValue(new Error("offline"));
    renderPage();
    expect(await screen.findByText("No connection. Check the network and try again.")).toBeInTheDocument();
  });

  it("a recomputation that throws is 'unavailable'", async () => {
    respond(200, { data: verdict({ document: { ...document0, sections: null } }) });
    renderPage();
    expect(await screen.findByText("Your browser could not recompute the hash.")).toBeInTheDocument();
  });
});
