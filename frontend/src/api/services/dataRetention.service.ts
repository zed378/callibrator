import { api } from "../client";

/**
 * Data Retention & privacy governance.
 *
 * Mounted on the tenant base path — every endpoint is scoped to a tenant id.
 * Backend: src/routes/api/dataRetention.route.js
 *   GET    /api/v1/tenants/:tenantId/policy        (data-retention read; own tenant, else 404)
 *   PUT    /api/v1/tenants/:tenantId/policy        (super admin)
 *   GET    /api/v1/tenants/:tenantId/legal-hold    (data-retention read; own tenant, else 404)
 *   POST   /api/v1/tenants/:tenantId/legal-hold    (super admin)
 *   DELETE /api/v1/tenants/:tenantId/legal-hold    (super admin)
 *   POST   /api/v1/tenants/:tenantId/purge         (super admin)
 *   POST   /api/v1/tenants/:tenantId/mask-pii      (super admin)
 *
 * `POST /anonymize` is not offered: the backend refuses it for every dataset
 * (A-152) — it overwrote every text column of every row. Masking named data
 * subjects (`maskPII`) is the per-subject operation.
 */

// ---------- Types ----------
//
// A-135: every shape below is the backend's, read from
// backend/src/services/dataRetention.service.js and its controller. This file
// used to send `audit_log_retention_days` / `notification_retention_days` /
// `session_retention_days`, keys the backend has never accepted (every save
// answered 400 "Unknown retention policy"), and offered an audit-log window
// although audit rows are never purged (ADR-051 Q-12).

/** The retention policy keys `PUT /policy` accepts — the purgeable entities. */
export type RetentionPolicyKey = "notifications" | "sessions";

/**
 * The shortest period, in days, the backend accepts for each key
 * (`MIN_RETENTION_DAYS`); `0` means keep forever and is always accepted.
 */
export const RETENTION_MIN_DAYS: Record<RetentionPolicyKey, number> = {
  notifications: 30,
  sessions: 30,
};

/** `GET /policy`: each purgeable entity's period in days (0 = keep forever). */
export type RetentionPolicy = Record<RetentionPolicyKey, number>;

/** `PUT /policy` answers with the one policy it set. */
export interface SetPolicyResult {
  policyKey: RetentionPolicyKey;
  days: number;
}

/** What the UI reads; normalised from the backend's `{ tenantId, onLegalHold }`. */
export interface LegalHoldStatus {
  enabled: boolean;
}

/** `POST /legal-hold` answers with the hold it set. */
export interface LegalHoldEnabled {
  tenantId: string;
  enabled: true;
  reason: string;
  enabledBy: string;
}

/** `DELETE /legal-hold` answers with the release. */
export interface LegalHoldDisabled {
  tenantId: string;
  enabled: false;
  disabledBy: string;
}

/**
 * `POST /purge`: `purged` maps each entity to the rows destroyed (only those
 * with any), or the purge was skipped under a legal hold (`purged` absent).
 */
export interface PurgeResult {
  tenantId?: string;
  purged?: Partial<Record<RetentionPolicyKey, number>>;
  skipped: boolean;
  reason?: "legal_hold";
}

/**
 * The entity types `POST /mask-pii` accepts. `users` is addressed by user id;
 * `audit_logs` by the DATA SUBJECT's user id — audit rows are never addressed
 * one by one, and never deleted (ADR-051 Q-12).
 */
export type MaskPiiEntity = "users" | "audit_logs";

/** `POST /mask-pii`: rows changed, and which fields were masked. */
export interface MaskPiiResult {
  masked: number;
  fields: string[];
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
    policyKey: RetentionPolicyKey,
    days: number,
  ): Promise<SetPolicyResult> => {
    const response = await api.put<BackendResponse<SetPolicyResult>>(
      `/api/v1/tenants/${tenantId}/policy`,
      { tenantId, policyKey, days },
    );
    return response.data;
  },

  /**
   * GET /api/v1/tenants/:tenantId/legal-hold — `data-retention: read`.
   * The backend answers `{ tenantId, onLegalHold }` only; it does not return
   * the hold's reason or who set it.
   */
  getLegalHold: async (tenantId: string): Promise<LegalHoldStatus> => {
    const response = await api.get<
      BackendResponse<{ tenantId: string; onLegalHold: boolean }>
    >(`/api/v1/tenants/${tenantId}/legal-hold`);
    return { enabled: response.data?.onLegalHold === true };
  },

  /** POST /api/v1/tenants/:tenantId/legal-hold — super admin only. */
  enableLegalHold: async (
    tenantId: string,
    reason: string,
  ): Promise<LegalHoldEnabled> => {
    const response = await api.post<BackendResponse<LegalHoldEnabled>>(
      `/api/v1/tenants/${tenantId}/legal-hold`,
      { tenantId, reason },
    );
    return response.data;
  },

  /** DELETE /api/v1/tenants/:tenantId/legal-hold — super admin only. */
  disableLegalHold: async (tenantId: string): Promise<LegalHoldDisabled> => {
    const response = await api.delete<BackendResponse<LegalHoldDisabled>>(
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
   *
   * `ids` are user ids for `users`, and the data subjects' user ids for
   * `audit_logs` — sent as `recordIds` and `subjectIds` respectively, the
   * only field the backend accepts for each.
   */
  maskPii: async (
    tenantId: string,
    entityType: MaskPiiEntity,
    ids: string[],
  ): Promise<MaskPiiResult> => {
    const idField = entityType === "audit_logs" ? "subjectIds" : "recordIds";
    const response = await api.post<BackendResponse<MaskPiiResult>>(
      `/api/v1/tenants/${tenantId}/mask-pii`,
      { tenantId, entityType, [idField]: ids },
    );
    return response.data;
  },
};

export default dataRetentionService;
