/**
 * P21-02b (ADR-132 § 6, Am. 3; spec MEMORY/specs/P19-03-device-extensions.md § 7.2, § 11): a
 * device's register photos — `POST /calibration-devices/:id/photos` and
 * `DELETE /calibration-devices/:id/photos/:attachmentId`.
 *
 * Upload, in docs/UPSTREAM/08-FILE-POLICY.md § 2's order, nothing reachable before the end:
 *   1. the device, loaded IN CONTEXT (another tenant's or facility's: 404 — before the file is
 *      even read, so a foreign probe stores and scans nothing);
 *   2. the type by MAGIC BYTES: JPEG or PNG; HEIC/HEIF → 415 `PHOTO_HEIC_UNSUPPORTED` (converted on
 *      the client — the server has no HEVC decoder, Am. 3); anything else → 415;
 *   3. the structure and the size/pixel limits from the header (`imageInspect`, 08 § 3), location
 *      metadata removed LOSSLESSLY from the original (the import's rule, 08 § 11);
 *   4. ClamAV, fail-closed (`virusScan`, 08 § 5);
 *   5. a FULL decode — the polyglot guard — and the two metadata-free derivatives (08 § 4.1);
 *   6. the three objects put under the DEVICE's facility (`t/<tenant>/f/<facility>/attachments/`);
 *   7. one transaction, under a lock on the device row: a single-purpose photo's live predecessor
 *      soft-deleted (the replace, F-28; the partial unique index of 0129 is the backstop), the new
 *      row inserted with its purpose and the device's facility, the audit rows, the idempotency
 *      key completed. A failure removes the three objects.
 * A replaced or deleted photo's bytes stay until the deleted-file sweep's retention passes
 * (ADR-083), which removes the derivatives with the original.
 *
 * Named exports only.
 */
import crypto from "crypto";
import fs from "fs";
import type { CreationAttributes, Transaction } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import virusScan from "./virusScan.service";
import storage from "./storage";
import { completeIdempotentRequest } from "./idempotency.service";
import { AppError } from "../utils/appError.util";
import { CodedError } from "../utils/codedError.util";
import { actorChanges, auditEntryActor, rowActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import { detectImageType, extensionOf, inspectJpeg, inspectPng, mimeOf } from "./upstreamFileImport/imageInspect";
import { MIN_FILE_BYTES } from "../constants/upstreamFileImport";
import { UndecodableImageError, buildDerivatives } from "./devicePhoto/imageDerivatives";
import { derivativeKeyOf } from "./devicePhoto/derivativeKeys";
import { DEVICE_PHOTO_CODES, DEVICE_PHOTO_PURPOSES, SINGLE_DEVICE_PHOTO_PURPOSES } from "@callibrator/contracts/deviceValues";
import type { DevicePhotoParams, DevicePhotoUpload } from "@callibrator/contracts/calibrationDevices";
import type { TenantId } from "../types/ids";
import type { ModelInstance } from "../types/models";

type AttachmentRow = ModelInstance<"Attachment">;
type DeviceRow = ModelInstance<"CalibrationDevice">;

/** The resource type a device photo row carries (the generic route's key for a device). */
export const DEVICE_PHOTO_RESOURCE_TYPE = "device";
/** The attachment rows' legacy folder column (a keyed row is never read from it). */
const ATTACH_FOLDER = "uploads/attachments";
const DEVICE_NOT_FOUND = "Calibration device not found";
const PHOTO_NOT_FOUND = "Photo not found";
const SINGLE_PURPOSES: readonly string[] = SINGLE_DEVICE_PHOTO_PURPOSES;
const PHOTO_PURPOSES: string[] = [...DEVICE_PHOTO_PURPOSES];

/** The uploaded file as multer leaves it in the quarantine. */
export interface HeldUpload {
  readonly path: string;
}

/** A device photo as the routes answer it — ids and facts, never a storage key or a file name. */
export interface DevicePhotoView {
  readonly id: string;
  readonly calibrationDeviceId: string;
  readonly purpose: string;
  readonly mimeType: string;
  readonly size: number;
  readonly checksum: string;
  readonly width: number;
  readonly height: number;
  readonly variants: readonly string[];
  readonly replacedAttachmentId: string | null;
  readonly createdAt: Date;
}

const sha256 = (bytes: Buffer): string => crypto.createHash("sha256").update(bytes).digest("hex");

/** The device in context, locked for the transaction; another tenant's or facility's is a 404. */
const lockDevice = async (deviceId: string, transaction: Transaction): Promise<DeviceRow> => {
  const device = await models.CalibrationDevice.findOne({ where: { id: deviceId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!device) {
    throw new AppError(404, DEVICE_NOT_FOUND);
  }
  return device;
};

/** What the file is, checked by content: the stripped original, its type and dimensions. */
interface CheckedImage {
  readonly type: "jpeg" | "png";
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
}

/** Steps 2 and 3: the type by magic bytes, the structure, the limits, the location metadata removed. */
const checkImage = (raw: Buffer): CheckedImage => {
  const type = detectImageType(raw);
  if (type === "heic") {
    throw new CodedError(
      415,
      DEVICE_PHOTO_CODES.heicUnsupported,
      "HEIC photos are not accepted. Take the photo with the app's camera, or save it as JPEG and upload that.",
    );
  }
  if (type === null) {
    throw new CodedError(415, DEVICE_PHOTO_CODES.typeUnsupported, "A device photo must be a JPEG or PNG image.");
  }
  if (raw.length < MIN_FILE_BYTES) {
    throw new CodedError(422, DEVICE_PHOTO_CODES.undecodable, "This file is too small to be a photo.");
  }
  const inspected = type === "jpeg" ? inspectJpeg(raw) : inspectPng(raw);
  if (!inspected.ok) {
    if (inspected.reason === "image_too_large") {
      throw new CodedError(422, DEVICE_PHOTO_CODES.imageTooLarge, "The photo is too large: at most 50 megapixels and 12,000 pixels a side.");
    }
    throw new CodedError(422, DEVICE_PHOTO_CODES.undecodable, "The photo could not be read as an image.");
  }
  return { type, bytes: inspected.bytes, width: inspected.width, height: inspected.height };
};

const removeObjects = async (scoped: Awaited<ReturnType<typeof storage.getTenantStorage>>, keys: readonly string[]): Promise<void> => {
  // Settled, not awaited one by one: a key that cannot be removed does not keep the others.
  await Promise.allSettled(keys.map((key) => scoped.delete(key)));
};

/** The three objects of one photo, put; removed again if any put fails. */
const putObjects = async (
  scoped: Awaited<ReturnType<typeof storage.getTenantStorage>>,
  objects: readonly { key: string; bytes: Buffer; contentType: string }[],
): Promise<void> => {
  try {
    for (const object of objects) {
      await scoped.put(object.key, object.bytes, { contentType: object.contentType });
    }
  } catch (err) {
    await removeObjects(scoped, objects.map((o) => o.key));
    throw err;
  }
};

/**
 * Upload (or replace) a device photo.
 *
 * @param tenantId - the request's tenant
 * @param input - the validated path and fields
 * @param file - the quarantined upload, or undefined when the request carried none
 * @param actor - the request's principal (auditPrincipal)
 * @returns the new photo, and the id of the one it replaced
 */
export const uploadDevicePhoto = async (
  tenantId: TenantId,
  input: DevicePhotoUpload,
  file: HeldUpload | undefined,
  actor: AuditActorInput,
): Promise<DevicePhotoView> => {
  if (!file) {
    throw new CodedError(400, DEVICE_PHOTO_CODES.fileRequired, "Attach the photo as the multipart field 'file'.");
  }
  // Step 1: in context, before the bytes are read (FT-107; a foreign probe leaves nothing).
  const found = await models.CalibrationDevice.findOne({ where: { id: input.calibrationDeviceId }, attributes: ["id", "clientFacilityId"] });
  if (!found) {
    throw new AppError(404, DEVICE_NOT_FOUND);
  }
  const image = checkImage(await fs.promises.readFile(file.path));
  const scan = await virusScan.scanFile(file.path);
  if (!scan.clean) {
    throw new CodedError(422, DEVICE_PHOTO_CODES.rejectedByScan, "The photo was refused by the virus scan.");
  }
  let derivatives: ReturnType<typeof buildDerivatives>;
  try {
    derivatives = buildDerivatives(image.type, image.bytes);
  } catch (err) {
    if (err instanceof UndecodableImageError) {
      throw new CodedError(422, DEVICE_PHOTO_CODES.undecodable, "The photo could not be read as an image.");
    }
    throw err;
  }

  const id = crypto.randomUUID();
  const ext = extensionOf(image.type);
  const mimeType = mimeOf(image.type);
  const checksum = sha256(image.bytes);
  const scoped = await storage.getTenantStorage(tenantId);
  const key = scoped.buildKey({ domain: "attachments", name: `${id}.${ext}`, clientFacilityId: found.clientFacilityId });
  const objects = [
    { key, bytes: image.bytes, contentType: mimeType },
    { key: derivativeKeyOf(key, "display"), bytes: derivatives.display, contentType: "image/jpeg" },
    { key: derivativeKeyOf(key, "thumb"), bytes: derivatives.thumb, contentType: "image/jpeg" },
  ];
  await putObjects(scoped, objects);

  try {
    return await db.transaction(async (transaction) => {
      const device = await lockDevice(input.calibrationDeviceId, transaction);
      const facility = device.clientFacilityId;
      let replaced: AttachmentRow | null = null;
      if (SINGLE_PURPOSES.includes(input.purpose)) {
        replaced = await models.Attachment.findOne({
          where: { resourceId: device.id, purpose: input.purpose },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
      }
      if (replaced) {
        replaced.isDeleted = true;
        await replaced.save({ hooks: false, transaction });
        await auditService.logAction(
          {
            tenantId,
            ...auditEntryActor(actor),
            action: "DELETE",
            resourceType: "Attachment",
            resourceId: replaced.id,
            clientFacilityId: facility,
            changes: {
              operation: "REPLACE_DEVICE_PHOTO",
              before: { isDeleted: false },
              after: { isDeleted: true },
              purpose: input.purpose,
              replacedBy: id,
              checksum: replaced.checksum,
              ...actorChanges(actor),
            },
          },
          { transaction },
        );
      }
      const who = rowActor(actor);
      const created = await models.Attachment.create(
        {
          id,
          tenantId,
          resourceType: DEVICE_PHOTO_RESOURCE_TYPE,
          resourceId: device.id,
          fileName: `${id}.${ext}`,
          // Never the client's file name (08 § 7; 07 R-14): the purpose names the photo.
          originalName: `${input.purpose}.${ext}`,
          folder: ATTACH_FOLDER,
          storageKey: key,
          mimeType,
          size: image.bytes.length,
          checksum,
          uploadedBy: who.userId,
          purpose: input.purpose,
          // Stamped FROM THE DEVICE (FT-25; the AM-7 trigger checks it at commit).
          clientFacilityId: facility,
        } as unknown as CreationAttributes<AttachmentRow>,
        { transaction },
      );
      await auditService.logAction(
        {
          tenantId,
          ...auditEntryActor(actor),
          action: "CREATE",
          resourceType: "Attachment",
          resourceId: created.id,
          clientFacilityId: facility,
          changes: {
            operation: "UPLOAD_DEVICE_PHOTO",
            purpose: input.purpose,
            size: image.bytes.length,
            checksum,
            resource: { type: DEVICE_PHOTO_RESOURCE_TYPE, id: device.id },
            ...actorChanges(actor),
          },
        },
        { transaction },
      );
      if (replaced) {
        await auditService.logAction(
          {
            tenantId,
            ...auditEntryActor(actor),
            action: "UPDATE",
            resourceType: "CalibrationDevice",
            resourceId: device.id,
            clientFacilityId: facility,
            changes: { operation: "REPLACE_DEVICE_PHOTO", purpose: input.purpose, from: replaced.id, to: created.id, ...actorChanges(actor) },
          },
          { transaction },
        );
      }
      await completeIdempotentRequest(transaction, 201, "Attachment", created.id);
      return {
        id: created.id,
        calibrationDeviceId: device.id,
        purpose: input.purpose,
        mimeType,
        size: image.bytes.length,
        checksum,
        width: image.width,
        height: image.height,
        variants: ["original", "display", "thumb"],
        replacedAttachmentId: replaced?.id ?? null,
        createdAt: created.createdAt,
      };
    });
  } catch (err) {
    await removeObjects(scoped, objects.map((o) => o.key));
    throw err;
  }
};

/** A device photo's view, re-read by id in context (the idempotent replay's reader). */
export const readDevicePhoto = async (attachmentId: string): Promise<Record<string, unknown>> => {
  const row = await models.Attachment.findOne({ where: { id: attachmentId, purpose: PHOTO_PURPOSES } });
  if (!row) {
    throw new AppError(404, PHOTO_NOT_FOUND);
  }
  return {
    id: row.id,
    calibrationDeviceId: row.resourceId,
    purpose: row.purpose,
    mimeType: row.mimeType,
    size: Number(row.size),
    checksum: row.checksum,
    variants: ["original", "display", "thumb"],
    createdAt: row.createdAt,
  };
};

/**
 * Delete a device photo (a soft delete, audited; a register photo is not Part 11 evidence).
 *
 * @returns the deleted photo's id
 */
export const deleteDevicePhoto = async (tenantId: TenantId, params: DevicePhotoParams, actor: AuditActorInput): Promise<{ id: string }> =>
  db.transaction(async (transaction) => {
    // A device out of view and a photo out of view are the same 404, from the same place (PT-31:
    // the path names both).
    const device = await models.CalibrationDevice.findOne({ where: { id: params.calibrationDeviceId }, transaction, lock: transaction.LOCK.UPDATE });
    const photo = device
      ? await models.Attachment.findOne({
        where: { id: params.attachmentId, resourceId: device.id, purpose: PHOTO_PURPOSES },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      : null;
    if (!device || !photo) {
      throw new AppError(404, PHOTO_NOT_FOUND);
    }
    photo.isDeleted = true;
    await photo.save({ hooks: false, transaction });
    await auditService.logAction(
      {
        tenantId,
        ...auditEntryActor(actor),
        action: "DELETE",
        resourceType: "Attachment",
        resourceId: photo.id,
        clientFacilityId: device.clientFacilityId,
        changes: {
          operation: "DELETE_DEVICE_PHOTO",
          before: { isDeleted: false },
          after: { isDeleted: true },
          purpose: photo.purpose,
          checksum: photo.checksum,
          resource: { type: DEVICE_PHOTO_RESOURCE_TYPE, id: device.id },
          ...actorChanges(actor),
        },
      },
      { transaction },
    );
    return { id: photo.id };
  });
