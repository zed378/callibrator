/**
 * The IPM session handlers (P21-03; ADR-126; spec MEMORY/specs/P19-02-ipm-session-aggregate.md
 * § 10). Every body, query and parameter arrives validated (`validate(schema, { from })` on the
 * route) and is read with `validated(req, schema)`; the tenant comes from the request context and
 * the actor from the principal — never from input (FT-91).
 *
 * Named exports only (ADR-087 Am. 15).
 */
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import { auditPrincipal } from "../utils/auditPrincipal.util";
import { rbacAllows, type PermissionPrincipal } from "../services/effectivePermission.service";
import { ROLE_NAMES } from "../constants";
import {
  deviceIpmSessionsQuery,
  ipmResultsReplace,
  ipmSessionCorrection,
  ipmSessionCreate,
  ipmSessionDiscard,
  ipmSessionHeaderUpdate,
  ipmSessionIdParams,
  ipmSessionListQuery,
} from "@callibrator/contracts/inspectionSessions";
import {
  createCorrection,
  createSession,
  deviceSessions,
  discardSession,
  getSession,
  listSessions,
  replaceResults,
  updateHeader,
  type IpmActor,
  type IpmWriteResult,
} from "../services/ipmSession.service";
import { toInspectionSessionId, type TenantId } from "../types/ids";

const actorOf = (req: Request): IpmActor => ({
  ...auditPrincipal(req),
  tenantAdmin: rbacAllows(req.user as PermissionPrincipal, [ROLE_NAMES.TENANT_ADMIN]),
});

const tenantOf = (req: Request): TenantId => req.tenantId as TenantId;

const callerId = (req: Request): string | null => auditPrincipal(req).userId;

const answer = (res: Response, result: IpmWriteResult, message: string): void => {
  success(res, result.session, null, result.status === 201 ? message : `${message} (already recorded)`, result.status);
};

/** GET /ipm/sessions. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const { rows, meta } = await listSessions(callerId(req), validated(req, ipmSessionListQuery));
  success(res, rows, meta, "IPM sessions retrieved", 200);
});

/** GET /calibration-devices/:calibrationDeviceId/ipm-sessions. */
export const deviceHistory = asyncHandler(async (req: Request, res: Response) => {
  const { rows, meta } = await deviceSessions(callerId(req), validated(req, deviceIpmSessionsQuery));
  success(res, rows, meta, "IPM sessions retrieved", 200);
});

/** GET /ipm/sessions/:sessionId. */
export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = validated(req, ipmSessionIdParams);
  success(res, await getSession(toInspectionSessionId(sessionId)), "IPM session retrieved", 200);
});

/** POST /ipm/sessions. */
export const create = asyncHandler(async (req: Request, res: Response) => {
  answer(res, await createSession(tenantOf(req), validated(req, ipmSessionCreate), actorOf(req)), "IPM draft created");
});

/** PATCH /ipm/sessions/:sessionId. */
export const editHeader = asyncHandler(async (req: Request, res: Response) => {
  success(res, (await updateHeader(tenantOf(req), validated(req, ipmSessionHeaderUpdate), actorOf(req))).session, "IPM draft saved", 200);
});

/** PUT /ipm/sessions/:sessionId/results. */
export const editResults = asyncHandler(async (req: Request, res: Response) => {
  success(res, (await replaceResults(tenantOf(req), validated(req, ipmResultsReplace), actorOf(req))).session, "IPM results saved", 200);
});

/** POST /ipm/sessions/:sessionId/discard. */
export const discard = asyncHandler(async (req: Request, res: Response) => {
  success(res, (await discardSession(tenantOf(req), validated(req, ipmSessionDiscard), actorOf(req))).session, "IPM draft discarded", 200);
});

/** POST /ipm/sessions/:sessionId/corrections. */
export const correct = asyncHandler(async (req: Request, res: Response) => {
  answer(res, await createCorrection(tenantOf(req), validated(req, ipmSessionCorrection), actorOf(req)), "IPM correction draft created");
});

/** The idempotency replay's reader: the session, re-read in the current context. */
export const readSession = (id: string): Promise<unknown> => getSession(toInspectionSessionId(id));
