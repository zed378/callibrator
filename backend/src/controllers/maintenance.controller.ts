/**
 * Maintenance work orders: `/api/v1/maintenance`.
 *
 * P9-20 (ADR-087): converted from maintenance.controller.js, behaviour
 * unchanged. As the JavaScript did: the list passes `req.query` values to the
 * service RAW (no schema); the create and update bodies are what `validate()`
 * left on `req.body`; the tenant comes from `req.user`, the order id from the
 * path; `success()` answers with the service's status (and `data: null` on a
 * delete). Everything the JavaScript destructured at load is still captured at
 * load.
 */
import type { Request, Response } from "express";
import maintenanceService from "../services/maintenance.service";
import { withDisplay, withDisplays } from "../services/personDisplay.service";

/** P21-09e (spec § 12): the assignee shown beside each work order, for every viewer. */
const ORDER_PEOPLE = { assigneeDisplay: "assignedTo" } as const;
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
// A-282 (ADR-100): an API key (maintenance scopes) is audited as system:api-key.
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const auditPrincipal = loadedAuditPrincipal;

/**
 * The principal `auth` set. Destructured INLINE from `req.user`, as the
 * JavaScript did: a request without a user throws a TypeError whose message
 * names that expression ("... of 'req.user' as it is undefined"), and the
 * message reaches the client outside production, so it must not change.
 */
interface Principal {
  tenantId: unknown;
}

// `req.params` is read without a schema, as before (`validateUuid` on the
// route checks `:orderId`; the service takes it as it comes).

export const fetchWorkOrders = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  const { find, page, limit, status, type, priority, deviceId } = req.query;

  const result = await maintenanceService.fetchWorkOrders({
    tenantId,
    find,
    page,
    limit,
    status,
    type,
    priority,
    deviceId,
  });

  success(res, await withDisplays(result.data.rows, ORDER_PEOPLE), result.data.meta, result.message, result.status);
});

export const getWorkOrderById = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  const { orderId } = req.params;

  const result = await maintenanceService.getWorkOrderById(tenantId, orderId);
  // The service throws 404 for a missing order: `data` is always the row here.
  success(res, await withDisplay(result.data, ORDER_PEOPLE), null, result.message, result.status);
});

export const createWorkOrder = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  const data: unknown = req.body;

  const result = await maintenanceService.createWorkOrder(tenantId, data, auditPrincipal(req));
  success(res, result.data, null, result.message, result.status);
});

export const updateWorkOrder = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  const { orderId } = req.params;
  const data: unknown = req.body;

  const result = await maintenanceService.updateWorkOrder(tenantId, orderId, data, auditPrincipal(req));
  success(res, result.data, null, result.message, result.status);
});

export const deleteWorkOrder = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  const { orderId } = req.params;

  const result = await maintenanceService.deleteWorkOrder(tenantId, orderId, auditPrincipal(req));
  success(res, null, null, result.message, result.status);
});
