/**
 * P21-05: calibration dates (ADR-133 § 1, § 2, § 4; spec MEMORY/specs/P19-05-calibration-dates.md
 * § 5 – § 7, § 10).
 *
 *  - `rederiveNextCalibrationDate`: the device's next due date from its latest EFFECTIVE record
 *    (not voided, not superseded; by calibration date, then creation, then id), inside the
 *    record's transaction under a lock on the device row, after the record write. Called by the
 *    full record's create, correction and void (G-11: the date used to follow the last record
 *    WRITTEN and never moved on a correction or a void), by the quick entry, and by an interval
 *    change of a derived date. Written with its source `record` explicitly (ADR-133 Am. 1); audited
 *    `DERIVE_NEXT_CALIBRATION_DATE` only when it changes. A new effective record dated on or after
 *    an IPM's calibration request clears the request (`IPM_CALIBRATION_REQUEST_CLEARED`).
 *  - `recordExternalCalibration`: `POST /calibration-devices/:id/calibration-dates`, an outside
 *    laboratory's calibration by its date and key data: no file (G-C3), history kept (a same-day
 *    duplicate is a notice, not a 409), the performer's snapshot at insert, the room confirmed at
 *    entry (found or created, as on the device form), one transaction.
 *
 * The calibration date's meaning for imported devices (OA-7) is the owner's open question: this
 * module takes a record's `calibration_date` as the day the laboratory calibrated (the spec's
 * working rule, UD-8) and derives nothing for a device with no interval and no stated due date.
 *
 * Named exports only.
 */
import type { CreationAttributes, Transaction } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import { actorChanges, auditEntryActor, rowActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import { AppError } from "../utils/appError.util";
import { CodedError } from "../utils/codedError.util";
import { completeIdempotentRequest } from "./idempotency.service";
import { deviceSettingsOf } from "./deviceSettings.service";
import { assertNotFuture, loadVendor, personSnapshotOf, resolveLocation } from "./deviceRegister.service";
import {
  DEVICE_CONFLICT_CODES,
  INVENTORIED_ON_MIN,
  deriveNextCalibrationDate,
  zonedDayNumber,
  zonedDayStart,
} from "@callibrator/contracts/deviceValues";
import type { CalibrationDateEntry } from "@callibrator/contracts/calibrationRecords";
import type { TenantId } from "../types/ids";
import type { ModelInstance } from "../types/models";

type DeviceRow = ModelInstance<"CalibrationDevice">;
type RecordRow = ModelInstance<"CalibrationRecord">;

/** The idempotency store's resource name for a quick entry. */
export const CALIBRATION_RECORD_RESOURCE = "CalibrationRecord";
const DEVICE_NOT_FOUND = "Calibration device not found";

const sameInstant = (a: Date | null | undefined, b: Date | null | undefined): boolean =>
  (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

/** The device's latest EFFECTIVE record (the defaultScope hides a voided one). */
export const latestEffectiveRecord = (deviceId: string, transaction: Transaction): Promise<RecordRow | null> =>
  models.CalibrationRecord.findOne({
    where: { deviceId, supersededById: null },
    order: [
      ["calibrationDate", "DESC"],
      ["createdAt", "DESC"],
      ["id", "DESC"],
    ],
    transaction,
  });

/** The device row, in context, locked for the transaction (another tenant's or facility's: not found). */
export const lockDevice = (deviceId: string, transaction: Transaction): Promise<DeviceRow | null> =>
  models.CalibrationDevice.findOne({ where: { id: deviceId }, transaction, lock: transaction.LOCK.UPDATE });

/** Why a re-derivation runs, and the record that drove it. */
export interface RederiveCause {
  readonly recordId: string | null;
  /** A NEW effective record was written (create, correction, quick entry): it may clear an IPM request. */
  readonly newRecord: boolean;
}

/**
 * The next due date, re-derived (spec § 5); the IPM request cleared by a new record (§ 6).
 *
 * @param tenantId - the caller's tenant
 * @param deviceId - the device
 * @param cause - the record and whether it is new
 * @param actor - the audit actor
 * @param transaction - the record's transaction
 * @returns the device after the write, or null when it is not in context
 */
export const rederiveNextCalibrationDate = async (
  tenantId: string,
  deviceId: string,
  cause: RederiveCause,
  actor: AuditActorInput,
  transaction: Transaction,
): Promise<DeviceRow | null> => {
  const device = await lockDevice(deviceId, transaction);
  if (!device) {
    return null;
  }
  const latest = await latestEffectiveRecord(deviceId, transaction);
  const current = { date: device.nextCalibrationDate ?? null, source: device.nextCalibrationDateSource ?? null };
  const next = deriveNextCalibrationDate({
    current,
    intervalDays: device.calibrationIntervalDays ?? null,
    latest: latest ? { calibrationDate: new Date(latest.calibrationDate), dueDate: latest.dueDate ? new Date(latest.dueDate) : null } : null,
  });
  const audit = (operation: string, changes: Record<string, unknown>): Promise<unknown> =>
    auditService.logAction(
      {
        tenantId,
        ...auditEntryActor(actor),
        action: "UPDATE",
        resourceType: "CalibrationDevice",
        resourceId: device.id,
        changes: { operation, ...changes, ...actorChanges(actor) },
      },
      { transaction },
    );
  if (!sameInstant(next.date, current.date) || next.source !== current.source) {
    await device.update({ nextCalibrationDate: next.date, nextCalibrationDateSource: next.source }, { transaction });
    await audit("DERIVE_NEXT_CALIBRATION_DATE", {
      before: { nextCalibrationDate: current.date, nextCalibrationDateSource: current.source },
      after: { nextCalibrationDate: next.date, nextCalibrationDateSource: next.source },
      recordId: cause.recordId,
    });
  }
  const requestedAt = device.calibrationRequestedAt;
  if (cause.newRecord && requestedAt && latest) {
    const { timeZone } = await deviceSettingsOf(tenantId, { transaction });
    if (zonedDayNumber(new Date(latest.calibrationDate), timeZone).n >= zonedDayNumber(new Date(requestedAt), timeZone).n) {
      const sessionId = device.calibrationRequestedBySessionId;
      await device.update({ calibrationRequestedAt: null, calibrationRequestedBySessionId: null }, { transaction });
      await audit("IPM_CALIBRATION_REQUEST_CLEARED", { sessionId, recordId: latest.id });
    }
  }
  return device;
};

/** The quick entry's answer (P19-05 § 7.3). */
export interface ExternalCalibrationResult {
  readonly record: Record<string, unknown>;
  readonly device: { readonly id: string; readonly nextCalibrationDate: Date | null; readonly nextCalibrationDateSource: string | null; readonly calibrationRequestedAt: Date | null };
  readonly notices: readonly string[];
}

/** The 400 for a day outside the register's range (spec § 7.3). */
const assertCalibrationDays = (input: CalibrationDateEntry, timeZone: string): void => {
  if (input.calibrationDate < INVENTORIED_ON_MIN) {
    throw new AppError(400, `A calibration date is on or after ${INVENTORIED_ON_MIN}.`);
  }
  assertNotFuture(input.calibrationDate, timeZone, "A calibration date cannot be in the future.");
};

/** 00:00 of a `YYYY-MM-DD` day in the tenant's zone (the column is a timestamptz, spec § 7.3). */
const dayStart = (day: string, timeZone: string): Date => zonedDayStart(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000, timeZone);

/** The device's room after the entry, and whether the entry changed it. */
const confirmRoom = async (
  tenantId: TenantId,
  device: DeviceRow,
  input: CalibrationDateEntry,
  actor: AuditActorInput,
  transaction: Transaction,
): Promise<{ name: string | null; floor: string | null }> => {
  const location = await resolveLocation(tenantId, device.clientFacilityId, input, actor, transaction, device.id);
  const before = device.locationId ?? null;
  if (location.locationId !== undefined && location.locationId !== before) {
    await device.update({ locationId: location.locationId }, { transaction });
    await auditService.logAction(
      {
        tenantId,
        ...auditEntryActor(actor),
        action: "UPDATE",
        resourceType: "CalibrationDevice",
        resourceId: device.id,
        changes: { operation: "CALIBRATION_ENTRY_ROOM", before: { locationId: before }, after: { locationId: location.locationId }, ...actorChanges(actor) },
      },
      { transaction },
    );
  }
  const roomId = device.locationId ?? null;
  const room = roomId ? await models.Warehouse.findOne({ where: { id: roomId }, attributes: ["id", "name", "floor"], transaction }) : null;
  return { name: room?.name ?? null, floor: room?.floor ?? null };
};

/**
 * `POST /calibration-devices/:calibrationDeviceId/calibration-dates` (spec § 7).
 *
 * @param tenantId - the caller's tenant (stamped, never read from the body)
 * @param input - the validated body (with the path's device id)
 * @param actor - the person or the API key (Q-51: a key records as `api_key_id`)
 * @returns the record, the device's derived date and the notices
 */
export const recordExternalCalibration = async (tenantId: TenantId, input: CalibrationDateEntry, actor: AuditActorInput): Promise<ExternalCalibrationResult> => {
  if (!actor.apiKeyId && input.calibrationVendorId === undefined && input.externalLabName === undefined) {
    throw new AppError(400, "Name the laboratory that calibrated the device.");
  }
  const settings = await deviceSettingsOf(tenantId);
  assertCalibrationDays(input, settings.timeZone);
  return db.transaction(async (transaction) => {
    const device = await lockDevice(input.calibrationDeviceId, transaction);
    if (!device) {
      throw new AppError(404, DEVICE_NOT_FOUND);
    }
    if (device.status === "retired") {
      throw new CodedError(
        409,
        DEVICE_CONFLICT_CODES.retired,
        "This device was retired; a calibration cannot be recorded. A tenant administrator can reinstate it.",
      );
    }
    const facility = await models.ClientFacility.findOne({ where: { id: device.clientFacilityId }, attributes: ["id", "name", "status"], transaction });
    if (facility?.status === "ended") {
      throw new CodedError(409, DEVICE_CONFLICT_CODES.calibrationFacilityEnded, `${facility.name} has ended; new records cannot be added.`);
    }
    const vendor = input.calibrationVendorId ? await loadVendor(input.calibrationVendorId, transaction) : null;
    const room = await confirmRoom(tenantId, device, input, actor, transaction);
    // The performer as recorded at insert (ADR-133 § 3), read once the device is known to be the caller's.
    const performerSnapshot = actor.apiKeyId ? null : await personSnapshotOf(actor.userId);
    const calibrationDate = dayStart(input.calibrationDate, settings.timeZone);
    const sameDay = await models.CalibrationRecord.findOne({
      where: { deviceId: device.id, supersededById: null, entryKind: "external_date", calibrationDate },
      attributes: ["id", "performedBy", "performerSnapshot"],
      transaction,
    });
    const notices = sameDay
      ? [`A calibration on this date is already recorded (by ${sameDay.performerSnapshot?.name ?? "another entry"}).`]
      : [];
    const who = rowActor(actor);
    const values: Record<string, unknown> = {
      tenantId,
      clientFacilityId: device.clientFacilityId,
      deviceId: device.id,
      calibrationDate,
      dueDate: input.dueDate ? dayStart(input.dueDate, settings.timeZone) : null,
      isCompliant: input.isCompliant ?? null,
      certificateNumber: input.certificateNumber ?? null,
      notes: input.notes ?? null,
      standard: null,
      results: null,
      entryKind: "external_date",
      calibrationVendorId: vendor?.id ?? null,
      externalLabName: input.externalLabName ?? vendor?.name ?? null,
      roomSnapshot: room.name,
      floorSnapshot: room.floor,
      performerSnapshot,
      performedBy: who.userId,
      apiKeyId: who.apiKeyId,
    };
    const record = await models.CalibrationRecord.create(values as CreationAttributes<RecordRow>, { transaction });
    await auditService.logAction(
      {
        tenantId,
        ...auditEntryActor(actor),
        action: "CREATE",
        resourceType: "CalibrationRecord",
        resourceId: record.id,
        changes: {
          operation: "RECORD_EXTERNAL_CALIBRATION",
          deviceId: device.id,
          calibrationDate: input.calibrationDate,
          entryKind: "external_date",
          calibrationVendorId: vendor?.id ?? null,
          externalLabNameLength: input.externalLabName?.length ?? null,
          certificateNumberPresent: input.certificateNumber !== undefined,
          dueDate: input.dueDate ?? null,
          ...actorChanges(actor),
        },
      },
      { transaction },
    );
    const after = (await rederiveNextCalibrationDate(tenantId, device.id, { recordId: record.id, newRecord: true }, actor, transaction)) as DeviceRow;
    await completeIdempotentRequest(transaction, 201, CALIBRATION_RECORD_RESOURCE, record.id);
    return {
      record: record.toJSON() as unknown as Record<string, unknown>,
      device: {
        id: after.id,
        nextCalibrationDate: after.nextCalibrationDate ?? null,
        nextCalibrationDateSource: after.nextCalibrationDateSource ?? null,
        calibrationRequestedAt: after.calibrationRequestedAt ?? null,
      },
      notices,
    };
  });
};

/**
 * The quick entry's record, re-read in the current context (an idempotent replay).
 *
 * @param id - the record
 * @returns the record
 * @throws AppError 404 when it is gone from view
 */
export const readCalibrationRecord = async (id: string): Promise<Record<string, unknown>> => {
  const record = await models.CalibrationRecord.findOne({ where: { id } });
  if (!record) {
    throw new AppError(404, "Calibration record not found");
  }
  return record.toJSON();
};

/**
 * A full record's performer as recorded at insert (ADR-133 § 3): the person's own display.
 *
 * @param userId - the performing user
 * @returns the snapshot, or null
 */
export const performerSnapshotFor = (userId: string): ReturnType<typeof personSnapshotOf> => personSnapshotOf(userId);
