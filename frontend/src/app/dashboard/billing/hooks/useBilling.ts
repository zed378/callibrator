// src/app/dashboard/billing/hooks/useBilling.ts
import { deferEffect } from "@/lib/deferEffect";
import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import {
  billingService,
  Subscription,
  SubscriptionUpdateInput,
  Invoice,
  InvoiceStatus,
  BillingCycle,
  SubscriptionStatus,
  ListMeta,
} from "@/api/services/billing.service";

export interface SubscriptionForm {
  planId: string;
  billingCycle: BillingCycle;
  status: SubscriptionStatus;
  /** A-225: why a status is overridden by hand — required by the API when it changes. */
  reason: string;
}

export function useBilling() {
  const { user } = useAuthStore();
  const { addToast } = useToastStore();

  // Subscription state
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isSubscriptionLoading, setIsSubscriptionLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);

  // Edit form state
  const [form, setForm] = useState<SubscriptionForm>({
    planId: "basic",
    billingCycle: "Monthly",
    status: "Active",
    reason: "",
  });

  // Invoices state
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesMeta, setInvoicesMeta] = useState<ListMeta>({
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 0,
  });
  const [isInvoicesLoading, setIsInvoicesLoading] = useState(true);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);
  const [invoicesPage, setInvoicesPage] = useState(1);
  const [pageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "">("");

  const canEditSubscription =
    user?.role?.name === "SUPERADMIN" ||
    user?.role?.name === "HEALTHCARE ADMIN";

  const fetchSubscription = useCallback(async () => {
    setIsSubscriptionLoading(true);
    setSubscriptionError(null);
    try {
      const data = await billingService.getSubscription();
      setSubscription(data);
      setForm({
        planId: data.planId || "basic",
        billingCycle: data.billingCycle || "Monthly",
        status: data.status || "Active",
        reason: "",
      });
    } catch (err) {
      setSubscriptionError(
        err instanceof Error ? err.message : "Failed to load subscription",
      );
    } finally {
      setIsSubscriptionLoading(false);
    }
  }, []);

  const fetchInvoices = useCallback(async () => {
    setIsInvoicesLoading(true);
    setInvoicesError(null);
    try {
      const result = await billingService.getInvoices(
        invoicesPage,
        pageSize,
        statusFilter || undefined,
      );
      setInvoices(result.data);
      setInvoicesMeta(result.meta);
    } catch (err) {
      setInvoicesError(
        err instanceof Error ? err.message : "Failed to load invoices",
      );
    } finally {
      setIsInvoicesLoading(false);
    }
  }, [invoicesPage, pageSize, statusFilter]);

  useEffect(() => deferEffect(fetchSubscription), [fetchSubscription]);

  useEffect(() => deferEffect(fetchInvoices), [fetchInvoices]);

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value as InvoiceStatus | "");
    setInvoicesPage(1);
  };

  const handleSaveSubscription = async () => {
    setIsSaving(true);
    try {
      const payload: SubscriptionUpdateInput = {
        planId: form.planId,
        billingCycle: form.billingCycle,
        status: form.status,
        ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
      };
      const updated = await billingService.updateSubscription(payload);
      setSubscription(updated);
      setForm({
        planId: updated.planId || "basic",
        billingCycle: updated.billingCycle || "Monthly",
        status: updated.status || "Active",
        reason: "",
      });
      addToast({ type: "success", title: "Subscription updated" });
    } catch (err) {
      addToast({
        type: "error",
        title:
          err instanceof Error ? err.message : "Failed to update subscription",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return {
    subscription,
    isSubscriptionLoading,
    subscriptionError,
    canEditSubscription,
    form,
    setForm,
    isSaving,
    handleSaveSubscription,
    invoices,
    invoicesMeta,
    isInvoicesLoading,
    invoicesError,
    invoicesPage,
    setInvoicesPage,
    pageSize,
    statusFilter,
    handleStatusFilterChange,
  };
}

export default useBilling;
