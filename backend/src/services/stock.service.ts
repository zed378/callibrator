// src/services/stock.service.ts
//
// P9-15 (ADR-087, Stage C): converted from stock.service.js with no behaviour
// change. `export =` keeps the exact object `require()` returned (the same
// keys, in the same order). `db`, the seven models, `logger`, `AppError`,
// `DEFAULT_LIMIT`, `webhookService`, `auditService`, the three audit helpers,
// `WEBHOOK_EVENTS`, the seven schemas and `validateInput` are captured once at
// load, as the `.js` destructured them. workflow.service is still `require`d
// inside createTransfer and updateTransferStatus, never at this module's load
// (it loads the role services through the dynamicAccess gate). No method calls
// a sibling. webhook.service is still JavaScript: its types come from the
// `.d.ts` beside it (declarationDrift.p912 holds it); workflow.service is
// TypeScript since P9-16.
//
// As built, not changed here: the lists answer `data: { rows, count, meta }`,
// which the controller unwraps; the search matched with a case-sensitive
// `LIKE` until A-320 (now `ILIKE`); `deleteStock` soft-deleted outside its
// transaction until A-321. The CSV export is RFC 4180 and formula-neutralised
// through utils/csv.util since A-319.
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3): `||` treats "", 0 and null as absent throughout this file */
import { Op, type Transaction, type WhereOptions, type CreationAttributes } from "sequelize";
import { db as loadedDb } from "../config";
import models from "../models";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { DEFAULT_LIMIT as LOADED_DEFAULT_LIMIT } from "../constants";
import loadedWebhookService from "./webhook.service";
import loadedAuditService from "./audit.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
  rowActor as loadedRowActor,
  type AuditActorInput,
} from "../utils/auditPrincipal.util";
import { WEBHOOK_EVENTS as LOADED_WEBHOOK_EVENTS } from "../constants/webhookEvents";
import {
  createStockSchema as loadedCreateStockSchema,
  updateStockSchema as loadedUpdateStockSchema,
  createTransferSchema as loadedCreateTransferSchema,
  updateTransferStatusSchema as loadedUpdateTransferStatusSchema,
  createAdjustmentSchema as loadedCreateAdjustmentSchema,
  createOpnameSchema as loadedCreateOpnameSchema,
  updateOpnameStatusSchema as loadedUpdateOpnameStatusSchema,
} from "../validators/stock.validator";
import { validateInput } from "../validators/input";
import { csvDocument } from "../utils/csv.util";
import type WorkflowService from "./workflow.service";
import type { AuditAction } from "../constants/auditActions";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const db = loadedDb;
const { Stock, StockTransfer, StockAdjustment, StockOpname, Warehouse, StorageLocation, User, ApiKey } = models;

/**
 * Q-51 (ADR-100 Amendment 2) — the key that wrote a row, for the lists: its
 * id, name and display prefix ONLY (never `keyHash`). LEFT JOIN
 * (`required: false`): ApiKey's defaultScope carries a `where`, so a bare
 * include would drop every user-written row. `includeDeleted`: a revoked
 * (soft-deleted) key still names the rows it wrote. The tenant hooks scope the
 * join (ADR-048). A fresh object per query: Sequelize annotates includes.
 */
const apiKeyActorInclude = (): { model: ReturnType<typeof ApiKey.scope>; as: "apiKey"; attributes: string[]; required: false } => ({
  model: ApiKey.scope("includeDeleted"),
  as: "apiKey",
  attributes: ["id", "name", "keyPrefix"],
  required: false,
});
const logger = loadedLogger;
const AppError = LoadedAppError;
const DEFAULT_LIMIT = LOADED_DEFAULT_LIMIT;
const webhookService = loadedWebhookService;
const auditService = loadedAuditService;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;
const rowActor = loadedRowActor;
const WEBHOOK_EVENTS = LOADED_WEBHOOK_EVENTS;
const createStockSchema = loadedCreateStockSchema;
const updateStockSchema = loadedUpdateStockSchema;
const createTransferSchema = loadedCreateTransferSchema;
const updateTransferStatusSchema = loadedUpdateTransferStatusSchema;
const createAdjustmentSchema = loadedCreateAdjustmentSchema;
const createOpnameSchema = loadedCreateOpnameSchema;
const updateOpnameStatusSchema = loadedUpdateOpnameStatusSchema;

// ==========================================
// VALIDATION HELPERS
// ==========================================

const validate = validateInput;

type StockRow = ModelInstance<"Stock">;
type TransferRow = ModelInstance<"StockTransfer">;
type AdjustmentRow = ModelInstance<"StockAdjustment">;
type OpnameRow = ModelInstance<"StockOpname">;

/** The service's answer; the controller forwards it. */
interface ServiceResult<T> {
  success: true;
  status: number;
  message: string;
  data: T;
}

interface ListData<Row> {
  rows: Row[];
  count: number;
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/** Sequelize's run-time `transaction.finished` ("commit" / "rollback"), which its typings omit. */
const finishedOf = (transaction: Transaction): unknown => (transaction as unknown as { finished?: unknown }).finished;

/** A caught value's `message`, read exactly as the `.js` read it (a thrown `null` still throws here). */
const messageOf = (error: unknown): unknown => (error as { message?: unknown }).message;

/** workflow.service, required when a transfer needs it (never at this module's load). */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: loaded on first use (see the file header)
const loadWorkflowService = (): typeof WorkflowService => require("./workflow.service") as typeof WorkflowService;

// ==========================================
// P6-09 — EVERY QUANTITY CHANGE IS EXPLAINED
// ==========================================
//
// A stock quantity changes in exactly four places, and each names a reason
// and an actor and writes an audit row inside its transaction:
//   - createStock with an opening quantity -> an "addition" adjustment
//   - createAdjustment                     -> the adjustment (reason required)
//   - updateTransferStatus -> "completed"  -> the transfer (its own record)
//   - (stock opname records a count; it does not change quantities)
// updateStock REFUSES a quantity change: it would bypass all of the above.

/** The reason recorded for an item created with a quantity already on hand. */
const OPENING_BALANCE_REASON = "Opening balance recorded when the stock item was created";

/**
 * Write one audit row inside `transaction` (a failed insert rolls the change
 * back; a rolled-back change takes its row with it).
 */
const audit = (
  transaction: Transaction,
  tenantId: TenantId,
  actor: AuditActorInput,
  action: AuditAction,
  resourceType: string,
  resourceId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<unknown> =>
  auditService.logAction(
    {
      tenantId,
      // A-282 (ADR-100): a key is system:api-key, its id in changes.
      ...auditEntryActor(actor),
      action,
      resourceType,
      resourceId,
      changes: { before, after, ...actorChanges(actor) },
    },
    { transaction },
  );

// ==========================================
// STOCK SERVICE METHODS
// ==========================================

/** A list query as the controller passes it (validated; a JavaScript caller may pass anything). */
// `| undefined` (P9-20): the controller passes each value as it has it, absent
// or not, as the JavaScript did. A type-only widening; nothing emitted changes.
interface StockListQuery {
  tenantId: TenantId;
  warehouseId?: string | null | undefined;
  locationId?: string | null | undefined;
  find?: string | null | undefined;
  page?: number | string | undefined;
  limit?: number | string | undefined;
}

const fetchStocks = async ({ tenantId, warehouseId, locationId, find, page = 1, limit = DEFAULT_LIMIT }: StockListQuery): Promise<ServiceResult<ListData<StockRow>>> => {
  try {
    const whereClause: Record<string | symbol, unknown> = { tenantId, isDeleted: false };

    if (warehouseId) {
      whereClause["warehouseId"] = warehouseId;
    }
    if (locationId) {
      whereClause["locationId"] = locationId;
    }

    if (find) {
      // A-320: ILIKE on the term as typed. It was lower-cased and matched with a
      // case-sensitive LIKE, so a mixed-case name was not found by its own name.
      // A leading % rules out a b-tree index either way.
      const searchTerm = `%${find}%`;
      whereClause[Op.or] = [
        { itemName: { [Op.iLike]: searchTerm } },
        { sku: { [Op.iLike]: searchTerm } },
        { serialNumber: { [Op.iLike]: searchTerm } },
      ];
    }

    const { rows, count } = await Stock.findAndCountAll({
      where: whereClause as WhereOptions,
      // Every Warehouse and User include in this file is `required: false`
      // (A-90): both models have a defaultScope `where`, which makes an
      // include without it an INNER JOIN that drops the stock row, adjustment,
      // transfer or opname when the warehouse is soft-deleted or the user is
      // deleted or outside the tenant. The relation reads as null instead.
      include: [
        { model: Warehouse, as: "warehouse", attributes: ["id", "name", "code"], required: false },
        { model: StorageLocation, as: "location", attributes: ["id", "name", "code"] },
      ],
      order: [["itemName", "ASC"]],
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
    });

    return {
      success: true,
      status: 200,
      message: "Fetch stocks successful",
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
    logger.error("Error fetching stocks", { error: messageOf(error) });
    throw error;
  }
};

const fetchSpecificStock = async (tenantId: TenantId, stockId: string): Promise<ServiceResult<StockRow>> => {
  try {
    const stock = await Stock.findOne({
      where: { id: stockId, tenantId, isDeleted: false },
      include: [
        { model: Warehouse, as: "warehouse", attributes: ["id", "name", "code"], required: false },
        { model: StorageLocation, as: "location", attributes: ["id", "name", "code"] },
      ],
    });

    if (!stock) {
      throw new AppError(404, "Stock item not found");
    }

    return {
      success: true,
      status: 200,
      message: "Fetch stock item successful",
      data: stock,
    };
  } catch (error) {
    logger.error("Error fetching specific stock", { error: messageOf(error) });
    throw error;
  }
};

/**
 * @param tenantId
 * @param input - validated by createStockSchema
 * @param actor - auditPrincipal(req): userId, apiKeyId, ipAddress, userAgent
 */
const createStock = async (tenantId: TenantId, input: unknown, actor: AuditActorInput = {}): Promise<ServiceResult<StockRow>> => {
  const data = validate(input, createStockSchema);
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

    // Verify location if provided
    if (data.locationId) {
      const location = await StorageLocation.findOne({
        where: { id: data.locationId, warehouseId: data.warehouseId, tenantId },
        transaction,
      });
      if (!location) {
        throw new AppError(404, "Storage location not found in this warehouse");
      }
    }

    // Check if stock with same SKU/serial number already exists
    if (data.sku || data.serialNumber) {
      const existingQuery: Record<string, unknown> = {
        tenantId,
        warehouseId: data.warehouseId,
        isDeleted: false,
      };
      if (data.locationId) {
        existingQuery["locationId"] = data.locationId;
      }
      if (data.sku) {
        existingQuery["sku"] = data.sku;
      }
      if (data.serialNumber) {
        existingQuery["serialNumber"] = data.serialNumber;
      }

      const existing = await Stock.findOne({
        where: existingQuery as WhereOptions,
        transaction,
      });

      if (existing) {
        throw new AppError(409, "Stock item with matching SKU or serial number already exists");
      }
    }

    const stockValues: Record<string, unknown> = {
      tenantId,
      warehouseId: data.warehouseId,
      locationId: data.locationId || null,
      itemName: data.itemName,
      sku: data.sku || null,
      serialNumber: data.serialNumber || null,
      quantity: data.quantity || 0,
      minQuantity: data.minQuantity || 0,
      description: data.description || null,
    };
    const stock = await Stock.create(stockValues as CreationAttributes<StockRow>, { transaction });
    await audit(transaction, tenantId, actor, "CREATE", "Stock", stock.id, {}, {
      itemName: stock.itemName,
      warehouseId: stock.warehouseId,
      quantity: stock.quantity,
    });

    // P6-09: stock on hand at creation is a quantity change like any other —
    // it is recorded as an adjustment, with who and why.
    if (stock.quantity > 0) {
      const opening = await StockAdjustment.create(
        {
          tenantId,
          warehouseId: stock.warehouseId,
          locationId: stock.locationId,
          stockId: stock.id,
          type: "addition",
          quantity: stock.quantity,
          quantityBefore: 0,
          quantityAfter: stock.quantity,
          reason: OPENING_BALANCE_REASON,
          // Q-51: a key is named in apiKeyId, never in the users FK.
          adjustedBy: rowActor(actor).userId as UserId | null,
          apiKeyId: rowActor(actor).apiKeyId,
        },
        { transaction },
      );
      await audit(transaction, tenantId, actor, "CREATE", "StockAdjustment", opening.id, {}, {
        stockId: stock.id,
        type: "addition",
        quantityBefore: 0,
        quantityAfter: stock.quantity,
        reason: OPENING_BALANCE_REASON,
      });
    }

    await transaction.commit();
    logger.info("Stock item created", { stockId: stock.id, tenantId });

    return {
      success: true,
      status: 201,
      message: "Stock item created successfully",
      data: stock,
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the .js guarded the transaction too (ADR-038 rule 3)
    if (transaction && !finishedOf(transaction)) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is swallowed so the original error surfaces (ADR-038 rule 3)
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error creating stock", { error: messageOf(error) });
    throw error;
  }
};

/**
 * Update an item's descriptive fields. P6-09: a `quantity` that differs from
 * the stored one is REFUSED (400) — a quantity changes through an
 * adjustment, which requires a reason. The same value is accepted and
 * ignored, so an edit form that echoes it keeps working.
 *
 * @param tenantId
 * @param stockId
 * @param input - validated by updateStockSchema
 * @param actor - auditActor(req)
 */
const updateStock = async (tenantId: TenantId, stockId: string, input: unknown, actor: AuditActorInput = {}): Promise<ServiceResult<StockRow>> => {
  const data = validate(input, updateStockSchema);
  const transaction = await db.transaction();

  try {
    const stock = await Stock.findOne({
      where: { id: stockId, tenantId, isDeleted: false },
      transaction,
    });

    if (!stock) {
      throw new AppError(404, "Stock item not found");
    }

    if (data.quantity !== undefined && data.quantity !== stock.quantity) {
      throw new AppError(
        400,
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: both quantities are interpolated as the .js did (ADR-038 rule 3)
        `The quantity of a stock item cannot be edited directly (it is ${stock.quantity}; ` +
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built (ADR-038 rule 3)
          `${data.quantity} was sent). Record an adjustment instead — POST /api/v1/stocks/adjustment ` +
          "with the type, the quantity and a reason — or a transfer or stock count, so the change " +
          "names who made it and why.",
      );
    }

    const next = {
      itemName: data.itemName || stock.itemName,
      sku: data.sku !== undefined ? data.sku : stock.sku,
      serialNumber: data.serialNumber !== undefined ? data.serialNumber : stock.serialNumber,
      minQuantity: data.minQuantity !== undefined ? data.minQuantity : stock.minQuantity,
      description: data.description !== undefined ? data.description : stock.description,
    };
    const before = Object.fromEntries(Object.keys(next).map((key) => [key, stock[key as keyof typeof next]]));
    await stock.update(next as Parameters<StockRow["update"]>[0], { transaction });
    await audit(transaction, tenantId, actor, "UPDATE", "Stock", stock.id, before, next);

    await transaction.commit();
    logger.info("Stock item updated", { stockId, tenantId });

    return {
      success: true,
      status: 200,
      message: "Stock item updated successfully",
      data: stock,
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the .js guarded the transaction too (ADR-038 rule 3)
    if (transaction && !finishedOf(transaction)) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is swallowed so the original error surfaces (ADR-038 rule 3)
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error updating stock", { error: messageOf(error) });
    throw error;
  }
};

/**
 * Soft-delete an item. A-321: the soft-delete and its audit row commit
 * together in this transaction; `stock.softDelete()` saved without it (an
 * unmanaged transaction is not on CLS), so the delete committed on its own
 * and nothing recorded it.
 *
 * @param tenantId
 * @param stockId
 * @param actor - auditPrincipal(req)
 */
const deleteStock = async (tenantId: TenantId, stockId: string, actor: AuditActorInput = {}): Promise<ServiceResult<null>> => {
  const transaction = await db.transaction();

  try {
    const stock = await Stock.findOne({
      where: { id: stockId, tenantId, isDeleted: false },
      transaction,
    });

    if (!stock) {
      throw new AppError(404, "Stock item not found");
    }

    // What Stock#softDelete does (isDeleted, save without hooks), inside this
    // transaction — softDelete() takes no options. The same fix as P6-11's
    // deleteWarehouse.
    stock.isDeleted = true;
    await stock.save({ hooks: false, transaction });
    await audit(transaction, tenantId, actor, "DELETE", "Stock", stock.id, {
      itemName: stock.itemName,
      warehouseId: stock.warehouseId,
      quantity: stock.quantity,
    }, { isDeleted: true });
    await transaction.commit();
    logger.info("Stock item deleted", { stockId, tenantId });

    return {
      success: true,
      status: 200,
      message: "Stock item deleted successfully",
      data: null,
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the .js guarded the transaction too (ADR-038 rule 3)
    if (transaction && !finishedOf(transaction)) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is swallowed so the original error surfaces (ADR-038 rule 3)
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error deleting stock", { error: messageOf(error) });
    throw error;
  }
};

// ==========================================
// STOCK ADJUSTMENT METHODS
// ==========================================

/**
 * @param tenantId
 * @param input - validated by createAdjustmentSchema (reason required)
 * @param userId - who adjusts
 * @param actor - auditActor(req)
 */
const createAdjustment = async (
  tenantId: TenantId,
  input: unknown,
  userId: UserId | null,
  actor: AuditActorInput = {},
): Promise<ServiceResult<AdjustmentRow>> => {
  const data = validate(input, createAdjustmentSchema);
  const transaction = await db.transaction();

  try {
    const stock = await Stock.findOne({
      where: { id: data.stockId, tenantId, isDeleted: false },
      transaction,
    });

    if (!stock) {
      throw new AppError(404, "Stock item not found");
    }

    let newQuantity = stock.quantity;
    /* istanbul ignore else -- createAdjustmentSchema restricts `type` to
       exactly "addition" | "subtraction" | "write_off" and validate() runs
       above, so the implicit else (quantity unchanged) is unreachable. */
    if (data.type === "addition") {
      newQuantity += data.quantity;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the .js tested both values (ADR-038 rule 3)
    } else if (data.type === "subtraction" || data.type === "write_off") {
      if (stock.quantity < data.quantity) {
        throw new AppError(400, "Insufficient stock quantity for adjustment");
      }
      newQuantity -= data.quantity;
    }

    const quantityBefore = stock.quantity;
    await stock.update({ quantity: newQuantity }, { transaction });

    // P6-09: the item, the before/after and the reason — all required.
    const adjustment = await StockAdjustment.create(
      {
        tenantId,
        warehouseId: stock.warehouseId,
        locationId: stock.locationId || null,
        stockId: stock.id,
        type: data.type,
        quantity: data.quantity,
        quantityBefore,
        quantityAfter: newQuantity,
        reason: data.reason,
        // Q-51: from the principal (auditPrincipal), never the body — a key
        // in apiKeyId with adjustedBy null, a user in adjustedBy.
        adjustedBy: rowActor(actor, userId).userId as UserId | null,
        apiKeyId: rowActor(actor, userId).apiKeyId,
      },
      { transaction },
    );
    await audit(
      transaction,
      tenantId,
      { ...actor, userId },
      "CREATE",
      "StockAdjustment",
      adjustment.id,
      { quantity: quantityBefore },
      { stockId: stock.id, type: data.type, quantity: newQuantity, reason: data.reason },
    );

    await transaction.commit();
    logger.info("Stock adjusted", { stockId: stock.id, adjustmentId: adjustment.id, tenantId });

    return {
      success: true,
      status: 201,
      message: "Stock adjusted successfully",
      data: adjustment,
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the .js guarded the transaction too (ADR-038 rule 3)
    if (transaction && !finishedOf(transaction)) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is swallowed so the original error surfaces (ADR-038 rule 3)
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error adjusting stock", { error: messageOf(error) });
    throw error;
  }
};

interface AdjustmentListQuery {
  tenantId: TenantId;
  warehouseId?: string | null | undefined;
  type?: string | null | undefined;
  page?: number | string | undefined;
  limit?: number | string | undefined;
}

const fetchAdjustments = async ({ tenantId, warehouseId, type, page = 1, limit = DEFAULT_LIMIT }: AdjustmentListQuery): Promise<ServiceResult<ListData<AdjustmentRow>>> => {
  try {
    const whereClause: Record<string, unknown> = { tenantId };
    if (warehouseId) {
      whereClause["warehouseId"] = warehouseId;
    }
    if (type) {
      whereClause["type"] = type;
    }

    const { rows, count } = await StockAdjustment.findAndCountAll({
      where: whereClause as WhereOptions,
      include: [
        { model: Warehouse, as: "warehouse", attributes: ["id", "name", "code"], required: false },
        { model: User, as: "adjuster", attributes: ["id", "username", "firstName", "lastName"], required: false },
        apiKeyActorInclude(),
      ],
      order: [["createdAt", "DESC"]],
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
    });

    return {
      success: true,
      status: 200,
      message: "Fetch adjustments successful",
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
    logger.error("Error fetching adjustments", { error: messageOf(error) });
    throw error;
  }
};

// ==========================================
// STOCK TRANSFER METHODS
// ==========================================

/**
 * @param tenantId
 * @param input - validated by createTransferSchema
 * @param userId - the requester
 * @param actor - auditActor(req)
 */
const createTransfer = async (
  tenantId: TenantId,
  input: unknown,
  userId: UserId | null,
  actor: AuditActorInput = {},
): Promise<ServiceResult<TransferRow>> => {
  const data = validate(input, createTransferSchema);
  const transaction = await db.transaction();

  try {
    if (data.fromWarehouseId === data.toWarehouseId) {
      throw new AppError(400, "Source and destination warehouses must be different");
    }

    // Verify source warehouse
    const fromWarehouse = await Warehouse.findOne({
      where: { id: data.fromWarehouseId, tenantId, isDeleted: false },
      transaction,
    });
    if (!fromWarehouse) {
      throw new AppError(404, "Source warehouse not found");
    }

    // Verify destination warehouse
    const toWarehouse = await Warehouse.findOne({
      where: { id: data.toWarehouseId, tenantId, isDeleted: false },
      transaction,
    });
    if (!toWarehouse) {
      throw new AppError(404, "Destination warehouse not found");
    }

    // Verify stock exists and quantity is sufficient in source warehouse
    const stock = await Stock.findOne({
      where: {
        warehouseId: data.fromWarehouseId,
        itemName: data.itemName,
        tenantId,
        isDeleted: false,
      },
      transaction,
    });

    if (!stock || stock.quantity < data.quantity) {
      throw new AppError(400, "Insufficient stock in source warehouse");
    }

    const transfer = await StockTransfer.create(
      {
        tenantId,
        fromWarehouseId: data.fromWarehouseId,
        toWarehouseId: data.toWarehouseId,
        itemName: data.itemName,
        quantity: data.quantity,
        notes: data.notes || null,
        // Q-51: the requesting key in apiKeyId with requestedBy null, or the user.
        requestedBy: rowActor(actor, userId).userId as UserId | null,
        apiKeyId: rowActor(actor, userId).apiKeyId,
        status: "pending",
      },
      { transaction },
    );

    // A-202 (ADR-065) — the transfer's approval workflow starts in the SAME
    // transaction, as a certificate's does (A-190). It started after the
    // commit, fail-soft: a failure there left a transfer with no workflow,
    // which any warehouse writer could then move by hand. Now a failure rolls
    // the transfer back, and the create and its audit row commit together.
    const workflowService = loadWorkflowService();
    const instance = await workflowService.startWorkflow(tenantId, "StockTransfer", transfer.id, transaction);
    await audit(transaction, tenantId, { ...actor, userId }, "CREATE", "StockTransfer", transfer.id, {}, {
      status: transfer.status,
      itemName: transfer.itemName,
      quantity: transfer.quantity,
      fromWarehouseId: transfer.fromWarehouseId,
      toWarehouseId: transfer.toWarehouseId,
      workflowInstanceId: instance ? instance.id : null,
    });

    await transaction.commit();
    logger.info("Stock transfer request created", { transferId: transfer.id, tenantId });

    return {
      success: true,
      status: 201,
      message: "Stock transfer request created successfully",
      data: transfer,
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the .js guarded the transaction too (ADR-038 rule 3)
    if (transaction && !finishedOf(transaction)) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is swallowed so the original error surfaces (ADR-038 rule 3)
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error creating transfer request", { error: messageOf(error) });
    throw error;
  }
};

/**
 * @param tenantId
 * @param transferId
 * @param input - validated by updateTransferStatusSchema
 * @param userId - who moves it on
 * @param actor - auditActor(req)
 */
const updateTransferStatus = async (
  tenantId: TenantId,
  transferId: string,
  input: unknown,
  userId: UserId | null,
  actor: AuditActorInput = {},
): Promise<ServiceResult<TransferRow>> => {
  const data = validate(input, updateTransferStatusSchema);
  const transaction = await db.transaction();

  try {
    const transfer = await StockTransfer.findOne({
      where: { id: transferId, tenantId },
      transaction,
    });

    if (!transfer) {
      throw new AppError(404, "Stock transfer not found");
    }

    if (transfer.status === "completed" || transfer.status === "cancelled") {
      throw new AppError(400, `Cannot update transfer in '${transfer.status}' status`);
    }

    // A-202 / A-203 (ADR-065) — a transfer whose approval workflow is still
    // PENDING is decided through that workflow, not moved by hand: the
    // configured chain is the control, and a manual move would leave the
    // instance pending over a transfer that had already happened.
    const pending = await loadWorkflowService().findPendingInstance(
      tenantId,
      "StockTransfer",
      transfer.id,
      transaction,
    );
    if (pending) {
      throw new AppError(
        409,
        `This stock transfer is awaiting approval in the workflow "${pending.workflow.name}" ` +
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the step number is interpolated (ADR-038 rule 3)
          `(step ${pending.currentStepOrder}). It moves when that workflow approves it ` +
          "(POST /workflows/instances/:instanceId/action), not by a status change.",
      );
    }

    if (data.status === "completed") {
      // Execute the transfer atomically
      const sourceStock = await Stock.findOne({
        where: {
          warehouseId: transfer.fromWarehouseId,
          itemName: transfer.itemName,
          tenantId,
          isDeleted: false,
        },
        transaction,
      });

      if (!sourceStock || sourceStock.quantity < transfer.quantity) {
        throw new AppError(400, "Insufficient stock in source warehouse to complete transfer");
      }

      // Deduct from source
      const sourceBefore = sourceStock.quantity;
      await sourceStock.update({ quantity: sourceBefore - transfer.quantity }, { transaction });

      // Add to destination. The where and the defaults are built in the order
      // the .js built them; the defaults omit the where's fields, which
      // findOrCreate merges in (hence the one assertion).
      const destinationWhere = {
        warehouseId: transfer.toWarehouseId,
        itemName: transfer.itemName,
        tenantId,
        isDeleted: false,
      };
      const destinationDefaults: Record<string, unknown> = {
        quantity: transfer.quantity,
        sku: sourceStock.sku,
        serialNumber: sourceStock.serialNumber,
        minQuantity: sourceStock.minQuantity,
        description: sourceStock.description,
      };
      const [destStock, created] = await Stock.findOrCreate({
        where: destinationWhere,
        defaults: destinationDefaults as CreationAttributes<StockRow>,
        transaction,
      });

      const destinationBefore = created ? 0 : destStock.quantity;
      if (!created) {
        await destStock.update({ quantity: destStock.quantity + transfer.quantity }, { transaction });
      }

      const previousStatus = transfer.status;
      await transfer.update(
        {
          status: "completed",
          approvedBy: userId,
          transferDate: new Date(),
        },
        { transaction },
      );
      // P6-09: the transfer is the reason and names the actors; the audit row
      // records both quantities it moved, from and to.
      await audit(
        transaction,
        tenantId,
        { ...actor, userId },
        "UPDATE",
        "StockTransfer",
        transfer.id,
        {
          status: previousStatus,
          sourceQuantity: sourceBefore,
          destinationQuantity: destinationBefore,
        },
        {
          status: "completed",
          sourceStockId: sourceStock.id,
          sourceQuantity: sourceBefore - transfer.quantity,
          destinationStockId: destStock.id,
          destinationQuantity: destinationBefore + transfer.quantity,
        },
      );
      // A-11: fires from afterCommit — never for a rolled-back transfer.
      webhookService.emitAfterCommit(transaction, tenantId, WEBHOOK_EVENTS.STOCK_TRANSFER_COMPLETED, {
        transferId: transfer.id, itemName: transfer.itemName, quantity: transfer.quantity, fromWarehouseId: transfer.fromWarehouseId, toWarehouseId: transfer.toWarehouseId, approvedBy: userId,
      });
    } else {
      // Transition to in_transit or cancelled
      await transfer.update(
        {
          status: data.status,
          approvedBy: data.status === "cancelled" ? userId : null,
        },
        { transaction },
      );
    }

    await transaction.commit();
    logger.info("Stock transfer status updated", { transferId, status: data.status, tenantId });

    return {
      success: true,
      status: 200,
      message: `Stock transfer status updated to ${data.status} successfully`,
      data: transfer,
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the .js guarded the transaction too (ADR-038 rule 3)
    if (transaction && !finishedOf(transaction)) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is swallowed so the original error surfaces (ADR-038 rule 3)
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error updating transfer status", { error: messageOf(error) });
    throw error;
  }
};

interface TransferListQuery {
  tenantId: TenantId;
  fromWarehouseId?: string | null | undefined;
  toWarehouseId?: string | null | undefined;
  status?: string | null | undefined;
  page?: number | string | undefined;
  limit?: number | string | undefined;
}

const fetchTransfers = async ({ tenantId, fromWarehouseId, toWarehouseId, status, page = 1, limit = DEFAULT_LIMIT }: TransferListQuery): Promise<ServiceResult<ListData<TransferRow>>> => {
  try {
    const whereClause: Record<string, unknown> = { tenantId };
    if (fromWarehouseId) {
      whereClause["fromWarehouseId"] = fromWarehouseId;
    }
    if (toWarehouseId) {
      whereClause["toWarehouseId"] = toWarehouseId;
    }
    if (status) {
      whereClause["status"] = status;
    }

    const { rows, count } = await StockTransfer.findAndCountAll({
      where: whereClause as WhereOptions,
      include: [
        { model: Warehouse, as: "fromWarehouse", attributes: ["id", "name", "code"], required: false },
        { model: Warehouse, as: "toWarehouse", attributes: ["id", "name", "code"], required: false },
        { model: User, as: "requester", attributes: ["id", "username", "firstName", "lastName"], required: false },
        { model: User, as: "approver", attributes: ["id", "username", "firstName", "lastName"], required: false },
        apiKeyActorInclude(),
      ],
      order: [["createdAt", "DESC"]],
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
    });

    return {
      success: true,
      status: 200,
      message: "Fetch transfers successful",
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
    logger.error("Error fetching transfers", { error: messageOf(error) });
    throw error;
  }
};

// ==========================================
// STOCK OPNAME METHODS
// ==========================================

/**
 * Schedule a stock count. P6-11: the opname and ONE audit row commit together
 * (it used to write no row). An opname refuses an API key at the route (Q-51),
 * so the actor is a user.
 *
 * @param tenantId
 * @param input - validated by createOpnameSchema
 * @param userId - who performs the count
 * @param actor - auditPrincipal(req): userId, ipAddress, userAgent
 */
const createOpname = async (tenantId: TenantId, input: unknown, userId: UserId, actor: AuditActorInput = {}): Promise<ServiceResult<OpnameRow>> => {
  const data = validate(input, createOpnameSchema);
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

    const opname = await StockOpname.create(
      {
        tenantId,
        warehouseId: data.warehouseId,
        status: "draft",
        scheduledAt: data.scheduledAt,
        performedBy: userId,
        notes: data.notes || null,
      },
      { transaction },
    );
    await audit(transaction, tenantId, { ...actor, userId }, "CREATE", "StockOpname", opname.id, {}, {
      warehouseId: opname.warehouseId,
      status: opname.status,
      scheduledAt: opname.scheduledAt,
    });

    await transaction.commit();
    logger.info("Stock opname scheduled", { opnameId: opname.id, tenantId });

    return {
      success: true,
      status: 201,
      message: "Stock opname scheduled successfully",
      data: opname,
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the .js guarded the transaction too (ADR-038 rule 3)
    if (transaction && !finishedOf(transaction)) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is swallowed so the original error surfaces (ADR-038 rule 3)
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error creating opname", { error: messageOf(error) });
    throw error;
  }
};

/**
 * Move a stock count through draft -> in_progress -> completed. P6-11: the
 * status change and ONE audit row (before/after) commit together.
 *
 * @param tenantId
 * @param opnameId
 * @param input - validated by updateOpnameStatusSchema
 * @param userId - who moves it
 * @param actor - auditPrincipal(req): userId, ipAddress, userAgent
 */
const updateOpnameStatus = async (
  tenantId: TenantId,
  opnameId: string,
  input: unknown,
  userId: UserId,
  actor: AuditActorInput = {},
): Promise<ServiceResult<OpnameRow>> => {
  const data = validate(input, updateOpnameStatusSchema);
  const transaction = await db.transaction();

  try {
    const opname = await StockOpname.findOne({
      where: { id: opnameId, tenantId },
      transaction,
    });

    if (!opname) {
      throw new AppError(404, "Stock opname not found");
    }

    if (opname.status === "completed") {
      throw new AppError(400, "Cannot update completed stock opname");
    }

    const before = { status: opname.status, completedAt: opname.completedAt };
    await opname.update(
      {
        status: data.status,
        completedAt: data.status === "completed" ? new Date() : null,
      },
      { transaction },
    );
    await audit(transaction, tenantId, { ...actor, userId }, "UPDATE", "StockOpname", opname.id, before, {
      status: opname.status,
      completedAt: opname.completedAt,
    });

    await transaction.commit();
    logger.info("Stock opname status updated", { opnameId, status: data.status, tenantId });

    return {
      success: true,
      status: 200,
      message: `Stock opname status updated to ${data.status} successfully`,
      data: opname,
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the .js guarded the transaction too (ADR-038 rule 3)
    if (transaction && !finishedOf(transaction)) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is swallowed so the original error surfaces (ADR-038 rule 3)
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error updating opname status", { error: messageOf(error) });
    throw error;
  }
};

interface OpnameListQuery {
  tenantId: TenantId;
  warehouseId?: string | null | undefined;
  status?: string | null | undefined;
  page?: number | string | undefined;
  limit?: number | string | undefined;
}

const fetchOpnames = async ({ tenantId, warehouseId, status, page = 1, limit = DEFAULT_LIMIT }: OpnameListQuery): Promise<ServiceResult<ListData<OpnameRow>>> => {
  try {
    const whereClause: Record<string, unknown> = { tenantId };
    if (warehouseId) {
      whereClause["warehouseId"] = warehouseId;
    }
    if (status) {
      whereClause["status"] = status;
    }

    const { rows, count } = await StockOpname.findAndCountAll({
      where: whereClause as WhereOptions,
      include: [
        { model: Warehouse, as: "warehouse", attributes: ["id", "name", "code"], required: false },
        { model: User, as: "performer", attributes: ["id", "username", "firstName", "lastName"], required: false },
      ],
      order: [["scheduledAt", "DESC"]],
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
    });

    return {
      success: true,
      status: 200,
      message: "Fetch opnames successful",
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
    logger.error("Error fetching opnames", { error: messageOf(error) });
    throw error;
  }
};

interface WarehouseBucket {
  id: string;
  name: string;
  code: string;
  itemCount: number;
  unitCount: number;
}

interface InventoryReport {
  totalItems: number;
  totalUnits: number;
  lowStockCount: number;
  warehouseDistribution: WarehouseBucket[];
}

const getInventoryReport = async (tenantId: TenantId): Promise<ServiceResult<InventoryReport>> => {
  try {
    const stocks = await Stock.findAll({
      where: { tenantId, isDeleted: false },
      include: [
        { model: Warehouse, as: "warehouse", attributes: ["id", "name", "code"], required: false },
      ],
    });

    let totalItems = 0;
    let totalUnits = 0;
    let lowStockCount = 0;
    // Keyed by warehouse id: a plain object, as built.
    const warehouseMap: Record<string, WarehouseBucket> = {};

    for (const stock of stocks) {
      totalItems += 1;
      const qty = stock.quantity || 0;
      totalUnits += qty;
      if (qty < (stock.minQuantity || 0)) {
        lowStockCount += 1;
      }

      const wh = stock.warehouse;
      if (wh) {
        // As built: the first stock of a warehouse creates its bucket.
        if (!warehouseMap[wh.id]) {
          warehouseMap[wh.id] = {
            id: wh.id,
            name: wh.name,
            code: wh.code,
            itemCount: 0,
            unitCount: 0,
          };
        }
        (warehouseMap[wh.id] as WarehouseBucket).itemCount += 1;
        (warehouseMap[wh.id] as WarehouseBucket).unitCount += qty;
      }
    }

    const warehouseDistribution = Object.values(warehouseMap);

    return {
      success: true,
      status: 200,
      message: "Get inventory report successful",
      data: {
        totalItems,
        totalUnits,
        lowStockCount,
        warehouseDistribution,
      },
    };
  } catch (error) {
    logger.error("Error generating inventory report", { error: messageOf(error) });
    throw error;
  }
};

const exportInventoryCsv = async (tenantId: TenantId): Promise<ServiceResult<string>> => {
  try {
    const stocks = await Stock.findAll({
      where: { tenantId, isDeleted: false },
      include: [
        { model: Warehouse, as: "warehouse", attributes: ["name"], required: false },
        { model: StorageLocation, as: "location", attributes: ["name"] },
      ],
      order: [["itemName", "ASC"]],
    });

    const headers = [
      "Item Name",
      "SKU",
      "Serial Number",
      "Warehouse",
      "Storage Location",
      "Quantity",
      "Min Quantity",
      "Description",
    ];

    // A-319: RFC 4180 (every field quoted, CRLF) and formula-neutralised —
    // item names, SKUs, serials and descriptions are text a tenant user typed.
    const csvString = csvDocument([
      headers,
      ...stocks.map((stock) => [
        stock.itemName,
        stock.sku,
        stock.serialNumber,
        stock.warehouse ? stock.warehouse.name : "",
        stock.location ? stock.location.name : "",
        stock.quantity,
        stock.minQuantity,
        stock.description,
      ]),
    ]);

    return {
      success: true,
      status: 200,
      message: "Export inventory CSV successful",
      data: csvString,
    };
  } catch (error) {
    logger.error("Error exporting inventory CSV", { error: messageOf(error) });
    throw error;
  }
};

export = {
  fetchStocks,
  fetchSpecificStock,
  createStock,
  updateStock,
  deleteStock,
  createAdjustment,
  fetchAdjustments,
  createTransfer,
  updateTransferStatus,
  fetchTransfers,
  createOpname,
  updateOpnameStatus,
  fetchOpnames,
  getInventoryReport,
  exportInventoryCsv,
};
