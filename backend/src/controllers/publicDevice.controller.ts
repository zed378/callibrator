/**
 * The public device page and the device's public link (P21-08; ADR-138, Am. 1; spec
 * MEMORY/specs/P19-07-public-device-page.md § 6 – § 8).
 *
 *  - `publicHeaders` — on the public route, BEFORE its budgets, so a 429 carries them too:
 *    `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`.
 *  - `read` — the public page. Every 404 also counts against `publicDevicePageMiss` (ADR-100's
 *    pair, as `ipmSession.controller#verify`): a failed lookup counts double.
 *  - `state` / `issue` / `rotate` / `revoke` — the staff routes (unbound only, by the route gate).
 *
 * Named exports only (ADR-087 Am. 15).
 */
import type { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import { requestBudget } from "../middlewares/requestBudget.middleware";
import { auditPrincipal } from "../utils/auditPrincipal.util";
import { AppError } from "../utils/appError.util";
import { publicDeviceParams, publicDeviceTokenParams } from "@callibrator/contracts/publicDevices";
import { readPublicDevice } from "../services/publicDevicePage.service";
import { getLinkState, issueLink, revokeLink, rotateLink } from "../services/publicDeviceToken.service";
import type { TenantId } from "../types/ids";

/** The public answer's headers (§ 8), on every answer of the route — 200, 404 and 429. */
export const publicHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
};

const missBudget = requestBudget("publicDevicePageMiss");

/** GET /public/devices/:token — PUBLIC. */
export const read = asyncHandler(async (req: Request, res: Response) => {
  const { token } = validated(req, publicDeviceParams);
  try {
    success(res, await readPublicDevice(token), "Public device page", 200);
  } catch (err) {
    if (!(err instanceof AppError) || err.status !== 404) {
      throw err;
    }
    let withinBudget = false;
    await missBudget(req, res, () => {
      withinBudget = true;
    });
    // `next` above may have run: TypeScript cannot see the callback's assignment.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- set by the callback
    if (withinBudget) {
      throw err;
    }
  }
});

/** GET /calibration-devices/:calibrationDeviceId/public-token — the link's state. */
export const state = asyncHandler(async (req: Request, res: Response) => {
  const { calibrationDeviceId } = validated(req, publicDeviceTokenParams);
  success(res, await getLinkState(calibrationDeviceId), "Public link state", 200);
});

/** POST /calibration-devices/:calibrationDeviceId/public-token — issue (201; the token once). */
export const issue = asyncHandler(async (req: Request, res: Response) => {
  const { calibrationDeviceId } = validated(req, publicDeviceTokenParams);
  res.setHeader("Cache-Control", "no-store");
  success(res, await issueLink(req.tenantId as TenantId, calibrationDeviceId, auditPrincipal(req)), "Public link issued", 201);
});

/** POST /calibration-devices/:calibrationDeviceId/public-token/rotate — rotate (201; the new token once). */
export const rotate = asyncHandler(async (req: Request, res: Response) => {
  const { calibrationDeviceId } = validated(req, publicDeviceTokenParams);
  res.setHeader("Cache-Control", "no-store");
  success(res, await rotateLink(req.tenantId as TenantId, calibrationDeviceId, auditPrincipal(req)), "Public link rotated", 201);
});

/** DELETE /calibration-devices/:calibrationDeviceId/public-token — revoke. */
export const revoke = asyncHandler(async (req: Request, res: Response) => {
  const { calibrationDeviceId } = validated(req, publicDeviceTokenParams);
  success(res, await revokeLink(req.tenantId as TenantId, calibrationDeviceId, auditPrincipal(req)), "Public link revoked", 200);
});
