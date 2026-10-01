/**
 * Types for `src/services/audit.service.js`, which is still JavaScript.
 * Written for P9-12 (ADR-087 Amendment 13), following the `config/index.d.ts`
 * precedent: under `allowJs: false` a `.ts` module cannot import a `.js` one
 * without declared types. This file emits nothing and is never copied into
 * `dist/`. It declares exactly what audit.service.js exports (`exports.x = ...`
 * five times), typed from its code, and is deleted when that module converts;
 * until then a change to its exports must change this file too.
 */
import type { Transaction } from "sequelize";
import type { AuditAction } from "../constants/auditActions";

/** One audit row, as logAction takes it. EXACTLY ONE actor: `userId` or `systemActor` (A-124). */
interface AuditEntry {
  tenantId: string | null | undefined;
  userId?: string | null | undefined;
  systemActor?: string | null | undefined;
  impersonatorId?: string | null | undefined;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null | undefined;
  /** Never secrets: this table is permanent (D-27 redacts them). */
  changes?: Record<string, unknown> | null | undefined;
  ipAddress?: string | null | undefined;
  /**
   * Stored as given. `auditActor(req)` passes the raw `user-agent` header, which Node types
   * `string | string[]` (P9-20: widened so the controllers that pass it type-check; type-only).
   */
  userAgent?: string | readonly string[] | null | undefined;
}

declare const auditService: {
  /**
   * The single write path for `audit_logs`. With a transaction the row is
   * written in it and a failure is RE-THROWN (A-41); without one a failure is
   * logged and null returned.
   */
  logAction: (entry: AuditEntry, options?: { transaction?: Transaction | null | undefined }) => Promise<unknown>;
  /**
   * A-72/A-185: persist an account lock and its ACCOUNT_LOCKED row together; on
   * failure, persist the lock alone. Resolves whether the row was written.
   */
  recordAccountLock: (params: {
    persistLock: (transaction: Transaction | null) => Promise<unknown>;
    user: { id: string; tenantId?: string | null };
    lockedUntil: Date;
    failedAttempts: number;
    endpoint: string;
    ipAddress: string | null;
    userAgent: string | null;
    scope?: string | undefined;
  }) => Promise<boolean>;
  /** The default window of fetchAuditLogs, in days (90). */
  AUDIT_DEFAULT_WINDOW_DAYS: number;
  /** The cap on fetchAuditLogs' count (10000). */
  AUDIT_COUNT_CAP: number;
  /** One tenant's audit trail, newest first (the service's own response object). */
  fetchAuditLogs: (query: Record<string, unknown>) => Promise<unknown>;
};

export = auditService;
