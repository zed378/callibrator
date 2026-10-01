/**
 * useAttachments — what the A-118 test (useAttachments.a118.test.ts) does not
 * cover: the list filter and its failure, the no-file guard, an upload
 * refusal, the signed-URL download, and delete. attachmentService returns:
 * getAll a PaginatedResponse, getSignedUrl `{ url, token, expiresAt,
 * expiresInSec }`, remove `{ id }`, upload the attachment.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const attachmentService = { getAll: jest.fn(), upload: jest.fn(), getSignedUrl: jest.fn(), remove: jest.fn() };
jest.mock("@/api/services/attachment.service", () => ({ attachmentService }));

import { useAttachments } from "../useAttachments";
import { useToastStore } from "@/stores/toastStore";
import type { Attachment } from "@/api/services/attachment.service";

const ev = { preventDefault: jest.fn() } as unknown as React.FormEvent;
const att = {
  id: "a1", tenantId: "t1", resourceType: "device", resourceId: "d1", originalName: "manual.pdf", size: 10,
  url: "/api/v1/attachments/a1/download",
} as unknown as Attachment;
const page = { success: true, message: "ok", data: [att], meta: { total: 1, page: 1, limit: 10, totalPages: 1 } };
const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { response: { status, data: { success: false, status, message } } });
const lastToast = () => useToastStore.getState().toasts.at(-1);
const FILE = new File(["x"], "a.pdf", { type: "application/pdf" });

let openSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  attachmentService.getAll.mockResolvedValue(page);
  openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
});
afterEach(() => openSpy.mockRestore());

const setup = async () => {
  const h = renderHook(() => useAttachments());
  await waitFor(() => expect(h.result.current.attachments).toEqual(page));
  await waitFor(() => expect(h.result.current.isLoading).toBe(false));
  return h;
};

describe("useAttachments", () => {
  it("the type filter and page reach the request", async () => {
    const { result } = await setup();
    expect(attachmentService.getAll).toHaveBeenCalledWith(1, 10, { resourceType: undefined });
    act(() => result.current.setResourceTypeFilter("device"));
    act(() => result.current.setCurrentPage(2));
    await waitFor(() => expect(attachmentService.getAll).toHaveBeenLastCalledWith(2, 10, { resourceType: "device" }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("a failed list load is an error, with the backend message or a fallback", async () => {
    attachmentService.getAll.mockRejectedValueOnce(httpError(403, "Forbidden"));
    const { result } = renderHook(() => useAttachments());
    await waitFor(() => expect(result.current.error).toBe("Forbidden"));
    attachmentService.getAll.mockRejectedValueOnce("x");
    act(() => result.current.setCurrentPage(2));
    await waitFor(() => expect(result.current.error).toBe("Failed to load attachments"));
  });

  it("an upload without a file is refused before any request", async () => {
    const { result } = await setup();
    act(() => result.current.openUploadModal());
    expect(result.current.isUploadModalOpen).toBe(true);
    await act(async () => result.current.handleUploadSubmit(ev));
    expect(lastToast()).toMatchObject({ type: "error", title: "Choose a file to upload" });
    expect(attachmentService.upload).not.toHaveBeenCalled();
  });

  it("a blank type uploads as generic; success closes and resets the modal", async () => {
    attachmentService.upload.mockResolvedValueOnce({ id: "a2" });
    const { result } = await setup();
    act(() => result.current.openUploadModal());
    act(() => {
      result.current.setFile(FILE);
      result.current.setForm({ resourceType: "  ", resourceId: "" });
    });
    await act(async () => result.current.handleUploadSubmit(ev));
    expect(attachmentService.upload).toHaveBeenCalledWith({ file: FILE, resourceType: "generic", resourceId: undefined });
    expect(lastToast()).toMatchObject({ type: "success", title: "File uploaded" });
    expect(result.current.isUploadModalOpen).toBe(false);
    expect(result.current.file).toBeNull();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("a refused upload keeps the modal and the chosen file", async () => {
    const { result } = await setup();
    act(() => result.current.openUploadModal());
    act(() => result.current.setFile(FILE));
    attachmentService.upload.mockRejectedValueOnce(httpError(422, "File type not allowed"));
    await act(async () => result.current.handleUploadSubmit(ev));
    expect(lastToast()).toMatchObject({ type: "error", title: "File type not allowed" });
    expect(result.current.isUploadModalOpen).toBe(true);
    expect(result.current.file).toBe(FILE);
    attachmentService.upload.mockRejectedValueOnce({});
    await act(async () => result.current.handleUploadSubmit(ev));
    expect(lastToast()?.title).toBe("Failed to upload file");
    expect(result.current.isSubmitting).toBe(false);
    act(() => result.current.closeUploadModal());
    expect(result.current.isUploadModalOpen).toBe(false);
    expect(result.current.file).toBeNull();
  });

  it("download opens the signed URL in a new tab without an opener", async () => {
    attachmentService.getSignedUrl.mockResolvedValueOnce({
      url: "/api/v1/storage/object?key=k&token=t", token: "t", expiresAt: "2026-09-29T01:00:00Z", expiresInSec: 300,
    });
    const { result } = await setup();
    await act(async () => result.current.handleDownload(att));
    expect(attachmentService.getSignedUrl).toHaveBeenCalledWith("a1");
    expect(openSpy).toHaveBeenCalledWith("/api/v1/storage/object?key=k&token=t", "_blank", "noopener,noreferrer");
    expect(result.current.downloadingId).toBeNull();
  });

  it("a failed signed-URL request is a toast and opens nothing", async () => {
    const { result } = await setup();
    attachmentService.getSignedUrl.mockRejectedValueOnce(httpError(404, "Attachment not found"));
    await act(async () => result.current.handleDownload(att));
    expect(lastToast()).toMatchObject({ type: "error", title: "Attachment not found" });
    attachmentService.getSignedUrl.mockRejectedValueOnce(null);
    await act(async () => result.current.handleDownload(att));
    expect(lastToast()?.title).toBe("Failed to generate download link");
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("delete: nothing without a target; a refusal keeps the confirm; success closes and reloads", async () => {
    const { result } = await setup();
    await act(async () => result.current.confirmDelete());
    expect(attachmentService.remove).not.toHaveBeenCalled();

    act(() => result.current.handleDeleteClick(att));
    expect(result.current.isDeleteConfirmOpen).toBe(true);
    attachmentService.remove.mockRejectedValueOnce(httpError(404, "Attachment not found"));
    await act(async () => result.current.confirmDelete());
    expect(lastToast()).toMatchObject({ type: "error", title: "Attachment not found" });
    expect(result.current.isDeleteConfirmOpen).toBe(true);
    attachmentService.remove.mockRejectedValueOnce("x");
    await act(async () => result.current.confirmDelete());
    expect(lastToast()?.title).toBe("Failed to delete attachment");

    attachmentService.remove.mockResolvedValueOnce({ id: "a1" });
    await act(async () => result.current.confirmDelete());
    expect(attachmentService.remove).toHaveBeenLastCalledWith("a1");
    expect(lastToast()).toMatchObject({ type: "success", title: "Attachment deleted" });
    expect(result.current.isDeleteConfirmOpen).toBe(false);
    expect(result.current.attachmentToDelete).toBeNull();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });
});
