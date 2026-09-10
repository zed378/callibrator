import { api } from "../client";

// ---------- Types ----------

export interface FeatureFlagDefinition {
  key: string;
  category: string;
  description?: string;
  defaultValue: boolean;
}

/** Effective flag map: flagKey -> enabled. */
export type FeatureFlagMap = Record<string, boolean>;

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ---------- Service ----------

export const featureFlagService = {
  /**
   * Get the effective flags for a tenant (merged with defaults).
   * GET /api/v1/feature-flags?tenantId=
   */
  getTenantFlags: async (tenantId?: string): Promise<FeatureFlagMap> => {
    const response = await api.get<BackendResponse<FeatureFlagMap>>(
      "/api/v1/feature-flags",
      { params: { tenantId } },
    );
    return response.data;
  },

  /**
   * Get the catalog of all flag definitions.
   * GET /api/v1/feature-flags/definitions
   */
  getDefinitions: async (): Promise<FeatureFlagDefinition[]> => {
    const response = await api.get<BackendResponse<FeatureFlagDefinition[]>>(
      "/api/v1/feature-flags/definitions",
    );
    return response.data;
  },

  /**
   * Check whether a single flag is enabled for a tenant.
   * GET /api/v1/feature-flags/:tenantId/:flagKey
   */
  isEnabled: async (
    tenantId: string,
    flagKey: string,
  ): Promise<{ flagKey: string; enabled: boolean }> => {
    const response = await api.get<
      BackendResponse<{ flagKey: string; enabled: boolean }>
    >(`/api/v1/feature-flags/${tenantId}/${flagKey}`);
    return response.data;
  },

  /**
   * Set a per-tenant flag override (super admin only).
   * POST /api/v1/feature-flags/:tenantId/:flagKey
   */
  setFlag: async (
    tenantId: string,
    flagKey: string,
    enabled: boolean,
  ): Promise<{ flagKey: string; enabled: boolean }> => {
    const response = await api.post<
      BackendResponse<{ flagKey: string; enabled: boolean }>
    >(`/api/v1/feature-flags/${tenantId}/${flagKey}`, {
      tenantId,
      flagKey,
      enabled,
    });
    return response.data;
  },

  /**
   * Reset a per-tenant flag to its default (super admin only).
   * DELETE /api/v1/feature-flags/:tenantId/:flagKey
   */
  resetFlag: async (tenantId: string, flagKey: string): Promise<void> => {
    await api.delete(`/api/v1/feature-flags/${tenantId}/${flagKey}`);
  },

  /**
   * Seed a tenant's default flags (super admin only).
   * POST /api/v1/feature-flags/:tenantId/initialize
   */
  initialize: async (tenantId: string): Promise<FeatureFlagMap> => {
    const response = await api.post<BackendResponse<FeatureFlagMap>>(
      `/api/v1/feature-flags/${tenantId}/initialize`,
    );
    return response.data;
  },
};

export default featureFlagService;
