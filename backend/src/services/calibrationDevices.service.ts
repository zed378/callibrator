/**
 * Calibration Device service methods
 *
 * P9-20 (ADR-087, Stage C): converted from calibrationDevices.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned (the
 * same keys, in the same order). No method calls a sibling. `Op`, the model,
 * `logger`, `DEFAULT_LIMIT`, `auditService`, the two audit helpers, the
 * reinstate module (`retirement`), `db`, `validateInput` and `checkInput` are
 * captured once at load, in the `.js`'s require order. The validator module,
 * `attachment.service` and `fs` are still required inside the methods, at call
 * time, as the `.js` did.
 */
import { Op as LoadedOp, type CreationAttributes, type Transaction as SqlTransaction, type WhereOptions } from "sequelize";
import models from "../models";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
// The `.js` destructured AppError and never used it: the module load is kept.
import "../utils/appError.util";
import { DEFAULT_LIMIT as LOADED_DEFAULT_LIMIT } from "../constants";
import loadedAuditService from "./audit.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
  type AuditActorInput,
} from "../utils/auditPrincipal.util";
import loadedRetirement from "./calibrationDeviceReinstate.service";
import { db as loadedDb } from "../config";
import { validateInput, checkInput as loadedCheckInput, type FieldError } from "../validators/input";
import type * as CalibrationDevicesValidator from "../validators/calibrationDevices.validator";
import type AttachmentService from "./attachment.service";
import type * as Fs from "fs";
import type { AuditAction } from "../constants/auditActions";
import type { ClientFacilityId, TenantId } from "../types/ids";
import type { ModelInstance } from "../types/models";
import { tenantStorage } from "../middlewares/tenantContext.middleware";

const Op = LoadedOp;
const { CalibrationDevice } = models;
const logger = loadedLogger;
const DEFAULT_LIMIT = LOADED_DEFAULT_LIMIT;
const auditService = loadedAuditService;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;
const retirement = loadedRetirement;
const db = loadedDb;

type DeviceRow = ModelInstance<"CalibrationDevice">;

/** A service answer the controller forwards. */
interface Outcome<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

/** A caught value's `message`, read exactly as the `.js` read it (a thrown `null` still throws here). */
const messageOf = (error: unknown): unknown => (error as { message?: unknown }).message;

/**
 * A-133 — a device register entry is the anchor of every calibration record
 * and certificate (ISO 17025 §6.4.13). Create, update, delete and bulk import
 * write their audit row inside the SAME transaction as the change (the A-41
 * rule, MEMORY/specs/A-41-audit-inside-transaction.md): a rollback takes the
 * row with it, and a failed audit insert (re-thrown by logAction) rolls the
 * change back. The impersonator, when there is one, is added by logAction
 * from the request context (F-8).
 *
 * @param transaction
 * @param tenantId
 * @param resourceId - null for a bulk import (many devices)
 * @param action
 * @param changes
 * @param actor - auditPrincipal(req)
 */
const auditDevice = (
  transaction: SqlTransaction,
  tenantId: TenantId,
  resourceId: string | null,
  action: AuditAction,
  changes: Record<string, unknown>,
  actor: AuditActorInput,
): Promise<unknown> =>
  auditService.logAction(
    {
      tenantId,
      // A-282 (ADR-100): a key is system:api-key, its id in changes.
      ...auditEntryActor(actor),
      action,
      resourceType: "CalibrationDevice",
      resourceId,
      changes: { ...changes, ...actorChanges(actor) },
    },
    { transaction },
  );

/** The values of `device` for the keys in `changes` — the audit row's `before`. */
const beforeOf = (device: DeviceRow, changes: object): Record<string, unknown> =>
  Object.fromEntries(Object.keys(changes).map((key) => [key, (device as unknown as Record<string, unknown>)[key] ?? null]));

// ==========================================
// VALIDATION HELPERS
// ==========================================

const validate = validateInput;
const checkInput = loadedCheckInput;

/** The validator module, required at call time as the `.js` did. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required inside each method (see the file header)
const deviceSchemas = (): typeof CalibrationDevicesValidator => require("../validators/calibrationDevices.validator") as typeof CalibrationDevicesValidator;

/** attachment.service, required at call time as the `.js` did (it is not loaded with this module). */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require (see the file header)
const attachmentService = (): typeof AttachmentService => require("./attachment.service") as typeof AttachmentService;

// ==========================================
// SERIAL-NUMBER CONFLICTS (A-92, ADR-049)
// ==========================================
//
// `calibration_devices` carries UNIQUE (tenant_id, serial_number) — migration
// 0026. The index covers SOFT-DELETED rows (a soft delete only sets
// `isDeleted`), so a serial held by a deleted device is still taken. The model's
// defaultScope hides those rows, so a duplicate check through it missed them and
// the insert failed on the index with a 500.
//
// Decided behaviour: a serial held by a deleted device is a 409 that says so.
// It is NOT silently restored: a create that resurrected the old row would hand
// back an old id with that device's calibration history attached, overwrite its
// fields without an audit trail of the restore, and turn a "register" into a
// "restore" the caller never asked for. Restoring is its own, audited act —
// POST /calibration-devices/:id/restore (A-133, ADR-075) — and the message names
// the device so an administrator can take it.
//
// The index is per tenant, so a violation is always in the caller's own tenant:
// answering it with a 409 discloses nothing about another tenant.

/**
 * The serial's unique index: per FACILITY since migration 0118 (UD-9, P20-07), which replaced
 * 0026's per-tenant one — the same rows for a tenant with one facility. Both names are claimed,
 * so a database not yet upgraded answers the same 409.
 */
const SERIAL_UNIQUE_INDEXES: readonly string[] = Object.freeze([
  "calibration_devices_tenant_facility_serial_unique",
  "calibration_devices_tenant_id_serial_number_unique",
]);

/**
 * An empty serial is "no serial". The validator allows "" (and trims "  " to
 * ""), and "" is not NULL — two serial-less devices stored as "" collided on the
 * unique index, where two NULLs never do.
 *
 * @param validated - validated input; `serialNumber` is normalised in place
 */
const normaliseSerial = (validated: { serialNumber?: string | null | undefined }): void => {
  if (validated.serialNumber === "") {
    validated.serialNumber = null;
  }
};

/** What findSerialHolder selects. */
interface SerialHolder {
  id: string;
  isDeleted?: boolean;
  deletedAt?: Date | null;
}

/**
 * The device in `tenantId` holding `serialNumber`, deleted or not.
 * `unscoped()` drops the defaultScope's `isDeleted = false`; `paranoid: false`
 * sees a row destroyed rather than soft-deleted. Both matter because the unique
 * index covers every row. The tenant predicate is explicit, and the global
 * tenant hooks still apply (they are hooks, not a scope).
 *
 * P21-09 (UD-9, hand-off 2 of P20-07): the index is per FACILITY since 0118
 * (`calibration_devices_tenant_facility_serial_unique`), so the pre-check is
 * too — the same serial in two client facilities is two instruments. When the
 * facility is not known (a database without the self facility the backstop
 * trigger would refuse anyway) the check stays per tenant, the stricter one.
 *
 * @param tenantId
 * @param clientFacilityId - the facility the device is (or will be) in
 * @param serialNumber
 */
const findSerialHolder = (
  tenantId: TenantId,
  clientFacilityId: string | null | undefined,
  serialNumber: string | null | undefined,
): Promise<DeviceRow | null> => {
  const where: Record<string, unknown> = { tenantId, serialNumber };
  if (clientFacilityId) {
    where["clientFacilityId"] = clientFacilityId;
  }
  return CalibrationDevice.unscoped().findOne({
    where: where as WhereOptions,
    attributes: ["id", "isDeleted", "deletedAt"],
    paranoid: false,
  });
};

/**
 * The 409 for a serial number already held in the tenant, explaining which
 * kind of device holds it and what the caller can do.
 *
 * @param serialNumber
 * @param holder - null when unknown (a lost race)
 */
const serialConflict = (
  serialNumber: string | null | undefined,
  holder: SerialHolder | null,
): { success: false; status: 409; message: string; data: null } => {
  let message;
  if (holder && (holder.isDeleted || holder.deletedAt)) {
    message =
      `Serial number "${String(serialNumber)}" is held by a deleted calibration device in this organisation. ` +
      "A serial number stays reserved after its device is deleted, so the deleted device's " +
      "calibration history stays attributable to it. Ask an administrator to restore that device" +
      // findSerialHolder selects the id: the administrator restores by it (A-133).
      ` (id ${holder.id})` +
      ", or register this device with a different serial number.";
  } else {
    message =
      `A calibration device with serial number "${String(serialNumber)}" already exists in this organisation. ` +
      "Serial numbers are unique per organisation — edit that device, or use a different serial number.";
  }
  return { success: false, status: 409, message, data: null };
};

/** A thrown value as a Sequelize unique-constraint error carries it. */
interface UniqueErrorLike {
  name?: string;
  parent?: { constraint?: string } | null;
  fields: object;
}

/**
 * Whether `error` is a violation of the per-tenant serial unique index — the
 * backstop when a concurrent request registered the same serial between the
 * check and the write. Any other unique violation (`iot_device_token` is
 * GLOBALLY unique) is not claimed here and propagates unchanged.
 *
 * @param error - a thrown value (read as the `.js` read it: a thrown `null` still throws)
 */
const isSerialUniqueViolation = (error: unknown): boolean => {
  const e = error as UniqueErrorLike;
  return (
    e.name === "SequelizeUniqueConstraintError" &&
    (SERIAL_UNIQUE_INDEXES.includes(e.parent?.constraint ?? "") ||
      // UniqueConstraintError always carries `fields` (`{}` when none were parsed)
      Object.hasOwn(e.fields, "serial_number"))
  );
};

// ==========================================
// SERVICE METHODS
// ==========================================

/** The list query as the controller passes it (validated; a JavaScript caller may pass anything). */
interface DeviceListQuery {
  tenantId: TenantId;
  find?: string | null | undefined;
  page?: number | string | undefined;
  limit?: number | string | undefined;
  status?: string | null | undefined;
  category?: string | null | undefined;
}

interface DeviceListData {
  rows: DeviceRow[];
  count: number;
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/**
 * Fetch all calibration devices for a tenant with pagination and filtering
 */
const fetchCalibrationDevices = async ({
  tenantId,
  find,
  page = 1,
  limit = DEFAULT_LIMIT,
  status,
  category,
}: DeviceListQuery): Promise<Outcome<DeviceListData>> => {
  try {
    const whereClause: Record<string | symbol, unknown> = { tenantId };

    if (find) {
      const searchTerm = `%${find.toLowerCase()}%`;
      whereClause[Op.or] = [
        { name: { [Op.iLike]: searchTerm } },
        { serialNumber: { [Op.iLike]: searchTerm } },
        { manufacturer: { [Op.iLike]: searchTerm } },
      ];
    }

    if (status) {
      whereClause["status"] = status.toLowerCase();
    }

    if (category) {
      whereClause["category"] = category;
    }

    const { rows, count } = await CalibrationDevice.findAndCountAll({
      where: whereClause as WhereOptions,
      order: [["name", "ASC"], ["id", "ASC"]],
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
      include: [
        {
          association: "warehouse",
          attributes: ["id", "name", "code"],
          // LEFT JOIN (A-90) — a device may have no warehouse. Warehouse has a
          // defaultScope `where`, so without this the list dropped every such
          // device, and every device whose warehouse was soft-deleted.
          required: false,
        },
      ],
    });

    return {
      success: true,
      status: 200,
      message: "Fetch calibration devices successful",
      data: {
        rows,
        count,
        meta: {
          total: count,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(count / Number(limit)),
        },
      },
    };
  } catch (error) {
    logger.error("Error fetching calibration devices", {
      error: messageOf(error),
    });
    throw error;
  }
};

/**
 * Fetch a specific calibration device by ID
 */
const fetchSpecificCalibrationDevice = async (
  tenantId: TenantId,
  calibrationDeviceId: string,
): Promise<Outcome<DeviceRow | null>> => {
  try {
    const device = await CalibrationDevice.findOne({
      where: { id: calibrationDeviceId, tenantId },
      include: [
        {
          association: "warehouse",
          attributes: ["id", "name", "code"],
          required: false, // LEFT JOIN — a device may have no warehouse
        },
        {
          association: "calibrationRecords",
          separate: true, // avoid a limit-in-join that can drop the parent row
          order: [["calibrationDate", "DESC"], ["id", "DESC"]],
          limit: 10,
          attributes: { exclude: ["results"] },
        },
      ],
    });

    if (!device) {
      return {
        success: false,
        status: 404,
        message: "Calibration device not found",
        data: null,
      };
    }

    return {
      success: true,
      status: 200,
      message: "Fetch calibration device successful",
      data: device,
    };
  } catch (error) {
    logger.error("Error fetching specific calibration device", {
      error: messageOf(error),
      calibrationDeviceId,
    });
    throw error;
  }
};

/** Where `resolveCreateFacility` sends a create: a facility, or an answer instead of the create. */
type CreateFacility = { ok: true; clientFacilityId: ClientFacilityId | undefined } | { ok: false; outcome: Outcome<null> };

/**
 * P21-09 — the client facility a new device is created in (G-F1; ADR-124 Am. 2 § 1, Am. 3 § 3;
 * hand-off 1 of P20-07). The service now names the facility on EVERY create, so a tenant with a
 * second facility no longer meets Am. 3's 23502:
 *  - a facility-BOUND principal: its own facility (the hooks stamp and force it too); naming
 *    another is answered as a missing one — 404, never a hint that it exists;
 *  - an unbound principal naming one: that facility of the tenant (404 when it is not one; 409
 *    when it has `ended` — spec § 4.4);
 *  - an unbound principal naming none: the tenant's SELF facility — every create path of today
 *    (API, bulk import, frontend) sends none, and a self-served hospital notices nothing.
 * A database without the tenant's self facility leaves it unnamed: the default trigger of 0118,
 * kept as the backstop, then fills or refuses it.
 *
 * @param tenantId - the caller's tenant
 * @param requested - the facility the request names, if any
 * @returns the facility, or the answer to send instead
 */
const resolveCreateFacility = async (tenantId: TenantId, requested: string | null | undefined): Promise<CreateFacility> => {
  const notFound: CreateFacility = { ok: false, outcome: { success: false, status: 404, message: "Client facility not found", data: null } };
  const ctx = tenantStorage.getStore();
  if (ctx?.facilityBound === true && !ctx.isSuperAdmin && ctx.clientFacilityId) {
    return requested && requested !== ctx.clientFacilityId ? notFound : { ok: true, clientFacilityId: ctx.clientFacilityId };
  }
  const { ClientFacility } = models;
  if (requested) {
    const facility = await ClientFacility.findOne({ where: { id: requested, tenantId }, attributes: ["id", "name", "status"] });
    if (!facility) {
      return notFound;
    }
    if (facility.status === "ended") {
      return {
        ok: false,
        outcome: {
          success: false,
          status: 409,
          message: `${facility.name} has ended; new records cannot be added. Reinstate it first.`,
          data: null,
        },
      };
    }
    return { ok: true, clientFacilityId: facility.id };
  }
  const self = await ClientFacility.findOne({ where: { tenantId, isSelf: true }, attributes: ["id"] });
  return { ok: true, clientFacilityId: self?.id };
};

/**
 * P21-09e (P18-03 § 8.2 A-2 / A-3) — what a facility-BOUND writer may not do to a device: change
 * its status on an edit (retirement and reinstatement are provider acts), or point it at a
 * location its context cannot read (another facility's room, a provider store — the facility hooks
 * filter Warehouse, so such a location is the same 404 as a missing one). Its facility is forced
 * (the create resolves its own; the edit contract carries none). Unbound callers: no change.
 *
 * @param tenantId - the caller's tenant
 * @param validated - the validated body
 * @param update - an edit (status refused) or a create
 * @returns the refusal to send, or null
 */
const boundWriteRefusal = async (
  tenantId: TenantId,
  validated: { status?: unknown; locationId?: unknown },
  update: boolean,
): Promise<Outcome<null> | null> => {
  const ctx = tenantStorage.getStore();
  if (ctx?.facilityBound !== true) {
    return null;
  }
  if (update && validated.status !== undefined) {
    return { success: false, status: 400, message: "A facility user cannot change a device's status.", data: null };
  }
  if (typeof validated.locationId === "string" && validated.locationId !== "") {
    const location = await models.Warehouse.findOne({ where: { id: validated.locationId, tenantId }, attributes: ["id"] });
    if (!location) {
      return { success: false, status: 404, message: "Location not found", data: null };
    }
  }
  return null;
};

/**
 * Create a new calibration device
 */
const createCalibrationDevice = async (
  tenantId: TenantId,
  inputData: unknown,
  actor: AuditActorInput = {},
): Promise<Outcome<DeviceRow | null>> => {
  try {
    const validated = validate(
      inputData,
      deviceSchemas()
        .createCalibrationDeviceSchema,
    );

    normaliseSerial(validated);

    const refused = await boundWriteRefusal(tenantId, validated, false);
    if (refused) {
      return refused;
    }

    // P21-09 (G-F1): the facility, before the serial check that is per facility.
    const facility = await resolveCreateFacility(tenantId, validated.clientFacilityId);
    if (!facility.ok) {
      return facility.outcome;
    }
    const { clientFacilityId } = facility;

    // Check for a duplicate serial number (only when one is supplied — a null
    // serialNumber must not be used as a WHERE parameter). Deleted devices
    // count: the unique index covers them (A-92).
    const holder = validated.serialNumber
      ? await findSerialHolder(tenantId, clientFacilityId, validated.serialNumber)
      : null;

    if (holder) {
      return serialConflict(validated.serialNumber, holder);
    }

    let device;
    try {
      device = await db.transaction(async (transaction) => {
        const values: Record<string, unknown> = { ...validated, tenantId };
        if (clientFacilityId) {
          values["clientFacilityId"] = clientFacilityId;
        } else {
          delete values["clientFacilityId"];
        }
        const created = await CalibrationDevice.create(
          values as CreationAttributes<DeviceRow>,
          { transaction },
        );
        await auditDevice(transaction, tenantId, created.id, "CREATE", { before: {}, after: validated }, actor);
        return created;
      });
    } catch (error) {
      // A concurrent request registered the serial after the check above.
      if (isSerialUniqueViolation(error)) {
        return serialConflict(
          validated.serialNumber,
          await findSerialHolder(tenantId, clientFacilityId, validated.serialNumber),
        );
      }
      throw error;
    }

    return {
      success: true,
      status: 201,
      message: "Calibration device created successfully",
      data: device,
    };
  } catch (error) {
    logger.error("Error creating calibration device", { error: messageOf(error) });
    throw error;
  }
};

/**
 * Update an existing calibration device
 */
const updateCalibrationDevice = async (
  tenantId: TenantId,
  calibrationDeviceId: string,
  inputData: unknown,
  actor: AuditActorInput = {},
): Promise<Outcome<DeviceRow | null>> => {
  try {
    const validated = validate(
      inputData,
      deviceSchemas()
        .updateCalibrationDeviceSchema,
    );

    const refused = await boundWriteRefusal(tenantId, validated, true);
    if (refused) {
      return refused;
    }

    const device = await CalibrationDevice.findOne({
      where: { id: calibrationDeviceId, tenantId },
    });

    if (!device) {
      return {
        success: false,
        status: 404,
        message: "Calibration device not found",
        data: null,
      };
    }

    // Q-02 (ADR-084): retirement is terminal; the way back is the audited
    // reinstatement, never an edit.
    if (retirement.leavesRetirement(device, validated)) {
      return retirement.retirementConflict(device);
    }

    normaliseSerial(validated);

    // A serial another device of the tenant holds — live or deleted — is a
    // 409, not a 500 from the unique index (A-92). Keeping the device's own
    // serial is not a conflict.
    const changesSerial =
      validated.serialNumber && validated.serialNumber !== device.serialNumber;
    if (changesSerial) {
      const holder = await findSerialHolder(tenantId, device.clientFacilityId, validated.serialNumber);
      if (holder && holder.id !== device.id) {
        return serialConflict(validated.serialNumber, holder);
      }
    }

    try {
      const before = beforeOf(device, validated);
      await db.transaction(async (transaction) => {
        await device.update(validated as Parameters<DeviceRow["update"]>[0], { transaction });
        await auditDevice(transaction, tenantId, device.id, "UPDATE", { before, after: validated }, actor);
      });
    } catch (error) {
      // A concurrent request took the serial after the check above.
      if (isSerialUniqueViolation(error)) {
        return serialConflict(
          validated.serialNumber,
          await findSerialHolder(tenantId, device.clientFacilityId, validated.serialNumber),
        );
      }
      // Q-02: retired by a concurrent request after the check above — the
      // 0089 trigger refused the write.
      if (retirement.isRetirementTerminalViolation(error)) {
        return retirement.retirementConflict(device);
      }
      throw error;
    }

    return {
      success: true,
      status: 200,
      message: "Calibration device updated successfully",
      data: device,
    };
  } catch (error) {
    logger.error("Error updating calibration device", { error: messageOf(error) });
    throw error;
  }
};

/**
 * Soft-delete a calibration device
 */
const deleteCalibrationDevice = async (
  tenantId: TenantId,
  calibrationDeviceId: string,
  actor: AuditActorInput = {},
): Promise<Outcome<null>> => {
  try {
    const device = await CalibrationDevice.findOne({
      where: { id: calibrationDeviceId, tenantId },
    });

    if (!device) {
      return {
        success: false,
        status: 404,
        message: "Calibration device not found",
        data: null,
      };
    }

    // softDelete() takes no options; it joins this transaction through
    // Sequelize CLS (config/index.js `useCLS`), as certificate.approve() does.
    await db.transaction(async (transaction) => {
      await device.softDelete();
      // D-22 (ADR-070): its attachments go with it, in this transaction.
      await attachmentService().softDeleteForResource(
        tenantId,
        "CalibrationDevice",
        device.id,
        { transaction, actor },
      );
      await auditDevice(
        transaction,
        tenantId,
        device.id,
        "DELETE",
        { before: { isDeleted: false }, after: { isDeleted: true } },
        actor,
      );
    });

    return {
      success: true,
      status: 200,
      message: "Calibration device deleted successfully",
      data: null,
    };
  } catch (error) {
    logger.error("Error deleting calibration device", { error: messageOf(error) });
    throw error;
  }
};

/**
 * A-133 (ADR-075) — restore a soft-deleted calibration device.
 *
 * A device is the anchor of its calibration records and certificates (ISO
 * 17025 §6.4.13, §7.5): a device deleted in error left that history attached
 * to a register entry nobody could reach, and the only way back was the
 * database. Restoring is:
 *  - 404 for a device that does not exist, is another tenant's, or was never
 *    deleted AND is another tenant's — indistinguishable (CLAUDE.md);
 *  - 409 with a state explanation for a device of this tenant that is not
 *    deleted, or whose serial number a LIVE device of this tenant now holds
 *    (possible once the serial index is partial on is_deleted, P6-06; the
 *    unique index is the backstop for a race);
 *  - one transaction: the device, exactly the attachments its delete took with
 *    it (attachment.service#restoreForResource), and an UPDATE audit row with
 *    `operation: "RESTORE"` (auditActions.js: a restore has no ENUM member).
 *
 * @param tenantId
 * @param calibrationDeviceId
 * @param actor
 */
const restoreCalibrationDevice = async (
  tenantId: TenantId,
  calibrationDeviceId: string,
  actor: AuditActorInput = {},
): Promise<Outcome<DeviceRow | null>> => {
  try {
    // unscoped(): the defaultScope hides deleted devices, which is exactly
    // what is being looked for. The tenant predicate is explicit, and the
    // global tenant hooks still apply (they are hooks, not a scope).
    const device = await CalibrationDevice.unscoped().findOne({
      where: { id: calibrationDeviceId, tenantId },
      attributes: ["id", "tenantId", "clientFacilityId", "name", "serialNumber", "isDeleted"],
    });

    if (!device) {
      return { success: false, status: 404, message: "Calibration device not found", data: null };
    }

    if (!device.isDeleted) {
      return {
        success: false,
        status: 409,
        message:
          `Calibration device "${device.name}" is not deleted, so there is nothing to restore. ` +
          "It is already listed in the register.",
        data: null,
      };
    }

    const serialTakenOnRestore = (): Outcome<null> => ({
      success: false,
      status: 409,
      message:
        `Calibration device "${device.name}" cannot be restored: serial number "${String(device.serialNumber)}" ` +
        "is now held by another calibration device in this organisation. Change or remove that " +
        "device's serial number first, then restore this one.",
      data: null,
    });

    if (device.serialNumber) {
      // P21-09 (UD-9): the serial is unique per facility — only a live holder
      // in the device's own facility blocks the restore.
      const liveWhere: Record<string, unknown> = { tenantId, serialNumber: device.serialNumber, id: { [Op.ne]: device.id } };
      if (device.clientFacilityId) {
        liveWhere["clientFacilityId"] = device.clientFacilityId;
      }
      const liveHolder = await CalibrationDevice.findOne({
        where: liveWhere as WhereOptions,
        attributes: ["id"],
      });
      if (liveHolder) {
        return serialTakenOnRestore();
      }
    }

    let attachmentsRestored;
    try {
      attachmentsRestored = await db.transaction(async (transaction) => {
        // restoreStatic joins this transaction through Sequelize CLS, as
        // softDelete() does on the way out.
        const [count] = await CalibrationDevice.restoreStatic(device.id);
        if (count !== 1) {
          // Restored by a concurrent request between the read and the write.
          throw Object.assign(new Error("already restored"), { alreadyRestored: true });
        }
        const restored = await attachmentService().restoreForResource(
          tenantId,
          "CalibrationDevice",
          device.id,
          { transaction, actor },
        );
        await auditDevice(
          transaction,
          tenantId,
          device.id,
          "UPDATE",
          {
            operation: "RESTORE",
            before: { isDeleted: true },
            after: { isDeleted: false },
            attachmentsRestored: restored,
          },
          actor,
        );
        return restored;
      });
    } catch (error) {
      if ((error as { alreadyRestored?: boolean }).alreadyRestored) {
        return {
          success: false,
          status: 409,
          message: `Calibration device "${device.name}" has just been restored by another request.`,
          data: null,
        };
      }
      if (isSerialUniqueViolation(error)) {
        return serialTakenOnRestore();
      }
      throw error;
    }

    const restoredDevice = await CalibrationDevice.findOne({ where: { id: device.id, tenantId } });

    return {
      success: true,
      status: 200,
      message:
        attachmentsRestored.length > 0
          ? `Calibration device restored, with ${String(attachmentsRestored.length)} attachment(s) removed by its deletion`
          : "Calibration device restored",
      data: restoredDevice,
    };
  } catch (error) {
    logger.error("Error restoring calibration device", { error: messageOf(error) });
    throw error;
  }
};

// ==========================================
// CSV PARSING HELPER
// ==========================================

const parseCSV = (filePath: string): string[][] => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required at call time
  const fs = require("fs") as typeof Fs;
  const content = fs.readFileSync(filePath, "utf8");
  const lines: string[][] = [];
  let currentLine: string[] = [];
  let currentField = "";
  let insideQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i] as string;
    const nextChar = content[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      currentLine.push(currentField.trim());
      currentField = "";
    } else if ((char === "\r" || char === "\n") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++;
      }
      currentLine.push(currentField.trim());
      if (currentLine.length > 1 || (currentLine.length === 1 && currentLine[0] !== "")) {
        lines.push(currentLine);
      }
      currentField = "";
      currentLine = [];
    } else {
      currentField += char;
    }
  }

  if (currentField !== "" || currentLine.length > 0) {
    currentLine.push(currentField.trim());
    if (currentLine.length > 1 || (currentLine.length === 1 && currentLine[0] !== "")) {
      lines.push(currentLine);
    }
  }
  return lines;
};

/** One rejected row of a bulk import. */
interface ImportRowError {
  row: number;
  errors: string | FieldError[] | { field: string; message: string }[];
}

interface ImportData {
  successCount: number;
  failedCount: number;
  totalCount: number;
  errors: ImportRowError[];
}

/**
 * Bulk import calibration devices from a CSV file
 */
const bulkImportCalibrationDevices = async (
  tenantId: TenantId,
  csvFilePath: string,
  actor: AuditActorInput = {},
): Promise<Outcome<ImportData | null>> => {
  try {
    const parsedLines = parseCSV(csvFilePath);
    if (parsedLines.length < 2) {
      return {
        success: false,
        status: 400,
        message: "CSV file must contain a header row and at least one data row",
        data: {
          successCount: 0,
          failedCount: 0,
          totalCount: 0,
          errors: [{ row: 1, errors: "CSV is empty or missing headers" }],
        },
      };
    }

    const headers = (parsedLines[0] as string[]).map((h) => h.toLowerCase().trim());
    const dataRows = parsedLines.slice(1);

    // P21-09 (G-F1): an import names no facility, so its devices go where an
    // unbound create without one goes — the tenant's self facility (a bound
    // principal's own). Choosing a client facility for an import is later work.
    // Naming none never refuses (only a named facility can be missing or ended).
    const clientFacilityId = ((await resolveCreateFacility(tenantId, null)) as Extract<CreateFacility, { ok: true }>).clientFacilityId;

    // Every serial the facility holds, DELETED devices included: the unique
    // index (tenant_id, client_facility_id, serial_number) covers them, so a
    // row re-using one failed the whole bulkCreate with a 500 (A-92). Same
    // lookup rules as findSerialHolder: unscoped (no isDeleted filter),
    // paranoid off, tenant (and facility, UD-9) predicate explicit.
    const existingDevices = await CalibrationDevice.unscoped().findAll({
      where: clientFacilityId ? { tenantId, clientFacilityId } : { tenantId },
      attributes: ["serialNumber", "isDeleted", "deletedAt"],
      paranoid: false,
    });
    /** serial → true when only a deleted device holds it */
    const existingSerialNumbers = new Map(
      existingDevices
        .filter((d) => d.serialNumber)
        .map((d) => [d.serialNumber, Boolean(d.isDeleted || d.deletedAt)]),
    );

    const processedSerialNumbers = new Set<string>();
    const toInsert: Record<string, unknown>[] = [];
    const errors: ImportRowError[] = [];

    const headerMap: Record<string, string | undefined> = {
      "device name": "name",
      "name": "name",
      "manufacturer": "manufacturer",
      "model": "model",
      "serial number": "serialNumber",
      "serialnumber": "serialNumber",
      "status": "status",
      "next calibration": "nextCalibrationDate",
      "next calibration date": "nextCalibrationDate",
      "nextcalibrationdate": "nextCalibrationDate",
      "category": "category",
      "installation date": "installationDate",
      "installationdate": "installationDate",
      "calibration interval days": "calibrationIntervalDays",
      "calibrationintervaldays": "calibrationIntervalDays",
      "remarks": "remarks",
    };

    const schema = deviceSchemas().createCalibrationDeviceSchema;

    for (let index = 0; index < dataRows.length; index++) {
      const row = dataRows[index] as string[];
      const rowNum = index + 2;

      const rowObj: Record<string, unknown> = {};
      for (let c = 0; c < headers.length; c++) {
        const fieldName = headerMap[headers[c] as string];
        if (fieldName && row[c] !== undefined) {
          if (fieldName === "calibrationIntervalDays") {
            const val = row[c] === "" ? null : Number(row[c]);
            // as built: the global isNaN, which reads null as 0 (ADR-038 rule 3)
            rowObj[fieldName] = isNaN(val as never) ? row[c] : val;
          } else {
            rowObj[fieldName] = row[c] === "" ? null : row[c];
          }
        }
      }

      const isEmpty = Object.values(rowObj).every((v) => v === null || v === "");
      if (isEmpty) {
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: a CSV cell is a string or null, and String() is what the .js called (ADR-038 rule 3)
      const sn = rowObj["serialNumber"] ? String(rowObj["serialNumber"]).trim() : null;
      if (sn) {
        if (existingSerialNumbers.has(sn) || processedSerialNumbers.has(sn)) {
          errors.push({
            row: rowNum,
            errors: [
              {
                field: "serialNumber",
                message: existingSerialNumbers.get(sn)
                  ? `Duplicate serial number: ${sn} is held by a deleted device in this organisation. ` +
                    "Ask an administrator to restore it, or use a different serial number."
                  : `Duplicate serial number: ${sn}`,
              },
            ],
          });
          continue;
        }
        processedSerialNumbers.add(sn);
      }

      const checked = checkInput(rowObj, schema);

      if (!checked.ok) {
        errors.push({
          row: rowNum,
          errors: checked.errors,
        });
      } else {
        toInsert.push({
          ...checked.value,
          tenantId,
          ...(clientFacilityId ? { clientFacilityId } : {}),
        });
      }
    }

    if (toInsert.length > 0) {
      try {
        // One INSERT and ONE audit row summarising the import (counts and the
        // ids created), in one transaction: all of it, or none of it.
        await db.transaction(async (transaction) => {
          const created = await CalibrationDevice.bulkCreate(toInsert as CreationAttributes<DeviceRow>[], { transaction });
          await auditDevice(
            transaction,
            tenantId,
            null,
            "CREATE",
            {
              operation: "bulk_import",
              after: {
                successCount: created.length,
                failedCount: errors.length,
                totalCount: created.length + errors.length,
                ids: created.map((d) => d.id),
              },
            },
            actor,
          );
        });
      } catch (error) {
        // A concurrent request registered one of these serials after the
        // lookup above. bulkCreate is one INSERT statement, so NOTHING was
        // written — say so, rather than a 500 or a partial count.
        if (isSerialUniqueViolation(error)) {
          return {
            success: false,
            status: 409,
            message:
              "Bulk import was not applied: a serial number in the file was registered in this " +
              "organisation while the import ran. No device was imported — upload the file again.",
            data: null,
          };
        }
        throw error;
      }
    }

    return {
      success: true,
      status: 200,
      message: `Bulk import completed: ${String(toInsert.length)} succeeded, ${String(errors.length)} failed.`,
      data: {
        successCount: toInsert.length,
        failedCount: errors.length,
        totalCount: toInsert.length + errors.length,
        errors,
      },
    };
  } catch (error) {
    logger.error("Error bulk importing calibration devices", {
      error: messageOf(error),
    });
    throw error;
  }
};

export = {
  fetchCalibrationDevices,
  fetchSpecificCalibrationDevice,
  createCalibrationDevice,
  updateCalibrationDevice,
  deleteCalibrationDevice,
  restoreCalibrationDevice,
  bulkImportCalibrationDevices,
};
