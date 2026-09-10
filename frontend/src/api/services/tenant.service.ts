import { api } from "../client";
import { Tenant, PaginatedResponse, TenantSettings, TenantSettingsResponse } from "@/types";

// Backend response structure for tenants list
// Actual format: { success, status, message, data: Tenant[], meta: {...} }
interface BackendTenantsResponse {
  success: boolean;
  status: number;
  message: string;
  data: Tenant[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/** Non-sensitive tenant branding returned by the public (no-auth) endpoint. */
export interface PublicTenantBranding {
  id: string;
  name: string;
  code: string;
  primaryColor: string | null;
  logoBaseUrl: string | null;
}

/** Payload of POST /api/v1/tenants/user-count. */
export interface TenantUserCount {
  tenantId: string;
  userCount: number;
  maxUsers: number;
  remainingSlots: number;
}

export const tenantService = {
  getAll: async (
    page = 1,
    limit = 25,
    search?: string,
  ): Promise<PaginatedResponse<Tenant>> => {
    const response = await api.get<BackendTenantsResponse>(
      "/api/v1/tenants/all",
      {
        params: { page, limit, find: search },
      },
    );

    // Transform backend response to PaginatedResponse format
    return {
      success: response.success,
      message: response.message,
      data: response.data,
      meta: response.meta,
    };
  },

  getById: async (tenantId: string): Promise<Tenant> => {
    const response = await api.post<{ success: boolean; data: Tenant }>(
      "/api/v1/tenants/detail",
      { tenantId },
    );
    return response.data;
  },

  /**
   * Public (no-auth) branding for the deploy-configured tenant. The proxy
   * injects the X-Tenant-ID header from NEXT_PUBLIC_TENANT_ID, so no id is
   * passed here. Returns only non-sensitive branding fields.
   */
  getPublicBranding: async (): Promise<PublicTenantBranding> => {
    const response = await api.get<{ success: boolean; data: PublicTenantBranding }>(
      "/api/v1/tenants/public",
    );
    return response.data;
  },

  create: async (data: {
    name: string;
    code: string;
    description?: string;
    primaryColor?: string;
    maxUsers?: number;
    file?: File;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
    website?: string;
  }): Promise<Tenant> => {
    // Swagger spec: multipart/form-data for file upload in single API call
    // Req body: name *, code *, description, file ($binary), maxUsers, email, phone, address, city, state, zipCode, country, website
    const formData = new FormData();
    formData.append("name", data.name);
    formData.append("code", data.code);
    if (data.description) formData.append("description", data.description);
    if (data.primaryColor) formData.append("primaryColor", data.primaryColor);
    if (data.file) formData.append("file", data.file);
    if (data.maxUsers) formData.append("maxUsers", String(data.maxUsers));
    if (data.email) formData.append("email", data.email);
    if (data.phone) formData.append("phone", data.phone);
    if (data.address) formData.append("address", data.address);
    if (data.city) formData.append("city", data.city);
    if (data.state) formData.append("state", data.state);
    if (data.zipCode) formData.append("zipCode", data.zipCode);
    if (data.country) formData.append("country", data.country);
    if (data.website) formData.append("website", data.website);

    // Do not set Content-Type — the client interceptor lets the browser add
    // the multipart boundary automatically.
    const response = await api.post<{ success: boolean; data: Tenant }>(
      "/api/v1/tenants/create",
      formData,
    );
    return response.data;
  },

  update: async (data: {
    tenantId: string;
    name?: string;
    code?: string;
    description?: string;
    primaryColor?: string;
    status?: "ACTIVE" | "INACTIVE" | "SUSPENDED";
    maxUsers?: number;
    file?: File;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
    website?: string;
  }): Promise<Tenant> => {
    // Swagger spec: multipart/form-data for file upload
    // Req body: tenantId *, name, code, description, file ($binary), status, maxUsers, email, phone, address, city, state, zipCode, country, website
    const formData = new FormData();
    formData.append("tenantId", data.tenantId);
    if (data.name) formData.append("name", data.name);
    if (data.code) formData.append("code", data.code);
    if (data.description) formData.append("description", data.description);
    if (data.primaryColor) formData.append("primaryColor", data.primaryColor);
    if (data.file) formData.append("file", data.file);
    if (data.status) formData.append("status", data.status);
    if (data.maxUsers) formData.append("maxUsers", String(data.maxUsers));
    if (data.email) formData.append("email", data.email);
    if (data.phone) formData.append("phone", data.phone);
    if (data.address) formData.append("address", data.address);
    if (data.city) formData.append("city", data.city);
    if (data.state) formData.append("state", data.state);
    if (data.zipCode) formData.append("zipCode", data.zipCode);
    if (data.country) formData.append("country", data.country);
    if (data.website) formData.append("website", data.website);

    const response = await api.patch<{ success: boolean; data: Tenant }>(
      "/api/v1/tenants/edit",
      formData,
    );
    return response.data;
  },

  delete: async (tenantId: string): Promise<void> => {
    await api.delete("/api/v1/tenants/delete", { params: { tenantId } });
  },

  getSettings: async (tenantId: string): Promise<TenantSettingsResponse> => {
    const response = await api.post<{
      success: boolean;
      data: TenantSettingsResponse;
    }>("/api/v1/tenants/settings", { tenantId });
    return response.data;
  },

  updateSettings: async (
    tenantId: string,
    settings: TenantSettings,
  ): Promise<void> => {
    await api.patch("/api/v1/tenants/settings", { tenantId, settings });
  },

  /**
   * POST /api/v1/tenants/user-count
   *
   * The backend returns { tenantId, userCount, maxUsers, remainingSlots } under
   * `data`. This previously read a top-level `count`, which does not exist at
   * any level, so it always resolved to undefined.
   */
  getUserCount: async (tenantId: string): Promise<TenantUserCount> => {
    const response = await api.post<{
      success: boolean;
      status: number;
      message: string;
      data: TenantUserCount;
    }>("/api/v1/tenants/user-count", { tenantId });
    return response.data;
  },

  uploadLogo: async (tenantId: string, file: File): Promise<void> => {
    const formData = new FormData();
    formData.append("file", file);
    await api.post(`/api/v1/tenants/${tenantId}/logo`, formData);
  },

  deleteLogo: async (tenantId: string): Promise<void> => {
    await api.delete(`/api/v1/tenants/${tenantId}/logo`);
  },

  // NOTE: backup creation lives in tenantBackup.service.ts (`create`).
  // A duplicate `createBackup` used to sit here, but it POSTed without the
  // required `name` (a guaranteed 400) and returned a `downloadUrl` the
  // endpoint never sends. Use tenantBackupService.create instead.
};
