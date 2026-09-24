import { api } from "../client";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "LOGIN"
  | "APPROVE"
  | "EXPORT"
  // A-126 (ADR-051 Q-15)
  | "ACCOUNT_LOCKED"
  | "SIGNATURE_AUTH_FAILED";

/**
 * A-124 (ADR-051 Q-13): what acted. `system` rows name a background job in
 * `actorName` (e.g. "system:retention-purge"); `unknown` exists only on rows
 * written before the actor was recorded.
 */
export type AuditActorType = "user" | "system" | "unknown";

export interface AuditLogUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface AuditLogChanges {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface AuditLog {
  id: string;
  tenantId: string;
  userId?: string | null;
  actorType?: AuditActorType;
  actorName?: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  changes?: AuditLogChanges | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  /**
   * `null` while `userId` is set means the reference is outside the reader's
   * tenant — a platform operator (ADR-051 Q-17), or an account since removed.
   */
  user?: AuditLogUser | null;
  /**
   * F-8: the super admin who acted through an impersonation token. The id is
   * always present on such a row; the object is `null` for a tenant reader,
   * because the operator is not a member of the tenant.
   */
  impersonatorId?: string | null;
  impersonator?: AuditLogUser | null;
}

export interface AuditMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditListQuery {
  page?: number;
  limit?: number;
  userId?: string;
  actorType?: AuditActorType;
  action?: AuditAction;
  resourceType?: string;
  startDate?: string;
  endDate?: string;
  /** Super admin only: the PLATFORM tenant's trail (A-125). Others get 403. */
  scope?: "platform";
}

interface ListEnvelope {
  success: boolean;
  status: number;
  message: string;
  data: AuditLog[] | null;
  meta?: AuditMeta;
}

export interface AuditListResult {
  logs: AuditLog[];
  meta: AuditMeta;
}

// ─── API Service ─────────────────────────────────────────────────────────────

export const auditService = {
  /**
   * Get audit logs (paginated, read-only)
   * @param query - page, limit, userId, action, resourceType, startDate, endDate
   */
  getAll: async (query: AuditListQuery = {}): Promise<AuditListResult> => {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const params: Record<string, string | number> = { page, limit };

    if (query.userId) params.userId = query.userId;
    if (query.actorType) params.actorType = query.actorType;
    if (query.scope) params.scope = query.scope;
    if (query.action) params.action = query.action;
    if (query.resourceType) params.resourceType = query.resourceType;
    if (query.startDate) params.startDate = query.startDate;
    if (query.endDate) params.endDate = query.endDate;

    const response = await api.get<ListEnvelope>("/api/v1/audit", { params });

    const logs = response.data ?? [];
    const meta: AuditMeta = response.meta ?? {
      total: logs.length,
      page,
      limit,
      totalPages: 1,
    };

    return { logs, meta };
  },
};

export default auditService;
