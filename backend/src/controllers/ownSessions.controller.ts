/**
 * Q-08 (ADR-084) — the caller's own sessions: list them, end one.
 * Acts only on req.user.id; see services/ownSessions.service.
 *
 * P9-20 (ADR-087): converted from ownSessions.controller.js with no behaviour
 * change. `export =` keeps the exact object `require()` returned. The service
 * is the module object; `asyncHandler`, `auditActor` and `sendResult` are
 * captured at load, as the `.js` destructured them.
 */
import type { Request, Response } from "express";

import ownSessions from "../services/ownSessions.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";
import { sendResult as loadedSendResult } from "../utils/response.util";
import type { TenantId, UserId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const auditActor = loadedAuditActor;
const sendResult = loadedSendResult;

/** The request as `auth` leaves it: the principal, and the session the token names. */
interface SessionRequest extends Request {
  user: { id: UserId; tenantId?: TenantId | null };
  sessionId?: string | null;
}

const listOwnSessions = asyncHandler(async (req: Request, res: Response) => {
  const r = req as SessionRequest;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty session id reads as null
  sendResult(res, await ownSessions.listOwnSessions(r.user.id, r.sessionId || null));
});

const revokeOwnSession = asyncHandler(async (req: Request, res: Response) => {
  const r = req as SessionRequest;
  sendResult(
    res,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty session id reads as null
    await ownSessions.revokeOwnSession(r.user, r.params["id"] as string, r.sessionId || null, auditActor(req)),
  );
});

const controller = {
  listOwnSessions,
  revokeOwnSession,
};

export = controller;
