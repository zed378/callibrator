// src/api/services/supplierScorecard.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
// contract's (backend/src/routes/api/supplierScorecard.openapi.ts →
// @callibrator/contracts/supplierScorecard). The exported names are unchanged.
import { typedApi, unwrap, type JsonBody, type Op, type components } from "../typed";
import type { ListPage } from "./risk.service";

type S = "/api/v1/supplier-scorecard";
type CreateBody = JsonBody<Op<S, "post">>;
type UpdateBody = JsonBody<Op<`${S}/{id}`, "put">>;

// ---------- Types ----------

export type SupplierScorecardStatus = NonNullable<CreateBody["status"]>;

/**
 * A scorecard. `overallScore` is virtual: round((quality + delivery +
 * service) / 3). A list or single read also carries its vendor and evaluator
 * (SupplierScorecardWithRefs); a write's answer is the row.
 */
export type SupplierScorecard = components["schemas"]["SupplierScorecard"];

/**
 * The create body, with `status` as the page's select gives it (a string;
 * the select offers only the contract's statuses, A-336).
 */
export type SupplierScorecardCreateInput = Omit<CreateBody, "status"> & {
  status?: SupplierScorecardStatus | string;
};

export type SupplierScorecardUpdateInput = Partial<SupplierScorecardCreateInput>;

const byId = (id: string) => ({ params: { path: { id } } });

// ---------- Service ----------

export const supplierScorecardService = {
  /**
   * List supplier scorecards. GET /api/v1/supplier-scorecard
   */
  list: async (params?: {
    vendorId?: string;
    status?: string;
  }): Promise<SupplierScorecard[]> =>
    (await typedApi.GET("/api/v1/supplier-scorecard", { params: { query: params } }).then(unwrap)).data,

  /**
   * One page of scorecards with the backend's `meta` (F-19). The backend's
   * default page is 10 rows, so a caller that ignores `meta` silently shows
   * only the first 10.
   */
  listPage: async (params: {
    vendorId?: string;
    status?: string;
    page: number;
    limit: number;
  }): Promise<ListPage<SupplierScorecard>> => {
    const response = await typedApi.GET("/api/v1/supplier-scorecard", { params: { query: params } }).then(unwrap);
    // Defensive, as built: a body without rows or `meta` still renders.
    const rows = Array.isArray(response.data) ? response.data : [];
    const meta = response.meta as Partial<components["schemas"]["PaginationMeta"]> | undefined;
    const total = meta?.total ?? rows.length;
    const limit = meta?.limit ?? params.limit;
    return {
      rows,
      meta: {
        total,
        page: meta?.page ?? params.page,
        limit,
        totalPages: meta?.totalPages ?? Math.max(1, Math.ceil(total / limit)),
      },
    };
  },

  /**
   * Get a single scorecard. GET /api/v1/supplier-scorecard/:id
   */
  getById: async (id: string): Promise<SupplierScorecard> =>
    (await typedApi.GET("/api/v1/supplier-scorecard/{id}", byId(id)).then(unwrap)).data,

  /**
   * Create a scorecard. POST /api/v1/supplier-scorecard
   */
  create: async (
    data: SupplierScorecardCreateInput,
  ): Promise<SupplierScorecard> =>
    // The status is the page's select value (see SupplierScorecardCreateInput).
    (await typedApi.POST("/api/v1/supplier-scorecard", { body: data as CreateBody }).then(unwrap)).data,

  /**
   * Update a scorecard. PUT /api/v1/supplier-scorecard/:id
   */
  update: async (
    id: string,
    data: SupplierScorecardUpdateInput,
  ): Promise<SupplierScorecard> =>
    (await typedApi.PUT("/api/v1/supplier-scorecard/{id}", { ...byId(id), body: data as UpdateBody }).then(unwrap))
      .data,

  /**
   * Delete a scorecard. DELETE /api/v1/supplier-scorecard/:id
   */
  delete: async (id: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/supplier-scorecard/{id}", byId(id));
  },
};

export default supplierScorecardService;
