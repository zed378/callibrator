/**
 * Device types — the GLOBAL catalogue's types (P21-01; ADR-125 § 1, Am. 1; spec
 * MEMORY/specs/P19-01-inspection-catalogue.md § 4.1, § 7.1, § 8.2, § 10).
 *
 * Reads are open to every catalogue reader (`calibration` | `ipm` | `ipm-templates`), facility-
 * bound users included: a type is platform content with no facility in it. Writes are the platform
 * operator's (the routes carry `superAdminOnly`); each writes its audit row under the PLATFORM
 * tenant inside its transaction (the roles precedent, A-125).
 *
 * The name is unique over EVERY status, case-insensitively (migration 0111): a retired name is
 * reactivated, never recreated — the 409 says so. Global uniqueness is no oracle here: the table
 * is platform content every tenant reads.
 *
 * Named exports only (ADR-087 Am. 15).
 */
import { Op, type Transaction, type WhereOptions } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import { AppError } from "../utils/appError.util";
import { auditEntryActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";
import type { CreateDeviceTypeInput, ListDeviceTypesQueryInput } from "@callibrator/contracts/inspectionCatalogue";
import type { DeviceTypeId } from "../types/ids";
import type { CatalogueLifecycleStatus } from "@callibrator/contracts/states";
import type { ModelInstance } from "../types/models";
import { actorUserId, conflictOr, deviceTypeView, likeLiteral, pageMeta, type DeviceTypeView, type Page } from "./inspectionCatalogue.shared";

type DeviceTypeRow = ModelInstance<"DeviceType">;

const NOT_FOUND = "Device type not found";

/** The 409 of a name another type holds, naming that type's status. */
const nameTaken = (name: string, status: string): AppError =>
  new AppError(
    409,
    status === "retired"
      ? `A device type named "${name}" already exists (status: retired — reactivate it instead).`
      : `A device type named "${name}" already exists.`,
  );

/** The type `id`, locked in `transaction`, or the 404. */
const loadType = async (id: string, transaction?: Transaction): Promise<DeviceTypeRow> => {
  const row = await models.DeviceType.findOne({
    where: { id },
    ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!row) {
    throw new AppError(404, NOT_FOUND);
  }
  return row;
};

/** The 409 when another type already has `name` (case-insensitively, any status). */
const assertNameFree = async (name: string, excludeId: string | null, transaction: Transaction): Promise<void> => {
  const clash = await models.DeviceType.findOne({
    where: { name: { [Op.iLike]: likeLiteral(name) }, ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) },
    attributes: ["id", "name", "status"],
    transaction,
  });
  if (clash) {
    throw nameTaken(clash.name, clash.status);
  }
};

/** One audit row for a device type, inside `transaction`. */
const audit = async (
  transaction: Transaction,
  actor: AuditActorInput,
  row: DeviceTypeRow,
  action: "CREATE" | "UPDATE",
  operation: string,
  before: Readonly<Record<string, unknown>>,
): Promise<void> => {
  await auditService.logAction(
    {
      tenantId: PLATFORM_TENANT_ID,
      ...auditEntryActor(actor),
      action,
      resourceType: "DeviceType",
      resourceId: row.id,
      changes: { operation, before, after: { name: row.name, status: row.status } },
    },
    { transaction },
  );
};

/**
 * `GET /device-types`: a page of types, by name then id.
 *
 * @param query - the validated query (`status` defaults to `active`)
 * @returns rows and meta
 */
export const listDeviceTypes = async (query: ListDeviceTypesQueryInput): Promise<Page<DeviceTypeView>> => {
  const where: Record<string, unknown> = {};
  if (query.status !== "all") {
    where["status"] = query.status;
  }
  if (query.search) {
    where["name"] = { [Op.iLike]: `%${likeLiteral(query.search)}%` };
  }
  const { rows, count } = await models.DeviceType.findAndCountAll({
    where: where as WhereOptions,
    attributes: ["id", "name", "status"],
    order: [["name", "ASC"], ["id", "ASC"]],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });
  return { rows: rows.map(deviceTypeView), meta: pageMeta(count, query.page, query.limit) };
};

/**
 * `GET /device-types/:deviceTypeId` — any status (a device's retired type still resolves).
 *
 * @param id - the type
 * @returns the type (404 when missing)
 */
export const getDeviceType = async (id: DeviceTypeId): Promise<DeviceTypeView> => deviceTypeView(await loadType(id));

/**
 * `POST /device-types`.
 *
 * @param input - the validated body (the name normalised by the contract)
 * @param actor - the operator
 * @returns the new, active type
 */
export const createDeviceType = async (input: CreateDeviceTypeInput, actor: AuditActorInput): Promise<DeviceTypeView> => {
  try {
    return await db.transaction(async (transaction) => {
      await assertNameFree(input.name, null, transaction);
      const by = actorUserId(actor);
      const row = await models.DeviceType.create({ name: input.name, status: "active", createdBy: by, updatedBy: by }, { transaction });
      await audit(transaction, actor, row, "CREATE", "CREATE_DEVICE_TYPE", {});
      return deviceTypeView(row);
    });
  } catch (error) {
    throw conflictOr(error, `A device type named "${input.name}" already exists.`);
  }
};

/**
 * `PATCH /device-types/:deviceTypeId`: rename an ACTIVE type.
 *
 * @param id - the type
 * @param name - the new name
 * @param actor - the operator
 * @returns the type
 */
export const renameDeviceType = async (id: DeviceTypeId, name: string, actor: AuditActorInput): Promise<DeviceTypeView> => {
  try {
    return await db.transaction(async (transaction) => {
      const row = await loadType(id, transaction);
      if (row.status !== "active") {
        throw new AppError(409, "This device type is retired; reactivate it before renaming it.");
      }
      await assertNameFree(name, row.id, transaction);
      const before = { name: row.name, status: row.status };
      await row.update({ name, updatedBy: actorUserId(actor) }, { transaction });
      await audit(transaction, actor, row, "UPDATE", "RENAME_DEVICE_TYPE", before);
      return deviceTypeView(row);
    });
  } catch (error) {
    throw conflictOr(error, `A device type named "${name}" already exists.`);
  }
};

/**
 * `POST /device-types/:deviceTypeId/retire` · `/reactivate` (spec § 7.1). Devices keep a retired
 * type; it cannot be GIVEN to a device any more (400 at the device routes).
 *
 * @param id - the type
 * @param to - the status it moves to
 * @param actor - the operator
 * @returns the type
 */
export const setDeviceTypeStatus = async (id: DeviceTypeId, to: CatalogueLifecycleStatus, actor: AuditActorInput): Promise<DeviceTypeView> =>
  db.transaction(async (transaction) => {
    const row = await loadType(id, transaction);
    if (row.status === to) {
      throw new AppError(409, to === "retired" ? "This device type is already retired." : "This device type is active.");
    }
    const before = { name: row.name, status: row.status };
    await row.update({ status: to, updatedBy: actorUserId(actor) }, { transaction });
    await audit(transaction, actor, row, "UPDATE", to === "retired" ? "RETIRE_DEVICE_TYPE" : "REACTIVATE_DEVICE_TYPE", before);
    return deviceTypeView(row);
  });

/**
 * The type a device may be GIVEN (spec § 4.7): it exists and is active. A device that already
 * holds a retired type keeps it — the caller asks only when the type changes.
 *
 * @param id - the type the body names
 * @returns null when it may be given, else the 400's message
 */
export const deviceTypeAssignmentRefusal = async (id: string): Promise<string | null> => {
  const row = await models.DeviceType.findOne({ where: { id }, attributes: ["id", "status"] });
  if (!row) {
    return "Unknown device type.";
  }
  return row.status === "retired" ? "This device type is retired; choose its replacement." : null;
};
