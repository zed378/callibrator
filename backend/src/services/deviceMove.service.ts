/**
 * P21-09d — moving a device between two client facilities of one tenant (spec
 * MEMORY/specs/P19-04-client-facilities.md § 11; ADR-124 Am. 2 § 2; G-F2).
 *
 * Children follow the device (§ 11.1): the device's whole history moves with it, because the
 * evidence belongs to the instrument. History is not rewritten — only the access attribute moves,
 * and the move itself is recorded:
 *
 *  1. the actor is UNBOUND (re-checked here; the route is unmarked and `rbac([TENANT_ADMIN])`);
 *  2. the device (locked) and the target facility are loaded in the caller's context (404);
 *  3. the 409s of § 11.2, each a state explanation: same facility, a target not active, a retired
 *     device, a certificate not yet signed or revoked, the serial already used in the target, a
 *     location of another facility;
 *  4. one transaction: the `client_facility_moves` row (`in_progress`), the transaction-local
 *     `callibrator.facility_move` naming it, the device's facility (and room) updated with the
 *     typed `facilityMove` option — the database CASCADES the facility to every child along one
 *     path and 0117's guards admit exactly that change (proved by `deviceMove.p2007.live`); the
 *     files of the device and its children follow, flagged `rekey_pending`; the counts; the move
 *     `completed`; two audit rows — MOVE_DEVICE_OUT in the old facility, MOVE_DEVICE_IN in the
 *     new (§ 16, OQ-12);
 *  5. after commit: the re-key job (§ 9.4) and `device:moved_out` / `device:moved_in` to each
 *     facility's room, the device id only (§ 9.1).
 *
 * Not checked yet: an open IPM draft of the device (§ 11.2) — IPM sessions do not exist before
 * P20-04 / P21-03, which add that 409 here (ADR-124 Am. 6 § 2).
 *
 * Named exports only.
 */
import { Op, type Transaction } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import { enqueueRekey } from "./attachmentRekey.service";
import { emitForRow } from "./realtime";
import { AppError } from "../utils/appError.util";
import { sql, type SqlRunner } from "../utils/sql.util";
import { auditEntryActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import { tenantStorage } from "../middlewares/tenantContext.middleware";
import type { DeviceMoveCountKey, DeviceMoveInput } from "@callibrator/contracts/clientFacilities";
import type { ClientFacilityId, TenantId, UserId } from "../types/ids";

/** The transaction-local setting 0117's guards read (= migrations/facilityMigration.shared#MOVE_SETTING). */
export const FACILITY_MOVE_SETTING = "callibrator.facility_move";

/** A certificate that is final for its customer: signed, or revoked (voided). */
const FINAL_CERTIFICATE_STATES: readonly string[] = ["signed", "revoked"];

const dbRunner = db as unknown as SqlRunner;

/** The answer: the move as recorded. */
export interface DeviceMoveResult {
  readonly moveId: string;
  readonly calibrationDeviceId: string;
  readonly fromClientFacilityId: string;
  readonly toClientFacilityId: string;
  readonly locationId: string | null;
  readonly counts: Readonly<Record<DeviceMoveCountKey, number>>;
}

/** One move of a device's history, for provider staff. */
export interface DeviceMoveRow {
  readonly id: string;
  readonly from: { readonly id: string; readonly name: string };
  readonly to: { readonly id: string; readonly name: string };
  readonly reason: string;
  readonly movedBy: string;
  readonly counts: Record<string, number>;
  readonly createdAt: Date;
  readonly completedAt: Date;
}

/** Refuse a bound actor: a move is provider administration (AM-14). */
const assertUnbound = (): void => {
  if (tenantStorage.getStore()?.facilityBound === true) {
    throw new AppError(403, "Only an administrator who is not bound to a facility can move a device.");
  }
};

/** The location the device keeps, takes or loses with the move (P19-03 § 9). */
const resolveLocation = async (
  tenantId: TenantId,
  current: string | null,
  from: string,
  to: string,
  requested: string | null | undefined,
  transaction: Transaction,
): Promise<string | null> => {
  if (requested) {
    const location = await models.Warehouse.findOne({ where: { id: requested, tenantId }, attributes: ["id", "name", "clientFacilityId"], transaction });
    if (!location) {
      throw new AppError(404, "Location not found");
    }
    if (location.clientFacilityId && location.clientFacilityId !== to) {
      throw new AppError(409, `The location ${location.name} belongs to another facility; choose a room of the target facility or a provider store.`);
    }
    return location.id;
  }
  if (requested === null || !current) {
    return null;
  }
  const location = await models.Warehouse.findOne({ where: { id: current, tenantId }, attributes: ["id", "clientFacilityId"], transaction });
  // A room of the facility the device leaves is cleared; a provider store is kept.
  return location?.clientFacilityId === from ? null : current;
};

/** Each child table's rows of the device, after the cascade (they are the device's whole history). */
const countChildren = async (tenantId: TenantId, deviceId: string, transaction: Transaction): Promise<Omit<Record<DeviceMoveCountKey, number>, "attachments_rekey">> => {
  const where = { tenantId, deviceId };
  return {
    calibration_records: await models.CalibrationRecord.unscoped().count({ where, paranoid: false, transaction }),
    certificates: await models.Certificate.unscoped().count({ where, paranoid: false, transaction }),
    maintenance_work_orders: await models.MaintenanceWorkOrder.unscoped().count({ where, paranoid: false, transaction }),
    iot_readings: await models.IotReading.count({ where, transaction }),
    non_conformances: await models.NonConformance.count({ where, transaction }),
  };
};

/** The ids of the device's children a file can be linked to (records, certificates, work orders). */
const linkedChildIds = async (tenantId: TenantId, deviceId: string, transaction: Transaction): Promise<string[]> => {
  const where = { tenantId, deviceId };
  const options = { where, attributes: ["id"], paranoid: false, transaction };
  const rows = [
    ...(await models.CalibrationRecord.unscoped().findAll(options)),
    ...(await models.Certificate.unscoped().findAll(options)),
    ...(await models.MaintenanceWorkOrder.unscoped().findAll(options)),
  ] as unknown as { id: string }[];
  return rows.map((r) => r.id);
};

/**
 * Move a device, and its whole history, to another client facility of the tenant (§ 11.2).
 *
 * @param tenantId - the actor's tenant
 * @param input - the validated params and body
 * @param actor - the administrator
 * @returns the move as recorded
 */
export const moveDevice = async (tenantId: TenantId, input: DeviceMoveInput, actor: AuditActorInput): Promise<DeviceMoveResult> => {
  assertUnbound();
  const result = await db.transaction(async (transaction) => {
    const device = await models.CalibrationDevice.findOne({
      where: { id: input.calibrationDeviceId, tenantId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!device) {
      throw new AppError(404, "Calibration device not found");
    }
    const target = await models.ClientFacility.findOne({
      where: { id: input.targetClientFacilityId, tenantId },
      attributes: ["id", "name", "status"],
      transaction,
    });
    if (!target) {
      throw new AppError(404, "Client facility not found");
    }
    const from = device.clientFacilityId as string;
    const to = target.id as string;
    if (from === to) {
      throw new AppError(409, "The device is already in this facility.");
    }
    if (target.status !== "active") {
      throw new AppError(409, `A device cannot be moved into a facility that is ${target.status}.`);
    }
    if (device.status === "retired") {
      throw new AppError(409, "A retired device stays in the facility that retired it; reinstate it first.");
    }
    const pending = await models.Certificate.findOne({
      where: { tenantId, deviceId: device.id, status: { [Op.notIn]: FINAL_CERTIFICATE_STATES } },
      attributes: ["id", "certificateNumber", "status"],
      order: [["createdAt", "ASC"], ["id", "ASC"]],
      transaction,
    });
    if (pending) {
      throw new AppError(
        409,
        `Certificate ${pending.certificateNumber} is ${String(pending.status)}; issue or void it first — its customer is the facility the calibration was done for.`,
      );
    }
    if (device.serialNumber) {
      const twin = await models.CalibrationDevice.unscoped().findOne({
        where: { tenantId, clientFacilityId: to, serialNumber: device.serialNumber, id: { [Op.ne]: device.id } },
        attributes: ["id"],
        paranoid: false,
        transaction,
      });
      if (twin) {
        throw new AppError(409, `A device with this serial number already exists in ${target.name}.`);
      }
    }
    const locationBefore = device.locationId ?? null;
    const locationAfter = await resolveLocation(tenantId, locationBefore, from, to, input.targetLocationId, transaction);

    const move = await models.ClientFacilityMove.create(
      {
        tenantId,
        deviceId: device.id,
        fromClientFacilityId: from as ClientFacilityId,
        toClientFacilityId: to as ClientFacilityId,
        reason: input.reason,
        movedBy: actor.userId as UserId,
      },
      { transaction },
    );
    await sql(dbRunner, "SELECT set_config($1, $2, true)", [FACILITY_MOVE_SETTING, move.id], { transaction });
    await device.update(
      { clientFacilityId: to as ClientFacilityId, locationId: locationAfter },
      { transaction, facilityMove: move.id },
    );

    const childIds = await linkedChildIds(tenantId, device.id, transaction);
    const [attachmentsRekey] = await models.Attachment.update(
      { clientFacilityId: to as ClientFacilityId, rekeyPending: true },
      {
        where: { tenantId, clientFacilityId: from, resourceId: { [Op.in]: [device.id, ...childIds] } },
        transaction,
        facilityMove: move.id,
      },
    );
    const counts: Record<DeviceMoveCountKey, number> = {
      ...(await countChildren(tenantId, device.id, transaction)),
      attachments_rekey: attachmentsRekey,
    };
    await move.update({ status: "completed", completedAt: new Date(), counts }, { transaction });

    for (const [clientFacilityId, operation] of [[from, "MOVE_DEVICE_OUT"], [to, "MOVE_DEVICE_IN"]] as const) {
      await auditService.logAction(
        {
          tenantId,
          ...auditEntryActor(actor),
          action: "UPDATE",
          resourceType: "CalibrationDevice",
          resourceId: device.id,
          clientFacilityId,
          changes: { operation, moveId: move.id, from, to, reason: input.reason, locationBefore, locationAfter, counts },
        },
        { transaction },
      );
    }
    return {
      moveId: move.id,
      calibrationDeviceId: device.id,
      fromClientFacilityId: from,
      toClientFacilityId: to,
      locationId: locationAfter,
      counts,
    };
  });
  if (result.counts.attachments_rekey > 0) {
    enqueueRekey(tenantId);
  }
  emitForRow({ tenantId, clientFacilityId: result.fromClientFacilityId }, "device:moved_out", { id: result.calibrationDeviceId });
  emitForRow({ tenantId, clientFacilityId: result.toClientFacilityId }, "device:moved_in", { id: result.calibrationDeviceId });
  return result;
};

/**
 * A device's moves, newest first, for provider staff (`GET …/moves`; unmarked: a move names
 * another client). A missing, deleted or other tenant's device is the same 404.
 *
 * @param tenantId - the caller's tenant
 * @param calibrationDeviceId - the device
 * @returns the completed moves with the facilities' names
 */
export const listDeviceMoves = async (tenantId: TenantId, calibrationDeviceId: string): Promise<DeviceMoveRow[]> => {
  const device = await models.CalibrationDevice.findOne({ where: { id: calibrationDeviceId, tenantId }, attributes: ["id"] });
  if (!device) {
    throw new AppError(404, "Calibration device not found");
  }
  const moves = await models.ClientFacilityMove.findAll({
    where: { tenantId, deviceId: device.id, status: "completed" },
    order: [["createdAt", "DESC"], ["id", "DESC"]],
  });
  const ids = [...new Set(moves.flatMap((m) => [m.fromClientFacilityId as string, m.toClientFacilityId as string]))];
  const facilities = ids.length
    ? await models.ClientFacility.findAll({ where: { tenantId, id: { [Op.in]: ids } }, attributes: ["id", "name"] })
    : [];
  const nameOf = new Map(facilities.map((f) => [f.id as string, f.name]));
  // A completed move carries its counts and its completion time (0117's trigger holds both), and
  // both facilities exist (the composite keys RESTRICT their delete).
  return moves.map((m) => ({
    id: m.id,
    from: { id: m.fromClientFacilityId, name: nameOf.get(m.fromClientFacilityId) as string },
    to: { id: m.toClientFacilityId, name: nameOf.get(m.toClientFacilityId) as string },
    reason: m.reason,
    movedBy: m.movedBy,
    counts: m.counts as Record<string, number>,
    createdAt: m.createdAt,
    completedAt: m.completedAt as Date,
  }));
};
