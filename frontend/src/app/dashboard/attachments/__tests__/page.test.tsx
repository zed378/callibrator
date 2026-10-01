/** @jest-environment jsdom */
/**
 * Files & Documents, against the backend contract (attachment.controller.js):
 *  - GET    /api/v1/attachments                → rows in `data`, top-level `meta`
 *  - POST   /api/v1/attachments (multipart)    → 201 `data: attachment`
 *  - POST   /api/v1/attachments/:id/signed-url → `data: { url, token, expiresAt, expiresInSec }`
 *  - DELETE /api/v1/attachments/:id            → `data: { id }`; another tenant's is 404
 *
 * Real: the page, useAttachments, the attachment service. Mocked: the
 * transport, the layout, window.open.
 *
 * Fail-before: a failed list load showed the error AND "No files yet".
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/components/layouts/DashboardLayout", () =>
  function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  },
);
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import AttachmentsPage from "../page";
import { useToastStore } from "@/stores/toastStore";
import { httpError } from "@/tests/support/httpErrors";
import { grantPermissions, grantSuperAdmin, clearPermissions } from "@/tests/support/permissions";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const att = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  tenantId: "t1",
  resourceType: "device",
  resourceId: "11111111-2222-3333-4444-555555555555",
  originalName: "calibration-evidence.pdf",
  mimeType: "application/pdf",
  size: 2_621_440,
  createdAt: "2026-09-10T08:00:00.000Z",
  ...over,
});
const list = (rows: unknown[], meta: Record<string, number> = {}) => ({
  success: true,
  status: 200,
  message: "Attachments retrieved",
  data: rows,
  meta: { total: rows.length, page: 1, limit: 10, totalPages: 1, ...meta },
});
const toasts = () => useToastStore.getState().toasts;
const listParams = () => (mockedGet.mock.calls.at(-1)?.[1] as { params: Record<string, unknown> }).params;

let openSpy: jest.SpyInstance;
beforeEach(() => {
  // ADR-102: write controls follow the effective permissions.
  grantPermissions({ equipment: "write" });
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
});
afterEach(() => openSpy.mockRestore());

describe("Attachments page", () => {
  it("lists files with what they are linked to, their size and actions", async () => {
    mockedGet.mockResolvedValue(list([att(), att({ id: "a2", originalName: "note.txt", resourceType: "generic", resourceId: null, size: 512 })]));
    const { container } = render(<AttachmentsPage />);

    const row = (await screen.findByText("calibration-evidence.pdf")).closest("tr") as HTMLElement;
    expect(within(row).getByText("device")).toBeInTheDocument();
    expect(within(row).getByText("11111111-2222-3333-4444-555555555555")).toBeInTheDocument();
    expect(within(row).getByText("2.5 MB")).toBeInTheDocument();
    expect(within(screen.getByText("note.txt").closest("tr") as HTMLElement).getByText("512 B")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("no files: the empty state", async () => {
    mockedGet.mockResolvedValue(list([]));
    render(<AttachmentsPage />);

    expect(await screen.findByText("No files yet")).toBeInTheDocument();
  });

  it("a failed load shows the error, not the empty state", async () => {
    mockedGet.mockRejectedValue(httpError(403, "You do not have permission to read attachments"));
    const { container } = render(<AttachmentsPage />);

    expect(await screen.findByText("You do not have permission to read attachments")).toBeInTheDocument();
    expect(screen.queryByText("No files yet")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("filters by what the file is linked to, from page 1", async () => {
    mockedGet.mockResolvedValue(list([att()], { total: 30, totalPages: 3 }));
    render(<AttachmentsPage />);
    await screen.findByText("calibration-evidence.pdf");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(listParams()).toEqual({ page: 2, limit: 10 }));

    fireEvent.click(screen.getByRole("button", { name: "All files" }));
    fireEvent.click(screen.getByRole("option", { name: "Certificate" }));
    await waitFor(() => expect(listParams()).toEqual({ page: 1, limit: 10, resourceType: "certificate" }));
  });

  it("download mints a signed URL and opens it without an opener", async () => {
    mockedGet.mockResolvedValue(list([att()]));
    mockedPost.mockResolvedValue({
      success: true,
      status: 200,
      message: "Signed URL generated",
      data: { url: "/api/v1/attachments/a1/signed?token=t", token: "t", expiresAt: "2026-09-10T08:05:00.000Z", expiresInSec: 300 },
    });
    render(<AttachmentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Download/ }));

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith("/api/v1/attachments/a1/signed?token=t", "_blank", "noopener,noreferrer"));
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/attachments/a1/signed-url", {});
  });

  it("a refused download link is reported and nothing opens", async () => {
    mockedGet.mockResolvedValue(list([att()]));
    mockedPost.mockRejectedValue(httpError(404, "Attachment not found"));
    render(<AttachmentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Download/ }));

    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ type: "error", title: "Attachment not found" })]));
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("uploads a file linked to a record, then reloads", async () => {
    mockedGet.mockResolvedValue(list([]));
    mockedPost.mockResolvedValue({ success: true, status: 201, message: "Attachment uploaded", data: att() });
    render(<AttachmentsPage />);
    await screen.findByText("No files yet");

    fireEvent.click(screen.getByRole("button", { name: /Upload File/ }));
    const dialog = await screen.findByRole("dialog", { name: "Upload File" });
    expect(within(dialog).getByRole("button", { name: "Upload" })).toBeDisabled();
    const file = new File(["%PDF"], "evidence.pdf", { type: "application/pdf" });
    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Link To/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Device" }));
    fireEvent.change(within(dialog).getByLabelText("Linked Record ID"), { target: { value: " dev-1 " } });
    const reads = mockedGet.mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith("/api/v1/attachments", expect.any(FormData)));
    const body = mockedPost.mock.calls[0][1] as FormData;
    expect(body.get("file")).toBe(file);
    expect(body.get("resourceType")).toBe("device");
    expect(body.get("resourceId")).toBe("dev-1");
    await waitFor(() => expect(mockedGet.mock.calls.length).toBe(reads + 1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toasts()).toEqual(expect.arrayContaining([expect.objectContaining({ type: "success", title: "File uploaded" })]));
  });

  it("a refused upload is reported and the dialog stays", async () => {
    mockedGet.mockResolvedValue(list([]));
    mockedPost.mockRejectedValue(httpError(400, "File type not allowed"));
    render(<AttachmentsPage />);
    await screen.findByText("No files yet");

    fireEvent.click(screen.getByRole("button", { name: /Upload File/ }));
    const dialog = await screen.findByRole("dialog", { name: "Upload File" });
    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["x"], "x.exe")] },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ type: "error", title: "File type not allowed" })]));
    expect(screen.getByRole("dialog", { name: "Upload File" })).toBeInTheDocument();
    // A general file carries no record id.
    const body = mockedPost.mock.calls[0][1] as FormData;
    expect(body.get("resourceType")).toBe("generic");
    expect(body.get("resourceId")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("deletes a file after confirmation", async () => {
    mockedGet.mockResolvedValue(list([att()]));
    mockedDelete.mockResolvedValue({ success: true, status: 200, message: "Attachment deleted", data: { id: "a1" } });
    render(<AttachmentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Delete/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Attachment" });
    expect(within(dialog).getByText("calibration-evidence.pdf")).toBeInTheDocument();
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith("/api/v1/attachments/a1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toasts()).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Attachment deleted" })]));
  });

  it("a delete of another tenant's or a missing file (404) is reported", async () => {
    mockedGet.mockResolvedValue(list([att()]));
    mockedDelete.mockRejectedValue(httpError(404, "Attachment not found"));
    render(<AttachmentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Delete/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ type: "error", title: "Attachment not found" })]));
  });
});

/**
 * ADR-102 — deleting a file needs `equipment` write (attachments.route.js);
 * uploading and downloading need `equipment` read. ENGINEERING MANAGER holds
 * `equipment` read: it keeps Upload and Download, loses Delete.
 * Fail-before: Delete rendered for every role.
 */
describe("ADR-102 — attachment delete follows the effective permission", () => {
  it("an `equipment` reader downloads and uploads, but has no Delete", async () => {
    grantPermissions({ equipment: "read" });
    mockedGet.mockResolvedValue(list([att()]));
    render(<AttachmentsPage />);
    await screen.findByText("calibration-evidence.pdf");
    expect(screen.getByRole("button", { name: /Download/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  });

  it("nothing is deletable before the permissions load", async () => {
    clearPermissions();
    mockedGet.mockResolvedValue(list([att()]));
    render(<AttachmentsPage />);
    await screen.findByText("calibration-evidence.pdf");
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  });

  it("the super admin deletes", async () => {
    grantSuperAdmin();
    mockedGet.mockResolvedValue(list([att()]));
    render(<AttachmentsPage />);
    await screen.findByText("calibration-evidence.pdf");
    expect(screen.getByRole("button", { name: /Delete/ })).toBeInTheDocument();
  });
});
