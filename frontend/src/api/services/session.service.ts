// P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
// contract's (backend/src/routes/api/sessions.openapi.ts). The names are unchanged.
import { typedApi, unwrap, type Answer, type DataOf, type Op, type QueryOf, type components } from "../typed";

// ─── Types ───────────────────────────────────────────────────────────────────

/** A session as the platform operator sees it (A-334: there is no `location`). */
export type Session = components["schemas"]["AdminSession"];

type List = Op<"/api/v1/sessions", "get">;

/**
 * GET /api/v1/sessions answers the standard envelope: rows in `data`,
 * pagination in a TOP-LEVEL `meta` (A-111).
 */
export type SessionMeta = Answer<List>["meta"];

/** What `getAll` resolves to: the rows and their pagination. */
export interface SessionsResult {
  sessions: Session[];
  meta: SessionMeta;
}

export type SessionStats = DataOf<Op<"/api/v1/sessions/stats", "get">>;

export interface RevokeSessionPayload {
  reason?: string;
}

export type RevokeAllResult = DataOf<Op<"/api/v1/sessions/user/{userId}/revoke-all", "post">>;

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
    // The contract publishes page/limit as the strings the controller parses.
    const params: QueryOf<List> = { page: String(page), limit: String(limit) };

    if (search) params.search = search;
    if (status) params.status = status;
    if (userId) params.userId = userId;

    const response = await typedApi.GET("/api/v1/sessions", { params: { query: params } }).then(unwrap);

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
    return (await typedApi.GET("/api/v1/sessions/{id}", { params: { path: { id } } }).then(unwrap)).data;
  },

  /**
   * Get session statistics
   * @param userId - Filter by user ID (optional)
   */
  getStats: async (userId?: string): Promise<SessionStats> => {
    const params: QueryOf<Op<"/api/v1/sessions/stats", "get">> = {};
    if (userId) params.userId = userId;

    return (await typedApi.GET("/api/v1/sessions/stats", { params: { query: params } }).then(unwrap)).data;
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
    return typedApi.POST("/api/v1/sessions/{id}/revoke", { params: { path: { id } }, body: { reason } }).then(unwrap);
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
    return (
      await typedApi
        .POST("/api/v1/sessions/user/{userId}/revoke-all", { params: { path: { userId } }, body: { reason } })
        .then(unwrap)
    ).data;
  },

  /**
   * Delete a revoked or expired session
   * @param id - Session UUID
   */
  delete: async (
    id: string,
  ): Promise<{ success: boolean; message: string }> => {
    return typedApi.DELETE("/api/v1/sessions/{id}", { params: { path: { id } } }).then(unwrap);
  },
};

export default sessionService;
