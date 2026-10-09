/**
 * P21-02b (ADR-132 Am. 3; spec MEMORY/specs/P19-03-device-extensions.md § 7.2): the device photo
 * routes' handlers. The path and the fields arrive validated; the tenant and the actor come from
 * the request.
 *
 * Named exports only (ADR-087 Am. 15).
 */
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import { auditPrincipal } from "../utils/auditPrincipal.util";
import { devicePhotoParams, devicePhotoUpload } from "@callibrator/contracts/calibrationDevices";
import { deleteDevicePhoto, uploadDevicePhoto } from "../services/devicePhoto.service";
import type { TenantId } from "../types/ids";

/** POST /calibration-devices/:calibrationDeviceId/photos — 201, the photo (and the id it replaced). */
export const uploadPhoto = asyncHandler(async (req: Request, res: Response) => {
  const photo = await uploadDevicePhoto(req.tenantId as TenantId, validated(req, devicePhotoUpload), req.file, auditPrincipal(req));
  success(res, photo, photo.replacedAttachmentId ? "Device photo replaced" : "Device photo uploaded", 201);
});

/** DELETE /calibration-devices/:calibrationDeviceId/photos/:attachmentId — 200, the deleted id. */
export const deletePhoto = asyncHandler(async (req: Request, res: Response) => {
  const result = await deleteDevicePhoto(req.tenantId as TenantId, validated(req, devicePhotoParams), auditPrincipal(req));
  success(res, result, "Device photo deleted");
});
