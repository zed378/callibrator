/**
 * P9-25 (ADR-103) — the contract of `vendor.route.js`, code-first: the P9-25
 * pilot. Its `@swagger` JSDoc blocks were deleted when this file was written;
 * what `/docs` shows for vendors is generated from here.
 *
 * Request bodies are the objects `validate()` enforces on each route
 * (`validators/vendor.validator.ts` re-exports them from
 * `@callibrator/contracts/vendor`). The response schema describes what
 * `vendor.service.js#transformVendor` answers: the model row as JSON.
 * Examples are synthetic — no real supplier, person or address.
 */
import { z } from "zod";
import { createVendor, qualifyVendor, updateVendor } from "../../validators/vendor.validator";
import { defineRouteDocs } from "../../docs/openapi/operation";

const VENDOR_TYPES = ["CalibrationLab", "PartsSupplier", "Other"] as const;
const VENDOR_STATUSES = ["Active", "Inactive"] as const;
const APPROVAL_STATUSES = ["APPROVED", "PENDING", "REJECTED", "CONDITIONAL"] as const;

const timestamp = z.iso.datetime();

/** A vendor as the API answers it (`Vendor.toJSON()`). */
const Vendor = z
  .object({
    id: z.guid(),
    tenantId: z.guid(),
    name: z.string(),
    type: z.enum(VENDOR_TYPES),
    contactPerson: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
    /** Q-52: stored since migration 0106 (was accepted and dropped). */
    notes: z.string().nullable(),
    rating: z.number().nullable(),
    approvalStatus: z.enum(APPROVAL_STATUSES),
    scorecard: z.number().int().nullable(),
    lastAuditDate: timestamp.nullable(),
    nextAuditDate: timestamp.nullable(),
    status: z.enum(VENDOR_STATUSES),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: timestamp.nullable(),
  })
  .meta({
    id: "Vendor",
    description: "An approved-supplier record (ISO 13485 supplier file).",
    example: {
      id: "5f0c2a8e-7c1d-4b6a-9e2f-3d4c5b6a7e81",
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      name: "Example Calibration Lab",
      type: "CalibrationLab",
      contactPerson: "Quality Desk",
      email: "quality@lab.example",
      phone: "+00 000 0000",
      address: "1 Example Street",
      notes: "Accredited scope covers temperature and pressure.",
      rating: 4.5,
      approvalStatus: "APPROVED",
      scorecard: 92,
      lastAuditDate: "2026-03-01T00:00:00.000Z",
      nextAuditDate: "2027-03-01T00:00:00.000Z",
      status: "Active",
      createdAt: "2026-01-15T08:30:00.000Z",
      updatedAt: "2026-03-01T09:00:00.000Z",
      deletedAt: null,
    },
  });

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
        "`rating` is not accepted on create (Q-37): set it with PATCH. `notes` is accepted and NOT stored — " +
        "the vendors table has no such column (Q-52).",
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
      description: "`notes` is accepted and NOT stored — the vendors table has no such column (Q-52).",
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
