/** @jest-environment jsdom */
/**
 * A-156 — the backup screen shows the accounts a restore did NOT re-create.
 *
 * A restore never creates an account (ADR-051 Q-09). The backend reports each
 * archived account that matched nothing in the tenant in `data.notRestored`,
 * with reason `absent` (may be re-invited) or `erased` (GDPR; must not be).
 * Before this fix the service kept only `success` and `message`, so the page
 * said "Backup restored successfully" and nothing else.
 *
 * Fail-before: no "not restored" panel, no usernames, no reasons.
 *
 * Real: the page, its hook, its components, and tenantBackupService. Mocked:
 * the layout, the router, and the HTTP client — answered with the exact
 * envelope the backend sends (list: rows in `data`, `meta` top-level; restore:
 * the outcome object in `data`, no `meta`).
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  useParams: () => ({ tenantId: "t1" }),
  usePathname: () => "/dashboard/tenants/t1/backup",
}));

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <div data-testid="dashboard-layout">{children}</div>;
  };
});

jest.mock("@/api/client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
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

const listEnvelope = {
  success: true,
  status: 200,
  message: "Backups retrieved successfully",
  data: [BACKUP],
  meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
};

const restoreEnvelope = (notRestored: unknown[]) => ({
  success: true,
  status: 200,
  message: "Backup restored successfully",
  data: {
    tenantId: "t1",
    recordsProcessed: 3,
    updated: 1,
    unchanged: 0,
    skippedDeleted: 0,
    retained: 4,
    notRestored,
    restoredAt: "2026-09-24T10:00:00.000Z",
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.get.mockResolvedValue(listEnvelope);
});

const restoreFirstBackup = async () => {
  render(<TenantBackupPage />);
  fireEvent.click(await screen.findByRole("button", { name: /Restore/ }));
};

describe("A-156: backup screen shows the restore's notRestored list", () => {
  it("lists each account that was not restored, with its reason and what to do", async () => {
    mockedApi.post.mockResolvedValueOnce(
      restoreEnvelope([
        { entry: 1, username: "gone.user", reason: "absent" },
        { entry: 2, username: "anon_7f3a", reason: "erased" },
      ]),
    );

    await restoreFirstBackup();

    expect(
      await screen.findByText("2 account(s) were not restored"),
    ).toBeInTheDocument();
    expect(mockedApi.post).toHaveBeenCalledWith(
      "/api/v1/tenants/t1/backups/b1/restore",
      { mergeData: false },
    );

    const list = screen.getByRole("list", { name: "Accounts not restored" });
    const items = Array.from(list.querySelectorAll("li"));
    expect(items).toHaveLength(2);

    expect(items[0]).toHaveTextContent("gone.user");
    expect(items[0]).toHaveTextContent("Not in this tenant");
    expect(items[0]).toHaveTextContent(/Re-invite through Users/);

    expect(items[1]).toHaveTextContent("anon_7f3a");
    expect(items[1]).toHaveTextContent("Erased (GDPR)");
    expect(items[1]).toHaveTextContent(/Do not re-invite/);

    expect(screen.getByText(/A restore never re-creates an account/)).toBeInTheDocument();
    expect(screen.getByText(/1 updated/)).toBeInTheDocument();
  });

  it("says every account was matched when notRestored is empty", async () => {
    mockedApi.post.mockResolvedValueOnce(restoreEnvelope([]));

    await restoreFirstBackup();

    expect(
      await screen.findByText("Every account in the backup was matched."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Accounts not restored" })).toBeNull();
  });

  it("shows no restore result before a restore, and none after a failed one", async () => {
    mockedApi.post.mockRejectedValueOnce(new Error("Backup b1 cannot be restored"));

    render(<TenantBackupPage />);
    const button = await screen.findByRole("button", { name: /Restore/ });
    expect(screen.queryByText(/Restore result|were not restored/)).toBeNull();

    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByText("Backup b1 cannot be restored")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Restore result|were not restored/)).toBeNull();
  });
});
