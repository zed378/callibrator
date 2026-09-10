// src/api/services/billing.service.ts
import { api } from "../client";

export type SubscriptionStatus = "Active" | "PastDue" | "Canceled" | "Unpaid";
export type BillingCycle = "Monthly" | "Annually";
export type InvoiceStatus =
  | "Draft"
  | "Open"
  | "Paid"
  | "Uncollectible"
  | "Void";

export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  tenantId: string;
  subscriptionId: string;
  amountDue: string | number;
  amountPaid: string | number;
  currency: string;
  status: InvoiceStatus;
  invoiceUrl?: string | null;
  stripeInvoiceId?: string | null;
  createdAt: string;
  updatedAt: string;
  subscription?: {
    id: string;
    planId: string;
  };
}

export interface SubscriptionUpdateInput {
  planId?: string;
  billingCycle?: BillingCycle;
  status?: SubscriptionStatus;
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Backend response envelopes
interface BackendSubscriptionResponse {
  success: boolean;
  status: number;
  message: string;
  data: Subscription;
}

interface BackendInvoicesListResponse {
  success: boolean;
  status: number;
  message: string;
  data: Invoice[] | null;
  meta?: ListMeta;
}

export const billingService = {
  /**
   * Get the current tenant's subscription (auto-created if none exists)
   */
  getSubscription: async (): Promise<Subscription> => {
    const response = await api.get<BackendSubscriptionResponse>(
      "/api/v1/billing/subscription",
    );
    return response.data;
  },

  /**
   * Update the current tenant's subscription
   */
  updateSubscription: async (
    input: SubscriptionUpdateInput,
  ): Promise<Subscription> => {
    const response = await api.patch<BackendSubscriptionResponse>(
      "/api/v1/billing/subscription",
      input,
    );
    return response.data;
  },

  /**
   * Get invoices for the current tenant (paginated)
   */
  getInvoices: async (
    page = 1,
    limit = 10,
    status?: InvoiceStatus,
  ): Promise<{ data: Invoice[]; meta: ListMeta }> => {
    const response = await api.get<BackendInvoicesListResponse>(
      "/api/v1/billing/invoices",
      {
        params: { page, limit, status: status || undefined },
      },
    );
    const rows = Array.isArray(response.data) ? response.data : [];
    return {
      data: rows,
      meta: response.meta ?? {
        total: rows.length,
        page,
        limit,
        totalPages: rows.length > 0 ? 1 : 0,
      },
    };
  },
};

export default billingService;
