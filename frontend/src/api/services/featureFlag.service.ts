// src/api/services/featureFlag.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client. Every call is typed by
// `paths` (generated from backend/src/routes/api/featureFlags.openapi.ts); the
// exported names are unchanged, so no caller changed.
import { typedApi, unwrap, type DataOf, type Op, type components } from "../typed";

// ---------- Types ----------

export interface FeatureFlagDefinition {
  key: string;
  category: string;
  description?: string;
  defaultValue: boolean;
}

/** Effective flag map: flagKey -> enabled. */
export type FeatureFlagMap = Record<string, boolean>;

/** Every defined flag as the tenant has it (the contract's TenantFeatureFlags). */
export type TenantFeatureFlags = components["schemas"]["TenantFeatureFlags"];

type Flag = "/api/v1/feature-flags/{tenantId}/{flagKey}";
const flag = (tenantId: string, flagKey: string) => ({ params: { path: { tenantId, flagKey } } });

// ---------- Service ----------

export const featureFlagService = {
  /**
   * Get the effective flags for a tenant (merged with defaults).
   * GET /api/v1/feature-flags?tenantId=
   */
  getTenantFlags: async (tenantId: string): Promise<FeatureFlagMap> => {
    // The backend answers each flag as a state object — { enabled, category,
    // description, defaultValue, tenantOverride } (featureFlag.service.ts
    // getTenantFlags) — not a boolean. Read as a boolean map, every object was
    // truthy: every flag showed Enabled and overridden, and a toggle could
    // only ever send `false`. Reduce each to its `enabled`.
    const response = await typedApi
      .GET("/api/v1/feature-flags", {
        // A-353 (fixed): the page asks only once a tenant is chosen.
        params: { query: { tenantId } },
      })
      .then(unwrap);
    const map: FeatureFlagMap = {};
    const data: Record<string, boolean | { enabled?: boolean } | null> = response.data ?? {};
    for (const [key, value] of Object.entries(data)) {
      map[key] = typeof value === "boolean" ? value : value?.enabled === true;
    }
    return map;
  },

  /**
   * Get the catalog of all flag definitions.
   * GET /api/v1/feature-flags/definitions
   */
  getDefinitions: async (): Promise<FeatureFlagDefinition[]> => {
    // The backend sends its DEFAULT_FLAGS catalogue: an object keyed by flag
    // key, not a list — the screen's Array.isArray check dropped it and the
    // page always read "No feature flags defined." Turn it into rows.
    const response = await typedApi.GET("/api/v1/feature-flags/definitions").then(unwrap);
    const data: FeatureFlagDefinition[] | Record<string, Omit<FeatureFlagDefinition, "key">> | null = response.data;
    if (Array.isArray(data)) return data;
    return Object.entries(data ?? {}).map(([key, def]) => ({ key, ...def }));
  },

  /**
   * Check whether a single flag is enabled for a tenant.
   * GET /api/v1/feature-flags/:tenantId/:flagKey
   */
  isEnabled: async (
    tenantId: string,
    flagKey: string,
  ): Promise<DataOf<Op<Flag, "get">>> =>
    (await typedApi.GET("/api/v1/feature-flags/{tenantId}/{flagKey}", flag(tenantId, flagKey)).then(unwrap)).data,

  /**
   * Set a per-tenant flag override (super admin only).
   * POST /api/v1/feature-flags/:tenantId/:flagKey
   */
  setFlag: async (
    tenantId: string,
    flagKey: string,
    enabled: boolean,
  ): Promise<DataOf<Op<Flag, "post">>> => {
    // As built: the body repeats the path's tenantId and flagKey; the contract
    // reads only `enabled` (the controller takes both from the path).
    const body = { tenantId, flagKey, enabled };
    return (
      await typedApi.POST("/api/v1/feature-flags/{tenantId}/{flagKey}", { ...flag(tenantId, flagKey), body }).then(unwrap)
    ).data;
  },

  /**
   * Reset a per-tenant flag to its default (super admin only).
   * DELETE /api/v1/feature-flags/:tenantId/:flagKey
   */
  resetFlag: async (tenantId: string, flagKey: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/feature-flags/{tenantId}/{flagKey}", flag(tenantId, flagKey));
  },

  /**
   * Seed a tenant's default flags (super admin only).
   * POST /api/v1/feature-flags/:tenantId/initialize
   */
  initialize: async (tenantId: string): Promise<TenantFeatureFlags> =>
    (
      await typedApi
        .POST("/api/v1/feature-flags/{tenantId}/initialize", { params: { path: { tenantId } } })
        .then(unwrap)
    ).data,
};

export default featureFlagService;
