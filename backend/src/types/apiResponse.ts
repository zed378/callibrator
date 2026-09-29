/**
 * The response envelope (CLAUDE.md § The Response Envelope; ADR-087 Amendment 5).
 *
 *   { "success": true, "status": 200, "message": "...", "data": [...], "meta": { "total": 0 } }
 *
 * Rows go in `data`. Pagination goes in a top-level `meta`, a SIBLING of `data`
 * — never `data.rows`, `data.items` or `data.meta`. Built by `utils/response.util`,
 * its first converted user. Backend-internal: the contract the frontend reads
 * goes in `packages/contracts` (P9-22). Types only; this file emits nothing.
 */

/** A success body. `meta`, `token`, `refreshToken` and `session` appear only when set. */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  status: number;
  message: string;
  data: T;
  meta?: object;
  token?: unknown;
  refreshToken?: unknown;
  session?: unknown;
}

/**
 * An error body. `details` appears outside production only; `extra` fields
 * (field `errors`, a production `requestId`) are spread in at the top level.
 */
export interface ApiErrorResponse {
  success: false;
  status: number;
  message: string;
  data: null;
  details?: unknown;
  [extra: string]: unknown;
}

/** Either envelope. */
export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;
