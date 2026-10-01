/** @jest-environment jsdom */
/**
 * F-19 — a failed backup list read showed the error AND "No backups found for
 * this tenant" (which says the tenant has none), and `fetchBackups` never
 * cleared the failure, so a later successful read kept the stale error.
 *
 * Real: the page, useTenantBackups, its components and tenantBackupService.
 * Mocked: the layout, the router and the HTTP client, answered with the
 * backend's envelope (rows in `data`, `meta` top-level).
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";

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

const httpError = (status: number, message: string) =>
  new AxiosError(message, "ERR_BAD_RESPONSE", undefined, undefined, {
    status,
    statusText: "",
    data: { success: false, status, message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

const list = (rows: unknown[], total = rows.length) => ({
  success: true,
  status: 200,
  message: "Backups retrieved successfully",
  data: rows,
  meta: { total, page: 1, limit: 10, totalPages: Math.max(1, Math.ceil(total / 10)) },
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("tenant backups — a failed list read (F-19)", () => {
  it("F-19: shows the error and never the empty state", async () => {
    get.mockRejectedValue(httpError(500, "Backup storage is unreachable"));
    render(<TenantBackupPage />);

    expect(await screen.findByText("Backup storage is unreachable")).toBeInTheDocument();
    expect(screen.getByText("Backups could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No backups found for this tenant")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create First Backup/ })).not.toBeInTheDocument();
  });

  it("F-19: the next successful read clears the stale list error", async () => {
    get.mockRejectedValueOnce(httpError(500, "Backup storage is unreachable"));
    render(<TenantBackupPage />);
    expect(await screen.findByText("Backup storage is unreachable")).toBeInTheDocument();

    get.mockResolvedValue(list([]));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("No backups found for this tenant")).toBeInTheDocument();
    expect(screen.queryByText("Backup storage is unreachable")).not.toBeInTheDocument();
  });

  it("control: an empty list is the empty state", async () => {
    get.mockResolvedValue(list([]));
    render(<TenantBackupPage />);
    expect(await screen.findByText("No backups found for this tenant")).toBeInTheDocument();
    expect(screen.queryByText("Backups could not be loaded.")).not.toBeInTheDocument();
  });
});
