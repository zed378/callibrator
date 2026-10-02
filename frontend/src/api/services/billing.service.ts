// src/api/services/billing.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
// contract's (backend/src/routes/api/billing.openapi.ts →
// @callibrator/contracts/billing). The exported names are unchanged.
import { typedApi, unwrap, type JsonBody, type Op, type components } from "../typed";

export type Subscription = components["schemas"]["Subscription"];
export type Invoice = components["schemas"]["Invoice"];

export type SubscriptionStatus = Subscription["status"];
export type BillingCycle = Subscription["billingCycle"];
export type InvoiceStatus = Invoice["status"];

/** The override body (A-225: `reason` is required by the API when `status` changes). */
export type SubscriptionUpdateInput = JsonBody<Op<"/api/v1/billing/subscription", "patch">>;

/** F-19: `meta` of a paged list — a top-level sibling of `data` (house envelope). */
export type ListMeta = components["schemas"]["PaginationMeta"];

export const billingService = {
  /**
   * Get the current tenant's subscription (auto-created if none exists)
   */
  getSubscription: async (): Promise<Subscription> =>
    (await typedApi.GET("/api/v1/billing/subscription").then(unwrap)).data,

  /**
   * Update the current tenant's subscription
   */
  updateSubscription: async (input: SubscriptionUpdateInput): Promise<Subscription> =>
    (await typedApi.PATCH("/api/v1/billing/subscription", { body: input }).then(unwrap)).data,

  /**
   * Get invoices for the current tenant (paginated)
   */
  getInvoices: async (
    page = 1,
    limit = 10,
    status?: InvoiceStatus,
  ): Promise<{ data: Invoice[]; meta: ListMeta }> => {
    const response = await typedApi
      .GET("/api/v1/billing/invoices", {
        params: { query: { page, limit, status: status || undefined } },
      })
      .then(unwrap);
    // Defensive, as built: a body without a row array or `meta` still renders.
    const rows = Array.isArray(response.data) ? response.data : [];
    return {
      data: rows,
      meta: (response.meta as ListMeta | undefined) ?? {
        total: rows.length,
        page,
        limit,
        totalPages: rows.length > 0 ? 1 : 0,
      },
    };
  },
};

export default billingService;
