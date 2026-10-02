import { api } from "../client";
import { typedApi, unwrap, type JsonBody, type Op, type QueryOf, type components } from "../typed";

/**
 * Asset finance — purchase cost and depreciation per calibration device.
 *
 * Backend: src/routes/api/finance.route.ts (mounted /api/v1/finance)
 *   GET    /                            ?page&limit&deviceId&method
 *   POST   /
 *   GET    /reports/depreciation        ?asOf&format=csv
 *   GET    /:financeId
 *   PATCH  /:financeId
 *   DELETE /:financeId
 *
 * This models ASSET DEPRECIATION (one record per device: purchase price,
 * useful life, salvage value), not contracts. The previous version of this
 * file described a contracts domain — name/type/currency/paymentTerms — that
 * exists nowhere in the backend.
 *
 * GET / sends `data` = rows array with `meta` as a TOP-LEVEL sibling.
 *
 * P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
 * contract's (backend/src/routes/api/finance.openapi.ts). The exported names
 * are unchanged. The CSV export stays on `api` (text).
 */

const BASE = "/api/v1/finance";
type F = "/api/v1/finance";
type Schemas = components["schemas"];

// ---------- Types ----------

export type PageMeta = Schemas["PaginationMeta"];

/**
 * A finance record with its computed depreciation; a list or single read also
 * carries its device and vendor (AssetFinanceWithRefs), a write's answer not.
 */
export type FinanceRecord = Schemas["AssetFinance"] & Partial<Pick<Schemas["AssetFinanceWithRefs"], "device" | "vendor">>;
export type DepreciationMethod = FinanceRecord["depreciationMethod"];

/** GET /reports/depreciation — the `csv` field is stripped from JSON responses. */
export type DepreciationReport = Schemas["DepreciationReport"];
/** One row of the depreciation report (keyed by `financeId`). */
export type DepreciationRow = DepreciationReport["rows"][number];
export type DepreciationTotals = DepreciationReport["totals"];

export type FinanceCreateInput = JsonBody<Op<F, "post">>;

/** PATCH accepts a partial — deviceId is fixed at creation. */
export type FinanceUpdateInput = JsonBody<Op<`${F}/{financeId}`, "patch">>;

export type FinanceListFilters = Pick<QueryOf<Op<F, "get">>, "deviceId" | "method">;

const byId = (financeId: string) => ({ params: { path: { financeId } } });

// ---------- Service ----------

export const financeService = {
  /**
   * GET / — the backend filters on deviceId and method only.
   */
  getAll: async (
    page = 1,
    limit = 20,
    filters: FinanceListFilters = {},
  ): Promise<{ data: FinanceRecord[]; meta: PageMeta }> => {
    const response = await typedApi
      .GET("/api/v1/finance", { params: { query: { page, limit, ...filters } } })
      .then(unwrap);

    // Defensive, as built: a body without rows or `meta` still renders.
    const rows = response.data ?? [];
    return {
      data: rows,
      meta:
        (response.meta as PageMeta | undefined) ?? {
          total: rows.length,
          page,
          limit,
          totalPages: 1,
        },
    };
  },

  /** GET /:financeId */
  getById: async (financeId: string): Promise<FinanceRecord> =>
    (await typedApi.GET("/api/v1/finance/{financeId}", byId(financeId)).then(unwrap)).data,

  /** POST / */
  create: async (input: FinanceCreateInput): Promise<FinanceRecord> =>
    (await typedApi.POST("/api/v1/finance", { body: input }).then(unwrap)).data,

  /** PATCH /:financeId — there is no PUT route. */
  update: async (
    financeId: string,
    input: FinanceUpdateInput,
  ): Promise<FinanceRecord> =>
    (await typedApi.PATCH("/api/v1/finance/{financeId}", { ...byId(financeId), body: input }).then(unwrap)).data,

  /** DELETE /:financeId */
  delete: async (financeId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/finance/{financeId}", byId(financeId));
  },

  /**
   * GET /reports/depreciation — book values as at `asOf` (default: now).
   * `asOf` is the only filter the backend reads.
   */
  getDepreciationReport: async (asOf?: string): Promise<DepreciationReport> =>
    (
      await typedApi
        .GET("/api/v1/finance/reports/depreciation", { params: { query: asOf ? { asOf } : {} } })
        .then(unwrap)
    ).data,

  /** The same report as raw CSV (?format=csv) — not an envelope. */
  exportDepreciationCsv: async (asOf?: string): Promise<string> =>
    api.get<string>(`${BASE}/reports/depreciation`, {
      params: asOf ? { asOf, format: "csv" } : { format: "csv" },
      responseType: "text",
    }),
};

export default financeService;
