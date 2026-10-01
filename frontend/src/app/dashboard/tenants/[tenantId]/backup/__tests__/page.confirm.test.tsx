/** @jest-environment jsdom */
/**
 * Tenant backup Restore and Delete ask first (audit 01 §4.4, severity 4).
 *
 * A restore overwrites the tenant's data from the archive and cannot be
 * undone, so its confirmation names the backup and the confirm button stays
 * disabled until the backup's name is typed. Delete asks once. Cancelling
 * either sends nothing.
 *
 * Fail-before: one click on Restore or Delete called the API at once.
 */
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  useParams: () => ({ tenantId: "t1" }),
  usePathname: () => "/dashboard/tenants/t1/backup",
}));
jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  };
});
jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import TenantBackupPage from "../page";
import { api } from "@/api/client";

const mockedApi = api as jest.Mocked<typeof api>;
const BACKUP = {
  id: "b1",
  tenantId: "t1",
  name: "nightly",
  backupType: "FULL",
  status: "COMPLETED",
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.get.mockResolvedValue({
    success: true,
    status: 200,
    message: "ok",
    data: [BACKUP],
    meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
  });
});

describe("backup Restore needs the backup's name typed", () => {
  it("nothing is sent on the click; confirm is disabled until the exact name is typed", async () => {
    render(<TenantBackupPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore backup nightly" }));
    const dialog = await screen.findByRole("dialog", { name: /Restore backup "nightly"/ });
    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();

    const confirm = within(dialog).getByRole("button", { name: "Restore backup" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/to confirm/), { target: { value: "Nightly" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/to confirm/), { target: { value: "nightly" } });
    expect(confirm).toBeEnabled();

    mockedApi.post.mockResolvedValue({ success: true, status: 200, message: "Backup restored", data: { notRestored: [] } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/api/v1/tenants/t1/backups/b1/restore", expect.anything()));
  });

  it("Cancel sends nothing, and reopening starts with an empty phrase", async () => {
    render(<TenantBackupPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore backup nightly" }));
    let dialog = await screen.findByRole("dialog", { name: /Restore backup/ });
    fireEvent.change(within(dialog).getByLabelText(/to confirm/), { target: { value: "nightly" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restore backup nightly" }));
    dialog = await screen.findByRole("dialog", { name: /Restore backup/ });
    expect(within(dialog).getByLabelText(/to confirm/)).toHaveValue("");
    expect(mockedApi.post).not.toHaveBeenCalled();
  });
});

describe("backup Delete asks first", () => {
  it("deletes only after confirmation; cancel sends nothing", async () => {
    render(<TenantBackupPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete backup nightly" }));
    let dialog = await screen.findByRole("dialog", { name: /Delete backup "nightly"/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mockedApi.delete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete backup nightly" }));
    dialog = await screen.findByRole("dialog", { name: /Delete backup "nightly"/ });
    mockedApi.delete.mockResolvedValue({ success: true, status: 200, message: "deleted", data: null });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete backup" }));
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalled());
    expect(String(mockedApi.delete.mock.calls[0]?.[0])).toContain("/backups/b1");
  });
});
