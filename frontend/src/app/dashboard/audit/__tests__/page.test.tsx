/** @jest-environment jsdom */
/**
 * A-165 — the audit page's "Platform" scope, against the backend contract
 * (audit.controller.js readableTenantId, A-125):
 *  - GET /api/v1/audit?scope=platform reads the PLATFORM tenant's trail, and
 *    is answered to a super admin only (anyone else: 403);
 *  - no `scope` reads the caller's own tenant;
 *  - rows in `data`, pagination in a top-level `meta`.
 *
 * The toggle is shown to a super admin only, and a hospital user's requests
 * never carry `scope`.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <div data-testid="dashboard-layout">{children}</div>;
  };
});

jest.mock("@/api/client", () => ({
  api: { get: jest.fn() },
}));

const mockAuthState: { user: { id: string; tenantId: string; role: { name: string } } | null } = {
  user: null,
};
jest.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (s: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

import { api } from "@/api/client";
import AuditLogPage from "../page";

const mockedGet = api.get as jest.Mock;

const row = (resourceType: string, tenantId: string) => ({
  id: `log-${resourceType}`,
  tenantId,
  userId: "u-1",
  actorType: "user",
  actorName: null,
  action: "UPDATE",
  resourceType,
  resourceId: null,
  changes: null,
  createdAt: "2026-09-24T10:00:00.000Z",
  user: null,
});

const envelope = (rows: unknown[]) => ({
  success: true,
  status: 200,
  message: "ok",
  data: rows,
  meta: { total: rows.length, page: 1, limit: 10, totalPages: 1 },
});

/** The backend: the platform trail for scope=platform, the caller's own otherwise. */
const backend = () => {
  mockedGet.mockImplementation(async (_url: string, { params }: { params: Record<string, unknown> }) =>
    params.scope === "platform"
      ? envelope([row("PlatformTenantChange", "platform")])
      : envelope([row("OwnTenantDevice", "own")]),
  );
};

const scopesRequested = () =>
  mockedGet.mock.calls.map(([, options]) => (options as { params: Record<string, unknown> }).params.scope);

const as = (roleName: string) => {
  mockAuthState.user = { id: "u-1", tenantId: "t-1", role: { name: roleName } };
};

beforeEach(() => {
  jest.clearAllMocks();
  backend();
});

describe("A-165 — audit page platform scope", () => {
  it("a super admin can switch to the PLATFORM trail, and back to their own tenant", async () => {
    as("SUPERADMIN");
    render(<AuditLogPage />);

    expect(await screen.findByText("OwnTenantDevice")).toBeInTheDocument();
    expect(scopesRequested()).toEqual([undefined]);

    const platform = screen.getByRole("button", { name: "Platform" });
    expect(platform).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(platform);

    expect(await screen.findByText("PlatformTenantChange")).toBeInTheDocument();
    expect(screen.queryByText("OwnTenantDevice")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Platform" })).toHaveAttribute("aria-pressed", "true");
    expect(mockedGet).toHaveBeenLastCalledWith("/api/v1/audit", {
      params: expect.objectContaining({ scope: "platform", page: 1 }),
    });

    fireEvent.click(screen.getByRole("button", { name: "My tenant" }));

    expect(await screen.findByText("OwnTenantDevice")).toBeInTheDocument();
    expect(scopesRequested()).toEqual([undefined, "platform", undefined]);
  });

  it("the SUPER_ADMIN spelling of the role sees the toggle too", async () => {
    as("SUPER_ADMIN");
    render(<AuditLogPage />);

    expect(await screen.findByRole("group", { name: "Audit scope" })).toBeInTheDocument();
  });

  it("a hospital admin sees no toggle, and never asks for scope=platform", async () => {
    as("TENANT_ADMIN");
    render(<AuditLogPage />);

    expect(await screen.findByText("OwnTenantDevice")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Audit scope" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Platform" })).not.toBeInTheDocument();
    expect(scopesRequested()).toEqual([undefined]);
  });

  it("a slow response for the previous scope does not overwrite the newer one", async () => {
    as("SUPERADMIN");
    let releaseTenant: (value: unknown) => void = () => undefined;
    mockedGet.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseTenant = resolve;
      }),
    );
    render(<AuditLogPage />);
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Platform" }));
    expect(await screen.findByText("PlatformTenantChange")).toBeInTheDocument();

    await act(async () => {
      releaseTenant(envelope([row("StaleOwnTenantRow", "own")]));
    });

    expect(screen.queryByText("StaleOwnTenantRow")).not.toBeInTheDocument();
    expect(screen.getByText("PlatformTenantChange")).toBeInTheDocument();
  });
});
