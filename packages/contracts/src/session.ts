/**
 * Session revocation bodies.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/session.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the session routes.
 */
import { z } from "zod";

const revokeSessionSchema = z.object({
  reason: z.string().trim().min(1).max(255).default("MANUAL_REVOKE"),
});

const revokeAllSessionsSchema = z.object({
  reason: z.string().trim().min(1).max(255).default("ADMIN_REVOKE_ALL"),
});

export { revokeSessionSchema, revokeAllSessionsSchema };

// The client-side (input) and handler-side (output) types of each schema.
export type RevokeSessionInput = z.input<typeof revokeSessionSchema>;
export type RevokeSessionBody = z.output<typeof revokeSessionSchema>;
export type RevokeAllSessionsInput = z.input<typeof revokeAllSessionsSchema>;
export type RevokeAllSessionsBody = z.output<typeof revokeAllSessionsSchema>;
