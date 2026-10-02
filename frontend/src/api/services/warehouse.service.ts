// src/api/services/warehouse.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client. Every call is typed by
// `paths` (generated from backend/src/routes/api/warehouse.openapi.ts); the
// warehouse and location types (@/types) are the contract's schemas, and the
// request bodies are the contract's, which replaced the interim `z.input` types
// (ADR-097 Am. 1). The exported names are unchanged.
import { typedApi, unwrap, type JsonBody, type Op } from "../typed";
import { Warehouse, StorageLocation, PaginatedResponse } from "@/types";

type ById = "/api/v1/warehouses/{warehouseId}";
type LocationById = "/api/v1/warehouses/locations/{locationId}";

export type WarehouseCreateInput = JsonBody<Op<"/api/v1/warehouses", "post">>;
export type WarehouseUpdateInput = JsonBody<Op<ById, "patch">>;
export type LocationCreateInput = JsonBody<Op<"/api/v1/warehouses/locations", "post">>;
export type LocationUpdateInput = JsonBody<Op<LocationById, "patch">>;

const warehouse = (warehouseId: string) => ({ params: { path: { warehouseId } } });
const location = (locationId: string) => ({ params: { path: { locationId } } });

export const warehouseService = {
  getAll: async (
    page = 1,
    limit = 25,
    search?: string
  ): Promise<PaginatedResponse<Warehouse>> => {
    const response = await typedApi
      .GET("/api/v1/warehouses", { params: { query: { page, limit, find: search } } })
      .then(unwrap);

    return {
      success: response.success,
      message: response.message,
      data: response.data,
      meta: response.meta,
    };
  },

  getById: async (warehouseId: string): Promise<Warehouse> =>
    (await typedApi.GET("/api/v1/warehouses/{warehouseId}", warehouse(warehouseId)).then(unwrap)).data,

  create: async (data: WarehouseCreateInput): Promise<Warehouse> =>
    (await typedApi.POST("/api/v1/warehouses", { body: data }).then(unwrap)).data,

  update: async (warehouseId: string, data: WarehouseUpdateInput): Promise<Warehouse> =>
    (
      await typedApi
        .PATCH("/api/v1/warehouses/{warehouseId}", { ...warehouse(warehouseId), body: data })
        .then(unwrap)
    ).data,

  delete: async (warehouseId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/warehouses/{warehouseId}", warehouse(warehouseId));
  },

  // ==========================================
  // STORAGE LOCATIONS
  // ==========================================

  getLocations: async (warehouseId: string): Promise<StorageLocation[]> =>
    (await typedApi.GET("/api/v1/warehouses/{warehouseId}/locations", warehouse(warehouseId)).then(unwrap)).data,

  createLocation: async (data: LocationCreateInput): Promise<StorageLocation> =>
    (await typedApi.POST("/api/v1/warehouses/locations", { body: data }).then(unwrap)).data,

  updateLocation: async (locationId: string, data: LocationUpdateInput): Promise<StorageLocation> =>
    (
      await typedApi
        .PATCH("/api/v1/warehouses/locations/{locationId}", { ...location(locationId), body: data })
        .then(unwrap)
    ).data,

  deleteLocation: async (locationId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/warehouses/locations/{locationId}", location(locationId));
  },
};
