/** @jest-environment jsdom */
/**
 * Billing & Subscription, against the backend contract:
 *  - GET   /api/v1/quota                  → `data: { plan, status, features[], seats{used,limit}, storage{usedMb,limitMb} }`
 *  - GET   /api/v1/billing/subscription   → `data: subscription` (auto-created)
 *  - PATCH /api/v1/billing/subscription   → `data: subscription`; a status change needs a `reason` (400);
 *    a transition the state machine refuses, or a Stripe-managed subscription, is a 409
 *  - GET   /api/v1/billing/invoices       → rows in `data`, top-level `meta`
 *
 * Real: the page, useBilling, the billing and quota services, the stores.
 * Mocked: `@/api/client`'s transport, the dashboard layout.
 *
 * Fail-before: a failed invoice load rendered the error AND "No invoices
 * found" (InvoicesTable) — an unread history presented as an empty one.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/components/layouts/DashboardLayout", () =>
  function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  },
);
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));

import { api } from "@/api/client";
import BillingPage from "../page";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { useMenuStore } from "@/stores/menuStore";
import type { EffectivePermissions } from "@/api/services/menuGroupRole.service";
import { httpError, networkError } from "@/tests/support/httpErrors";
import type { User } from "@/types";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedGet = api.get as jest.Mock;
const mockedPatch = api.patch as jest.Mock;

const ok = (data: unknown, meta: unknown = null) => ({ success: true, status: 200, message: "ok", data, meta });

const quota = {
  plan: "professional",
  status: "active",
  features: ["advanced_reports", "sso"],
  seats: { used: 9, limit: 10 },
  storage: { usedMb: 120.5, limitMb: null },
};
const subscription = {
  id: "s1",
  tenantId: "t1",
  planId: "professional",
  status: "Active",
  billingCycle: "Monthly",
  currentPeriodStart: "2026-09-01T00:00:00.000Z",
  currentPeriodEnd: "2026-10-01T00:00:00.000Z",
  stripeSubscriptionId: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const invoice = (over: Record<string, unknown> = {}) => ({
  id: "inv-0000-1111",
  tenantId: "t1",
  subscriptionId: "s1",
  amountDue: "150",
  amountPaid: 150,
  currency: "usd",
  status: "Paid",
  invoiceUrl: "https://pay.example/inv/1",
  stripeInvoiceId: "in_1ABCDEFGHIJ",
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  subscription: { id: "s1", planId: "professional" },
  ...over,
});

type Answer = unknown | (() => unknown);
let answers: Record<string, Answer>;
const backend = () =>
  mockedGet.mockImplementation(async (url: string) => {
    const a = answers[url];
    if (a === undefined) throw new Error(`unexpected GET ${url}`);
    return typeof a === "function" ? (a as () => unknown)() : a;
  });

/** ADR-102: the edit is gated on the effective `billing` permission (menu store), not a role name. */
const as = (billing: "read" | "write") => {
  useAuthStore.setState({ user: { id: "u1", username: "ada" } as unknown as User });
  const effectivePermissions: EffectivePermissions = { superAdmin: false, permissions: { billing } };
  useMenuStore.setState({ effectivePermissions });
};

const invoiceParams = () =>
  mockedGet.mock.calls.filter(([u]) => u === "/api/v1/billing/invoices").map(([, c]) => (c as { params: unknown }).params);

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  answers = {
    "/api/v1/quota": ok(quota),
    "/api/v1/billing/subscription": ok(subscription),
    "/api/v1/billing/invoices": ok([invoice()], { total: 1, page: 1, limit: 10, totalPages: 1 }),
  };
  backend();
  as("write");
});

describe("Billing page", () => {
  it("shows the plan, usage, subscription and invoices", async () => {
    const { container } = render(<BillingPage />);

    expect(await screen.findByText("Plan & Usage")).toBeInTheDocument();
    expect(screen.getByText("Advanced Reports")).toBeInTheDocument();
    expect(screen.getByText("9 of 10")).toBeInTheDocument();
    expect(screen.getByText(/120\.5 MB/)).toHaveTextContent("Unlimited");
    expect(await screen.findByText("Current Subscription")).toBeInTheDocument();
    // Amount due and amount paid are both USD 150.00.
    const row = (await screen.findAllByText("USD 150.00"))[0].closest("tr") as HTMLElement;
    expect(within(row).getByText("in_1ABCD…")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /View/ })).toHaveAttribute("href", "https://pay.example/inv/1");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a user who may not edit billing sees no edit controls", async () => {
    as("read");
    render(<BillingPage />);

    await screen.findByText("Current Subscription");
    expect(screen.queryByText("Edit subscription")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("changing the plan saves without a reason and reports success", async () => {
    mockedPatch.mockResolvedValue(ok({ ...subscription, planId: "enterprise" }));
    render(<BillingPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^Plan/ }));
    fireEvent.click(screen.getByRole("option", { name: "Enterprise" }));
    fireEvent.click(screen.getByRole("button", { name: /^Billing Cycle/ }));
    fireEvent.click(screen.getByRole("option", { name: "Annually" }));
    expect(screen.queryByLabelText(/Reason for the status change/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockedPatch).toHaveBeenCalledWith("/api/v1/billing/subscription", {
        planId: "enterprise",
        billingCycle: "Annually",
        status: "Active",
      }),
    );
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([expect.objectContaining({ type: "success", title: "Subscription updated" })]),
    );
  });

  it("a status override asks for the reason and sends it", async () => {
    mockedPatch.mockResolvedValue(ok({ ...subscription, status: "PastDue" }));
    render(<BillingPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^Status/ }));
    fireEvent.click(screen.getByRole("option", { name: "Past Due" }));
    fireEvent.change(screen.getByLabelText(/Reason for the status change/), { target: { value: "  bank ref 42 " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockedPatch).toHaveBeenCalledWith("/api/v1/billing/subscription", {
        planId: "professional",
        billingCycle: "Monthly",
        status: "PastDue",
        reason: "bank ref 42",
      }),
    );
    // Saved: the reason field goes with the override it explained.
    await waitFor(() => expect(screen.queryByLabelText(/Reason for the status change/)).not.toBeInTheDocument());
  });

  it("a refused transition (409) is explained to the user, not shown as a generic failure", async () => {
    const message =
      'This subscription is "Canceled" and cannot be set to "Active" by hand. No manual transition leaves "Canceled".';
    answers["/api/v1/billing/subscription"] = ok({ ...subscription, status: "Canceled" });
    mockedPatch.mockRejectedValue(httpError(409, message));
    render(<BillingPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^Status/ }));
    fireEvent.click(screen.getByRole("option", { name: "Active" }));
    fireEvent.change(screen.getByLabelText(/Reason for the status change/), { target: { value: "paid" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([expect.objectContaining({ type: "error", title: message })]),
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("filters invoices by status, starting from page 1", async () => {
    render(<BillingPage />);
    await screen.findAllByText("USD 150.00");

    fireEvent.click(screen.getByRole("button", { name: "All Statuses" }));
    fireEvent.click(screen.getByRole("option", { name: "Open" }));

    await waitFor(() => expect(invoiceParams().at(-1)).toEqual({ page: 1, limit: 10, status: "Open" }));
  });

  it("no invoices: the empty state", async () => {
    answers["/api/v1/billing/invoices"] = ok([], { total: 0, page: 1, limit: 10, totalPages: 0 });
    render(<BillingPage />);

    expect(await screen.findByText("No invoices found")).toBeInTheDocument();
  });

  it("failed invoice load: the error, and not the empty state", async () => {
    answers["/api/v1/billing/invoices"] = () => {
      throw httpError(403, "You do not have permission to read billing");
    };
    const { container } = render(<BillingPage />);

    expect(await screen.findByText("You do not have permission to read billing")).toBeInTheDocument();
    expect(screen.queryByText("No invoices found")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("failed subscription and quota loads each show their own error", async () => {
    answers["/api/v1/quota"] = () => {
      throw httpError(404, "Tenant not found");
    };
    answers["/api/v1/billing/subscription"] = () => {
      throw networkError();
    };
    render(<BillingPage />);

    expect(await screen.findByText("Tenant not found")).toBeInTheDocument();
    expect(await screen.findByText("Network Error")).toBeInTheDocument();
    expect(screen.queryByText("Current Subscription")).not.toBeInTheDocument();
  });

  it("a plan with no features, at its seat limit, says so", async () => {
    answers["/api/v1/quota"] = ok({ ...quota, plan: "free", features: [], seats: { used: 10, limit: 10 }, storage: { usedMb: 1, limitMb: 100 } });
    render(<BillingPage />);

    expect(await screen.findByText("No additional features enabled.")).toBeInTheDocument();
    expect(screen.getByText("10 of 10")).toBeInTheDocument();
    expect(screen.getByText("1 MB of 100 MB")).toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument();
  });
});
