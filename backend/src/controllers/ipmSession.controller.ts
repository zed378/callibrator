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
import { requestBudget } from "../middlewares/requestBudget.middleware";
import { AppError } from "../utils/appError.util";
import {
  deviceIpmSessionsQuery,
  ipmResultsReplace,
  ipmSessionCorrection,
  ipmSessionCreate,
  ipmSessionDiscard,
  ipmSessionHeaderUpdate,
  ipmSessionIdParams,
  ipmSessionListQuery,
  ipmSessionSubmit,
  ipmSessionVoid,
  ipmDueQuery,
} from "@callibrator/contracts/inspectionSessions";
import { ipmReportDocumentQuery, ipmSignature, ipmVerifyQuery } from "@callibrator/contracts/ipmReport";
import { submitSession, voidSession } from "../services/ipmSubmit.service";
import { getReportDocument, verifyReport } from "../services/ipmReport.service";
import { signReport } from "../services/ipmSignature.service";
import { listDue } from "../services/ipmDue.service";
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

/** POST /ipm/sessions/:sessionId/submit (P21-04). */
export const submit = asyncHandler(async (req: Request, res: Response) => {
  success(res, (await submitSession(tenantOf(req), validated(req, ipmSessionSubmit), actorOf(req))).session, "IPM submitted", 200);
});

/** POST /ipm/sessions/:sessionId/void (P21-04). */
export const voidOne = asyncHandler(async (req: Request, res: Response) => {
  success(res, (await voidSession(tenantOf(req), validated(req, ipmSessionVoid), actorOf(req))).session, "IPM voided", 200);
});

/** GET /ipm/sessions/:sessionId/report-document (P21-04). */
export const reportDocument = asyncHandler(async (req: Request, res: Response) => {
  success(res, await getReportDocument(tenantOf(req), validated(req, ipmReportDocumentQuery), auditPrincipal(req)), "IPM report document", 200);
});

/** POST /ipm/sessions/:sessionId/signatures (P21-04). */
export const sign = asyncHandler(async (req: Request, res: Response) => {
  success(res, await signReport(tenantOf(req), validated(req, ipmSignature), auditPrincipal(req)), "IPM report signed", 201);
});

/** GET /ipm/due (P21-04). */
export const due = asyncHandler(async (req: Request, res: Response) => {
  const { rows, meta } = await listDue(tenantOf(req), validated(req, ipmDueQuery));
  success(res, rows, meta, "IPM due list", 200);
});

// ADR-100's pair for a public verification by capability token (P19-06 § 8.1): every request counts
// against `ipmVerifyToken` on the route; every answer that is NOT a verdict also against the tighter
// `ipmVerify` — decided after the lookup, because a wrong token must answer exactly like none.
const notAVerdictBudget = requestBudget("ipmVerify");

/** GET /ipm/verify/:reportNumber?token= — PUBLIC (P21-04; P19-06 § 9). */
export const verify = asyncHandler(async (req: Request, res: Response) => {
  const { reportNumber, token } = validated(req, ipmVerifyQuery);
  try {
    success(res, await verifyReport(reportNumber, token), "IPM report verification result", 200);
  } catch (err) {
    if (!(err instanceof AppError) || err.status !== 404) {
      throw err;
    }
    let withinBudget = false;
    await notAVerdictBudget(req, res, () => {
      withinBudget = true;
    });
    // `next` above may have run: TypeScript cannot see the callback's assignment.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- set by the callback
    if (withinBudget) {
      throw err;
    }
  }
});

/** The idempotency replay's reader: the session, re-read in the current context. */
export const readSession = (id: string): Promise<unknown> => getSession(toInspectionSessionId(id));
