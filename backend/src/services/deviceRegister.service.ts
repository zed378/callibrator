/**
 * P21-02a: the device register's write rules (ADR-132 § 1, § 4 – § 7; spec
 * MEMORY/specs/P19-03-device-extensions.md § 4 – § 6, § 8.1), shared by the device create and
 * edit and by the quick calibration entry (P21-05, P19-05 § 7.3):
 *
 *  - the QR code: normalised with the tenant's prefix and digits (`normaliseQrCode`), unique per
 *    tenant over EVERY row (a deleted device keeps its sticker, as a serial does); the 409
 *    `DEVICE_QR_TAKEN` names the holder and its facility (only unbound principals set a QR, and
 *    they see every facility: OQ-2, FT-50 closed);
 *  - the location: an existing room or store loaded in context, or a room FOUND OR CREATED by
 *    name and floor in the device's facility (audited `CREATE_ROOM_FROM_DEVICE`); a room of
 *    another facility is a 400 (the trigger `calibration_devices_location_facility` is the backstop);
 *  - the calibration laboratory: a vendor loaded in context (another tenant's is a 404);
 *  - the registrant's snapshot, taken at create; the inventory date, never after today.
 *
 * Every refusal is THROWN (an AppError, or a CodedError with its top-level `code`); every read runs
 * in the caller's context (the tenant and facility hooks). Named exports only.
 */
import { randomUUID } from "node:crypto";
import { Op, UniqueConstraintError, type Transaction } from "sequelize";
import models from "../models";
import auditService from "./audit.service";
import { auditEntryActor, actorChanges, type AuditActorInput } from "../utils/auditPrincipal.util";
import { AppError } from "../utils/appError.util";
import { CodedError } from "../utils/codedError.util";
import { displayPeople } from "./personDisplay.service";
import { deviceSettingsOf } from "./deviceSettings.service";
import { DEVICE_CONFLICT_CODES, normaliseQrCode, zonedDayNumber } from "@callibrator/contracts/deviceValues";
import type { RoomInput } from "@callibrator/contracts/calibrationDevices";
import type { PersonSnapshot } from "../utils/jsonShape.util";
import type { PersonDisplay } from "@callibrator/contracts/people";
import type { TenantId } from "../types/ids";

/** The unique index on the QR (migration 0128). */
export const QR_UNIQUE_INDEX = "calibration_devices_tenant_qr_code_unique";

/**
 * The QR as stored: the tenant's normalisation of `raw`; `null` clears it; `undefined` = not sent.
 *
 * @param tenantId - the caller's tenant (its prefix and digits)
 * @param raw - the body's or the path's value
 * @returns the normalised value
 * @throws AppError 400 with `normaliseQrCode`'s message
 */
export const normaliseQrFor = async (tenantId: string, raw: string | null | undefined): Promise<string | null | undefined> => {
  if (raw === undefined || raw === null) {
    return raw;
  }
  if (raw.trim() === "") {
    return null;
  }
  const normalised = normaliseQrCode(raw, (await deviceSettingsOf(tenantId)).qr);
  if (!normalised.ok) {
    throw new AppError(400, normalised.message);
  }
  return normalised.value;
};

/**
 * The 409 for a QR another device of the tenant holds, naming it (spec § 4.3).
 *
 * @param tenantId - the caller's tenant
 * @param qrCode - the normalised QR
 * @param exceptId - the device being edited (its own QR is no conflict)
 * @returns the error to throw, or null when the QR is free
 */
export const qrConflict = async (tenantId: string, qrCode: string, exceptId: string | null = null): Promise<CodedError | null> => {
  const holder = await models.CalibrationDevice.unscoped().findOne({
    where: { tenantId, qrCode },
    attributes: ["id", "name", "clientFacilityId", "isDeleted", "deletedAt"],
    paranoid: false,
  });
  if (!holder || holder.id === exceptId) {
    return null;
  }
  if (holder.isDeleted || holder.deletedAt) {
    return new CodedError(409, DEVICE_CONFLICT_CODES.qrTaken, `QR code ${qrCode} is on a deleted device (${holder.name}); restore it, or use another sticker.`, {
      holderId: holder.id,
    });
  }
  const facility = await models.ClientFacility.findOne({ where: { id: holder.clientFacilityId }, attributes: ["id", "name"] });
  const where = facility ? ` in ${facility.name}` : "";
  return new CodedError(409, DEVICE_CONFLICT_CODES.qrTaken, `QR code ${qrCode} is already on device ${holder.name}${where}.`, { holderId: holder.id });
};

/**
 * Whether `error` is the QR unique index's violation: the backstop when a concurrent request took
 * the sticker between the check and the write.
 *
 * @param error - a thrown value
 * @returns true for the QR index
 */
export const isQrUniqueViolation = (error: unknown): boolean =>
  error instanceof UniqueConstraintError &&
  ((error.parent as { constraint?: string } | undefined)?.constraint === QR_UNIQUE_INDEX || Object.hasOwn(error.fields, "qr_code"));

/** `like` with its wildcards escaped: a room named `R_1` matches only itself. */
const literalLike = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);
/** One line: inner whitespace collapsed, trimmed. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Where `resolveLocation` leaves the device. */
export interface ResolvedLocation {
  /** `undefined`: the body named no location (unchanged). */
  readonly locationId: string | null | undefined;
  /** The room created on the fly, if one was. */
  readonly createdRoomId: string | null;
}

/** The location fields of a device or quick-entry body. */
export interface LocationInput {
  readonly locationId?: string | null | undefined;
  readonly room?: RoomInput | undefined;
}

/**
 * The device's location after this write (spec § 6.2, § 6.3).
 *
 * @param tenantId - the caller's tenant
 * @param clientFacilityId - the device's facility (a room must be of it)
 * @param input - `locationId` (existing; "" or null clears) or `room` (found or created)
 * @param actor - for the room's audit row
 * @param transaction - the device write's transaction
 * @param deviceId - the device, for the room's audit row (null on create)
 * @returns the location id to store
 * @throws AppError 404 (a location the context cannot read) / 400 (a room of another facility)
 */
export const resolveLocation = async (
  tenantId: TenantId,
  clientFacilityId: string | null | undefined,
  input: LocationInput,
  actor: AuditActorInput,
  transaction: Transaction,
  deviceId: string | null,
): Promise<ResolvedLocation> => {
  if (input.room) {
    const name = oneLine(input.room.name);
    const floor = input.room.floor ? oneLine(input.room.floor) : "";
    const found = await models.Warehouse.findOne({
      where: {
        tenantId,
        kind: "room",
        clientFacilityId: clientFacilityId ?? null,
        name: { [Op.iLike]: literalLike(name) },
        floor: floor === "" ? null : { [Op.iLike]: literalLike(floor) },
      },
      attributes: ["id"],
      transaction,
    });
    if (found) {
      return { locationId: found.id, createdRoomId: null };
    }
    // The code is the row's own id, shortened: no per-tenant sequence to race on (the ETL numbers its own).
    const id = randomUUID();
    let room;
    try {
      room = await models.Warehouse.create(
        { id, tenantId, clientFacilityId: (clientFacilityId ?? null) as never, kind: "room", name, floor: floor === "" ? null : floor, code: `R-${id.slice(0, 8).toUpperCase()}`, status: "active" },
        { transaction },
      );
    } catch (error) {
      // warehouses_room_name_unique: a concurrent request created the same room first.
      if (error instanceof UniqueConstraintError) {
        throw new CodedError(409, "ROOM_CREATED_CONCURRENTLY", "This room was just created by another request; save again to use it.");
      }
      throw error;
    }
    await auditService.logAction(
      {
        tenantId,
        ...auditEntryActor(actor),
        action: "CREATE",
        resourceType: "Warehouse",
        resourceId: room.id,
        changes: { operation: "CREATE_ROOM_FROM_DEVICE", deviceId, clientFacilityId: clientFacilityId ?? null, ...actorChanges(actor) },
      },
      { transaction },
    );
    return { locationId: room.id, createdRoomId: room.id };
  }
  if (input.locationId === undefined) {
    return { locationId: undefined, createdRoomId: null };
  }
  if (input.locationId === null || input.locationId === "") {
    return { locationId: null, createdRoomId: null };
  }
  const location = await models.Warehouse.findOne({
    where: { id: input.locationId, tenantId },
    attributes: ["id", "kind", "clientFacilityId"],
    transaction,
  });
  if (!location) {
    throw new AppError(404, "Location not found");
  }
  if (location.kind === "room" && location.clientFacilityId !== clientFacilityId) {
    throw new AppError(400, "This room belongs to another facility.");
  }
  return { locationId: location.id, createdRoomId: null };
};

/**
 * The calibration laboratory, loaded in the caller's context (spec § 4.1): another tenant's
 * vendor is not found.
 *
 * @param vendorId - the body's vendor
 * @param transaction - the write's transaction
 * @returns the vendor's id and name
 * @throws AppError 404
 */
export const loadVendor = async (vendorId: string, transaction: Transaction | null = null): Promise<{ id: string; name: string }> => {
  const vendor = await models.Vendor.findOne({ where: { id: vendorId }, attributes: ["id", "name"], transaction });
  if (!vendor) {
    throw new AppError(404, "Vendor not found");
  }
  return { id: vendor.id, name: vendor.name };
};

/** A person's printed name when the display has none (a redacted or nameless author). */
export const UNNAMED_PERSON = "Unnamed user";

/**
 * A person as recorded at insert (the registrant, a calibration's performer): the caller's own
 * display (it is never redacted to itself).
 *
 * @param userId - the acting user (null for an API key: no person to record)
 * @returns the snapshot, or null
 */
export const personSnapshotOf = async (userId: string | null | undefined): Promise<PersonSnapshot | null> => {
  if (!userId) {
    return null;
  }
  // displayPeople answers every id it is given (an unknown one as "Platform support").
  const person = (await displayPeople([userId])).get(userId) as PersonDisplay;
  return { name: person.name ?? UNNAMED_PERSON, role: person.role, organisation: person.organisation };
};

/**
 * An inventory date (or any register day) after today in the tenant's zone is refused (spec § 4.1).
 *
 * @param day - `YYYY-MM-DD`
 * @param timeZone - the tenant's zone
 * @param message - the 400's message
 * @throws AppError 400
 */
export const assertNotFuture = (day: string, timeZone: string, message: string): void => {
  if (day > zonedDayNumber(new Date(), timeZone).text) {
    throw new AppError(400, message);
  }
};
