/**
 * Warehouses and their storage locations: `/api/v1/warehouses`.
 *
 * P9-20 (ADR-087): converted from warehouse.controller.js, behaviour
 * unchanged. As the JavaScript did, each handler validates its own input with
 * `validateInput` (the routes mount no `validate()`), reads the tenant from
 * `req.user` and answers through `success()` with the service's status.
 * Everything the JavaScript destructured at load is still captured at load.
 */
import type { Request, Response } from "express";
import warehouseService from "../services/warehouse.service";
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import {
  getWarehousesQuery as loadedGetWarehousesQuery,
  warehouseIdSchema as loadedWarehouseIdSchema,
  locationIdSchema as loadedLocationIdSchema,
  createWarehouseSchema as loadedCreateWarehouseSchema,
  updateWarehouseSchema as loadedUpdateWarehouseSchema,
  createLocationSchema as loadedCreateLocationSchema,
  updateLocationSchema as loadedUpdateLocationSchema,
} from "../validators/warehouse.validator";
import { validateInput } from "../validators/input";
import type { TenantId } from "../types/ids";

const auditPrincipal = loadedAuditPrincipal;
const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const getWarehousesQuery = loadedGetWarehousesQuery;
const warehouseIdSchema = loadedWarehouseIdSchema;
const locationIdSchema = loadedLocationIdSchema;
const createWarehouseSchema = loadedCreateWarehouseSchema;
const updateWarehouseSchema = loadedUpdateWarehouseSchema;
const createLocationSchema = loadedCreateLocationSchema;
const updateLocationSchema = loadedUpdateLocationSchema;
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

export const getAllWarehouses = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const validated = validate(req.query, getWarehousesQuery);
  const result = await warehouseService.fetchWarehouses({
    tenantId,
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

export const getSpecificWarehouse = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const { warehouseId } = validate(req.params, warehouseIdSchema);
  const result = await warehouseService.fetchSpecificWarehouse(tenantId, warehouseId);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

export const createWarehouse = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const validated = validate(req.body, createWarehouseSchema);
  const result = await warehouseService.createWarehouse(tenantId, validated, auditPrincipal(req));

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

export const updateWarehouse = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const { warehouseId } = validate(req.params, warehouseIdSchema);
  const validated = validate(req.body, updateWarehouseSchema);
  const result = await warehouseService.updateWarehouse(tenantId, warehouseId, validated, auditPrincipal(req));

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

export const deleteWarehouse = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const { warehouseId } = validate(req.params, warehouseIdSchema);
  const result = await warehouseService.deleteWarehouse(tenantId, warehouseId, auditPrincipal(req));

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

// ==========================================
// STORAGE LOCATION HANDLERS
// ==========================================

export const getLocations = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const { warehouseId } = validate(req.params, warehouseIdSchema);
  const result = await warehouseService.fetchLocations(tenantId, warehouseId);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

export const createLocation = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const validated = validate(req.body, createLocationSchema);
  const result = await warehouseService.createLocation(tenantId, validated, auditPrincipal(req));

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

export const updateLocation = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const { locationId } = validate(req.params, locationIdSchema);
  const validated = validate(req.body, updateLocationSchema);
  const result = await warehouseService.updateLocation(tenantId, locationId, validated, auditPrincipal(req));

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

export const deleteLocation = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantOf(req);
  const { locationId } = validate(req.params, locationIdSchema);
  const result = await warehouseService.deleteLocation(tenantId, locationId, auditPrincipal(req));

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});
