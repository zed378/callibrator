// src/api/services/vendor.service.ts
import { api } from "../client";
import { PaginatedResponse } from "@/types";

export type VendorType = "CalibrationLab" | "PartsSupplier" | "Other";
export type VendorStatus = "Active" | "Inactive";

export interface Vendor {
  id: string;
  tenantId?: string;
  name: string;
  type: VendorType;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  rating?: number | null;
  status: VendorStatus;
  approvalStatus?: string | null;
  lastAuditDate?: string | null;
  nextAuditDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VendorQualifyInput {
  approvalStatus: string;
  scorecard?: Record<string, unknown>;
  lastAuditDate?: string;
  nextAuditDate?: string;
}

export interface VendorCreateInput {
  name: string;
  type?: VendorType;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
  status?: VendorStatus;
  rating?: number;
}

export interface VendorUpdateInput extends Partial<VendorCreateInput> {
  id: string;
}

// Backend envelope: for LIST endpoints `data` is the array itself and
// `meta` sits at the TOP level of the envelope (unlike devices).
interface BackendVendorsResponse {
  success: boolean;
  status: number;
  message: string;
  data: Vendor[] | null;
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface BackendVendorResponse {
  success: boolean;
  status: number;
  message: string;
  data: Vendor;
}

export const vendorService = {
  getAll: async (
    page = 1,
    limit = 20,
    find?: string,
    status?: string,
    type?: string,
  ): Promise<PaginatedResponse<Vendor>> => {
    const response = await api.get<BackendVendorsResponse>("/api/v1/vendors", {
      params: { page, limit, find, status, type },
    });

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
    const response = await api.get<BackendVendorResponse>(
      `/api/v1/vendors/${vendorId}`,
    );
    return response.data;
  },

  create: async (data: VendorCreateInput): Promise<Vendor> => {
    const response = await api.post<BackendVendorResponse>(
      "/api/v1/vendors",
      data,
    );
    return response.data;
  },

  update: async (data: VendorUpdateInput): Promise<Vendor> => {
    const { id, ...rest } = data;
    const response = await api.patch<BackendVendorResponse>(
      `/api/v1/vendors/${id}`,
      rest,
    );
    return response.data;
  },

  delete: async (vendorId: string): Promise<void> => {
    await api.delete(`/api/v1/vendors/${vendorId}`);
  },

  /**
   * PATCH /api/v1/vendors/:vendorId/qualify — set a vendor's approval status
   * (approve/reject/etc.) and optional audit dates.
   */
  qualify: async (
    vendorId: string,
    input: VendorQualifyInput,
  ): Promise<Vendor> => {
    const response = await api.patch<BackendVendorResponse>(
      `/api/v1/vendors/${vendorId}/qualify`,
      input,
    );
    return response.data;
  },
};
