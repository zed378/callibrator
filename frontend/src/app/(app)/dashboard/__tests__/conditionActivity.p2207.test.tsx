/** @jest-environment jsdom */
/**
 * P22-07 (F-70 … F-73; ADR-126 Am. 6) — the dashboard's condition panel and drill-down, the IPM
 * figures, technician activity, and the provider-internal cards hidden for a bound user.
 *
 * Against GET /api/v1/dashboard/metrics (`devices.byCondition`, `ipm`) and GET /api/v1/ipm/sessions
 * (rows in `data`, paging in the top-level `meta`). Real: the island, the panels, the generated
 * client and its transport, the stores. Mocked: `api` (the wire), the layout, the health panel.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { id } from "@/i18n/messages/id";
import { MessagesProvider } from "@/i18n/MessagesProvider";

jest.mock("@/components/layouts/DashboardLayout", () =>
  function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  },
);
jest.mock("../components/DashboardSystemHealth", () => () => null);
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn() },
}));

import { api } from "@/api/client";
import { DashboardClient } from "../DashboardClient";
import { DeviceConditionPanel, donutSegments, drillDownHref, shareOf } from "../components/DeviceConditionPanel";
import { activityQuery, snapshotText } from "../components/TechnicianActivity";
import { useAuthStore } from "@/stores/authStore";
import { useUserStore } from "@/stores/userStore";
import { useMenuStore } from "@/stores/menuStore";
import type { User } from "@/types";

jest.setTimeout(20000);

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const ok = (data: unknown, meta: unknown = null) => ({ success: true, status: 200, message: "ok", data, meta });

const metricsOf = (over: Record<string, unknown> = {}) => ({
  scope: "tenant",
  generatedAt: "2026-10-10T00:00:00.000Z",
  tenant: { id: "t1", name: "PT Kalibrasi Sintetis", code: "pks", status: "active" },
  users: { total: 4, verified: 4 },
  devices: { total: 20, byStatus: { active: 20 }, dueSoon: 1, overdue: 0, byCondition: { good: 10, not_good: 5, broken: 3, unset: 2 } },
  calibrations: { total: 5, compliant: 5, complianceRate: 100, last30Days: 1 },
  certificates: { total: 0, byStatus: {} },
  inventory: { stockItems: 0, totalQuantity: 0, lowStockItems: 0, warehouses: 0, pendingTransfers: 0, openOpnames: 0 },
  maintenance: { openWorkOrders: 0 },
  ipm: { sessionsLast30Days: 7, due: { scheduled: 18, due: 6, neverInspected: 2 } },
  trends: { calibrations: [], certificates: [] },
  ...over,
});

const visit = {
  id: "5e550000-0000-4000-8000-000000000001",
  performedAt: "2026-10-01T03:00:00.000Z",
  recommendation: "needs_repair",
  deviceSnapshot: { name: "Infusion pump sintetis", qrCode: "QR-0001", serialNumber: "SN-77" },
  facilitySnapshot: { id: "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1", name: "Puskesmas Sintetis" },
  performerDisplay: { name: "Teknisi Satu", role: null, organisation: null, redacted: false },
};

let metrics: unknown;
let sessions: unknown;
const me = { id: "u1", username: "tek", firstName: "Tek", lastName: "Satu", role: { name: "TECHNICIAN" } };
const grant = (permissions: Record<string, string>, facilityBound = false) =>
  useMenuStore.setState({ effectivePermissions: { superAdmin: false, permissions, facilityBound } as never });
const sessionCalls = () => mockedGet.mock.calls.filter(([url]) => url === "/api/v1/ipm/sessions");

beforeEach(() => {
  jest.clearAllMocks();
  metrics = ok(metricsOf());
  sessions = ok([visit], { total: 1, page: 1, limit: 5, totalPages: 1 });
  useUserStore.setState({ users: null });
  useAuthStore.setState({ user: me as unknown as User, isAuthenticated: true });
  grant({ calibration: "read", ipm: "read" });
  mockedPost.mockImplementation(async (url: string) => {
    if (url === "/api/v1/auth/verify") return ok(me);
    throw new Error(`unexpected POST ${url}`);
  });
  mockedGet.mockImplementation(async (url: string) => {
    if (url === "/api/v1/dashboard/metrics") return metrics;
    if (url === "/api/v1/ipm/sessions") {
      if (sessions instanceof Error) throw sessions;
      return sessions;
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

describe("P22-07 — device condition (F-70, F-71)", () => {
  it("shows each condition's count and share, a donut, and drills down to the filtered register; `unset` has no link", async () => {
    const { container } = render(<DashboardClient />);
    const panel = await screen.findByRole("region", { name: "Device condition" });
    expect(within(panel).getByRole("img", { name: "Device condition: Good 10, Not good 5, Broken 3, Not assessed 2" })).toBeInTheDocument();
    expect(within(panel).getByText("20 devices")).toBeInTheDocument();
    expect(within(panel).getByRole("progressbar", { name: "Share of devices: Good" })).toHaveAttribute("aria-valuenow", "50");
    expect(within(panel).getByRole("progressbar", { name: "Share of devices: Broken" })).toHaveAttribute("aria-valuenow", "15");
    expect(within(panel).getByRole("link", { name: "Show Good devices" })).toHaveAttribute("href", "/dashboard/devices?condition=good");
    expect(within(panel).getByRole("link", { name: "Show Not good devices" })).toHaveAttribute("href", "/dashboard/devices?condition=not_good");
    expect(within(panel).getByRole("link", { name: "Show Broken devices" })).toHaveAttribute("href", "/dashboard/devices?condition=broken");
    expect(within(panel).queryByRole("link", { name: /Not assessed/ })).not.toBeInTheDocument();
    expect(within(panel).getByText("The device list cannot be filtered by this condition yet.")).toBeInTheDocument();
    await screen.findByText("Infusion pump sintetis");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("offers no drill-down to a caller who cannot read the register", async () => {
    grant({ ipm: "read" });
    render(<DashboardClient />);
    const panel = await screen.findByRole("region", { name: "Device condition" });
    expect(within(panel).queryAllByRole("link")).toHaveLength(0);
  });

  it("says so when no device is registered", async () => {
    metrics = ok(metricsOf({ devices: { total: 0, byStatus: {}, dueSoon: 0, overdue: 0, byCondition: { good: 0, not_good: 0, broken: 0, unset: 0 } } }));
    render(<DashboardClient />);
    expect(await screen.findByText("No devices are registered yet.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Device condition/ })).not.toBeInTheDocument();
  });

  it("the helpers: shares, the donut's segments in order from twelve o'clock, the drill-down", () => {
    expect(shareOf(1, 3)).toBe(33);
    expect(shareOf(0, 0)).toBe(0);
    expect(donutSegments({ good: 1, not_good: 0, broken: 1, unset: 2 }, 4)).toEqual([
      { key: "good", stroke: "stroke-success", length: 25, offset: 25 },
      { key: "broken", stroke: "stroke-destructive", length: 25, offset: 0 },
      { key: "unset", stroke: "stroke-muted-foreground", length: 50, offset: -25 },
    ]);
    expect(drillDownHref("unset")).toBeNull();
    expect(drillDownHref("broken")).toBe("/dashboard/devices?condition=broken");
  });

  it("speaks Indonesian when the page hands it the Indonesian strings", () => {
    render(
      <MessagesProvider locale="id" messages={id}>
        <DeviceConditionPanel byCondition={{ good: 1, not_good: 0, broken: 0, unset: 0 }} canOpenRegister />
      </MessagesProvider>,
    );
    const panel = screen.getByRole("region", { name: "Kondisi alat" });
    expect(panel).toHaveAttribute("lang", "id");
    expect(within(panel).getByRole("link", { name: "Tampilkan alat Baik" })).toBeInTheDocument();
  });
});

describe("P22-07 — IPM figures", () => {
  it("shows the visits of 30 days and this month's due counts, with the history link for an ipm reader", async () => {
    render(<DashboardClient />);
    const panel = await screen.findByRole("region", { name: "Inspection and preventive maintenance (IPM)" });
    expect(within(panel).getByText("IPM visits in the last 30 days").nextSibling).toHaveTextContent("7");
    expect(within(panel).getByText("Due this month").nextSibling).toHaveTextContent("6");
    expect(within(panel).getByText("Never inspected").nextSibling).toHaveTextContent("2");
    expect(within(panel).getByText("Devices on an IPM schedule").nextSibling).toHaveTextContent("18");
    expect(within(panel).getByRole("link", { name: "Open the IPM history" })).toHaveAttribute("href", "/dashboard/ipm");
  });

  it("in the global view `due` is null: a note, not zeros; no activity list", async () => {
    useMenuStore.setState({ effectivePermissions: { superAdmin: true, permissions: {} } });
    metrics = ok(metricsOf({ scope: "global", tenant: null, tenants: { total: 2, active: 2 }, tenantBreakdown: [], ipm: { sessionsLast30Days: 3, due: null } }));
    render(<DashboardClient />);
    expect(await screen.findByText("IPM due counts are per tenant: choose a tenant to see them.")).toBeInTheDocument();
    expect(screen.queryByText("Due this month")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Technician activity" })).not.toBeInTheDocument();
    expect(sessionCalls()).toHaveLength(0);
  });
});

describe("P22-07 — technician activity (F-73)", () => {
  it("lists the latest submitted, effective visits from the visits' snapshots", async () => {
    render(<DashboardClient />);
    const panel = await screen.findByRole("region", { name: "Technician activity" });
    const row = (await within(panel).findByText("Infusion pump sintetis")).closest("tr") as HTMLElement;
    expect(within(row).getByText("QR-0001")).toBeInTheDocument();
    expect(within(row).getByText("SN-77")).toBeInTheDocument();
    expect(within(row).getByText("Puskesmas Sintetis")).toBeInTheDocument();
    expect(within(row).getByText("Teknisi Satu")).toBeInTheDocument();
    expect(within(row).getByText("Needs repair")).toBeInTheDocument();
    expect(sessionCalls()[0]?.[1]).toEqual({ params: { page: 1, limit: 5, status: "submitted", effective: true, sort: "performedAt" } });
    expect(within(panel).getByRole("link", { name: "All IPM history" })).toHaveAttribute("href", "/dashboard/ipm");
  });

  it("searches by device or QR, and narrows to the caller's own visits", async () => {
    render(<DashboardClient />);
    const panel = await screen.findByRole("region", { name: "Technician activity" });
    await within(panel).findByText("Infusion pump sintetis");
    fireEvent.change(within(panel).getByRole("searchbox", { name: "Search device or QR" }), { target: { value: " QR-0001 " } });
    fireEvent.click(within(panel).getByRole("button", { name: "Search" }));
    await waitFor(() => expect(sessionCalls().at(-1)?.[1]).toEqual({ params: expect.objectContaining({ q: "QR-0001" }) }));
    fireEvent.click(within(panel).getByRole("checkbox", { name: "Only my visits" }));
    await waitFor(() => expect(sessionCalls().at(-1)?.[1]).toEqual({ params: expect.objectContaining({ q: "QR-0001", performedBy: "u1" }) }));
  });

  it("an empty answer is not a failure; a failure offers a retry", async () => {
    sessions = ok([], { total: 0, page: 1, limit: 5, totalPages: 0 });
    const { unmount } = render(<DashboardClient />);
    expect(await screen.findByText("No submitted visits match.")).toBeInTheDocument();
    unmount();

    sessions = new Error("down");
    render(<DashboardClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The visits could not be loaded.");
    sessions = ok([{ ...visit, recommendation: null, deviceSnapshot: null, facilitySnapshot: { name: " " }, performerDisplay: null }], { total: 1, page: 1, limit: 5, totalPages: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const row = (await screen.findAllByRole("row"))[1] as HTMLElement;
    expect(within(row).getAllByText("—")).toHaveLength(6);
  });

  it("is not shown without `ipm` read, and the IPM panel offers no history link", async () => {
    grant({ calibration: "read" });
    render(<DashboardClient />);
    const panel = await screen.findByRole("region", { name: "Inspection and preventive maintenance (IPM)" });
    expect(within(panel).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Technician activity" })).not.toBeInTheDocument();
    expect(sessionCalls()).toHaveLength(0);
  });

  it("the helpers: only what is set is sent; a blank snapshot value is none", () => {
    expect(activityQuery("  ", null)).toEqual({ page: 1, limit: 5, status: "submitted", effective: true, sort: "performedAt" });
    expect(activityQuery("x", "u9")).toMatchObject({ q: "x", performedBy: "u9" });
    expect(snapshotText(null, "name")).toBeNull();
    expect(snapshotText({ name: 3 }, "name")).toBeNull();
  });
});

describe("P22-07 — a facility-bound user (ADR-126 Am. 6)", () => {
  it("hides the provider-internal cards (warehouses, stock, transfers); an unbound user sees them", async () => {
    grant({ calibration: "read", ipm: "read" }, true);
    const { unmount } = render(<DashboardClient />);
    expect(await screen.findByText("Team Members")).toBeInTheDocument();
    expect(screen.queryByText("Warehouses")).not.toBeInTheDocument();
    expect(screen.queryByText("Low Stock")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending Transfers")).not.toBeInTheDocument();
    expect(screen.getByText("Devices")).toBeInTheDocument();
    unmount();

    grant({ calibration: "read", ipm: "read" }, false);
    render(<DashboardClient />);
    expect(await screen.findByText("Warehouses")).toBeInTheDocument();
    expect(screen.getByText("Pending Transfers")).toBeInTheDocument();
  });
});
