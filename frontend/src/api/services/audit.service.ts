// P9-25 (ADR-103 item 11): on the GENERATED client; the row and meta types are
// the contract's (backend/src/routes/api/audit.openapi.ts). The names are unchanged.
import { typedApi, unwrap, type Answer, type Op, type QueryOf, type components } from "../typed";

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

export type AuditLog = components["schemas"]["AuditLogEntry"];

/** `null` on a row whose user is outside the reader's tenant, or removed. */
export type AuditLogUser = NonNullable<AuditLog["user"]>;

export interface AuditLogChanges {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

type ListAnswer = Answer<Op<"/api/v1/audit", "get">>;

type ListMeta = ListAnswer["meta"];

/**
 * P8-04 (ADR-096): `total` is at most 10,000 — see `totalIsCapped`. The backend
 * always sends `totalIsCapped` and `window`; they stay optional for the page's
 * own placeholder meta (before the first read, and an answer without one).
 */
export type AuditMeta = Omit<ListMeta, "totalIsCapped" | "window"> &
  Partial<Pick<ListMeta, "totalIsCapped" | "window">>;

/**
 * P8-04 (ADR-096): the date window the backend read. With no Start Date, End
 * Date or resource, it reads the last 90 days (`defaulted: true`).
 */
export type AuditWindow = ListMeta["window"];

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
    const params: QueryOf<Op<"/api/v1/audit", "get">> = { page, limit };

    if (query.userId) params.userId = query.userId;
    if (query.actorType) params.actorType = query.actorType;
    if (query.scope) params.scope = query.scope;
    if (query.action) params.action = query.action;
    if (query.resourceType) params.resourceType = query.resourceType;
    if (query.startDate) params.startDate = query.startDate;
    if (query.endDate) params.endDate = query.endDate;

    const response = await typedApi.GET("/api/v1/audit", { params: { query: params } }).then(unwrap);

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
