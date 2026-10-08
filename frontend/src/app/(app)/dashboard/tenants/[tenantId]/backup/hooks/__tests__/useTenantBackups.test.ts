/**
 * useTenantBackups — the paths the A-156 page test does not reach: no tenant
 * means no request, pagination, the create payload, delete / download /
 * restore outcomes and their failures. tenantBackupService returns:
 * getAll `{ data, meta }`, restore `{ success, message, outcome }`,
 * create the backup, delete/downloadToDisk nothing.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const tenantBackupService = {
  getAll: jest.fn(), create: jest.fn(), delete: jest.fn(), downloadToDisk: jest.fn(), restore: jest.fn(),
};
jest.mock("@/api/services/tenantBackup.service", () => ({ tenantBackupService }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { useTenantBackups } from "../useTenantBackups";

const ev = { preventDefault: jest.fn() } as unknown as React.FormEvent;
const backup = { id: "b1", tenantId: "t1", name: "nightly", status: "completed", backupType: "FULL" };
const list = { data: [backup], meta: { total: 12, page: 1, limit: 10, totalPages: 2 } };
const outcome = {
  tenantId: "t1", recordsProcessed: 3, updated: 1, unchanged: 1, skippedDeleted: 0, retained: 2,
  notRestored: [], restoredAt: "2026-09-29T00:00:00.000Z",
};
const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { response: { status, data: { success: false, status, message } } });

beforeEach(() => {
  jest.clearAllMocks();
  tenantBackupService.getAll.mockResolvedValue(list);
});

const setup = async () => {
  const h = renderHook(() => useTenantBackups("t1", "RS A"));
  await waitFor(() => expect(h.result.current.backups).toEqual([backup]));
  await waitFor(() => expect(h.result.current.isLoading).toBe(false));
  return h;
};

describe("useTenantBackups", () => {
  it("without a tenant id nothing is requested", async () => {
    const { result } = renderHook(() => useTenantBackups(undefined));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => result.current.handleCreateBackup(ev));
    await act(async () => result.current.handleDeleteBackup("b1"));
    await act(async () => result.current.handleDownloadBackup("b1"));
    await act(async () => result.current.handleRestoreBackup("b1"));
    expect(tenantBackupService.getAll).not.toHaveBeenCalled();
    expect(tenantBackupService.create).not.toHaveBeenCalled();
    expect(tenantBackupService.delete).not.toHaveBeenCalled();
    expect(tenantBackupService.downloadToDisk).not.toHaveBeenCalled();
    expect(tenantBackupService.restore).not.toHaveBeenCalled();
  });

  it("loads a page with the backend's totals; paging reaches the request", async () => {
    const { result } = await setup();
    expect(tenantBackupService.getAll).toHaveBeenCalledWith("t1", 1, 10);
    expect(result.current.totalPages).toBe(2);
    expect(result.current.totalItems).toBe(12);
    expect(result.current.tenantName).toBe("RS A");
    act(() => result.current.setCurrentPage(2));
    await waitFor(() => expect(tenantBackupService.getAll).toHaveBeenLastCalledWith("t1", 2, 10));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("a failed list load carries the backend message", async () => {
    tenantBackupService.getAll.mockRejectedValueOnce(httpError(404, "Tenant not found"));
    const { result } = renderHook(() => useTenantBackups("t1"));
    await waitFor(() => expect(result.current.error).toBe("Tenant not found"));
    expect(result.current.isLoading).toBe(false);
  });

  it("a non-Error list failure has a fallback message", async () => {
    tenantBackupService.getAll.mockRejectedValueOnce("x");
    const { result } = renderHook(() => useTenantBackups("t1"));
    await waitFor(() => expect(result.current.error).toBe("Failed to fetch backups"));
  });

  it("create sends the form (blank optionals omitted, retention as a number) and resets it", async () => {
    tenantBackupService.create.mockResolvedValue({ ...backup, id: "b2" });
    const { result } = await setup();
    act(() => result.current.setShowCreateModal(true));
    act(() => result.current.setCreateForm({ name: "pre-upgrade", description: "", backupType: "USER_ONLY", retentionDays: "30", tag: "" }));
    await act(async () => result.current.handleCreateBackup(ev));
    expect(tenantBackupService.create).toHaveBeenCalledWith("t1", {
      name: "pre-upgrade", description: undefined, backupType: "USER_ONLY", retentionDays: 30, tag: undefined,
    });
    expect(result.current.success).toBe("Backup created successfully");
    expect(result.current.showCreateModal).toBe(false);
    expect(result.current.createForm).toEqual({ name: "", description: "", backupType: "FULL", retentionDays: "90", tag: "" });
    expect(result.current.isCreating).toBe(false);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("a refused create keeps the modal open with the reason", async () => {
    const { result } = await setup();
    act(() => result.current.setShowCreateModal(true));
    act(() => result.current.setCreateForm((f) => ({ ...f, name: "x", description: "d", tag: "t" })));
    tenantBackupService.create.mockRejectedValueOnce(httpError(409, "A backup is already running for this tenant"));
    await act(async () => result.current.handleCreateBackup(ev));
    expect(tenantBackupService.create).toHaveBeenCalledWith("t1", expect.objectContaining({ description: "d", tag: "t" }));
    expect(result.current.error).toBe("A backup is already running for this tenant");
    expect(result.current.showCreateModal).toBe(true);
    tenantBackupService.create.mockRejectedValueOnce(null);
    await act(async () => result.current.handleCreateBackup(ev));
    expect(result.current.error).toBe("Failed to create backup");
  });

  it("delete reports success or the backend's refusal", async () => {
    const { result } = await setup();
    tenantBackupService.delete.mockResolvedValueOnce(undefined);
    await act(async () => result.current.handleDeleteBackup("b1"));
    expect(tenantBackupService.delete).toHaveBeenCalledWith("t1", "b1");
    expect(result.current.success).toBe("Backup deleted successfully");
    expect(result.current.actionLoading).toBeNull();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    tenantBackupService.delete.mockRejectedValueOnce(httpError(403, "Forbidden"));
    await act(async () => result.current.handleDeleteBackup("b1"));
    expect(result.current.error).toBe("Forbidden");
    tenantBackupService.delete.mockRejectedValueOnce({});
    await act(async () => result.current.handleDeleteBackup("b1"));
    expect(result.current.error).toBe("Failed to delete backup");
  });

  it("download saves the zip named after the backup, or its id when unknown", async () => {
    tenantBackupService.downloadToDisk.mockResolvedValue(undefined);
    const { result } = await setup();
    await act(async () => result.current.handleDownloadBackup("b1"));
    expect(tenantBackupService.downloadToDisk).toHaveBeenLastCalledWith("t1", "b1", "nightly.zip");
    expect(result.current.success).toBe("Download started");
    await act(async () => result.current.handleDownloadBackup("b9"));
    expect(tenantBackupService.downloadToDisk).toHaveBeenLastCalledWith("t1", "b9", "backup-b9.zip");

    tenantBackupService.downloadToDisk.mockRejectedValueOnce(httpError(404, "Backup file missing"));
    await act(async () => result.current.handleDownloadBackup("b1"));
    expect(result.current.error).toBe("Backup file missing");
    tenantBackupService.downloadToDisk.mockRejectedValueOnce("x");
    await act(async () => result.current.handleDownloadBackup("b1"));
    expect(result.current.error).toBe("Failed to download backup");
  });

  it("restore shows the backend's message and outcome; a failure clears the old outcome", async () => {
    const { result } = await setup();
    tenantBackupService.restore.mockResolvedValueOnce({ success: true, message: "Backup restored", outcome });
    await act(async () => result.current.handleRestoreBackup("b1"));
    expect(tenantBackupService.restore).toHaveBeenCalledWith("t1", "b1");
    expect(result.current.success).toBe("Backup restored");
    expect(result.current.restoreOutcome).toEqual(outcome);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    tenantBackupService.restore.mockResolvedValueOnce({ success: true, message: "", outcome: null });
    await act(async () => result.current.handleRestoreBackup("b1"));
    expect(result.current.success).toBe("Restore initiated successfully");
    expect(result.current.restoreOutcome).toBeNull();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    tenantBackupService.restore.mockResolvedValueOnce({ success: true, message: "ok", outcome });
    await act(async () => result.current.handleRestoreBackup("b1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    tenantBackupService.restore.mockRejectedValueOnce(httpError(409, "Backup is not COMPLETED and cannot be restored"));
    await act(async () => result.current.handleRestoreBackup("b1"));
    expect(result.current.error).toBe("Backup is not COMPLETED and cannot be restored");
    expect(result.current.restoreOutcome).toBeNull();
    tenantBackupService.restore.mockRejectedValueOnce(undefined);
    await act(async () => result.current.handleRestoreBackup("b1"));
    expect(result.current.error).toBe("Failed to restore backup");
  });
});
