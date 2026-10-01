/**
 * P9-21 / P9-25 (ADR-103) — the contract of `warehouse.route.ts`, code-first.
 *
 * Request schemas are the objects the handlers enforce: warehouse.controller
 * runs `validateInput(req.query | req.params | req.body, <schema>)` on each
 * route (the chain mounts no `validate()`), all from
 * `@callibrator/contracts/warehouse` via `validators/warehouse.validator`.
 * Response schemas are that contract's `warehouseResponse`,
 * `warehouseDetailResponse` and `storageLocationResponse`: the model rows as
 * JSON (warehouse.service returns the instances). Examples are synthetic.
 */
import { z } from "zod";
import {
  createLocationSchema,
  createWarehouseSchema,
  getWarehousesQuery,
  updateLocationSchema,
  updateWarehouseSchema,
} from "../../validators/warehouse.validator";
import {
  storageLocationResponse,
  warehouseDetailResponse,
  warehouseResponse,
} from "@callibrator/contracts/warehouse";
import { defineRouteDocs } from "../../docs/openapi/operation";

/**
 * Path parameters, as `validateUuid` checks them (the 8-4-4-4-12 SHAPE, not an
 * RFC version: `z.guid()`), with the synthetic example Spectral requires.
 */
const warehouseIdSchema = z.object({
  warehouseId: z.guid().meta({ description: "The warehouse's id", example: "5f0c2a8e-7c1d-4b6a-9e2f-3d4c5b6a7e81" }),
});
const locationIdSchema = z.object({
  locationId: z.guid().meta({ description: "The storage location's id", example: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" }),
});

const read = { kind: "dynamicAccess", resource: "warehouse", action: "read" } as const;
const write = { kind: "dynamicAccess", resource: "warehouse", action: "write" } as const;

export default defineRouteDocs({
  router: "api/warehouse.route",
  mount: "/api/v1/warehouses",
  tag: "Warehouses",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/",
      operationId: "listWarehouses",
      summary: "List warehouses",
      description: "The caller's tenant's warehouses, by name. `find` matches the name or the code (case-insensitive).",
      permission: read,
      audited: false,
      query: getWarehousesQuery,
      success: { status: 200, description: "A page of warehouses; pagination in the top-level `meta`", list: warehouseResponse },
    },
    {
      method: "get",
      path: "/:warehouseId",
      operationId: "getWarehouse",
      summary: "Get a warehouse",
      description: "The warehouse with its storage locations.",
      permission: read,
      audited: false,
      params: warehouseIdSchema,
      success: { status: 200, description: "The warehouse and its locations", data: warehouseDetailResponse },
    },
    {
      method: "post",
      path: "/",
      operationId: "createWarehouse",
      summary: "Create a warehouse",
      description: "`code` is unique among the tenant's warehouses that are not deleted.",
      permission: write,
      audited: true,
      body: createWarehouseSchema,
      success: { status: 201, description: "The created warehouse", data: warehouseResponse },
    },
    {
      method: "patch",
      path: "/:warehouseId",
      operationId: "updateWarehouse",
      summary: "Update a warehouse",
      permission: write,
      audited: true,
      params: warehouseIdSchema,
      body: updateWarehouseSchema,
      success: { status: 200, description: "The updated warehouse", data: warehouseResponse },
    },
    {
      method: "delete",
      path: "/:warehouseId",
      operationId: "deleteWarehouse",
      summary: "Delete a warehouse",
      description:
        "Soft delete (`isDeleted`). A warehouse that still holds stock is refused with **400** " +
        "(\"Cannot delete warehouse with N items in stock\").",
      permission: write,
      audited: true,
      params: warehouseIdSchema,
      success: { status: 200, description: "Deleted; `data` is null", empty: true },
    },
    {
      method: "get",
      path: "/:warehouseId/locations",
      operationId: "listStorageLocations",
      summary: "List a warehouse's storage locations",
      description: "Every location in the warehouse, by name. Not paginated.",
      permission: read,
      audited: false,
      params: warehouseIdSchema,
      success: { status: 200, description: "The warehouse's locations (an array in `data`)", data: storageLocationResponse.array() },
    },
    {
      method: "post",
      path: "/locations",
      operationId: "createStorageLocation",
      summary: "Create a storage location",
      description: "The warehouse is named in the body and must be the caller's.",
      permission: write,
      audited: true,
      body: createLocationSchema,
      success: { status: 201, description: "The created location", data: storageLocationResponse },
    },
    {
      method: "patch",
      path: "/locations/:locationId",
      operationId: "updateStorageLocation",
      summary: "Update a storage location",
      permission: write,
      audited: true,
      params: locationIdSchema,
      body: updateLocationSchema,
      success: { status: 200, description: "The updated location", data: storageLocationResponse },
    },
    {
      method: "delete",
      path: "/locations/:locationId",
      operationId: "deleteStorageLocation",
      summary: "Delete a storage location",
      description:
        "The row is removed. A location that still holds stock is refused with **400** " +
        "(\"Cannot delete storage location with N items in stock\").",
      permission: write,
      audited: true,
      params: locationIdSchema,
      success: { status: 200, description: "Deleted; `data` is null", empty: true },
    },
  ],
});
