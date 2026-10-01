/**
 * Stock, adjustments, transfers, opnames and the inventory report:
 * `/api/v1/stocks`.
 *
 * P9-20 (ADR-087): converted from stock.controller.js, behaviour unchanged. As
 * the JavaScript did, each handler validates its own input with
 * `validateInput` (the routes mount no `validate()`); the three history lists
 * pass their query values to the service RAW, as before; the tenant and the
 * acting user come from `req.user`; `success()` answers with the service's
 * status. Everything the JavaScript destructured at load is still captured at
 * load.
 */
import type { Request, Response } from "express";
import stockService from "../services/stock.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
// P6-09: who, from where — for the audit rows the service writes in its transaction.
// A-282 (ADR-100): an API key (warehouse scopes) is audited as system:api-key.
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import { success as loadedSuccess } from "../utils/response.util";
import {
  getStocksQuery as loadedGetStocksQuery,
  stockIdSchema as loadedStockIdSchema,
  createStockSchema as loadedCreateStockSchema,
  updateStockSchema as loadedUpdateStockSchema,
  createTransferSchema as loadedCreateTransferSchema,
  updateTransferStatusSchema as loadedUpdateTransferStatusSchema,
  createAdjustmentSchema as loadedCreateAdjustmentSchema,
  createOpnameSchema as loadedCreateOpnameSchema,
  updateOpnameStatusSchema as loadedUpdateOpnameStatusSchema,
} from "../validators/stock.validator";
import { validateInput } from "../validators/input";
import type { TenantId, UserId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const auditPrincipal = loadedAuditPrincipal;
const success = loadedSuccess;
const getStocksQuery = loadedGetStocksQuery;
const stockIdSchema = loadedStockIdSchema;
const createStockSchema = loadedCreateStockSchema;
const updateStockSchema = loadedUpdateStockSchema;
const createTransferSchema = loadedCreateTransferSchema;
const updateTransferStatusSchema = loadedUpdateTransferStatusSchema;
const createAdjustmentSchema = loadedCreateAdjustmentSchema;
const createOpnameSchema = loadedCreateOpnameSchema;
const updateOpnameStatusSchema = loadedUpdateOpnameStatusSchema;
const validate = validateInput;

/**
 * The caller's tenant, read as the JavaScript read it: `req.user.tenantId`,
 * with no guard, so a request without a user throws inside asyncHandler (a
 * 500) exactly as before. `auth` runs first on every route here.
 *
 * @param req - the request
 * @returns the tenant id `auth` put on the principal
 */
const tenantOf = (req: Request): TenantId => (req.user as { tenantId: TenantId }).tenantId;

/**
 * The acting user's id, read as `req.user.id` was (no guard; see tenantOf).
 * An API key principal carries its key id here, as it always did.
 *
 * @param req - the request
 * @returns the id `auth` put on the principal
 */
const userOf = (req: Request): UserId => (req.user as { id: UserId }).id;

/**
 * The path parameters the two status routes read WITHOUT a schema, as the
 * JavaScript did (`validateUuid` on the route has already checked the shape).
 *
 * @param req - the request
 * @returns `req.params`
 */
const routeParams = (req: Request): { transferId: string; opnameId: string } =>
  req.params as { transferId: string; opnameId: string };

/**
 * The query of the three history lists, passed to the service RAW, as the
 * JavaScript passed it: no schema, so a repeated key arrives as an array
 * exactly as before. Typed as the service reads it.
 *
 * @param req - the request
 * @returns `req.query`
 */
const rawQuery = (
  req: Request,
): {
  warehouseId?: string | undefined;
  fromWarehouseId?: string | undefined;
  toWarehouseId?: string | undefined;
  type?: string | undefined;
  status?: string | undefined;
  page?: string | undefined;
  limit?: string | undefined;
} => req.query;

export const getAllStocks = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const validated = validate(req.query, getStocksQuery);
  const result = await stockService.fetchStocks({
    tenantId,
    warehouseId: validated.warehouseId,
    locationId: validated.locationId,
    find: validated.find,
    page: validated.page,
    limit: validated.limit,
  });

  success(
    res,
    result.data.rows,
    result.data.meta,
    result.message,
    result.status,
  );
});

export const getSpecificStock = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const { stockId } = validate(req.params, stockIdSchema);
  const result = await stockService.fetchSpecificStock(tenantId, stockId);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

export const createStock = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const validated = validate(req.body, createStockSchema);
  const result = await stockService.createStock(tenantId, validated, auditPrincipal(req));

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

export const updateStock = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const { stockId } = validate(req.params, stockIdSchema);
  const validated = validate(req.body, updateStockSchema);
  const result = await stockService.updateStock(tenantId, stockId, validated, auditPrincipal(req));

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

export const deleteStock = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const { stockId } = validate(req.params, stockIdSchema);
  // A-321: the soft-delete writes its audit row, so it needs the principal.
  const result = await stockService.deleteStock(tenantId, stockId, auditPrincipal(req));

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

// ==========================================
// ADJUSTMENT HANDLERS
// ==========================================

export const createAdjustment = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const userId = userOf(req);
  const validated = validate(req.body, createAdjustmentSchema);
  const result = await stockService.createAdjustment(tenantId, validated, userId, auditPrincipal(req));

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

export const getAdjustments = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const result = await stockService.fetchAdjustments({
    tenantId,
    warehouseId: rawQuery(req).warehouseId,
    type: rawQuery(req).type,
    page: rawQuery(req).page,
    limit: rawQuery(req).limit,
  });

  success(
    res,
    result.data.rows,
    result.data.meta,
    result.message,
    result.status,
  );
});

// ==========================================
// TRANSFER HANDLERS
// ==========================================

export const createTransfer = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const userId = userOf(req);
  const validated = validate(req.body, createTransferSchema);
  const result = await stockService.createTransfer(tenantId, validated, userId, auditPrincipal(req));

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

export const updateTransferStatus = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const userId = userOf(req);
  const { transferId } = routeParams(req);
  const validated = validate(req.body, updateTransferStatusSchema);
  const result = await stockService.updateTransferStatus(tenantId, transferId, validated, userId, auditPrincipal(req));

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

export const getTransfers = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const result = await stockService.fetchTransfers({
    tenantId,
    fromWarehouseId: rawQuery(req).fromWarehouseId,
    toWarehouseId: rawQuery(req).toWarehouseId,
    status: rawQuery(req).status,
    page: rawQuery(req).page,
    limit: rawQuery(req).limit,
  });

  success(
    res,
    result.data.rows,
    result.data.meta,
    result.message,
    result.status,
  );
});

// ==========================================
// OPNAME HANDLERS
// ==========================================

export const createOpname = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const userId = userOf(req);
  const validated = validate(req.body, createOpnameSchema);
  // P6-11: the opname writes its audit row, so it needs the principal.
  const result = await stockService.createOpname(tenantId, validated, userId, auditPrincipal(req));

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

export const updateOpnameStatus = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const userId = userOf(req);
  const { opnameId } = routeParams(req);
  const validated = validate(req.body, updateOpnameStatusSchema);
  const result = await stockService.updateOpnameStatus(tenantId, opnameId, validated, userId, auditPrincipal(req));

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

export const getOpnames = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const result = await stockService.fetchOpnames({
    tenantId,
    warehouseId: rawQuery(req).warehouseId,
    status: rawQuery(req).status,
    page: rawQuery(req).page,
    limit: rawQuery(req).limit,
  });

  success(
    res,
    result.data.rows,
    result.data.meta,
    result.message,
    result.status,
  );
});

export const getInventoryReport = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const result = await stockService.getInventoryReport(tenantId);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

export const exportInventoryCsv = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const result = await stockService.exportInventoryCsv(tenantId);

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=inventory_report.csv");
  res.status(result.status).send(result.data);
});
