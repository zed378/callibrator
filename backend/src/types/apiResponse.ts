/**
 * The response envelope (CLAUDE.md § The Response Envelope; ADR-087 Amendment 5).
 *
 *   { "success": true, "status": 200, "message": "...", "data": [...], "meta": { "total": 0 } }
 *
 * Rows go in `data`. Pagination goes in a top-level `meta`, a SIBLING of `data`
 * — never `data.rows`, `data.items` or `data.meta`. Built by `utils/response.util`.
 *
 * P9-22 (ADR-097, and the ADR-087 amendment recording the move): the envelope is
 * a cross-workspace contract, so its definition lives in
 * `@callibrator/contracts/envelope` (packages/contracts/src/envelope.ts), as Zod
 * schemas with these types inferred from them. This file stays the backend's one
 * place for the envelope types (the src/types/ lint guard) and re-exports them.
 * Types only; this file emits nothing.
 */
export type {
  ApiErrorResponse,
  ApiListResponse,
  ApiResponse,
  ApiSuccessResponse,
} from "@callibrator/contracts/envelope";
