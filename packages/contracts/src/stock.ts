/**
 * Stock validation schemas.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/stock.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for /api/v1/stocks (list query, id params, stock, adjustment, opname and transfer bodies).
 */
import { z } from "zod";
import { isoDate, nullableText, numeric, optionalText, uuid } from "./fields";
import { STOCK_OPNAME_STATUSES, STOCK_TRANSFER_STATUSES } from "./states";

// ==========================================
// GET STOCKS QUERY
// ==========================================

const getStocksQuery = z.object({
  page: numeric(z.number().int().min(1)).default(1),
  limit: numeric(z.number().int().min(1).max(100)).default(20),
  find: nullableText(),
  warehouseId: uuid().or(z.literal("")).nullable().optional(),
  locationId: uuid().or(z.literal("")).nullable().optional(),
});

const stockIdSchema = z.object({
  stockId: uuid(),
});

// ==========================================
// STOCK CRUD
// ==========================================

const count = numeric(z.number().int().min(0));

const createStockSchema = z.object({
  warehouseId: uuid(),
  locationId: uuid().or(z.literal("")).nullable().optional(),
  itemName: z.string().trim().min(2).max(255),
  sku: optionalText(100),
  serialNumber: optionalText(100),
  quantity: count.default(0),
  minQuantity: count.default(0),
  description: optionalText(),
});

// P6-09: `quantity` is accepted here ONLY so an edit form that echoes the
// current value keeps working; stock.service refuses any value that differs
// from the stored one and points at the adjustment endpoint. A quantity
// changes through an adjustment, a transfer or an opname — each names a
// reason and an actor.
const updateStockSchema = z.object({
  itemName: z.string().trim().min(2).max(255).optional(),
  sku: optionalText(100),
  serialNumber: optionalText(100),
  quantity: count.optional(),
  minQuantity: count.optional(),
  description: optionalText(),
});

// ==========================================
// STOCK TRANSFER
// ==========================================

const createTransferSchema = z.object({
  fromWarehouseId: uuid(),
  toWarehouseId: uuid(),
  itemName: z.string().trim().min(2).max(255),
  quantity: numeric(z.number().int().min(1)),
  notes: optionalText(),
});

const updateTransferStatusSchema = z.object({
  status: z.enum(STOCK_TRANSFER_STATUSES),
});

// ==========================================
// STOCK ADJUSTMENT
// ==========================================

const createAdjustmentSchema = z.object({
  stockId: uuid(),
  type: z.enum(["addition", "subtraction", "write_off"]),
  quantity: numeric(z.number().int().min(1)),
  // P6-09: required and never blank — trim runs before the length check, so
  // "   " is refused rather than stored as a reason that says nothing.
  reason: z.string().trim().min(3).max(255),
});

// ==========================================
// STOCK OPNAME
// ==========================================

const createOpnameSchema = z.object({
  warehouseId: uuid(),
  scheduledAt: isoDate(),
  notes: optionalText(),
});

const updateOpnameStatusSchema = z.object({
  status: z.enum(STOCK_OPNAME_STATUSES),
});

export {
  getStocksQuery,
  stockIdSchema,
  createStockSchema,
  updateStockSchema,
  createTransferSchema,
  updateTransferStatusSchema,
  createAdjustmentSchema,
  createOpnameSchema,
  updateOpnameStatusSchema,
};

// ==========================================
// RESPONSES (P9-20/21, ADR-103: what the API answers, published code-first)
// ==========================================
// The rows stock.service returns, as JSON. A list/detail row carries the
// associations its query includes (LEFT joins: an absent one is null); a row
// just created or updated carries none of them.

const timestamp = z.iso.datetime();
const id = z.guid();
const ADJUSTMENT_TYPES = ["addition", "subtraction", "write_off"] as const;
// P9-05: the one list of each is `states.ts`.
const TRANSFER_STATUSES = STOCK_TRANSFER_STATUSES;
const OPNAME_STATUSES = STOCK_OPNAME_STATUSES;

/** `{ id, name, code }` of an included warehouse or storage location. */
const placeRef = z.object({ id, name: z.string(), code: z.string() }).nullable();
/** `{ id, username, firstName, lastName }` of an included user. */
const userRef = z
  .object({ id, username: z.string(), firstName: z.string(), lastName: z.string() })
  .nullable();
/** Q-51: the API key that acted, when no user did — id, name and display prefix only. */
const apiKeyRef = z.object({ id, name: z.string(), keyPrefix: z.string() }).nullable();

const stockFields = {
  id,
  tenantId: id,
  warehouseId: id,
  locationId: id.nullable(),
  itemName: z.string(),
  sku: z.string().nullable(),
  serialNumber: z.string().nullable(),
  quantity: z.number().int(),
  minQuantity: z.number().int(),
  description: z.string().nullable(),
  isDeleted: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: timestamp.nullable(),
};
const stockExample = {
  id: "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
  warehouseId: "5f0c2a8e-7c1d-4b6a-9e2f-3d4c5b6a7e81",
  locationId: null,
  itemName: "Infusion pump spare battery",
  sku: "BAT-100",
  serialNumber: null,
  quantity: 12,
  minQuantity: 4,
  description: null,
  isDeleted: false,
  createdAt: "2026-01-15T08:30:00.000Z",
  updatedAt: "2026-01-15T08:30:00.000Z",
  deletedAt: null,
};

/** A stock item as created or updated. */
const stockResponse = z.object(stockFields).meta({ id: "Stock", description: "A stocked item in a warehouse.", example: stockExample });

/** A stock item as listed or fetched: with its warehouse and location. */
const stockDetailResponse = z
  .object({ ...stockFields, warehouse: placeRef, location: placeRef })
  .meta({
    id: "StockDetail",
    description: "A stocked item with its warehouse and storage location (`{ id, name, code }`, or null).",
    example: { ...stockExample, warehouse: { id: stockExample.warehouseId, name: "Main Store", code: "WH-1" }, location: null },
  });

const adjustmentFields = {
  id,
  tenantId: id,
  warehouseId: id,
  locationId: id.nullable(),
  type: z.enum(ADJUSTMENT_TYPES),
  quantity: z.number().int(),
  reason: z.string(),
  stockId: id.nullable(),
  quantityBefore: z.number().int().nullable(),
  quantityAfter: z.number().int().nullable(),
  adjustedBy: id.nullable().meta({ description: "Null when an API key adjusted; then `apiKeyId` names it (Q-51)" }),
  apiKeyId: id.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
};

/** An adjustment as recorded. */
const stockAdjustmentResponse = z.object(adjustmentFields).meta({ id: "StockAdjustment", description: "A recorded change to a stock quantity, with its reason." });

/** An adjustment in the history: with its warehouse, the adjusting user and (Q-51) the API key. */
const stockAdjustmentListItem = z
  .object({ ...adjustmentFields, warehouse: placeRef, adjuster: userRef, apiKey: apiKeyRef })
  .meta({ id: "StockAdjustmentListItem" });

const transferFields = {
  id,
  tenantId: id,
  fromWarehouseId: id,
  toWarehouseId: id,
  status: z.enum(TRANSFER_STATUSES).nullable(),
  requestedBy: id.nullable().meta({ description: "Null when an API key requested; then `apiKeyId` names it (Q-51)" }),
  apiKeyId: id.nullable(),
  approvedBy: id.nullable(),
  itemName: z.string(),
  quantity: z.number().int(),
  transferDate: timestamp.nullable(),
  notes: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
};

/** A transfer as requested or updated. */
const stockTransferResponse = z.object(transferFields).meta({ id: "StockTransfer", description: "Stock moving between two of the tenant's warehouses." });

/**
 * A transfer in the history: with both warehouses, the requester and the
 * approver, and the API key that requested it (Q-51; P9-25 item 11 — the
 * history joins it as the adjustments' does, stock.service#fetchTransfers).
 */
const stockTransferListItem = z
  .object({ ...transferFields, fromWarehouse: placeRef, toWarehouse: placeRef, requester: userRef, approver: userRef, apiKey: apiKeyRef })
  .meta({ id: "StockTransferListItem" });

const opnameFields = {
  id,
  tenantId: id,
  warehouseId: id,
  status: z.enum(OPNAME_STATUSES).nullable(),
  scheduledAt: timestamp,
  completedAt: timestamp.nullable(),
  performedBy: id,
  notes: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
};

/** An opname (stock count) as scheduled or updated. */
const stockOpnameResponse = z.object(opnameFields).meta({ id: "StockOpname", description: "A scheduled stock count of a warehouse." });

/** An opname in the history: with its warehouse and the person who counts. */
const stockOpnameListItem = z
  .object({ ...opnameFields, warehouse: placeRef, performer: userRef })
  .meta({ id: "StockOpnameListItem" });

/** GET /stocks/reports/summary. */
const inventoryReportResponse = z
  .object({
    totalItems: z.number().int(),
    totalUnits: z.number().int(),
    lowStockCount: z.number().int().meta({ description: "Items below their minQuantity" }),
    warehouseDistribution: z.array(
      z.object({ id, name: z.string(), code: z.string(), itemCount: z.number().int(), unitCount: z.number().int() }),
    ),
  })
  .meta({ id: "InventoryReport", description: "Totals across the tenant's stock, and per warehouse." });

export {
  stockResponse,
  stockDetailResponse,
  stockAdjustmentResponse,
  stockAdjustmentListItem,
  stockTransferResponse,
  stockTransferListItem,
  stockOpnameResponse,
  stockOpnameListItem,
  inventoryReportResponse,
};

// The client-side (input) and handler-side (output) types of each schema.
export type GetStocksQueryInput = z.input<typeof getStocksQuery>;
export type GetStocksQueryBody = z.output<typeof getStocksQuery>;
export type StockIdInput = z.input<typeof stockIdSchema>;
export type StockIdBody = z.output<typeof stockIdSchema>;
export type CreateStockInput = z.input<typeof createStockSchema>;
export type CreateStockBody = z.output<typeof createStockSchema>;
export type UpdateStockInput = z.input<typeof updateStockSchema>;
export type UpdateStockBody = z.output<typeof updateStockSchema>;
export type CreateTransferInput = z.input<typeof createTransferSchema>;
export type CreateTransferBody = z.output<typeof createTransferSchema>;
export type UpdateTransferStatusInput = z.input<typeof updateTransferStatusSchema>;
export type UpdateTransferStatusBody = z.output<typeof updateTransferStatusSchema>;
export type CreateAdjustmentInput = z.input<typeof createAdjustmentSchema>;
export type CreateAdjustmentBody = z.output<typeof createAdjustmentSchema>;
export type CreateOpnameInput = z.input<typeof createOpnameSchema>;
export type CreateOpnameBody = z.output<typeof createOpnameSchema>;
export type UpdateOpnameStatusInput = z.input<typeof updateOpnameStatusSchema>;
export type UpdateOpnameStatusBody = z.output<typeof updateOpnameStatusSchema>;
