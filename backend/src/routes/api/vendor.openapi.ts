/**
 * P9-25 (ADR-103) — the contract of `vendor.route.ts`, code-first: the P9-25
 * pilot. Its `@swagger` JSDoc blocks were deleted when this file was written;
 * what `/docs` shows for vendors is generated from here.
 *
 * Request bodies are the objects `validate()` enforces on each route
 * (`validators/vendor.validator.ts` re-exports them from
 * `@callibrator/contracts/vendor`). The response schema describes what
 * `vendor.service#transformVendor` answers: the model row as JSON
 * (`vendorResponse` in `@callibrator/contracts/vendor`, P9-20/21).
 * Examples are synthetic — no real supplier, person or address.
 */
import { z } from "zod";
import { createVendor, qualifyVendor, updateVendor } from "../../validators/vendor.validator";
import { VENDOR_STATUSES, VENDOR_TYPES, vendorResponse as Vendor } from "@callibrator/contracts/vendor";
import { defineRouteDocs } from "../../docs/openapi/operation";

/** `validateUuid` checks the 8-4-4-4-12 SHAPE, not an RFC version (P6-02): `z.guid()`, not `z.uuid()`. */
const params = z.object({
  vendorId: z.guid().meta({ description: "The vendor's id", example: "5f0c2a8e-7c1d-4b6a-9e2f-3d4c5b6a7e81" }),
});

/**
 * The list filters `vendor.controller#fetchVendors` reads. NOT validated by a
 * schema on the route (read raw from `req.query`); documented as the handler
 * reads them.
 */
const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional().meta({ description: "1-based page", example: 1 }),
  limit: z.coerce.number().int().min(1).optional().meta({ description: "Rows per page (capped by the server)", example: 25 }),
  find: z.string().optional().meta({ description: "Substring of the vendor name" }),
  status: z.enum(VENDOR_STATUSES).optional(),
  type: z.enum(VENDOR_TYPES).optional(),
});

const read = { kind: "dynamicAccess", resource: "vendors", action: "read" } as const;

export default defineRouteDocs({
  router: "api/vendor.route",
  mount: "/api/v1/vendors",
  tag: "Vendors",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/",
      operationId: "listVendors",
      summary: "List vendors",
      description: "The caller's tenant's vendors, newest first.",
      permission: read,
      audited: false,
      query: listQuery,
      success: { status: 200, description: "A page of vendors; pagination in the top-level `meta`", list: Vendor },
    },
    {
      method: "get",
      path: "/:vendorId",
      operationId: "getVendor",
      summary: "Get a vendor",
      permission: read,
      audited: false,
      params,
      success: { status: 200, description: "The vendor", data: Vendor },
    },
    {
      method: "post",
      path: "/",
      operationId: "createVendor",
      summary: "Create a vendor",
      description:
        "`rating` is not accepted on create (Q-37): set it with PATCH. `notes` is stored (Q-52, migration 0106), " +
        "at most 2,000 characters.",
      permission: { kind: "dynamicAccess", resource: "vendors", action: "create" },
      audited: true,
      body: createVendor,
      success: { status: 201, description: "The created vendor", data: Vendor },
    },
    {
      method: "patch",
      path: "/:vendorId",
      operationId: "updateVendor",
      summary: "Update a vendor",
      description: "`notes` is stored (Q-52, migration 0106), at most 2,000 characters.",
      permission: { kind: "dynamicAccess", resource: "vendors", action: "update" },
      audited: true,
      params,
      body: updateVendor,
      success: { status: 200, description: "The updated vendor", data: Vendor },
    },
    {
      method: "delete",
      path: "/:vendorId",
      operationId: "deleteVendor",
      summary: "Delete a vendor",
      description: "Soft delete: the row is kept (paranoid) and no longer listed.",
      permission: { kind: "dynamicAccess", resource: "vendors", action: "delete" },
      audited: true,
      params,
      success: { status: 200, description: "Deleted; `data` is null", empty: true },
    },
    {
      method: "patch",
      path: "/:vendorId/qualify",
      operationId: "qualifyVendor",
      summary: "Record a vendor's qualification",
      description: "`approvalStatus` is matched case-insensitively and stored upper-case; any other value is a 400.",
      permission: { kind: "dynamicAccess", resource: "vendors", action: "update" },
      audited: true,
      params,
      body: qualifyVendor,
      success: { status: 200, description: "The vendor with its qualification", data: Vendor },
    },
  ],
});
