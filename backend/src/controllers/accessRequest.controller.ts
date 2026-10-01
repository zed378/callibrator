/**
 * P10-05 / P10-07 (ADR-098 §6) — the access-request intake and the super
 * admin's queue. The address and user agent come from the request itself,
 * never the body; every body arrives already validated (`validate(schema)` on
 * the route) and is read with `validated(req, schema)`.
 */
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import {
  accessRequestIdSchema,
  approveAccessRequestSchema,
  eraseAccessRequestsSchema,
  listAccessRequestsSchema,
  rejectAccessRequestSchema,
  submitAccessRequestSchema,
} from "../validators/accessRequest.validator";
import {
  SUBMISSION_RECEIVED,
  approveAccessRequest,
  eraseAccessRequestsByEmail,
  getAccessRequest,
  listAccessRequests,
  rejectAccessRequest,
  resendInvitation as resendInvitationService,
  submitAccessRequest,
  type Actor,
} from "../services/accessRequest.service";
import { actorIdOf, requestOriginOf } from "../utils/requestOrigin.util";

/** The super admin acting (the admin router's `auth` + `rbac` put them on `req.user`). */
const actorOf = (req: Request): Actor => {
  const { ip, userAgent } = requestOriginOf(req);
  return { userId: actorIdOf(req), ipAddress: ip, userAgent };
};

/**
 * POST /access-requests — public. BR-P10-2: the SAME answer for a new
 * request, a duplicate, an over-cap address and a filled honeypot.
 */
export const submit = asyncHandler(async (req: Request, res: Response) => {
  await submitAccessRequest(validated(req, submitAccessRequestSchema), requestOriginOf(req));
  const answer = SUBMISSION_RECEIVED;
  success(res, answer.data, answer.message, answer.status);
});

/** GET /admin/access-requests — rows in `data`, pagination in a top-level `meta`. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const { rows, meta } = await listAccessRequests(validated(req, listAccessRequestsSchema));
  success(res, rows, meta, "Access requests retrieved", 200);
});

/** GET /admin/access-requests/:id */
export const detail = asyncHandler(async (req: Request, res: Response) => {
  const { id } = validated(req, accessRequestIdSchema);
  success(res, await getAccessRequest(id), "Access request retrieved", 200);
});

/** POST /admin/access-requests/:id/approve */
export const approve = asyncHandler(async (req: Request, res: Response) => {
  const input = validated(req, approveAccessRequestSchema);
  const result = await approveAccessRequest(input.id, input, actorOf(req));
  success(res, result, "Access request approved", 200);
});

/** POST /admin/access-requests/:id/reject */
export const reject = asyncHandler(async (req: Request, res: Response) => {
  const input = validated(req, rejectAccessRequestSchema);
  success(res, await rejectAccessRequest(input.id, input, actorOf(req)), "Access request rejected", 200);
});

/** POST /admin/access-requests/:id/resend-invitation */
export const resendInvitation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = validated(req, accessRequestIdSchema);
  success(res, await resendInvitationService(id, actorOf(req)), "Invitation re-issued", 200);
});

/** POST /admin/access-requests/erasure — a requester's DSAR, by address. */
export const erase = asyncHandler(async (req: Request, res: Response) => {
  const { email } = validated(req, eraseAccessRequestsSchema);
  success(res, await eraseAccessRequestsByEmail(email, actorOf(req)), "Access requests erased", 200);
});
