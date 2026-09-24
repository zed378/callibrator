import { api } from "../client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  userId: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  ipAddress: string;
  userAgent: string;
  device: string;
  browser: string;
  os: string;
  location: string;
  role: string;
  tenantId: string | null;
  tenantName: string | null;
  isRevoked: boolean;
  isActive: boolean;
  expiredAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  lastActivityAt: string;
  createdAt: string;
  status: "active" | "expired" | "revoked";
}

export interface SessionMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * The wire shape of GET /api/v1/sessions — the standard envelope: rows in
 * `data`, pagination in a TOP-LEVEL `meta` (A-111). The backend used to send
 * `data: { sessions, meta }`; nothing reads that shape any more.
 */
interface SessionsEnvelope {
  success: boolean;
  status: number;
  message: string;
  data: Session[] | null;
  meta?: SessionMeta;
}

/** What `getAll` resolves to: the rows and their pagination. */
export interface SessionsResult {
  sessions: Session[];
  meta: SessionMeta;
}

export interface SessionStats {
  total: number;
  active: number;
  expired: number;
  revoked: number;
}

export interface RevokeSessionPayload {
  reason?: string;
}

export interface RevokeAllResult {
  revokedCount: number;
}

// ─── API Service ─────────────────────────────────────────────────────────────

export const sessionService = {
  /**
   * Get all sessions (paginated)
   * @param page - Page number (default: 1)
   * @param limit - Items per page (default: 20)
   * @param search - Search by IP, device, or user agent
   * @param status - Filter by status: active, expired, revoked
   * @param userId - Filter by user ID (admin only)
   */
  getAll: async (
    page = 1,
    limit = 20,
    search?: string,
    status?: "active" | "expired" | "revoked",
    userId?: string,
  ): Promise<SessionsResult> => {
    const params: Record<string, string | number> = { page, limit };

    if (search) params.search = search;
    if (status) params.status = status;
    if (userId) params.userId = userId;

    const response = await api.get<SessionsEnvelope>("/api/v1/sessions", {
      params,
    });

    const sessions = response.data ?? [];
    const meta: SessionMeta = response.meta ?? {
      total: sessions.length,
      page,
      limit,
      totalPages: 1,
    };
    return { sessions, meta };
  },

  /**
   * Get session by ID
   * @param id - Session UUID
   */
  getById: async (id: string): Promise<Session> => {
    const response = await api.get<{ success: boolean; data: Session }>(
      `/api/v1/sessions/${id}`,
    );
    return response.data;
  },

  /**
   * Get session statistics
   * @param userId - Filter by user ID (optional)
   */
  getStats: async (userId?: string): Promise<SessionStats> => {
    const params: Record<string, string> = {};
    if (userId) params.userId = userId;

    const response = await api.get<{ success: boolean; data: SessionStats }>(
      "/api/v1/sessions/stats",
      { params },
    );
    return response.data;
  },

  /**
   * Revoke a session
   * @param id - Session UUID
   * @param reason - Reason for revocation (default: "MANUAL_REVOKE")
   */
  revoke: async (
    id: string,
    reason = "MANUAL_REVOKE",
  ): Promise<{ success: boolean; message: string }> => {
    const response = await api.post<{
      success: boolean;
      message: string;
    }>(`/api/v1/sessions/${id}/revoke`, { reason });
    return response;
  },

  /**
   * Revoke all sessions for a user (admin only)
   * @param userId - User UUID
   * @param reason - Reason for revocation (default: "ADMIN_REVOKE_ALL")
   */
  revokeAllForUser: async (
    userId: string,
    reason = "ADMIN_REVOKE_ALL",
  ): Promise<RevokeAllResult> => {
    const response = await api.post<{
      success: boolean;
      data: RevokeAllResult;
      message: string;
    }>(`/api/v1/sessions/user/${userId}/revoke-all`, { reason });
    return response.data;
  },

  /**
   * Delete a revoked or expired session
   * @param id - Session UUID
   */
  delete: async (
    id: string,
  ): Promise<{ success: boolean; message: string }> => {
    const response = await api.delete<{
      success: boolean;
      message: string;
    }>(`/api/v1/sessions/${id}`);
    return response;
  },
};

export default sessionService;
