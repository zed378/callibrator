import { typedApi, unwrap, type DataOf, type JsonBody, type Op } from "../typed";

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
// backend/src/services/dataRetention.service.ts and its controller. This file
// used to send `audit_log_retention_days` / `notification_retention_days` /
// `session_retention_days`, keys the backend has never accepted (every save
// answered 400 "Unknown retention policy"), and offered an audit-log window
// although audit rows are never purged (ADR-051 Q-12).

// P9-25 (ADR-103 item 11): on the GENERATED client; the answers are the
// contract's (backend/src/routes/api/dataRetention.openapi.ts).

type T = "/api/v1/tenants/{tenantId}";

/** `PUT /policy` answers with the one policy it set. */
export type SetPolicyResult = DataOf<Op<`${T}/policy`, "put">>;

/**
 * The retention policy keys this page offers — the purgeable entities a
 * tenant administrator sets. The API also keeps `iot_readings` (it is in the
 * GET answer); the page does not offer it.
 */
export type RetentionPolicyKey = Extract<SetPolicyResult["policyKey"], "notifications" | "sessions">;

/**
 * The shortest period, in days, the backend accepts for each key
 * (`MIN_RETENTION_DAYS`); `0` means keep forever and is always accepted.
 */
export const RETENTION_MIN_DAYS: Record<RetentionPolicyKey, number> = {
  notifications: 30,
  sessions: 30,
};

/** `GET /policy`: each purgeable entity's period in days (0 = keep forever). */
export type RetentionPolicy = DataOf<Op<`${T}/policy`, "get">>;

/** What the UI reads; normalised from the backend's `{ tenantId, onLegalHold }`. */
export interface LegalHoldStatus {
  enabled: boolean;
}

/** `POST /legal-hold` answers with the hold it set. */
export type LegalHoldEnabled = DataOf<Op<`${T}/legal-hold`, "post">>;

/** `DELETE /legal-hold` answers with the release. */
export type LegalHoldDisabled = DataOf<Op<`${T}/legal-hold`, "delete">>;

/**
 * `POST /purge`: `purged` maps each entity to the rows destroyed (only those
 * with any), or the purge was skipped under a legal hold (`purged` absent).
 */
export type PurgeResult = DataOf<Op<`${T}/purge`, "post">>;

/**
 * The entity types `POST /mask-pii` accepts. `users` is addressed by user id;
 * `audit_logs` by the DATA SUBJECT's user id — audit rows are never addressed
 * one by one, and never deleted (ADR-051 Q-12).
 */
export type MaskPiiEntity = JsonBody<Op<`${T}/mask-pii`, "post">>["entityType"];

/** `POST /mask-pii`: rows changed, and which fields were masked. */
export type MaskPiiResult = DataOf<Op<`${T}/mask-pii`, "post">>;

const tenant = (tenantId: string) => ({ params: { path: { tenantId } } });

// ---------- Service ----------

export const dataRetentionService = {
  /** GET /api/v1/tenants/:tenantId/policy */
  getPolicy: async (tenantId: string): Promise<RetentionPolicy> =>
    (await typedApi.GET("/api/v1/tenants/{tenantId}/policy", tenant(tenantId)).then(unwrap)).data,

  /** PUT /api/v1/tenants/:tenantId/policy — super admin only. */
  setPolicy: async (
    tenantId: string,
    policyKey: RetentionPolicyKey,
    days: number,
  ): Promise<SetPolicyResult> => {
    // As built: the body repeats the path's tenantId; the API takes the path's.
    const body = { tenantId, policyKey, days };
    return (await typedApi.PUT("/api/v1/tenants/{tenantId}/policy", { ...tenant(tenantId), body }).then(unwrap)).data;
  },

  /**
   * GET /api/v1/tenants/:tenantId/legal-hold — `data-retention: read`.
   * The backend answers `{ tenantId, onLegalHold }` only; it does not return
   * the hold's reason or who set it.
   */
  getLegalHold: async (tenantId: string): Promise<LegalHoldStatus> => {
    const response = await typedApi.GET("/api/v1/tenants/{tenantId}/legal-hold", tenant(tenantId)).then(unwrap);
    // Defensive, as built: a body without `data` reads as no hold.
    return { enabled: response.data?.onLegalHold === true };
  },

  /** POST /api/v1/tenants/:tenantId/legal-hold — super admin only. */
  enableLegalHold: async (
    tenantId: string,
    reason: string,
  ): Promise<LegalHoldEnabled> => {
    // As built: the body repeats the path's tenantId.
    const body = { tenantId, reason };
    return (await typedApi.POST("/api/v1/tenants/{tenantId}/legal-hold", { ...tenant(tenantId), body }).then(unwrap))
      .data;
  },

  /** DELETE /api/v1/tenants/:tenantId/legal-hold — super admin only. */
  disableLegalHold: async (tenantId: string): Promise<LegalHoldDisabled> =>
    (await typedApi.DELETE("/api/v1/tenants/{tenantId}/legal-hold", tenant(tenantId)).then(unwrap)).data,

  /**
   * POST /api/v1/tenants/:tenantId/purge — super admin only.
   * Deletes records older than each policy window. Skipped under legal hold.
   */
  purge: async (tenantId: string): Promise<PurgeResult> =>
    (
      await typedApi
        // As built: posts `{ tenantId }`; the contract reads no body (the path names the tenant).
        .POST("/api/v1/tenants/{tenantId}/purge", { ...tenant(tenantId), body: { tenantId } as never })
        .then(unwrap)
    ).data,

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
    // As built: the body repeats the path's tenantId.
    const body = { tenantId, entityType, [idField]: ids };
    return (await typedApi.POST("/api/v1/tenants/{tenantId}/mask-pii", { ...tenant(tenantId), body }).then(unwrap))
      .data;
  },
};

export default dataRetentionService;
