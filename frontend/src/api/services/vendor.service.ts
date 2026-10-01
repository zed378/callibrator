// src/api/services/vendor.service.ts
//
// P9-25 (ADR-103): the first service on the GENERATED client. Every call below
// is typed by `paths` (src/api/generated/schema.d.ts, `npm run api:types`),
// which is generated from backend/openapi.json, which the backend generates
// from the same Zod schemas `validate()` enforces on these routes
// (backend/src/routes/api/vendor.openapi.ts). A path, query value or body
// field the backend does not accept no longer compiles.
//
// The service's own interface (vendorService.*, Vendor, the input types) is
// unchanged, so no caller changed.
import { typedApi, unwrap, type components, type paths } from "../typed";
import { PaginatedResponse } from "@/types";
import type { VendorStatus, VendorType } from "@callibrator/contracts/vendor";

export type { VendorStatus, VendorType };

export interface Vendor {
  id: string;
  tenantId?: string;
  name: string;
  type: VendorType;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  /** Q-52: free text, up to VENDOR_NOTES_MAX characters. */
  notes?: string | null;
  rating?: number | null;
  status: VendorStatus;
  approvalStatus?: string | null;
  lastAuditDate?: string | null;
  nextAuditDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A vendor exactly as the contract publishes it. */
export type ApiVendor = components["schemas"]["Vendor"];

// Compile-time: what the API answers is a `Vendor` as the UI uses it. If the
// contract drops or retypes a field the UI reads, this line stops compiling.
const _apiVendorIsVendor = (v: ApiVendor): Vendor => v;
void _apiVendorIsVendor;

/** The JSON body an operation publishes. */
type JsonBody<Op> = Op extends { requestBody?: { content: { "application/json": infer B } } } ? B : never;

// P9-22 (ADR-097) typed these from the validator's Zod input; P9-25 (ADR-103)
// types them from the published contract, generated from the same schemas.
// The contract is the CANONICAL form: a number where the validator would also
// convert "4", an ISO date string where it would also take a Date.
export type VendorQualifyInput = JsonBody<paths["/api/v1/vendors/{vendorId}/qualify"]["patch"]>;

export type VendorCreateInput = JsonBody<paths["/api/v1/vendors"]["post"]>;

export type VendorUpdateInput = JsonBody<paths["/api/v1/vendors/{vendorId}"]["patch"]> & {
  id: string;
};

/** The list filters the contract accepts — anything else is not sent. */
const STATUSES = ["Active", "Inactive"] as const satisfies readonly VendorStatus[];
const TYPES = ["CalibrationLab", "PartsSupplier", "Other"] as const satisfies readonly VendorType[];
const asStatus = (value?: string): VendorStatus | undefined =>
  STATUSES.find((s) => s === value);
const asType = (value?: string): VendorType | undefined =>
  TYPES.find((t) => t === value);

export const vendorService = {
  getAll: async (
    page = 1,
    limit = 20,
    find?: string,
    status?: string,
    type?: string,
  ): Promise<PaginatedResponse<Vendor>> => {
    const response = await typedApi
      .GET("/api/v1/vendors", {
        params: { query: { page, limit, find, status: asStatus(status), type: asType(type) } },
      })
      .then(unwrap);

    // Defensive: `data` may be null and `meta` may be missing.
    const rows: Vendor[] = Array.isArray(response?.data) ? response.data : [];
    const meta = response?.meta;
    const total = meta?.total ?? rows.length;
    const lim = meta?.limit ?? limit;

    return {
      success: response?.success ?? true,
      message: response?.message ?? "",
      data: rows,
      meta: {
        total,
        page: meta?.page ?? page,
        limit: lim,
        totalPages: meta?.totalPages ?? Math.max(1, Math.ceil(total / lim)),
      },
    };
  },

  getById: async (vendorId: string): Promise<Vendor> => {
    const response = await typedApi
      .GET("/api/v1/vendors/{vendorId}", { params: { path: { vendorId } } })
      .then(unwrap);
    return response.data;
  },

  create: async (data: VendorCreateInput): Promise<Vendor> => {
    const response = await typedApi.POST("/api/v1/vendors", { body: data }).then(unwrap);
    return response.data;
  },

  update: async (data: VendorUpdateInput): Promise<Vendor> => {
    const { id, ...rest } = data;
    const response = await typedApi
      .PATCH("/api/v1/vendors/{vendorId}", { params: { path: { vendorId: id } }, body: rest })
      .then(unwrap);
    return response.data;
  },

  delete: async (vendorId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/vendors/{vendorId}", { params: { path: { vendorId } } });
  },

  /**
   * PATCH /api/v1/vendors/:vendorId/qualify — set a vendor's approval status
   * (approve/reject/etc.) and optional audit dates.
   */
  qualify: async (
    vendorId: string,
    input: VendorQualifyInput,
  ): Promise<Vendor> => {
    const response = await typedApi
      .PATCH("/api/v1/vendors/{vendorId}/qualify", { params: { path: { vendorId } }, body: input })
      .then(unwrap);
    return response.data;
  },
};
