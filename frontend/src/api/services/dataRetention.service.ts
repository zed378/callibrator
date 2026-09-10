import { api } from "../client";

/**
 * Data Retention & privacy governance.
 *
 * Mounted on the tenant base path — every endpoint is scoped to a tenant id.
 * Backend: src/routes/api/dataRetention.route.js
 *   GET    /api/v1/tenants/:tenantId/policy
 *   PUT    /api/v1/tenants/:tenantId/policy        (super admin)
 *   GET    /api/v1/tenants/:tenantId/legal-hold
 *   POST   /api/v1/tenants/:tenantId/legal-hold    (super admin)
 *   DELETE /api/v1/tenants/:tenantId/legal-hold    (super admin)
 *   POST   /api/v1/tenants/:tenantId/purge         (super admin)
 *   POST   /api/v1/tenants/:tenantId/mask-pii      (super admin)
 *   POST   /api/v1/tenants/:tenantId/anonymize     (super admin)
 */

// ---------- Types ----------

/** Retention policy keys the backend recognises. */
export type RetentionPolicyKey =
  | "audit_log_retention_days"
  | "notification_retention_days"
  | "session_retention_days";

/** policyKey -> retention window in days. */
export type RetentionPolicy = Record<string, number>;

export interface LegalHoldStatus {
  enabled: boolean;
  reason?: string | null;
  enabledBy?: string | null;
}

export interface PurgeResult {
  purged?: boolean;
  skipped?: boolean;
  reason?: string;
  deleted?: Record<string, number>;
}

export interface MaskPiiResult {
  masked?: boolean;
  entityType?: string;
  count?: number;
}

export interface AnonymizeResult {
  anonymized?: boolean;
  entityType?: string;
  count?: number;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ---------- Service ----------

export const dataRetentionService = {
  /** GET /api/v1/tenants/:tenantId/policy */
  getPolicy: async (tenantId: string): Promise<RetentionPolicy> => {
    const response = await api.get<BackendResponse<RetentionPolicy>>(
      `/api/v1/tenants/${tenantId}/policy`,
    );
    return response.data;
  },

  /** PUT /api/v1/tenants/:tenantId/policy — super admin only. */
  setPolicy: async (
    tenantId: string,
    policyKey: RetentionPolicyKey | string,
    days: number,
  ): Promise<RetentionPolicy> => {
    const response = await api.put<BackendResponse<RetentionPolicy>>(
      `/api/v1/tenants/${tenantId}/policy`,
      { tenantId, policyKey, days },
    );
    return response.data;
  },

  /** GET /api/v1/tenants/:tenantId/legal-hold */
  getLegalHold: async (tenantId: string): Promise<LegalHoldStatus> => {
    const response = await api.get<
      BackendResponse<{
        tenantId: string;
        onLegalHold: boolean;
        reason?: string | null;
        enabledBy?: string | null;
      }>
    >(`/api/v1/tenants/${tenantId}/legal-hold`);
    // Backend returns the flag as `onLegalHold`; normalise to the `enabled`
    // shape the UI reads.
    const d = response.data;
    return {
      enabled: !!d?.onLegalHold,
      reason: d?.reason ?? null,
      enabledBy: d?.enabledBy ?? null,
    };
  },

  /** POST /api/v1/tenants/:tenantId/legal-hold — super admin only. */
  enableLegalHold: async (
    tenantId: string,
    reason: string,
  ): Promise<LegalHoldStatus> => {
    const response = await api.post<BackendResponse<LegalHoldStatus>>(
      `/api/v1/tenants/${tenantId}/legal-hold`,
      { tenantId, reason },
    );
    return response.data;
  },

  /** DELETE /api/v1/tenants/:tenantId/legal-hold — super admin only. */
  disableLegalHold: async (tenantId: string): Promise<LegalHoldStatus> => {
    const response = await api.delete<BackendResponse<LegalHoldStatus>>(
      `/api/v1/tenants/${tenantId}/legal-hold`,
    );
    return response.data;
  },

  /**
   * POST /api/v1/tenants/:tenantId/purge — super admin only.
   * Deletes records older than each policy window. Skipped under legal hold.
   */
  purge: async (tenantId: string): Promise<PurgeResult> => {
    const response = await api.post<BackendResponse<PurgeResult>>(
      `/api/v1/tenants/${tenantId}/purge`,
      { tenantId },
    );
    return response.data;
  },

  /**
   * POST /api/v1/tenants/:tenantId/mask-pii — super admin only.
   * Blocked while a legal hold is active.
   */
  maskPii: async (
    tenantId: string,
    entityType: string,
    recordIds: string[],
  ): Promise<MaskPiiResult> => {
    const response = await api.post<BackendResponse<MaskPiiResult>>(
      `/api/v1/tenants/${tenantId}/mask-pii`,
      { tenantId, entityType, recordIds },
    );
    return response.data;
  },

  /**
   * POST /api/v1/tenants/:tenantId/anonymize — super admin only.
   * Blocked while a legal hold is active.
   */
  anonymize: async (
    tenantId: string,
    entityType: string,
    options?: { keepDates?: boolean; keepNumericIds?: boolean },
  ): Promise<AnonymizeResult> => {
    const response = await api.post<BackendResponse<AnonymizeResult>>(
      `/api/v1/tenants/${tenantId}/anonymize`,
      { tenantId, entityType, options: options ?? {} },
    );
    return response.data;
  },
};

export default dataRetentionService;
