/**
 * A-124 (ADR-051 Q-13) — who an audit row names as its actor.
 *
 * `audit_logs.actor_type` says WHAT acted:
 *  - `user`    — a person; `user_id` names them (and `impersonator_id` the
 *                super admin behind them, F-8).
 *  - `system`  — a background job; `actor_name` names it, from SYSTEM_ACTORS.
 *  - `unknown` — ONLY rows written before migration 0033, whose actor the
 *                table never recorded (`user_id` NULL and no `changes.actor`).
 *                The migration's CHECK refuses a new one: it is history, not
 *                an option for a caller.
 *
 * Before 0033 `user_id IS NULL` meant three different things — a job, a user
 * since deleted, and an actor simply lost — and nothing on the row said which.
 *
 * SYSTEM_ACTORS is CLOSED. audit.service#logAction refuses a system actor that
 * is not on it, as it refuses an action that is not in AUDIT_ACTIONS: a new job
 * that writes audit rows adds its name here, in review, rather than inventing
 * a string at its call site. There is no system USER row (ADR-051 Q-13): a job
 * is not a principal that could log in, be granted menus or be impersonated.
 *
 * P9-08 (ADR-087): converted from systemActors.js with no behaviour change;
 * the export list keeps the old module.exports order.
 *
 * Deliberately absent (ADR-051 Q-13): individual IoT readings and session
 * sweeps are not audited. IoT ingest has a name only for the anomaly ALERT it
 * raises across a tenant (W-04, ADR-069), never for an ordinary reading.
 *
 * Kept in its own module (like auditActions.js) so a test that mocks the
 * constants barrel cannot empty it. A test asserts the model ENUM equals
 * ACTOR_TYPE_VALUES (tests/constants/systemActors.a124.test.js).
 */
const ACTOR_TYPES = Object.freeze({
  USER: "user",
  SYSTEM: "system",
  UNKNOWN: "unknown",
} as const);

/** One `audit_logs.actor_type` value. */
export type ActorType = (typeof ACTOR_TYPES)[keyof typeof ACTOR_TYPES];

/** The `audit_logs.actor_type` ENUM, in declaration order. */
const ACTOR_TYPE_VALUES = Object.freeze([
  ACTOR_TYPES.USER,
  ACTOR_TYPES.SYSTEM,
  ACTOR_TYPES.UNKNOWN,
] as const);

/**
 * Every `system:` actor that may appear on an audit row. The `system:` prefix
 * is also enforced by the database (migration 0033's CHECK).
 */
const SYSTEM_ACTORS = Object.freeze({
  /** services/dataRetention.service.js — the scheduled retention purge (W-04). */
  RETENTION_PURGE: "system:retention-purge",
  /** services/tenantLifecycle.service.js — the grace-period offboarding (W-01). */
  TENANT_LIFECYCLE: "system:tenant-lifecycle",
  /** services/scheduledBackup.service.js — the BACKUP_SCHEDULER tenant backup and its pruning (S-03, S-14). */
  SCHEDULED_BACKUP: "system:scheduled-backup",
  /**
   * A-126 (ADR-051 Q-15) — the brute-force lockout (auth.service#loginUser,
   * rateLimiter.redis.service#recordAuthFailure). The lock is the system's act,
   * not the account holder's: an ACCOUNT_LOCKED row names the locked account as
   * its RESOURCE, never as its actor.
   */
  AUTH_LOCKOUT: "system:auth-lockout",
  /**
   * P6-07 — the break-glass reset of a platform operator's second factor
   * (auth.service#breakGlassResetOperatorMfa, run only from the
   * scripts/breakGlassMfaReset.ts CLI by someone with database access). The
   * person is named in `changes.requestedBy`; they are not a principal here.
   */
  BREAK_GLASS: "system:break-glass",
  /**
   * W-04 / W-30 (ADR-061) — the scheduled calibration scan
   * (services/calibrationScheduler.service.js), which creates Preventative
   * work orders for due devices. A manual run from the API is attributed to
   * the requesting user instead.
   */
  CALIBRATION_SCAN: "system:calibration-scan",
  /**
   * W-04 (ADR-069) — IoT ingest (services/iot.service.js), for the one act it
   * audits: an out-of-tolerance reading and the tenant-wide anomaly alert it
   * raises. The device is authenticated by its token, not a person.
   */
  IOT_INGEST: "system:iot-ingest",
  /**
   * W-04 (ADR-069) — the batch-job runner and its sweeps
   * (services/batchJob.service.js): every state change of a job after it is
   * queued. The user who created the job is named in `changes.requestedBy`.
   */
  BATCH_JOB: "system:batch-job",
  /** ADR-070 — services/webhookDeliveryPurge.service.js: finished deliveries past retention. */
  WEBHOOK_DELIVERY_PURGE: "system:webhook-delivery-purge",
  /**
   * A-37 (ADR-075) — SCIM provisioning (services/scim.service.js) by an
   * identity provider's API key. The key is a machine credential, not a
   * person (as IOT_INGEST's device token is); the key's id is named in
   * `changes.apiKeyId`, and the administrator who minted it in api_keys.
   */
  SCIM_PROVISIONING: "system:scim",
  /**
   * D-22 (ADR-083) — services/attachmentFileSweep.service.ts: the files of
   * attachments soft-deleted longer than the retention window.
   */
  ATTACHMENT_FILE_SWEEP: "system:attachment-file-sweep",
  /**
   * A-282 (ADR-094) — a tenant API key (a service account) acting through a
   * route its scopes open. A key is not a user: `audit_logs.user_id`
   * references `users`, so a key's id there fails the foreign key. The key's
   * id is named in `changes.apiKeyId` (the A-37 rule, generalised).
   */
  API_KEY: "system:api-key",
  /**
   * A-276 (ADR-094) — services/stripeWebhook.service.js: a tenant's status
   * changed by a signed Stripe event (dunning suspends; payment lifts only a
   * dunning suspension). The Stripe event id is named in `changes.stripeEventId`.
   */
  BILLING_WEBHOOK: "system:billing-webhook",
  /**
   * P10-16 (ADR-099) — services/bootstrapCredential.service.ts: the creation
   * of the first super admin with a one-time password (the seed), the boot
   * step that retires the old public default, and the recovery CLI
   * (scripts/rotateBootstrapPassword.ts; the person is named in
   * `changes.requestedBy`, as BREAK_GLASS does).
   */
  BOOTSTRAP: "system:bootstrap",
  /**
   * P10-05 (ADR-098 §6) — services/accessRequest.service.ts#submitAccessRequest:
   * a request received through the public intake. The requester is not a
   * principal (no account), and their name and address are never written to
   * `changes` (BR-P10-6): audit_logs is append-only (0091) and the retention
   * sweep could not remove them.
   */
  ACCESS_REQUEST_INTAKE: "system:access-request-intake",
  /**
   * P10-05 (Q-42) — services/accessRequest.service.ts#runAccessRequestRetention,
   * run by the retention sweep: a pending request expired after 90 days, and
   * rejected, spam or expired requests deleted 12 months after their decision.
   */
  ACCESS_REQUEST_RETENTION: "system:access-request-retention",
  /**
   * A-322 — services/meteredBilling.service.ts#enforceQuotas: a free-plan
   * tenant suspended for exceeding a quota (suspension_reason
   * "billing:quota"). The metric and the overage are named in `changes`.
   */
  USAGE_QUOTA: "system:usage-quota",
  /**
   * P8-01 (ADR-086 Amendment 1) — services/storageMigration.service.ts, run
   * only from the scripts/migrateStorage.ts CLI by an operator with database
   * access: a row whose bytes were copied into pluggable storage (verified) now
   * names their storage key (attachments' `storageKey`, tenant backups'
   * `filePath`). One UPDATE row per moved row, in the tenant, with the move.
   */
  STORAGE_MIGRATION: "system:storage-migration",
  /**
   * P20-03 (ADR-125 Amendment 1; P19-01 spec § 12) — migration 0112, which
   * publishes the neutral base checklist, version 1, as the platform's own
   * content: `inspection_template_versions.published_by_system` names it (a
   * published version names exactly one publisher, a user or a system actor),
   * and so does the APPROVE audit row the migration writes under the PLATFORM
   * tenant. The ETL publishes under its own actor, added to this list by P24-02.
   */
  CATALOGUE_SEED: "system:catalogue-seed",
  /**
   * P24-06 — the SQL-dump import's worker (services/upstreamSqlImport.service.ts):
   * every scanning / parsing / loaded / failed / cancelled transition it makes,
   * the interrupted-run reconciliation and the expired-file purge, under the
   * PLATFORM tenant. The super admin who uploaded, cancelled or retried is the
   * actor of those transitions instead.
   */
  UPSTREAM_SQL_IMPORT: "system:upstream-sql-import",
} as const);

/** One system actor's name (`actor_name` of a `system` row). */
export type SystemActor = (typeof SYSTEM_ACTORS)[keyof typeof SYSTEM_ACTORS];

const SYSTEM_ACTOR_NAMES: readonly SystemActor[] = Object.freeze(Object.values(SYSTEM_ACTORS));

/** The longest `actor_name` the column holds (VARCHAR). */
const ACTOR_NAME_MAX_LENGTH = 100;

export { ACTOR_TYPES, ACTOR_TYPE_VALUES, SYSTEM_ACTORS, SYSTEM_ACTOR_NAMES, ACTOR_NAME_MAX_LENGTH };
