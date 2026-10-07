/** @jest-environment jsdom */
/**
 * Usage & metering page against the backend contract
 * (backend/src/routes/api/meteredBilling.route.js, mounted
 * /api/v1/metered-billing; controllers/meteredBilling.controller.js;
 * services/meteredBilling.service.js; models/invoice.model.ts):
 *  - GET /usage   → data { tenantId, metrics: { [m]: { total, current, history } }, generatedAt }
 *  - GET /plan    → data { plan, billingCycle, limits, overagePricing }
 *  - GET /alerts  → UsageAlert rows in `data`
 *  - GET /history?page&limit → Invoice rows in `data`, pagination in a
 *    top-level `meta` (the documented metered-billing history shape). An
 *    Invoice has amountDue / amountPaid, currency, status "Paid" | "Open" | …
 *  - POST /alerts { metricName, threshold, comparison } → 201 · DELETE /alerts/:id
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});

jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import { useToastStore } from "@/stores/toastStore";
import MeteredBillingPage from "../page";
import { grantPermissions, grantSuperAdmin, clearPermissions } from "@/tests/support/permissions";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const ok = (data: unknown, message = "ok", meta?: unknown) => ({
  success: true,
  status: 200,
  message,
  data,
  ...(meta ? { meta } : {}),
});

const metric = (current: number) => ({ total: current * 3, current, history: [] });

const invoice = (id: string, status: string, amountDue: number) => ({
  id,
  tenantId: "t-1",
  subscriptionId: "s-1",
  amountDue,
  amountPaid: status === "Paid" ? amountDue : 0,
  currency: "USD",
  status,
  invoiceUrl: null,
  stripeInvoiceId: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

let alerts: unknown[];
let invoiceTotal: number;

const backend = () => {
  mockedGet.mockImplementation(async (url: string, config?: { params?: { page?: number; limit?: number } }) => {
    switch (url) {
      case "/api/v1/metered-billing/usage":
        return ok(
          {
            tenantId: "t-1",
            metrics: { api_calls: metric(9500), calibrations: metric(60), documents: metric(4) },
            generatedAt: "2026-09-29T08:00:00.000Z",
          },
          "Usage metrics retrieved",
        );
      case "/api/v1/metered-billing/plan":
        return ok(
          {
            plan: "free",
            billingCycle: "monthly",
            limits: { api_calls: 10000, calibrations: 50 },
            overagePricing: { api_calls: 0.001, calibrations: 2 },
          },
          "Plan details retrieved",
        );
      case "/api/v1/metered-billing/alerts":
        return ok(alerts, "Usage alerts retrieved");
      case "/api/v1/metered-billing/history": {
        const page = config?.params?.page ?? 1;
        return ok(
          page === 1
            ? [invoice("inv-00000001-aaaa", "Paid", 49), invoice("inv-00000002-bbbb", "Open", 12.5)]
            : [invoice("inv-00000011-cccc", "Paid", 10)],
          "Billing history retrieved",
          { total: invoiceTotal, page, limit: 10, totalPages: Math.ceil(invoiceTotal / 10) },
        );
      }
      default:
        throw httpError(404, "Not found");
    }
  });
};

const toasts = () => useToastStore.getState().toasts.map((t) => ({ type: t.type, title: t.title, description: t.description }));

beforeEach(() => {
  // ADR-102: write controls follow the effective permissions.
  grantPermissions({ "metered-billing": "write" });
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  alerts = [
    {
      id: "al-1",
      tenantId: "t-1",
      metricName: "api_calls",
      threshold: 9000,
      comparison: "gte",
      notificationChannels: ["email"],
      isEnabled: false,
      createdAt: "2026-09-01T00:00:00.000Z",
    },
  ];
  invoiceTotal = 2;
  backend();
});

const renderLoaded = async () => {
  const view = render(<MeteredBillingPage />);
  await screen.findByText("calibrations");
  return view;
};

describe("metered billing — reading", () => {
  it("shows the plan and each metric's current use against its limit", async () => {
    const { container } = await renderLoaded();

    expect(screen.getByText("free")).toBeInTheDocument();
    expect(screen.getByText("billed monthly")).toBeInTheDocument();
    expect(screen.getByText(`${(9500).toLocaleString()} / ${(10000).toLocaleString()} (95%)`)).toBeInTheDocument();
    expect(screen.getByText("60 / 50 (120%)")).toBeInTheDocument();
    // Over the limit: the overage rate is named.
    expect(screen.getByText(/Over the included limit — overage is charged at\s*2\s*per/)).toBeInTheDocument();
    // A metric with no plan limit shows its count alone.
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows invoices by what an Invoice row carries: amountDue, currency and a Paid status", async () => {
    await renderLoaded();

    const paid = screen.getAllByRole("row")[1];
    expect(within(paid).getByText("inv-0000")).toBeInTheDocument();
    expect(within(paid).getByText("49.00 USD")).toBeInTheDocument();
    // ADR-122 Am. 1: the registry's invoice tones (was text-success / text-warning, colour only).
    expect(within(paid).getByText("Paid")).toHaveAttribute("data-tone", "current");
    expect(within(paid).getByText(new Date("2026-09-01T00:00:00.000Z").toLocaleDateString())).toBeInTheDocument();
    const open = screen.getAllByRole("row")[2];
    expect(within(open).getByText("12.50 USD")).toBeInTheDocument();
    expect(within(open).getByText("Open")).toHaveAttribute("data-tone", "info");
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/metered-billing/history", { params: { page: 1, limit: 10 } });
  });

  it("lists alerts, marking a disabled one", async () => {
    await renderLoaded();

    const [alert] = screen.getAllByRole("listitem");
    expect(within(alert).getByText("api calls")).toBeInTheDocument();
    expect(within(alert).getByText(`gte ${(9000).toLocaleString()}`)).toBeInTheDocument();
    expect(within(alert).getByText("disabled")).toBeInTheDocument();
  });

  it("pages through invoices using the top-level meta", async () => {
    invoiceTotal = 11;
    await renderLoaded();
    expect(screen.getByText("Page 1 of 2 · 11 total")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    });

    expect(await screen.findByText("Page 2 of 2 · 11 total")).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/metered-billing/history", { params: { page: 2, limit: 10 } });
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    });
    expect(await screen.findByText("Page 1 of 2 · 11 total")).toBeInTheDocument();
  });

  it("shows the loading state first", async () => {
    mockedGet.mockImplementation(() => new Promise(() => undefined));
    render(<MeteredBillingPage />);

    expect(await screen.findByText("Loading…")).toBeInTheDocument();
  });

  it("empty usage, alerts and invoices are the empty states", async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (url.endsWith("/usage")) return ok({ tenantId: "t-1", metrics: {}, generatedAt: "2026-09-29T08:00:00.000Z" });
      if (url.endsWith("/plan")) return ok({ plan: "enterprise", limits: {}, overagePricing: {} });
      if (url.endsWith("/history")) return ok([], "ok", { total: 0, page: 1, limit: 10, totalPages: 0 });
      return ok([]);
    });
    render(<MeteredBillingPage />);

    expect(await screen.findByText("No metered usage recorded.")).toBeInTheDocument();
    expect(screen.getByText("No alerts configured.")).toBeInTheDocument();
    expect(screen.getByText("No invoices yet.")).toBeInTheDocument();
  });

  it("a failed read shows the error, never the empty states", async () => {
    mockedGet.mockRejectedValue(httpError(404, "Tenant not found"));
    const { container } = render(<MeteredBillingPage />);

    expect(await screen.findByText("Tenant not found")).toBeInTheDocument();
    expect(screen.getByText("Usage could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("Alerts could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("Invoices could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No invoices yet.")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("metered billing — alerts", () => {
  const openNew = () => {
    fireEvent.click(screen.getByRole("button", { name: "New Alert" }));
    return screen.getByRole("dialog", { name: "New Usage Alert" });
  };

  it("needs a metric and a positive threshold", async () => {
    await renderLoaded();
    const dialog = openNew();

    fireEvent.click(within(dialog).getByRole("button", { name: "Create Alert" }));
    expect(toasts()).toContainEqual({ type: "error", title: "Pick a metric", description: undefined });

    fireEvent.click(within(dialog).getByRole("button", { name: /^Metric/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "calibrations" }));
    fireEvent.change(within(dialog).getByLabelText(/Threshold/), { target: { value: "0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Alert" }));
    expect(toasts()).toContainEqual({ type: "error", title: "Threshold must be a positive number", description: undefined });

    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("POSTs the alert with the chosen comparison, then closes", async () => {
    mockedPost.mockResolvedValue(ok({ id: "al-2" }, "Usage alert created"));
    const { container } = await renderLoaded();
    const dialog = openNew();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: /^Metric/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "api calls" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^When usage is/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "above (>)" }));
    fireEvent.change(within(dialog).getByLabelText(/Threshold/), { target: { value: "9900" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create Alert" }));
    });

    expect(mockedPost).toHaveBeenCalledWith("/api/v1/metered-billing/alerts", {
      metricName: "api_calls",
      threshold: 9900,
      comparison: "gt",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toasts()).toContainEqual({ type: "success", title: "Alert created", description: undefined });
  });

  it("a refused alert keeps the dialog and says why", async () => {
    mockedPost.mockRejectedValue(httpError(400, "metricName and threshold are required"));
    await renderLoaded();
    const dialog = openNew();

    fireEvent.click(within(dialog).getByRole("button", { name: /^Metric/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "documents" }));
    fireEvent.change(within(dialog).getByLabelText(/Threshold/), { target: { value: "5" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create Alert" }));
    });

    expect(toasts()).toContainEqual({
      type: "error",
      title: "Could not create alert",
      description: "metricName and threshold are required",
    });
    expect(screen.getByRole("dialog", { name: "New Usage Alert" })).toBeInTheDocument();
  });

  it("deletes an alert and reloads", async () => {
    mockedDelete.mockImplementation(async () => {
      alerts = [];
      return ok(null, "Usage alert deleted");
    });
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete api_calls alert" }));
    });

    expect(mockedDelete).toHaveBeenCalledWith("/api/v1/metered-billing/alerts/al-1");
    expect(await screen.findByText("No alerts configured.")).toBeInTheDocument();
    expect(toasts()).toContainEqual({ type: "success", title: "Alert removed", description: undefined });
  });

  it("a delete of an alert that is gone (404) is reported and the alert stays listed", async () => {
    mockedDelete.mockRejectedValue(httpError(404, "Usage alert not found"));
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete api_calls alert" }));
    });

    expect(toasts()).toContainEqual({ type: "error", title: "Delete failed", description: "Usage alert not found" });
    expect(screen.getByRole("button", { name: "Delete api_calls alert" })).toBeInTheDocument();
  });

  it("Cancel closes the new-alert dialog without sending", async () => {
    await renderLoaded();
    fireEvent.click(within(openNew()).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockedPost).not.toHaveBeenCalled();
  });
});

/**
 * ADR-102 — usage & metering writes are gated on `metered-billing` write. ENGINEERING MANAGER holds it read.
 * Before the permissions load nothing is writable; the super admin writes.
 * Fail-before: New Alert and alert Delete rendered for every role.
 */
describe("ADR-102 — usage & metering write controls follow the effective permission", () => {
  const writeControls = [
      /New Alert/,
  ];

  it("a reader gets none of the write controls", async () => {
    grantPermissions({ "metered-billing": "read" });
    render(<MeteredBillingPage />);
    await screen.findByText("calibrations");
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("nothing is writable before the permissions load", async () => {
    clearPermissions();
    render(<MeteredBillingPage />);
    await screen.findByText("calibrations");
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("the super admin gets them", async () => {
    grantSuperAdmin();
    render(<MeteredBillingPage />);
    await screen.findByText("calibrations");
    expect(screen.getAllByRole("button", { name: /New Alert/ }).length).toBeGreaterThan(0);
  });
});
