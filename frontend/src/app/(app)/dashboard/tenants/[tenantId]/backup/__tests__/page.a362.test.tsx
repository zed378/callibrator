/** @jest-environment jsdom */
/**
 * A-362 / A-363 — the backup page reads a backup row as the API sends it.
 *
 * A-362: the API answers `status` as the model's lower-case ENUM (`pending`,
 * `in_progress`, `completed`, `failed`, `deleted`). The page compared
 * COMPLETED / FAILED / IN_PROGRESS, so a finished backup was never offered
 * Download or Restore, the Completed/Failed/In Progress counts read 0 and
 * every badge was the fallback.
 *
 * A-363: `name` and `description` are stored since migration 0108 (NULL on a
 * backup taken before it); a failure's text is `errorMessage`. The page read
 * `completedAt` and `error`, which no row carries.
 *
 * Real: the page, useTenantBackups, its components and tenantBackupService.
 * Mocked: the layout, the router and the HTTP client, answered with rows in
 * the shape tenantBackup.openapi.ts publishes (`TenantBackup`).
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { TenantBackup } from "@/api/services/tenantBackup.service";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  useParams: () => ({ tenantId: "t1" }),
  usePathname: () => "/dashboard/tenants/t1/backup",
}));
jest.mock("@/components/layouts/DashboardLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import TenantBackupPage from "../page";
import { api } from "@/api/client";

const get = api.get as jest.Mock;

/** A tenant_backups row as the API answers it. */
const row = (over: Partial<TenantBackup>): TenantBackup => ({
  id: "b0",
  tenantId: "t1",
  name: null,
  description: null,
  backupPath: null,
  size: null,
  status: "pending",
  cronExpression: null,
  retentionDays: 90,
  backupType: "FULL",
  tag: null,
  filePath: null,
  fileSize: null,
  recordCount: null,
  errorMessage: null,
  restoredAt: null,
  expiresAt: null,
  metadata: null,
  createdBy: null,
  deletedBy: null,
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
  deletedAt: null,
  ...over,
});

const ROWS = [
  row({ id: "b1", name: "Before upgrade", description: "Taken before the v3 rollout", status: "completed", fileSize: "2048" }),
  row({ id: "b2", name: "Nightly", status: "failed", errorMessage: "disk full" }),
  row({ id: "b3", name: "Running", status: "in_progress", backupType: "full" }),
  // Taken before migration 0108: no name was stored.
  row({ id: "b4", status: "completed" }),
];

beforeEach(() => {
  jest.clearAllMocks();
  get.mockResolvedValue({
    success: true,
    status: 200,
    message: "Backups retrieved successfully",
    data: ROWS,
    meta: { total: ROWS.length, page: 1, limit: 10, totalPages: 1 },
  });
});

const stat = (label: string) => screen.getByText(label, { selector: "p" }).nextElementSibling?.textContent;

describe("A-362: the page compares the API's lower-case backup status", () => {
  it("a completed backup offers Download and Restore; a failed or running one does not", async () => {
    render(<TenantBackupPage />);
    await screen.findByText("Before upgrade");

    expect(screen.getByRole("button", { name: "Restore backup Before upgrade" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore backup Nightly" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore backup Running" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Download" })).toHaveLength(2);
  });

  it("counts completed, failed and in-progress backups, and colours each status badge", async () => {
    render(<TenantBackupPage />);
    await screen.findByText("Before upgrade");

    expect([stat("Total Backups"), stat("Completed"), stat("Failed"), stat("In Progress")]).toEqual(["4", "2", "1", "1"]);
    // ADR-122 (P11-05): tones from lib/statusTone.ts (shape + icon + colour).
    expect(screen.getByText("failed").closest("[data-tone]")).toHaveAttribute("data-tone", "alarm");
    expect(screen.getAllByText("completed")[0]?.closest("[data-tone]")).toHaveAttribute("data-tone", "current");
  });
});

describe("A-363: the page reads the fields a backup row carries", () => {
  it("shows a backup's stored name and description, and the failure text from errorMessage", async () => {
    render(<TenantBackupPage />);

    expect(await screen.findByRole("heading", { name: "Before upgrade" })).toBeInTheDocument();
    expect(screen.getByText("Taken before the v3 rollout")).toBeInTheDocument();
    expect(screen.getByText("disk full")).toBeInTheDocument();
    // The scheduled job's lower-case type reads like the create's.
    expect(screen.getAllByText("FULL")).toHaveLength(4);
  });

  it("a backup taken before names were stored reads 'Untitled backup' and is confirmed by its id", async () => {
    render(<TenantBackupPage />);
    await screen.findByText("Before upgrade");

    expect(screen.getByRole("heading", { name: "Untitled backup" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore backup Untitled backup" }));
    const dialog = await screen.findByRole("dialog", { name: /Restore backup "Untitled backup"/ });
    const confirm = within(dialog).getByRole("button", { name: "Restore backup" });

    fireEvent.change(within(dialog).getByLabelText(/to confirm/), { target: { value: "" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/to confirm/), { target: { value: "b4" } });
    expect(confirm).toBeEnabled();
  });
});
