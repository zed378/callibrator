// src/api/services/tenant.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client; the request and answer
// types are the contract's (backend/src/routes/api/tenant.openapi.ts). The
// exported names are unchanged. The create, edit and logo upload stay on `api`
// (multipart).
import { api } from "../client";
import { typedApi, unwrap, type DataOf, type Op, type components } from "../typed";
import { Tenant, PaginatedResponse, TenantSettings, TenantSettingsResponse } from "@/types";

/** A tenant row as the API answers it (the model's lowercase status). */
export type ApiTenant = components["schemas"]["Tenant"];

/**
 * A tenant row as the app's Tenant. Both type `status` as the model's
 * lower-case lifecycle enum (A-361: the app used to type it in upper case,
 * which the API never sends). The cast covers the app type's optional
 * profile joins (`settings`, `users`), which the row does not name.
 */
const asTenant = (row: ApiTenant): Tenant => row as unknown as Tenant;

/** Non-sensitive tenant branding returned by the public (no-auth) endpoint. */
export type PublicTenantBranding = DataOf<Op<"/api/v1/tenants/public", "get">>;

/** Payload of POST /api/v1/tenants/user-count (a null seat limit is unlimited). */
export type TenantUserCount = DataOf<Op<"/api/v1/tenants/user-count", "post">>;

export const tenantService = {
  getAll: async (
    page = 1,
    limit = 25,
    search?: string,
  ): Promise<PaginatedResponse<Tenant>> => {
    const response = await typedApi
      .GET("/api/v1/tenants/all", { params: { query: { page, limit, find: search } } })
      .then(unwrap);

    // Transform backend response to PaginatedResponse format
    return {
      success: response.success,
      message: response.message,
      data: response.data.map(asTenant),
      meta: response.meta,
    };
  },

  /**
   * The tenants the caller may see, as one list shape for every caller.
   *
   * A-76: GET /tenants/all is super-admin only — it lists every hospital on
   * the platform. Any other principal sees exactly one tenant, its own, read
   * through POST /tenants/detail. Pass `ownTenantId` for those callers; pass
   * null/undefined for a super admin.
   */
  getVisible: async (
    page = 1,
    limit = 25,
    search?: string,
    ownTenantId?: string | null,
  ): Promise<PaginatedResponse<Tenant>> => {
    if (!ownTenantId) {
      return tenantService.getAll(page, limit, search);
    }
    const tenant = await tenantService.getById(ownTenantId);
    const data = tenant ? [tenant] : [];
    return {
      success: true,
      message: "Fetch tenant successful",
      data,
      meta: { total: data.length, page: 1, limit, totalPages: 1 },
    };
  },

  getById: async (tenantId: string): Promise<Tenant> =>
    asTenant((await typedApi.POST("/api/v1/tenants/detail", { body: { tenantId } }).then(unwrap)).data),

  /**
   * Public (no-auth) branding for the deploy-configured tenant. The proxy
   * injects the X-Tenant-ID header from NEXT_PUBLIC_TENANT_ID, so no id is
   * passed here. Returns only non-sensitive branding fields.
   */
  getPublicBranding: async (): Promise<PublicTenantBranding> =>
    (await typedApi.GET("/api/v1/tenants/public").then(unwrap)).data,

  create: async (data: {
    name: string;
    code: string;
    description?: string;
    primaryColor?: string;
    limitSeats?: number;
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
    // Req body: name *, code *, description, file ($binary), limitSeats, email, phone, address, city, state, zipCode, country, website
    const formData = new FormData();
    formData.append("name", data.name);
    formData.append("code", data.code);
    if (data.description) formData.append("description", data.description);
    if (data.primaryColor) formData.append("primaryColor", data.primaryColor);
    if (data.file) formData.append("file", data.file);
    if (data.limitSeats) formData.append("limitSeats", String(data.limitSeats));
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
    const response = await api.post<{ success: boolean; data: ApiTenant }>(
      "/api/v1/tenants/create",
      formData,
    );
    return asTenant(response.data);
  },

  update: async (data: {
    tenantId: string;
    name?: string;
    code?: string;
    description?: string;
    primaryColor?: string;
    /** The tenants page never sends it: the status moves through the lifecycle actions (A-326 / ADR-112). */
    status?: Tenant["status"];
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
    // Req body: tenantId *, name, code, description, file ($binary), status, email, phone, address, city, state, zipCode, country, website
    // A-303: no maxUsers (a plan value the platform sets; the backend strips it).
    // A profile field is sent whenever it is given, "" included, so it can be cleared.
    const formData = new FormData();
    formData.append("tenantId", data.tenantId);
    if (data.name) formData.append("name", data.name);
    if (data.code) formData.append("code", data.code);
    if (data.primaryColor) formData.append("primaryColor", data.primaryColor);
    if (data.file) formData.append("file", data.file);
    if (data.status) formData.append("status", data.status);
    if (data.email) formData.append("email", data.email);
    for (const field of ["description", "phone", "address", "city", "state", "zipCode", "country", "website"] as const) {
      const value = data[field];
      if (value !== undefined) formData.append(field, value);
    }

    const response = await api.patch<{ success: boolean; data: ApiTenant }>(
      "/api/v1/tenants/edit",
      formData,
    );
    return asTenant(response.data);
  },

  delete: async (tenantId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/tenants/delete", { params: { query: { tenantId } } });
  },

  getSettings: async (tenantId: string): Promise<TenantSettingsResponse> => {
    const { tenant, settings } = (await typedApi.POST("/api/v1/tenants/settings", { body: { tenantId } }).then(unwrap))
      .data;
    // The settings are an open map (TenantSettings names the SSO keys the page reads).
    return { tenant: asTenant(tenant), settings: settings as TenantSettings };
  },

  updateSettings: async (
    tenantId: string,
    settings: TenantSettings,
  ): Promise<void> => {
    // The nested `settings` object is unwrapped by the API (tenant.service#settingEntries).
    await typedApi.PATCH("/api/v1/tenants/settings", {
      body: { tenantId, settings: settings as Record<string, string | number | boolean | null> },
    });
  },

  /**
   * POST /api/v1/tenants/user-count
   *
   * The backend returns { tenantId, userCount, limitSeats, remainingSlots, unlimited } under
   * `data`. This previously read a top-level `count`, which does not exist at
   * any level, so it always resolved to undefined.
   */
  getUserCount: async (tenantId: string): Promise<TenantUserCount> =>
    (await typedApi.POST("/api/v1/tenants/user-count", { body: { tenantId } }).then(unwrap)).data,

  uploadLogo: async (tenantId: string, file: File): Promise<void> => {
    const formData = new FormData();
    formData.append("file", file);
    await api.post(`/api/v1/tenants/${tenantId}/logo`, formData);
  },

  deleteLogo: async (tenantId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/tenants/{tenantId}/logo", { params: { path: { tenantId } } });
  },

  // NOTE: backup creation lives in tenantBackup.service.ts (`create`).
  // A duplicate `createBackup` used to sit here, but it POSTed without the
  // required `name` (a guaranteed 400) and returned a `downloadUrl` the
  // endpoint never sends. Use tenantBackupService.create instead.
};
