/**
 * ADR-108 Amendment 1 — the signed-in user's own passkeys: list, rename,
 * revoke. Every call acts on the caller's own rows (`req.user`); another
 * user's passkey id — in this tenant or another — answers 404.
 */
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import { renamePasskeySchema, revokePasskeySchema } from "../validators/webauthnCredential.validator";
import { requestOriginOf } from "../utils/requestOrigin.util";
import webauthn from "../services/webauthn.service";
import type { TenantId } from "../types/ids";

/** The caller as `auth` set it. */
const callerOf = (req: Request): { tenantId: TenantId | null; userId: string } => {
  // `auth` always sets both (a tenant-less account carries tenantId null).
  const user = req.user as { id: unknown; tenantId: TenantId | null };
  return { tenantId: user.tenantId, userId: String(user.id) };
};

const contextOf = (req: Request): { ipAddress: string | null; userAgent: string | null } => {
  const { ip, userAgent } = requestOriginOf(req);
  return { ipAddress: ip, userAgent };
};

/** GET /webauthn/credentials */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, userId } = callerOf(req);
  success(res, await webauthn.listPasskeys(tenantId, userId), "Passkeys", 200);
});

/** PATCH /webauthn/credentials/:id { name } */
export const rename = asyncHandler(async (req: Request, res: Response) => {
  const { id, name } = validated(req, renamePasskeySchema);
  const { tenantId, userId } = callerOf(req);
  success(res, await webauthn.renamePasskey(tenantId, userId, id, name, contextOf(req)), "Passkey renamed", 200);
});

/** DELETE /webauthn/credentials/:id { currentPassword, code?, recoveryCode? } */
export const revoke = asyncHandler(async (req: Request, res: Response) => {
  const { id, currentPassword, code, recoveryCode } = validated(req, revokePasskeySchema);
  const { tenantId, userId } = callerOf(req);
  const proof = {
    ...(currentPassword === undefined ? {} : { currentPassword }),
    ...(code === undefined ? {} : { code }),
    ...(recoveryCode === undefined ? {} : { recoveryCode }),
  };
  success(res, await webauthn.revokePasskey(tenantId, userId, id, proof, contextOf(req)), "Passkey removed", 200);
});
