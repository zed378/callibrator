// P9-20 (ADR-087): converted from admin.controller.js with no behaviour
// change. `export =` keeps the exact object `require()` returned (the same
// keys, in the same order). The service is the module object;
// `asyncHandlerWithMapping` and `auditActor` are captured at load, as the `.js`
// destructured them. Each handler still RETURNS its envelope, which the
// wrapper sends.
import type { Request } from "express";

import adminService from "../services/admin.service";
import { asyncHandlerWithMapping as loadedAsyncHandlerWithMapping } from "../utils/controllerWrapper.util";
// Who did it, from where — for the audit rows the service writes inside its
// transaction (A-165).
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";
import type { TenantId } from "../types/ids";

const asyncHandlerWithMapping = loadedAsyncHandlerWithMapping;
const auditActor = loadedAuditActor;

/** The path parameter the route validated (`validateUuid("id")`). */
interface TenantParams extends Record<string, string> {
  id: TenantId;
}

/** The list query, as the query string carries it. */
interface TenantListQuery {
  page?: string;
  limit?: string;
  search?: string | null;
}

const getAllTenants = asyncHandlerWithMapping(async (req: Request) => {
  const { page, limit, search } = req.query as TenantListQuery;
  const result = await adminService.getAllTenants(page, limit, search);
  return {
    success: true,
    status: 200,
    message: "Tenants retrieved successfully",
    data: result,
  };
}, {});

const updateTenantStatus = asyncHandlerWithMapping(async (req: Request) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const { status } = (req.body as { status?: string } | undefined) || {};
  const result = await adminService.updateTenantStatus((req.params as TenantParams).id, status as string, auditActor(req));
  return {
    success: true,
    status: 200,
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: a missing status is interpolated as "undefined"
    message: `Tenant status updated to ${status}`,
    data: result,
  };
}, {
  "Tenant not found": 404,
  "Invalid status": 400,
});

const updateTenantFlags = asyncHandlerWithMapping(async (req: Request) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const { flags } = (req.body as { flags?: unknown } | undefined) || {};
  const result = await adminService.updateTenantFlags((req.params as TenantParams).id, flags, auditActor(req));
  return {
    success: true,
    status: 200,
    message: "Tenant flags updated successfully",
    data: result,
  };
}, {
  "Tenant not found": 404,
});

const controller = {
  getAllTenants,
  updateTenantStatus,
  updateTenantFlags,
};

export = controller;
