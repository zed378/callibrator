/**
 * ADR-108 Amendment 1 — the request shapes of a user's own passkeys:
 * `/webauthn/credentials` (list), `/:id` rename and revoke. The id is the
 * passkey ROW's id (never the credential id, which is not exposed).
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/webauthnCredential.validator.ts,
 * which re-exports these same objects by name. The contract for
 * /api/v1/webauthn/credentials (list, rename and revoke a passkey).
 */
import { z } from "zod";
import { uuid } from "./fields";

/** `:id` alone. */
export const passkeyIdSchema = z.object({ id: uuid() });

/** PATCH /webauthn/credentials/:id — the owner's label. */
export const renamePasskeySchema = z.object({
  id: uuid(),
  name: z.string().trim().min(1).max(64),
});

/**
 * DELETE /webauthn/credentials/:id — the A-213 re-authentication: the current
 * password, and on an MFA account a current code or a recovery code.
 */
export const revokePasskeySchema = z.object({
  id: uuid(),
  currentPassword: z.string().max(200).optional(),
  code: z.string().max(20).optional(),
  recoveryCode: z.string().max(64).optional(),
});
