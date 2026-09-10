import { api } from "../client";

/**
 * Asset finance — purchase cost and depreciation per calibration device.
 *
 * Backend: src/routes/api/finance.route.js (mounted /api/v1/finance)
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
 */

const BASE = "/api/v1/finance";

// ---------- Types ----------

export type DepreciationMethod = "straight_line" | "declining_balance";

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FinanceRecord {
  id: string;
  tenantId?: string;
  deviceId: string;
  purchasePrice: number;
  purchaseDate: string;
  /** Residual value at end of life. Server defaults to 0. */
  salvageValue: number;
  usefulLifeYears: number;
  /** Server defaults to "straight_line". */
  depreciationMethod: DepreciationMethod;
  vendorId?: string | null;
  invoiceNumber?: string | null;
  notes?: string | null;
  device?: { id: string; name?: string; serialNumber?: string };
  vendor?: { id: string; name?: string };
  createdAt?: string;
  updatedAt?: string;
}

/** One row of the depreciation report. */
export interface DepreciationRow {
  id: string;
  deviceId: string;
  deviceName?: string;
  serialNumber?: string;
  purchaseDate: string;
  purchasePrice: number;
  salvageValue: number;
  usefulLifeYears: number;
  method: DepreciationMethod;
  ageYears?: number;
  annualDepreciation?: number;
  accumulatedDepreciation: number;
  bookValue: number;
  fullyDepreciated: boolean;
}

export interface DepreciationTotals {
  totalPurchase: number;
  totalAccumulatedDepreciation: number;
  totalBookValue: number;
  fullyDepreciatedCount: number;
}

/** GET /reports/depreciation — the `csv` field is stripped from JSON responses. */
export interface DepreciationReport {
  asOf: string;
  totals: DepreciationTotals;
  count: number;
  rows: DepreciationRow[];
}

export interface FinanceCreateInput {
  deviceId: string;
  purchasePrice: number;
  /** ISO date. */
  purchaseDate: string;
  /** Server defaults to 0. */
  salvageValue?: number;
  /** 1–50. */
  usefulLifeYears: number;
  /** Server defaults to "straight_line". */
  depreciationMethod?: DepreciationMethod;
  vendorId?: string | null;
  invoiceNumber?: string | null;
  notes?: string | null;
}

/** PATCH accepts a partial — deviceId is fixed at creation. */
export type FinanceUpdateInput = Partial<Omit<FinanceCreateInput, "deviceId">>;

export interface FinanceListFilters {
  deviceId?: string;
  method?: DepreciationMethod;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

interface BackendListResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T[];
  meta?: PageMeta;
}

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
    const response = await api.get<BackendListResponse<FinanceRecord>>(BASE, {
      params: { page, limit, ...filters },
    });

    const rows = response.data ?? [];
    return {
      data: rows,
      meta:
        response.meta ?? {
          total: rows.length,
          page,
          limit,
          totalPages: 1,
        },
    };
  },

  /** GET /:financeId */
  getById: async (financeId: string): Promise<FinanceRecord> => {
    const response = await api.get<BackendResponse<FinanceRecord>>(
      `${BASE}/${financeId}`,
    );
    return response.data;
  },

  /** POST / */
  create: async (input: FinanceCreateInput): Promise<FinanceRecord> => {
    const response = await api.post<BackendResponse<FinanceRecord>>(
      BASE,
      input,
    );
    return response.data;
  },

  /** PATCH /:financeId — there is no PUT route. */
  update: async (
    financeId: string,
    input: FinanceUpdateInput,
  ): Promise<FinanceRecord> => {
    const response = await api.patch<BackendResponse<FinanceRecord>>(
      `${BASE}/${financeId}`,
      input,
    );
    return response.data;
  },

  /** DELETE /:financeId */
  delete: async (financeId: string): Promise<void> => {
    await api.delete<BackendResponse<null>>(`${BASE}/${financeId}`);
  },

  /**
   * GET /reports/depreciation — book values as at `asOf` (default: now).
   * `asOf` is the only filter the backend reads.
   */
  getDepreciationReport: async (asOf?: string): Promise<DepreciationReport> => {
    const response = await api.get<BackendResponse<DepreciationReport>>(
      `${BASE}/reports/depreciation`,
      { params: asOf ? { asOf } : {} },
    );
    return response.data;
  },

  /** The same report as raw CSV (?format=csv) — not an envelope. */
  exportDepreciationCsv: async (asOf?: string): Promise<string> =>
    api.get<string>(`${BASE}/reports/depreciation`, {
      params: asOf ? { asOf, format: "csv" } : { format: "csv" },
      responseType: "text",
    }),
};

export default financeService;
