/**
 * Personal e-signatures and their applications (P21-15; ADR-140; spec
 * MEMORY/specs/P21-15-operator-esignature.md v2 § 4).
 *
 *  - my e-signature: `getMe`, `createMe`, `revokeMe`; a tenant administrator's `revokeOther`;
 *    `myApplicationList`; `signDocumentByHash`;
 *  - on calibration records: `applyToRecordHandler`, `recordApplications`;
 *  - public: `publicHeaders` (BEFORE the budget, so a 429 carries them too) and `verifyPublicHandler`.
 *    Every request counts against `esigVerifyToken` on the route; every answer that is NOT a verdict
 *    also against `esigVerify`, decided after the lookup because a wrong token must answer exactly
 *    like none (ADR-100's pair, as ipmSession#verify).
 *
 * Every body, query and parameter arrives validated (`validate(schema, { from })` on the route) and is
 * read with `validated(req, schema)`; the tenant comes from the request context and the signer from
 * the principal — never from input. Named exports only (ADR-087 Am. 15).
 */
import type { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import { requestBudget } from "../middlewares/requestBudget.middleware";
import { auditPrincipal } from "../utils/auditPrincipal.util";
import { AppError } from "../utils/appError.util";
import {
  applyRecordEsignature,
  createMyEsignature,
  myApplicationsQuery,
  publicEsignatureQuery,
  recordEsignaturesParams,
  revokeMyEsignature,
  revokeUserEsignature,
  signDocument,
} from "@callibrator/contracts/esignatures";
import { createOrReplace, getMine, revokeMine, revokeUser } from "../services/userEsignature.service";
import { applyToRecord, listForRecord, myApplications, signDocument as signDocumentService, verifyPublic } from "../services/esignatureApplication.service";
import type { TenantId } from "../types/ids";

const tenantOf = (req: Request): TenantId => req.tenantId as TenantId;
const meOf = (req: Request): string => (req.user as { id: string }).id;

/** GET /esignature/me. */
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  success(res, await getMine(meOf(req)), "My e-signature", 200);
});

/** POST /esignature/me — create or replace (201). */
export const createMe = asyncHandler(async (req: Request, res: Response) => {
  success(res, await createOrReplace(req.tenantId, validated(req, createMyEsignature), auditPrincipal(req)), "E-signature saved", 201);
});

/** POST /esignature/me/revoke. */
export const revokeMe = asyncHandler(async (req: Request, res: Response) => {
  success(res, await revokeMine(tenantOf(req), validated(req, revokeMyEsignature), auditPrincipal(req)), "E-signature revoked", 200);
});

/** POST /esignature/users/:userId/revoke — a tenant administrator's act. */
export const revokeOther = asyncHandler(async (req: Request, res: Response) => {
  success(res, await revokeUser(tenantOf(req), validated(req, revokeUserEsignature), auditPrincipal(req)), "E-signature revoked", 200);
});

/** GET /esignature/me/applications — rows in `data`, the page in a top-level `meta`. */
export const myApplicationList = asyncHandler(async (req: Request, res: Response) => {
  const { rows, meta } = await myApplications(meOf(req), validated(req, myApplicationsQuery));
  success(res, rows, meta, "My e-signature applications", 200);
});

/** POST /esignature/documents — a file signed by its hash (201). */
export const signDocumentByHash = asyncHandler(async (req: Request, res: Response) => {
  success(res, await signDocumentService(tenantOf(req), validated(req, signDocument), auditPrincipal(req)), "Document signed", 201);
});

/** POST /calibration-records/:calibrationRecordId/esignatures (201). */
export const applyToRecordHandler = asyncHandler(async (req: Request, res: Response) => {
  success(res, await applyToRecord(tenantOf(req), validated(req, applyRecordEsignature), auditPrincipal(req)), "Calibration record signed", 201);
});

/** GET /calibration-records/:calibrationRecordId/esignatures. */
export const recordApplications = asyncHandler(async (req: Request, res: Response) => {
  const { calibrationRecordId } = validated(req, recordEsignaturesParams);
  success(res, await listForRecord(calibrationRecordId), "Calibration record e-signatures", 200);
});

/** The public answer's headers, on every answer of the route — 200, 404 and 429. */
export const publicHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  next();
};

const notAVerdictBudget = requestBudget("esigVerify");

/** GET /public/esignatures/:applicationId?token= — PUBLIC. */
export const verifyPublicHandler = asyncHandler(async (req: Request, res: Response) => {
  const { applicationId, token } = validated(req, publicEsignatureQuery);
  try {
    success(res, await verifyPublic(applicationId, token), "E-signature verification result", 200);
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
