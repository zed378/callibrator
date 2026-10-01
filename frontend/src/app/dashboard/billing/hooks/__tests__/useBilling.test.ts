/**
 * useBilling — subscription + invoices load independently, who may edit,
 * the invoice filter, and the save payload (A-225: `reason` only when given;
 * a refused transition is a 409 whose message explains the state).
 * Returns mirror billing.service: getSubscription/updateSubscription the
 * envelope's `data`, getInvoices `{ data, meta }`.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const billingService = { getSubscription: jest.fn(), getInvoices: jest.fn(), updateSubscription: jest.fn() };
jest.mock("@/api/services/billing.service", () => ({ billingService }));

import { useBilling } from "../useBilling";
import { useAuthStore } from "@/stores/authStore";
import { useMenuStore } from "@/stores/menuStore";
import { useToastStore } from "@/stores/toastStore";
import type { User } from "@/types";

const sub = {
  id: "s1", tenantId: "t1", planId: "pro", status: "PastDue", billingCycle: "Annually",
  currentPeriodStart: "2026-01-01", currentPeriodEnd: "2027-01-01", createdAt: "x", updatedAt: "x",
};
const invoice = {
  id: "i1", tenantId: "t1", subscriptionId: "s1", amountDue: "100.00", amountPaid: "0.00",
  currency: "IDR", status: "Open", createdAt: "x", updatedAt: "x",
};
const invoicesPage = { data: [invoice], meta: { total: 11, page: 1, limit: 10, totalPages: 2 } };
const lastToast = () => useToastStore.getState().toasts.at(-1);
type Effective = { superAdmin: boolean; permissions: Record<string, "read" | "write"> } | null;
// ADR-102: write actions follow the caller's EFFECTIVE permission on the
// hook's API slug (GET /menu-groups/my-permissions), never a role name.
const grant = (effectivePermissions: Effective) => useMenuStore.setState({ effectivePermissions });
const signIn = (role: string) =>
  useAuthStore.setState({ user: { id: "u1", role: { name: role } } as unknown as User });

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  signIn("HEALTHCARE ADMIN");
  grant({ superAdmin: false, permissions: { billing: "write" } });
  billingService.getSubscription.mockResolvedValue(sub);
  billingService.getInvoices.mockResolvedValue(invoicesPage);
});

const setup = async () => {
  const hook = renderHook(() => useBilling());
  await waitFor(() => expect(hook.result.current.isSubscriptionLoading).toBe(false));
  await waitFor(() => expect(hook.result.current.isInvoicesLoading).toBe(false));
  return hook;
};

describe("useBilling", () => {
  it("loads the subscription into the form and the first invoice page", async () => {
    const { result } = await setup();
    expect(result.current.subscription).toEqual(sub);
    expect(result.current.form).toEqual({ planId: "pro", billingCycle: "Annually", status: "PastDue", reason: "" });
    expect(billingService.getInvoices).toHaveBeenCalledWith(1, 10, undefined);
    expect(result.current.invoices).toEqual([invoice]);
    expect(result.current.invoicesMeta).toEqual(invoicesPage.meta);
    expect(result.current.canEditSubscription).toBe(true);
  });

  it.each<[string, Effective, boolean]>([
    ["superAdmin", { superAdmin: true, permissions: {} }, true],
    ["write on billing", { superAdmin: false, permissions: { billing: "write" } }, true],
    ["read on billing", { superAdmin: false, permissions: { billing: "read" } }, false],
    ["write on another slug only", { superAdmin: false, permissions: { other: "write" } }, false],
    ["permissions not loaded (null)", null, false],
  ])("may edit the subscription: %s → %s", async (_label, effective, may) => {
    grant(effective);
    const { result } = await setup();
    expect(result.current.canEditSubscription).toBe(may);
  });

  it("a subscription missing fields falls back to the form defaults", async () => {
    billingService.getSubscription.mockResolvedValue({ ...sub, planId: "", billingCycle: undefined, status: undefined });
    const { result } = await setup();
    expect(result.current.form).toEqual({ planId: "basic", billingCycle: "Monthly", status: "Active", reason: "" });
  });

  it("the status filter reaches the request and returns to page 1", async () => {
    const { result } = await setup();
    act(() => result.current.setInvoicesPage(2));
    await waitFor(() => expect(billingService.getInvoices).toHaveBeenLastCalledWith(2, 10, undefined));
    act(() => result.current.handleStatusFilterChange("Paid"));
    expect(result.current.invoicesPage).toBe(1);
    await waitFor(() => expect(billingService.getInvoices).toHaveBeenLastCalledWith(1, 10, "Paid"));
    await waitFor(() => expect(result.current.isInvoicesLoading).toBe(false));
  });

  it("each list's failure is its own error, with the backend message or a fallback", async () => {
    billingService.getSubscription.mockRejectedValue(new Error("Forbidden"));
    billingService.getInvoices.mockRejectedValue("x");
    const { result } = await setup();
    expect(result.current.subscriptionError).toBe("Forbidden");
    expect(result.current.invoicesError).toBe("Failed to load invoices");
    expect(result.current.subscription).toBeNull();
  });

  it("a non-Error subscription failure has a fallback message", async () => {
    billingService.getSubscription.mockRejectedValue(null);
    const { result } = await setup();
    expect(result.current.subscriptionError).toBe("Failed to load subscription");
  });

  it("save sends the form, with a trimmed reason only when one is given", async () => {
    billingService.updateSubscription.mockResolvedValue({ ...sub, status: "Active" });
    const { result } = await setup();
    await act(async () => result.current.handleSaveSubscription());
    expect(billingService.updateSubscription).toHaveBeenLastCalledWith({
      planId: "pro", billingCycle: "Annually", status: "PastDue",
    });
    act(() => result.current.setForm((f) => ({ ...f, status: "Active", reason: "  INV-2026-09 bank ref " })));
    await act(async () => result.current.handleSaveSubscription());
    expect(billingService.updateSubscription).toHaveBeenLastCalledWith({
      planId: "pro", billingCycle: "Annually", status: "Active", reason: "INV-2026-09 bank ref",
    });
    expect(result.current.subscription?.status).toBe("Active");
    expect(result.current.form.reason).toBe("");
    expect(lastToast()).toMatchObject({ type: "success", title: "Subscription updated" });
    expect(result.current.isSaving).toBe(false);
  });

  it("a saved subscription missing fields resets the form to defaults", async () => {
    billingService.updateSubscription.mockResolvedValue({ ...sub, planId: "", billingCycle: "", status: "" });
    const { result } = await setup();
    await act(async () => result.current.handleSaveSubscription());
    expect(result.current.form).toEqual({ planId: "basic", billingCycle: "Monthly", status: "Active", reason: "" });
  });

  it("a 409 refused transition surfaces the backend's state explanation", async () => {
    const explanation = 'This subscription is "Canceled" and cannot be set to "Active" by hand. No manual transition leaves "Canceled".';
    billingService.updateSubscription.mockRejectedValueOnce(
      Object.assign(new Error(explanation), { response: { status: 409, data: { success: false, status: 409, message: explanation } } }),
    );
    const { result } = await setup();
    await act(async () => result.current.handleSaveSubscription());
    expect(lastToast()).toMatchObject({ type: "error", title: explanation });
    expect(result.current.subscription).toEqual(sub);

    billingService.updateSubscription.mockRejectedValueOnce({});
    await act(async () => result.current.handleSaveSubscription());
    expect(lastToast()).toMatchObject({ type: "error", title: "Failed to update subscription" });
  });
});
