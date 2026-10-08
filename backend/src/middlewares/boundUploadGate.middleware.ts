/**
 * P21-09e — the bound gate of `POST /attachments` (P18-03 § 8.2 A-5, C-4; G-P6).
 *
 * The upload is gated on `equipment` READ, which every seeded role holds — so a facility-BOUND
 * `ROOM USER` could otherwise put any file into the tenant's storage. For a bound principal the
 * upload must be a photo of a DEVICE (the IPM photo type joins with P19-02 / P21-03):
 *
 *  - `resourceType` `device` / `calibrationDevice`, with a `resourceId` — a standalone file
 *    (`generic`, `ticket`, `post`) and every other type (certificate, calibration, work order,
 *    kanban card) → 403 `FACILITY_UPLOAD_REFUSED`;
 *  - `calibration` WRITE on the principal's effective permission (role ⊕ override, capped by the
 *    bound ceiling — the function `dynamicAccess` reads) → else 403;
 *  - the device itself is loaded IN CONTEXT by the service (another facility's device is the same
 *    404 as a missing one — attachment.service#assertLinkTarget).
 *
 * Runs after multer (the body is multipart): a refused upload's quarantined file is removed here.
 * Unbound principals and API keys pass unchanged. Named on its route's FACILITY_ACCESSIBLE_ROUTES
 * entry (`boundGate`), and tests/guards/twoFacilityRoutes.guard holds the name to the chain.
 */
import fs from "fs";
import type { NextFunction, Request, Response } from "express";
import { facilityContextOf } from "./tenantContext.middleware";
import { allows, loadPermissionSources, type PermissionPrincipal } from "../services/effectivePermission.service";

/** The machine-readable code of a refused bound upload (top-level `code`). */
export const FACILITY_UPLOAD_REFUSED = "FACILITY_UPLOAD_REFUSED";

/** The resource types a bound principal may attach a file to, lower-cased (A-5). */
const BOUND_UPLOAD_TYPES: readonly string[] = ["device", "calibrationdevice"];

const refuse = async (req: Request, res: Response, message: string): Promise<void> => {
  const file = (req as Request & { file?: { path?: string } }).file;
  if (file?.path) {
    await fs.promises.unlink(file.path).catch(() => undefined);
  }
  res.status(403).json({ success: false, status: 403, message, data: null, code: FACILITY_UPLOAD_REFUSED });
};

/**
 * Pass an unbound upload; hold a bound one to a device photo with `calibration` write.
 */
export const boundUploadGate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const principal = req.user as (PermissionPrincipal & { isApiKey?: boolean; clientFacilityId?: unknown }) | undefined;
  if (!facilityContextOf(principal).facilityBound) {
    next();
    return;
  }
  const body = req.body as { resourceType?: unknown; resourceId?: unknown };
  const type = typeof body.resourceType === "string" ? body.resourceType.toLowerCase() : "";
  if (!BOUND_UPLOAD_TYPES.includes(type) || typeof body.resourceId !== "string" || body.resourceId === "") {
    await refuse(req, res, "A facility account can attach photos to its facility's devices only.");
    return;
  }
  try {
    const sources = await loadPermissionSources(principal as PermissionPrincipal);
    if (!allows(sources, "calibration", "write")) {
      await refuse(req, res, "Attaching a device photo needs calibration write.");
      return;
    }
  } catch (err) {
    next(err);
    return;
  }
  next();
};
