/** @jest-environment jsdom */
/**
 * The dashboard home, against GET /api/v1/dashboard/metrics
 * (`data`: tenant-scoped metrics; the super admin gets `scope: "global"` with
 * `tenants` and a `tenantBreakdown`), POST /api/v1/auth/verify (the user) and
 * GET /api/v1/users/all (rows in `data`, top-level `meta`).
 *
 * Real: the page, useDashboardMetrics, the stat/chart/breakdown/quick-action
 * components, the stores and services. Mocked: the transport, the layout,
 * next/navigation and the system-health panel (its own test covers it).
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/components/layouts/DashboardLayout", () =>
  function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  },
);
jest.mock("../components/DashboardSystemHealth", () => () => null);
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn() },
}));

import { api } from "@/api/client";
// P22-07: the page is a server wrapper now; the island is what renders (re-based import only).
import DashboardPage from "../DashboardClient";
import { useAuthStore } from "@/stores/authStore";
import { useUserStore } from "@/stores/userStore";
import { useMenuStore } from "@/stores/menuStore";
import { httpError } from "@/tests/support/httpErrors";
import type { User } from "@/types";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const ok = (data: unknown, meta: unknown = null) => ({ success: true, status: 200, message: "ok", data, meta });

const tenantMetrics = {
  scope: "tenant",
  generatedAt: "2026-09-29T00:00:00.000Z",
  tenant: { id: "t1", name: "RS Harapan", code: "rsh", status: "active" },
  users: { total: 14, verified: 12 },
  devices: { total: 120, byStatus: { active: 110 }, dueSoon: 6, overdue: 2, byCondition: { good: 100, not_good: 10, broken: 5, unset: 5 } },
  calibrations: { total: 300, compliant: 291, complianceRate: 97, last30Days: 20 },
  certificates: { total: 80, byStatus: { approved: 70, draft: 10 } },
  inventory: { stockItems: 45, totalQuantity: 900, lowStockItems: 3, warehouses: 2, pendingTransfers: 1, openOpnames: 0 },
  maintenance: { openWorkOrders: 4 },
  ipm: { sessionsLast30Days: 7, due: { scheduled: 90, due: 12, neverInspected: 4 } },
  trends: {
    calibrations: [
      { month: "2026-08", count: 40 },
      { month: "2026-09", count: 50 },
    ],
    certificates: [
      { month: "2026-08", count: 10 },
      { month: "2026-09", count: 5 },
    ],
  },
};
const globalMetrics = {
  ...tenantMetrics,
  scope: "global",
  tenant: null,
  calibrations: { ...tenantMetrics.calibrations, complianceRate: null },
  ipm: { sessionsLast30Days: 9, due: null },
  tenants: { total: 3, active: 2 },
  tenantBreakdown: [
    { id: "t1", name: "RS Harapan", code: "rsh", status: "active", users: 14, devices: 120 },
    { id: "t2", name: "Klinik Sehat", code: null, status: "suspended", users: 1, devices: 1500 },
  ],
  trends: { calibrations: [{ month: "2026-09", count: 3 }], certificates: [] },
};

let metrics: unknown;
let me: Record<string, unknown>;
beforeEach(() => {
  jest.clearAllMocks();
  metrics = ok(tenantMetrics);
  me = { id: "u1", username: "ada", firstName: "Ada", lastName: "Lovelace", role: { name: "HEALTHCARE ADMIN" } };
  useUserStore.setState({ users: null });
  useAuthStore.setState({ user: me as unknown as User, isAuthenticated: true });
  // ADR-102: what Home offers follows the effective permissions — the seeded
  // HEALTHCARE ADMIN holds `users` write and `notifications` (via `account`).
  useMenuStore.setState({
    effectivePermissions: { superAdmin: false, permissions: { users: "write", notifications: "write" } },
  });
  mockedPost.mockImplementation(async (url: string) => {
    if (url === "/api/v1/auth/verify") return ok(me);
    throw new Error(`unexpected POST ${url}`);
  });
  mockedGet.mockImplementation(async (url: string) => {
    if (url === "/api/v1/dashboard/metrics") {
      if (metrics instanceof Error) throw metrics;
      return metrics;
    }
    if (url === "/api/v1/users/all") {
      return ok([{ id: "u2", username: "nurse.jo", email: "jo@rs.test" }], { total: 1, page: 1, limit: 50, totalPages: 1 });
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

describe("Dashboard page", () => {
  it("a tenant user sees their tenant's metrics, trends and recent users", async () => {
    const { container } = render(<DashboardPage />);

    expect(await screen.findByText(/Overview for RS Harapan/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ada Lovelace");
    expect(screen.getByText("Team Members")).toBeInTheDocument();
    expect(screen.queryByText("Tenants")).not.toBeInTheDocument();
    expect(screen.getByText("97%")).toBeInTheDocument();
    expect(screen.getByText("291 of 300 calibrations")).toBeInTheDocument();
    expect(screen.getByText("70 approved · 10 draft")).toBeInTheDocument();
    expect(screen.getByText("Pending Transfers")).toBeInTheDocument();
    // Month-over-month: calibrations 40 → 50, certificates 10 → 5.
    expect(screen.getByText("+25%")).toBeInTheDocument();
    expect(screen.getByText("-50%")).toBeInTheDocument();
    expect(screen.getAllByText("Sep").length).toBeGreaterThan(0);
    expect(await screen.findByText("nurse.jo")).toBeInTheDocument();
    // The per-tenant breakdown is the super admin's only.
    expect(screen.queryByText("Tenant Breakdown")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("the super admin sees the global view with the tenant breakdown", async () => {
    me = { ...me, role: { name: "SUPERADMIN" }, firstName: "", lastName: "" };
    useAuthStore.setState({ user: me as unknown as User });
    useMenuStore.setState({ effectivePermissions: { superAdmin: true, permissions: {} } });
    metrics = ok(globalMetrics);
    const { container } = render(<DashboardPage />);

    expect(await screen.findByText(/Global overview — all tenants/)).toBeInTheDocument();
    expect(screen.getByText("Tenants")).toBeInTheDocument();
    expect(screen.getByText("2 active")).toBeInTheDocument();
    expect(screen.getByText("Open Work Orders")).toBeInTheDocument();
    // No compliance data yet: a dash, not 0%.
    expect(within(screen.getByText("Compliance Rate").closest("div") as HTMLElement).queryByText("0%")).not.toBeInTheDocument();
    const breakdown = screen.getByText("Tenant Breakdown").closest("div.rounded-2xl") as HTMLElement;
    const suspended = within(breakdown).getByText("Klinik Sehat").closest("tr") as HTMLElement;
    expect(within(suspended).getByText("suspended")).toBeInTheDocument();
    expect(within(suspended).getByText("1,500")).toBeInTheDocument();
    expect(within(suspended).getByText("-")).toBeInTheDocument();
    expect(within(breakdown).getByRole("link", { name: /Manage tenants/ })).toHaveAttribute("href", "/dashboard/tenants");
    // A single trend point has no change to report.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("U-06b: says when the figures were computed (the backend caches them up to 30 s)", async () => {
    render(<DashboardPage />);
    await screen.findByText("Team Members");
    const at = new Date(tenantMetrics.generatedAt);
    const hhmmss = [at.getHours(), at.getMinutes(), at.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
    const stamp = screen.getByText(hhmmss);
    expect(stamp.tagName).toBe("TIME");
    expect(stamp).toHaveAttribute("dateTime", tenantMetrics.generatedAt);
  });

  it("a failed metrics load shows the error with a retry that reloads", async () => {
    metrics = httpError(500, "Metrics are unavailable");
    render(<DashboardPage />);

    expect(await screen.findByText(/Metrics are unavailable/)).toBeInTheDocument();
    expect(screen.queryByText("Team Members")).not.toBeInTheDocument();

    metrics = ok(tenantMetrics);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Team Members")).toBeInTheDocument();
    expect(screen.queryByText(/Metrics are unavailable/)).not.toBeInTheDocument();
  });

  it("the trends can be refreshed", async () => {
    render(<DashboardPage />);
    await screen.findByText("Team Members");
    const before = mockedGet.mock.calls.filter(([u]) => u === "/api/v1/dashboard/metrics").length;

    fireEvent.click(screen.getByRole("button", { name: "Refresh trends" }));

    await waitFor(() =>
      expect(mockedGet.mock.calls.filter(([u]) => u === "/api/v1/dashboard/metrics").length).toBe(before + 1),
    );
  });

  it("no users to show: the users panel says so", async () => {
    mockedGet.mockImplementation(async (url: string) =>
      url === "/api/v1/dashboard/metrics" ? ok(tenantMetrics) : ok([], { total: 0, page: 1, limit: 50, totalPages: 0 }),
    );
    render(<DashboardPage />);

    expect(await screen.findByText("No users to show")).toBeInTheDocument();
  });

  it("quick actions navigate, and View Site opens without an opener", async () => {
    const open = jest.spyOn(window, "open").mockImplementation(() => null);
    // Roles is the super admin's (the roles API is rbac SUPERADMIN).
    useMenuStore.setState({ effectivePermissions: { superAdmin: true, permissions: {} } });
    render(<DashboardPage />);
    await screen.findByText("Team Members");

    fireEvent.click(screen.getByRole("button", { name: /Roles/ }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/roles");
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/profile");
    fireEvent.click(screen.getByRole("button", { name: /View Site/ }));
    expect(open).toHaveBeenCalledWith("/", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("ADR-102: a technician is offered no admin quick action and never reads the user list", async () => {
    me = { ...me, role: { name: "TECHNICIAN" } };
    useAuthStore.setState({ user: me as unknown as User });
    useMenuStore.setState({ effectivePermissions: { superAdmin: false, permissions: { "profile-page": "write" } } });
    render(<DashboardPage />);
    await screen.findByText("Team Members");

    for (const name of [/Add User/, /New Tenant/, /Roles/, /Notifications/]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /Settings/ })).toBeInTheDocument();
    expect(mockedGet.mock.calls.some(([u]) => u === "/api/v1/users/all")).toBe(false);
    expect(screen.queryByText("No users to show")).not.toBeInTheDocument();
  });

  it("ADR-102: a tenant admin gets Add User but not the super admin's New Tenant and Roles", async () => {
    render(<DashboardPage />);
    await screen.findByText("Team Members");
    expect(screen.getByRole("button", { name: /Add User/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Tenant/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Roles/ })).not.toBeInTheDocument();
  });
});
