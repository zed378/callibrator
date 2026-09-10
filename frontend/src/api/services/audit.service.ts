import { api } from "../client";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "LOGIN"
  | "APPROVE"
  | "EXPORT";

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
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  changes?: AuditLogChanges | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  user?: AuditLogUser | null;
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
  action?: AuditAction;
  resourceType?: string;
  startDate?: string;
  endDate?: string;
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
