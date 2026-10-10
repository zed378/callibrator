/** @jest-environment jsdom */
/**
 * P23-02 — the on-screen IPM report and its actions. Real: the island, the signature dialog, the
 * services and the typed client. Mocked: the HTTP client, the dashboard chrome and the PDF download
 * (the renderer is proved in node by `lib/ipmReportPdf.test.ts`).
 *
 * Pins: `ipm` read gates it; loading / failed; one h1; the report as semantic HTML (sections with
 * headings, tables with captions and row headers, the result words, the recommendation, both
 * signature columns, the integrity line); the PDF is downloaded from a FRESH `render=pdf` read in the
 * language chosen, never the copy on screen; Sign offered only for the current issued report without
 * a performer signature (never to the operator), Countersign only after it with the setting on; the
 * dialog makes the meaning acknowledged and the credential entered before it sends, shows a wrong
 * credential (401) inline and clears it, and reloads the report once signed; axe.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";
import { clearPermissions, grantPermissions, grantSuperAdmin } from "@/tests/support/permissions";
import { ipmReportDoc } from "@/tests/support/ipmReportFixtures";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});
jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});
jest.mock("@/lib/ipmReportDownload", () => ({ downloadIpmReportPdf: jest.fn(async () => undefined) }));

import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { id } from "@/i18n/messages/id";
import { downloadIpmReportPdf } from "@/lib/ipmReportDownload";
import { ReportClient } from "../sessions/[sessionId]/report/ReportClient";

jest.setTimeout(20000);

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const download = downloadIpmReportPdf as jest.Mock;
const ok = <T,>(data: T) => ({ success: true, status: 200, message: "ok", data });
const S = "5a000000-0000-4000-8000-000000000001";

let doc: ReturnType<typeof ipmReportDoc>;

const renderPage = () =>
  render(
    <MessagesProvider locale="en" messages={en}>
      <ReportClient sessionId={S} pdfMessages={{ id, en }} languageForm={<div>language</div>} />
    </MessagesProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  clearPermissions();
  useToastStore.setState({ toasts: [] });
  useAuthStore.setState({ user: { firstName: "Synthetic", lastName: "Reader", username: "reader" } as never });
  doc = ipmReportDoc();
  get.mockImplementation(async () => ok(doc));
});

describe("P23-02 — the on-screen report", () => {
  it("restricted without ipm read; loading; a failed read said", async () => {
    const first = renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    first.unmount();
    grantPermissions({ calibration: "read" });
    const second = renderPage();
    expect(screen.getByText("You do not have access to IPM reports.")).toBeInTheDocument();
    second.unmount();
    grantPermissions({ ipm: "read" });
    get.mockRejectedValueOnce(httpError(404, "IPM session not found"));
    renderPage();
    expect(await screen.findByText("IPM session not found")).toBeInTheDocument();
  });

  it("the report as semantic HTML: one h1, sections, tables, results, recommendation, signatures, integrity; axe-clean", async () => {
    grantPermissions({ ipm: "read" });
    const { container } = renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "IPM report IPM-SC-20261010-007" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(get).toHaveBeenCalledWith(`/api/v1/ipm/sessions/${S}/report-document`);
    expect(screen.getByText("Issued")).toBeInTheDocument();
    const safety = screen.getByRole("table", { name: "Electrical safety" });
    expect(within(safety).getByRole("rowheader", { name: "Chassis leakage" })).toBeInTheDocument();
    expect(within(safety).getByText("Good (computed)")).toBeInTheDocument();
    expect(within(safety).getByText("45 µA (≤ 100 µA)")).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Physical inspection" })).getByText("Minor damage")).toBeInTheDocument();
    expect(screen.getAllByText("The device must be repaired").length).toBeGreaterThan(0);
    expect(screen.getByText(/^Signed electronically by Synthetic Technician/)).toBeInTheDocument();
    expect(screen.getByText("Awaiting electronic countersignature")).toBeInTheDocument();
    expect(screen.getByText(/^The content matches its hash/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Sign |^Countersign / })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("the PDF: a fresh render=pdf read in the language chosen, with the reader's name; a failure said", async () => {
    grantPermissions({ ipm: "read" });
    renderPage();
    await screen.findByRole("heading", { level: 1 });
    fireEvent.change(screen.getByLabelText("Language of the PDF"), { target: { value: "id" } });
    fireEvent.click(screen.getByRole("button", { name: "Download IPM report IPM-SC-20261010-007 as PDF" }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(get).toHaveBeenLastCalledWith(`/api/v1/ipm/sessions/${S}/report-document`, { params: { render: "pdf", lang: "id" } });
    expect(download.mock.calls[0]?.[1]).toMatchObject({ language: "id", readerName: "Synthetic Reader", messages: id });
    get.mockRejectedValueOnce(httpError(500, "Audit write failed"));
    fireEvent.click(screen.getByRole("button", { name: "Download IPM report IPM-SC-20261010-007 as PDF" }));
    expect(await screen.findByText("Audit write failed")).toBeInTheDocument();
  });

  it("a preview, a mismatch, a voided report, a countersign off: said as such; no signing offered", async () => {
    grantPermissions({ ipm: "read", esignature: "write" });
    doc = ipmReportDoc({
      kind: "preview",
      status: "draft",
      reportNumber: null,
      signatures: [],
      countersignEnabled: false,
      integrity: null,
      notes: null,
      recommendation: null,
      inspectionOutcome: null,
      maintenanceOutcome: "fail",
      lineage: { supersedesReportNumber: "IPM-SC-20261001-001", supersededByReportNumber: null, supersededAt: null, voidedAt: null },
      flags: { capturedOffline: false, imported: true },
      room: null,
      floor: null,
      visitNumber: null,
    });
    const first = renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "IPM report preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download the preview as PDF" })).toBeInTheDocument();
    expect(screen.getByText("Synthetic Technician — not yet signed electronically")).toBeInTheDocument();
    expect(screen.getByText("No signature yet")).toBeInTheDocument();
    expect(screen.getByText("This report supersedes IPM-SC-20261001-001")).toBeInTheDocument();
    expect(screen.getByText("Imported from the previous system (SKP IPM); not signed electronically")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Sign / })).not.toBeInTheDocument();
    first.unmount();
    doc = ipmReportDoc({
      status: "voided",
      lineage: { supersedesReportNumber: null, supersededByReportNumber: "IPM-SC-20261011-002", supersededAt: "2026-10-11T02:00:00.000Z", voidedAt: "2026-10-12T02:00:00.000Z" },
      integrity: { scheme: "ipm-report-v1", hash: "f".repeat(64), state: "mismatch" },
      signatures: [{ ...ipmReportDoc().signatures[0]!, valid: false }],
    });
    renderPage();
    expect(await screen.findByText(/^INTEGRITY CHECK FAILED/)).toBeInTheDocument();
    expect(screen.getByText("Voided on 12 Oct 2026")).toBeInTheDocument();
    expect(screen.getByText("signature does not match this content")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Sign |^Countersign / })).not.toBeInTheDocument();
  });
});

describe("P23-02 — signing", () => {
  it("Sign: offered for the current report without a performer signature; meaning and credential first; a wrong password inline; signed → reloaded", async () => {
    grantPermissions({ ipm: "read", esignature: "write" });
    doc = ipmReportDoc({ signatures: [] });
    post.mockRejectedValueOnce(httpError(401, "Invalid password for e-signature."));
    post.mockResolvedValueOnce(ok({ kind: "performer" }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Sign IPM report IPM-SC-20261010-007" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign IPM report IPM-SC-20261010-007" });
    expect(within(dialog).getByText("By signing you attest that you performed this IPM and that this report is accurate.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign" }));
    expect(within(dialog).getByText("Read the meaning and enter your credential.")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByLabelText("I have read what this signature means."));
    expect(within(dialog).getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign" }));
    expect(await within(dialog).findByText("Invalid password for e-signature.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Password")).toHaveValue("");
    fireEvent.click(within(dialog).getByLabelText("My authenticator code"));
    fireEvent.change(within(dialog).getByLabelText("Authenticator code"), { target: { value: "123456" } });
    const reads = get.mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(post).toHaveBeenLastCalledWith(`/api/v1/ipm/sessions/${S}/signatures`, { kind: "performer", authMethod: "mfa", authPayload: "123456", meaningAcknowledged: true });
    await waitFor(() => expect(get.mock.calls.length).toBe(reads + 1));
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain("Report signed");
  });

  it("Countersign: after the performer, with the setting on; a refusal explained; cancel; never for the operator", async () => {
    grantPermissions({ ipm: "read", esignature: "write" });
    post.mockRejectedValueOnce(httpError(403, "Only the facility's IPSRS may countersign.", "IPM_COUNTERSIGN_ROLE"));
    const first = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Countersign IPM report IPM-SC-20261010-007" }));
    const dialog = await screen.findByRole("dialog", { name: "Countersign IPM report IPM-SC-20261010-007" });
    expect(within(dialog).getByText("By countersigning you attest that you reviewed this IPM report for the facility.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText("I have read what this signature means."));
    fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign" }));
    expect(await within(dialog).findByText("Only the facility's IPSRS may countersign.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    first.unmount();
    grantSuperAdmin();
    renderPage();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: /^Countersign / })).not.toBeInTheDocument();
  });
});
