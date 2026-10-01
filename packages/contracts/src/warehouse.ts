/**
 * Warehouse validation schemas.
 *
 * P9-11 (ADR-093): moved to Zod. `status` is matched case-insensitively and
 * output lower-case, which is what the previous schemas' object-level custom step
 * did after the match.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/warehouse.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for C:/Program Files/Git/api/v1/warehouses (list query, id params, warehouse and storage-location create/update bodies).
 */
import { z } from "zod";
import { booleanish, caseless, nullableText, numeric, optionalText, uuid } from "./fields";

const WAREHOUSE_STATUSES = ["active", "inactive"] as const;

// ==========================================
// QUERY / PARAMS
// ==========================================

const getWarehousesQuery = z.object({
  page: numeric(z.number().int().min(1)).default(1),
  limit: numeric(z.number().int().min(1).max(100)).default(20),
  find: nullableText(),
  status: caseless(WAREHOUSE_STATUSES, "lower").or(z.literal("")).nullable().optional(),
});

const warehouseIdSchema = z.object({
  warehouseId: uuid(),
});

const locationIdSchema = z.object({
  locationId: uuid(),
});

// ==========================================
// WAREHOUSE CRUD
// ==========================================

const createWarehouseSchema = z.object({
  name: z.string().trim().min(2).max(255),
  code: z.string().trim().min(2).max(100),
  address: optionalText(500),
  description: optionalText(),
  status: caseless(WAREHOUSE_STATUSES, "lower").nullable().default("active"),
});

const updateWarehouseSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  code: z.string().trim().min(2).max(100).optional(),
  address: optionalText(500),
  description: optionalText(),
  status: caseless(WAREHOUSE_STATUSES, "lower").nullable().optional(),
});

// ==========================================
// STORAGE LOCATION CRUD
// ==========================================

const createLocationSchema = z.object({
  warehouseId: uuid(),
  name: z.string().trim().min(2).max(255),
  code: z.string().trim().min(2).max(100),
  description: optionalText(),
  isActive: booleanish().default(true),
});

const updateLocationSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  code: z.string().trim().min(2).max(100).optional(),
  description: optionalText(),
  isActive: booleanish().optional(),
});

export {
  getWarehousesQuery,
  warehouseIdSchema,
  locationIdSchema,
  createWarehouseSchema,
  updateWarehouseSchema,
  createLocationSchema,
  updateLocationSchema,
};

// ==========================================
// RESPONSES (P9-20/21, ADR-103: what the API answers, published code-first)
// ==========================================

const timestamp = z.iso.datetime();

/** A storage location as the API answers it (`StorageLocation.toJSON()`). */
const storageLocationResponse = z
  .object({
    id: z.guid(),
    tenantId: z.guid(),
    warehouseId: z.guid(),
    name: z.string(),
    code: z.string(),
    description: z.string().nullable(),
    isActive: z.boolean().nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .meta({
    id: "StorageLocation",
    description: "A place inside a warehouse where stock is kept.",
    example: {
      id: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      warehouseId: "5f0c2a8e-7c1d-4b6a-9e2f-3d4c5b6a7e81",
      name: "Shelf A",
      code: "S-A",
      description: null,
      isActive: true,
      createdAt: "2026-01-15T08:30:00.000Z",
      updatedAt: "2026-01-15T08:30:00.000Z",
    },
  });

/** The fields of a warehouse row as the API answers it (`Warehouse.toJSON()`). */
const warehouseFields = {
  id: z.guid(),
  tenantId: z.guid(),
  name: z.string(),
  code: z.string(),
  address: z.string().nullable(),
  description: z.string().nullable(),
  status: z.enum(WAREHOUSE_STATUSES).nullable(),
  isDeleted: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: timestamp.nullable(),
};

const warehouseExample = {
  id: "5f0c2a8e-7c1d-4b6a-9e2f-3d4c5b6a7e81",
  tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
  name: "Main Store",
  code: "WH-1",
  address: "1 Example Street",
  description: null,
  status: "active",
  isDeleted: false,
  createdAt: "2026-01-15T08:30:00.000Z",
  updatedAt: "2026-01-15T08:30:00.000Z",
  deletedAt: null,
};

/** A warehouse in a list, or as created or updated. */
const warehouseResponse = z
  .object(warehouseFields)
  .meta({ id: "Warehouse", description: "A tenant's warehouse.", example: warehouseExample });

/** One warehouse as `GET /warehouses/:warehouseId` answers it: with its storage locations. */
const warehouseDetailResponse = z
  .object({ ...warehouseFields, locations: z.array(storageLocationResponse) })
  .meta({
    id: "WarehouseDetail",
    description: "A warehouse with its storage locations.",
    example: { ...warehouseExample, locations: [] },
  });

export { WAREHOUSE_STATUSES, storageLocationResponse, warehouseResponse, warehouseDetailResponse };

/** A warehouse as the API answers it. */
export type WarehouseResponse = z.output<typeof warehouseResponse>;
/** A warehouse with its locations. */
export type WarehouseDetailResponse = z.output<typeof warehouseDetailResponse>;
/** A storage location as the API answers it. */
export type StorageLocationResponse = z.output<typeof storageLocationResponse>;

// The client-side (input) and handler-side (output) types of each schema.
export type GetWarehousesQueryInput = z.input<typeof getWarehousesQuery>;
export type GetWarehousesQueryBody = z.output<typeof getWarehousesQuery>;
export type WarehouseIdInput = z.input<typeof warehouseIdSchema>;
export type WarehouseIdBody = z.output<typeof warehouseIdSchema>;
export type LocationIdInput = z.input<typeof locationIdSchema>;
export type LocationIdBody = z.output<typeof locationIdSchema>;
export type CreateWarehouseInput = z.input<typeof createWarehouseSchema>;
export type CreateWarehouseBody = z.output<typeof createWarehouseSchema>;
export type UpdateWarehouseInput = z.input<typeof updateWarehouseSchema>;
export type UpdateWarehouseBody = z.output<typeof updateWarehouseSchema>;
export type CreateLocationInput = z.input<typeof createLocationSchema>;
export type CreateLocationBody = z.output<typeof createLocationSchema>;
export type UpdateLocationInput = z.input<typeof updateLocationSchema>;
export type UpdateLocationBody = z.output<typeof updateLocationSchema>;
