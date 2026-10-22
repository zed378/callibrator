/**
 * The invitation of an imported user (P24-09a; ADR-139 § 3 and Am. 1): its state, issue and revoke.
 * The acceptance is publicAuth.controller's (`POST /auth/invitation/accept`, both kinds of token).
 *
 * Named exports only (ADR-087 Am. 15).
 */
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import { auditPrincipal } from "../utils/auditPrincipal.util";
import { issueUserInvitation, userInvitationParams } from "@callibrator/contracts/userInvitations";
import { getInvitationState, issueInvitation, revokeInvitation } from "../services/userInvitation.service";
import type { TenantId } from "../types/ids";

/** GET /users/:userId/invitation — the invitation's state. */
export const state = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = validated(req, userInvitationParams);
  success(res, await getInvitationState(userId), "Invitation state", 200);
});

/** POST /users/:userId/invitation — issue, or issue again (201; never the token). */
export const issue = asyncHandler(async (req: Request, res: Response) => {
  const input = validated(req, issueUserInvitation);
  success(res, await issueInvitation(req.tenantId as TenantId, input, auditPrincipal(req)), "Invitation issued", 201);
});

/** DELETE /users/:userId/invitation — revoke the live invitation. */
export const revoke = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = validated(req, userInvitationParams);
  success(res, await revokeInvitation(req.tenantId as TenantId, userId, auditPrincipal(req)), "Invitation revoked", 200);
});
