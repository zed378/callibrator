/**
 * Warehouses and their storage locations, per tenant.
 *
 * P9-15 (ADR-087, Stage C): converted from warehouse.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned (the
 * same keys, in the same order). `db`, the three models, `logger`, `AppError`,
 * `DEFAULT_LIMIT`, the four schemas and `validateInput` are captured once at
 * load, as the `.js` destructured them. No method calls a sibling, so there is
 * no internal call to route through the exported object.
 *
 * As built, not changed here: `fetchWarehouses` answers `data: { rows, count,
 * meta }`, and the controller unwraps it into the envelope. The search
 * matched with a case-sensitive `LIKE` until A-320 (now `ILIKE`).
 *
 * P6-11 (A-41 addendum): every write commits with one audit row in its own
 * transaction, and `deleteWarehouse` now soft-deletes INSIDE that transaction
 * (it used to soft-delete outside it, so its audit row and the delete could
 * disagree).
 */
import { Op, type Transaction, type WhereOptions } from "sequelize";
import { db as loadedDb } from "../config";
import models from "../models";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { DEFAULT_LIMIT as LOADED_DEFAULT_LIMIT } from "../constants";
import {
  createWarehouseSchema as loadedCreateWarehouseSchema,
  updateWarehouseSchema as loadedUpdateWarehouseSchema,
  createLocationSchema as loadedCreateLocationSchema,
  updateLocationSchema as loadedUpdateLocationSchema,
} from "../validators/warehouse.validator";
import { validateInput } from "../validators/input";
import auditService from "./audit.service";
import { actorChanges, auditEntryActor } from "../utils/auditPrincipal.util";
import type { AuditActorInput } from "../utils/auditPrincipal.util";
import type { TenantId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const db = loadedDb;
const { Warehouse, StorageLocation, Stock } = models;
const logger = loadedLogger;
const AppError = LoadedAppError;
const DEFAULT_LIMIT = LOADED_DEFAULT_LIMIT;
const createWarehouseSchema = loadedCreateWarehouseSchema;
const updateWarehouseSchema = loadedUpdateWarehouseSchema;
const createLocationSchema = loadedCreateLocationSchema;
const updateLocationSchema = loadedUpdateLocationSchema;

// ==========================================
// VALIDATION HELPERS
// ==========================================

const validate = validateInput;

type WarehouseRow = ModelInstance<"Warehouse">;
type LocationRow = ModelInstance<"StorageLocation">;

const WAREHOUSE_FIELDS = ["name", "code", "address", "description", "status"] as const;
const LOCATION_FIELDS = ["warehouseId", "name", "code", "description", "isActive"] as const;

/** The named attributes of a row, as plain values (null when absent). */
const pickFields = (row: object, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k] ?? null]));

/**
 * P6-11 (A-41 addendum) — a warehouse or storage-location write commits with
 * one audit row in its transaction; a rolled-back write leaves none. The actor
 * is auditPrincipal(req): a user, or an API key as `system:api-key` (A-282).
 *
 * @param transaction - the write's transaction
 * @param actor - auditPrincipal(req)
 * @param tenantId - the row's tenant
 * @param action - CREATE | UPDATE | DELETE
 * @param resourceType - "Warehouse" or "StorageLocation"
 * @param resourceId - the row's id
 * @param changes - { operation, before?, after? }
 * @returns logAction's result
 */
const auditWarehouse = (
  transaction: Transaction,
  actor: AuditActorInput | null | undefined,
  tenantId: TenantId,
  action: "CREATE" | "UPDATE" | "DELETE",
  resourceType: "Warehouse" | "StorageLocation",
  resourceId: string,
  changes: Record<string, unknown>,
): Promise<unknown> =>
  auditService.logAction(
    {
      tenantId,
      ...auditEntryActor(actor),
      action,
      resourceType,
      resourceId,
      changes: { ...changes, ...actorChanges(actor) },
    },
    { transaction },
  );

/** The service's answer; the controller forwards it. */
interface ServiceResult<T> {
  success: true;
  status: number;
  message: string;
  data: T;
}

interface WarehouseListData {
  rows: WarehouseRow[];
  count: number;
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/** The list query as the controller passes it (validated; a JavaScript caller may pass anything). */
interface FetchWarehousesQuery {
  tenantId: TenantId;
  // `| undefined`: the controller passes the validated query's `find` as it is,
  // absent or not (P9-20; a type-only widening, nothing emitted changes).
  find?: string | null | undefined;
  page?: number | string;
  limit?: number | string;
}

/** Sequelize's run-time `transaction.finished` ("commit" / "rollback"), which its typings omit. */
const finishedOf = (transaction: Transaction): unknown => (transaction as unknown as { finished?: unknown }).finished;

/** A caught value's `message`, read exactly as the `.js` read it (a thrown `null` still throws here). */
const messageOf = (error: unknown): unknown => (error as { message?: unknown }).message;

// ==========================================
// WAREHOUSE SERVICE METHODS
// ==========================================

const fetchWarehouses = async ({ tenantId, find, page = 1, limit = DEFAULT_LIMIT }: FetchWarehousesQuery): Promise<ServiceResult<WarehouseListData>> => {
  try {
    const whereClause: Record<string | symbol, unknown> = { tenantId, isDeleted: false };

    if (find) {
      // A-320: ILIKE on the term as typed. It was lower-cased and matched with a
      // case-sensitive LIKE, so a mixed-case name was not found by its own name.
      // A leading % rules out a b-tree index either way.
      const searchTerm = `%${find}%`;
      whereClause[Op.or] = [
        { name: { [Op.iLike]: searchTerm } },
        { code: { [Op.iLike]: searchTerm } },
      ];
    }

    const { rows, count } = await Warehouse.findAndCountAll({
      where: whereClause as WhereOptions,
      order: [["name", "ASC"], ["id", "ASC"]],
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
    });

    return {
      success: true,
      status: 200,
      message: "Fetch warehouses successful",
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
    logger.error("Error fetching warehouses", { error: messageOf(error) });
    throw error;
  }
};

const fetchSpecificWarehouse = async (tenantId: TenantId, warehouseId: string): Promise<ServiceResult<WarehouseRow>> => {
  try {
    const warehouse = await Warehouse.findOne({
      where: { id: warehouseId, tenantId, isDeleted: false },
      include: [
        {
          model: StorageLocation,
          as: "locations",
          required: false,
        },
      ],
    });

    if (!warehouse) {
      throw new AppError(404, "Warehouse not found");
    }

    return {
      success: true,
      status: 200,
      message: "Fetch warehouse successful",
      data: warehouse,
    };
  } catch (error) {
    logger.error("Error fetching specific warehouse", { error: messageOf(error) });
    throw error;
  }
};

const createWarehouse = async (
  tenantId: TenantId,
  input: unknown,
  actor: AuditActorInput | null = null,
): Promise<ServiceResult<WarehouseRow>> => {
  const data = validate(input, createWarehouseSchema);
  const transaction = await db.transaction();

  try {
    const existing = await Warehouse.findOne({
      where: { tenantId, code: data.code, isDeleted: false },
      transaction,
    });

    if (existing) {
      throw new AppError(409, "Warehouse code already exists");
    }

    const warehouse = await Warehouse.create(
      {
        tenantId,
        name: data.name,
        code: data.code,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty string is stored as null too (ADR-038 rule 3)
        address: data.address || null,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty string is stored as null too (ADR-038 rule 3)
        description: data.description || null,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a null status falls back to "active" (ADR-038 rule 3)
        status: data.status || "active",
      },
      { transaction },
    );

    await auditWarehouse(transaction, actor, tenantId, "CREATE", "Warehouse", warehouse.id, {
      operation: "WAREHOUSE_CREATE",
      after: pickFields(warehouse, WAREHOUSE_FIELDS),
    });
    await transaction.commit();
    logger.info("Warehouse created", { warehouseId: warehouse.id, tenantId });

    return {
      success: true,
      status: 201,
      message: "Warehouse created successfully",
      data: warehouse,
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the .js guarded the transaction too (ADR-038 rule 3)
    if (transaction && !finishedOf(transaction)) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is swallowed so the original error surfaces (ADR-038 rule 3)
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error creating warehouse", { error: messageOf(error) });
    throw error;
  }
};

const updateWarehouse = async (
  tenantId: TenantId,
  warehouseId: string,
  input: unknown,
  actor: AuditActorInput | null = null,
): Promise<ServiceResult<WarehouseRow>> => {
  const data = validate(input, updateWarehouseSchema);
  const transaction = await db.transaction();

  try {
    const warehouse = await Warehouse.findOne({
      where: { id: warehouseId, tenantId, isDeleted: false },
      transaction,
    });

    if (!warehouse) {
      throw new AppError(404, "Warehouse not found");
    }

    if (data.code) {
      const existing = await Warehouse.findOne({
        where: {
          tenantId,
          code: data.code,
          id: { [Op.ne]: warehouseId },
          isDeleted: false,
        },
        transaction,
      });

      if (existing) {
        throw new AppError(409, "Warehouse code already exists");
      }
    }

    const before = pickFields(warehouse, WAREHOUSE_FIELDS);
    await warehouse.update(
      {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value keeps the stored one (ADR-038 rule 3)
        name: data.name || warehouse.name,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value keeps the stored one (ADR-038 rule 3)
        code: data.code || warehouse.code,
        address: data.address !== undefined ? data.address : warehouse.address,
        description: data.description !== undefined ? data.description : warehouse.description,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a null status keeps the stored one (ADR-038 rule 3)
        status: data.status || warehouse.status,
      },
      { transaction },
    );

    await auditWarehouse(transaction, actor, tenantId, "UPDATE", "Warehouse", warehouse.id, {
      operation: "WAREHOUSE_UPDATE",
      before,
      after: pickFields(warehouse, WAREHOUSE_FIELDS),
    });
    await transaction.commit();
    logger.info("Warehouse updated", { warehouseId, tenantId });

    return {
      success: true,
      status: 200,
      message: "Warehouse updated successfully",
      data: warehouse,
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the .js guarded the transaction too (ADR-038 rule 3)
    if (transaction && !finishedOf(transaction)) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is swallowed so the original error surfaces (ADR-038 rule 3)
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error updating warehouse", { error: messageOf(error) });
    throw error;
  }
};

const deleteWarehouse = async (
  tenantId: TenantId,
  warehouseId: string,
  actor: AuditActorInput | null = null,
): Promise<ServiceResult<null>> => {
  const transaction = await db.transaction();

  try {
    const warehouse = await Warehouse.findOne({
      where: { id: warehouseId, tenantId, isDeleted: false },
      transaction,
    });

    if (!warehouse) {
      throw new AppError(404, "Warehouse not found");
    }

    // Check if warehouse has active stocks
    const stockCount = await Stock.count({
      where: { warehouseId, tenantId, isDeleted: false },
      transaction,
    });

    if (stockCount > 0) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the count is interpolated as the .js did (ADR-038 rule 3)
      throw new AppError(400, `Cannot delete warehouse with ${stockCount} items in stock`);
    }

    // P6-11: what Warehouse#softDelete does (isDeleted, save without hooks),
    // but inside this transaction — softDelete() takes no options, and this
    // unmanaged transaction is not on CLS, so it used to commit on its own.
    warehouse.isDeleted = true;
    await warehouse.save({ hooks: false, transaction });
    await auditWarehouse(transaction, actor, tenantId, "DELETE", "Warehouse", warehouse.id, {
      operation: "WAREHOUSE_DELETE",
      before: pickFields(warehouse, WAREHOUSE_FIELDS),
    });
    await transaction.commit();
    logger.info("Warehouse deleted", { warehouseId, tenantId });

    return {
      success: true,
      status: 200,
      message: "Warehouse deleted successfully",
      data: null,
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the .js guarded the transaction too (ADR-038 rule 3)
    if (transaction && !finishedOf(transaction)) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is swallowed so the original error surfaces (ADR-038 rule 3)
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error deleting warehouse", { error: messageOf(error) });
    throw error;
  }
};

// ==========================================
// STORAGE LOCATION METHODS
// ==========================================

const fetchLocations = async (tenantId: TenantId, warehouseId: string): Promise<ServiceResult<LocationRow[]>> => {
  try {
    // Verify warehouse exists for this tenant
    const warehouse = await Warehouse.findOne({
      where: { id: warehouseId, tenantId, isDeleted: false },
    });

    if (!warehouse) {
      throw new AppError(404, "Warehouse not found");
    }

    const locations = await StorageLocation.findAll({
      where: { warehouseId, tenantId },
      order: [["name", "ASC"]],
    });

    return {
      success: true,
      status: 200,
      message: "Fetch storage locations successful",
      data: locations,
    };
  } catch (error) {
    logger.error("Error fetching locations", { error: messageOf(error) });
    throw error;
  }
};

const createLocation = async (
  tenantId: TenantId,
  input: unknown,
  actor: AuditActorInput | null = null,
): Promise<ServiceResult<LocationRow>> => {
  const data = validate(input, createLocationSchema);
  const transaction = await db.transaction();

  try {
    // Verify warehouse
    const warehouse = await Warehouse.findOne({
      where: { id: data.warehouseId, tenantId, isDeleted: false },
      transaction,
    });

    if (!warehouse) {
      throw new AppError(404, "Warehouse not found");
    }

    const existing = await StorageLocation.findOne({
      where: { warehouseId: data.warehouseId, code: data.code, tenantId },
      transaction,
    });

    if (existing) {
      throw new AppError(409, "Storage location code already exists in this warehouse");
    }

    const location = await StorageLocation.create(
      {
        tenantId,
        warehouseId: data.warehouseId,
        name: data.name,
        code: data.code,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty string is stored as null too (ADR-038 rule 3)
        description: data.description || null,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition -- as built: a JavaScript caller may still pass undefined (ADR-038 rule 3)
        isActive: data.isActive !== undefined ? data.isActive : true,
      },
      { transaction },
    );

    await auditWarehouse(transaction, actor, tenantId, "CREATE", "StorageLocation", location.id, {
      operation: "LOCATION_CREATE",
      after: pickFields(location, LOCATION_FIELDS),
    });
    await transaction.commit();
    logger.info("Storage location created", { locationId: location.id, warehouseId: data.warehouseId });

    return {
      success: true,
      status: 201,
      message: "Storage location created successfully",
      data: location,
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the .js guarded the transaction too (ADR-038 rule 3)
    if (transaction && !finishedOf(transaction)) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is swallowed so the original error surfaces (ADR-038 rule 3)
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error creating location", { error: messageOf(error) });
    throw error;
  }
};

const updateLocation = async (
  tenantId: TenantId,
  locationId: string,
  input: unknown,
  actor: AuditActorInput | null = null,
): Promise<ServiceResult<LocationRow>> => {
  const data = validate(input, updateLocationSchema);
  const transaction = await db.transaction();

  try {
    const location = await StorageLocation.findOne({
      where: { id: locationId, tenantId },
      transaction,
    });

    if (!location) {
      throw new AppError(404, "Storage location not found");
    }

    if (data.code) {
      const existing = await StorageLocation.findOne({
        where: {
          warehouseId: location.warehouseId,
          code: data.code,
          id: { [Op.ne]: locationId },
          tenantId,
        },
        transaction,
      });

      if (existing) {
        throw new AppError(409, "Storage location code already exists in this warehouse");
      }
    }

    const before = pickFields(location, LOCATION_FIELDS);
    await location.update(
      {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value keeps the stored one (ADR-038 rule 3)
        name: data.name || location.name,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value keeps the stored one (ADR-038 rule 3)
        code: data.code || location.code,
        description: data.description !== undefined ? data.description : location.description,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: only undefined keeps the stored value, and a null is written (ADR-038 rule 3)
        isActive: data.isActive !== undefined ? data.isActive : location.isActive,
      },
      { transaction },
    );

    await auditWarehouse(transaction, actor, tenantId, "UPDATE", "StorageLocation", location.id, {
      operation: "LOCATION_UPDATE",
      before,
      after: pickFields(location, LOCATION_FIELDS),
    });
    await transaction.commit();
    logger.info("Storage location updated", { locationId, tenantId });

    return {
      success: true,
      status: 200,
      message: "Storage location updated successfully",
      data: location,
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the .js guarded the transaction too (ADR-038 rule 3)
    if (transaction && !finishedOf(transaction)) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is swallowed so the original error surfaces (ADR-038 rule 3)
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error updating location", { error: messageOf(error) });
    throw error;
  }
};

const deleteLocation = async (
  tenantId: TenantId,
  locationId: string,
  actor: AuditActorInput | null = null,
): Promise<ServiceResult<null>> => {
  const transaction = await db.transaction();

  try {
    const location = await StorageLocation.findOne({
      where: { id: locationId, tenantId },
      transaction,
    });

    if (!location) {
      throw new AppError(404, "Storage location not found");
    }

    // Check if location has active stocks
    const stockCount = await Stock.count({
      where: { locationId, tenantId, isDeleted: false },
      transaction,
    });

    if (stockCount > 0) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the count is interpolated as the .js did (ADR-038 rule 3)
      throw new AppError(400, `Cannot delete storage location with ${stockCount} items in stock`);
    }

    await location.destroy({ transaction });
    await auditWarehouse(transaction, actor, tenantId, "DELETE", "StorageLocation", location.id, {
      operation: "LOCATION_DELETE",
      before: pickFields(location, LOCATION_FIELDS),
    });
    await transaction.commit();
    logger.info("Storage location deleted", { locationId, tenantId });

    return {
      success: true,
      status: 200,
      message: "Storage location deleted successfully",
      data: null,
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the .js guarded the transaction too (ADR-038 rule 3)
    if (transaction && !finishedOf(transaction)) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is swallowed so the original error surfaces (ADR-038 rule 3)
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error deleting location", { error: messageOf(error) });
    throw error;
  }
};

export = {
  fetchWarehouses,
  fetchSpecificWarehouse,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
  fetchLocations,
  createLocation,
  updateLocation,
  deleteLocation,
};
