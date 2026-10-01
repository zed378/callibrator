import { api } from "../client";
import { Warehouse, StorageLocation, PaginatedResponse } from "@/types";
import type {
  CreateLocationInput,
  CreateWarehouseInput,
  UpdateLocationInput,
  UpdateWarehouseInput,
} from "@callibrator/contracts/warehouse";

// P9-22 (ADR-097): request bodies are the backend validator's own schemas
// (@callibrator/contracts/warehouse). The hand-written `Omit<Warehouse, …>`
// shapes they replace offered `tenantId` (never read from a body) and a
// "suspended" status the API refuses.
export type WarehouseCreateInput = CreateWarehouseInput;
export type WarehouseUpdateInput = UpdateWarehouseInput;
export type LocationCreateInput = CreateLocationInput;
export type LocationUpdateInput = UpdateLocationInput;

// Backend response structure for warehouses
interface BackendWarehousesResponse {
  success: boolean;
  status: number;
  message: string;
  data: Warehouse[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export const warehouseService = {
  getAll: async (
    page = 1,
    limit = 25,
    search?: string
  ): Promise<PaginatedResponse<Warehouse>> => {
    const response = await api.get<BackendWarehousesResponse>(
      "/api/v1/warehouses",
      {
        params: { page, limit, find: search },
      }
    );

    return {
      success: response.success,
      message: response.message,
      data: response.data,
      meta: response.meta,
    };
  },

  getById: async (warehouseId: string): Promise<Warehouse> => {
    const response = await api.get<{ success: boolean; data: Warehouse }>(
      `/api/v1/warehouses/${warehouseId}`
    );
    return response.data;
  },

  create: async (
    data: WarehouseCreateInput
  ): Promise<Warehouse> => {
    const response = await api.post<{ success: boolean; data: Warehouse }>(
      "/api/v1/warehouses",
      data
    );
    return response.data;
  },

  update: async (
    warehouseId: string,
    data: WarehouseUpdateInput
  ): Promise<Warehouse> => {
    const response = await api.patch<{ success: boolean; data: Warehouse }>(
      `/api/v1/warehouses/${warehouseId}`,
      data
    );
    return response.data;
  },

  delete: async (warehouseId: string): Promise<void> => {
    await api.delete(`/api/v1/warehouses/${warehouseId}`);
  },

  // ==========================================
  // STORAGE LOCATIONS
  // ==========================================

  getLocations: async (warehouseId: string): Promise<StorageLocation[]> => {
    const response = await api.get<{ success: boolean; data: StorageLocation[] }>(
      `/api/v1/warehouses/${warehouseId}/locations`
    );
    return response.data;
  },

  createLocation: async (
    data: LocationCreateInput
  ): Promise<StorageLocation> => {
    const response = await api.post<{ success: boolean; data: StorageLocation }>(
      "/api/v1/warehouses/locations",
      data
    );
    return response.data;
  },

  updateLocation: async (
    locationId: string,
    data: LocationUpdateInput
  ): Promise<StorageLocation> => {
    const response = await api.patch<{ success: boolean; data: StorageLocation }>(
      `/api/v1/warehouses/locations/${locationId}`,
      data
    );
    return response.data;
  },

  deleteLocation: async (locationId: string): Promise<void> => {
    await api.delete(`/api/v1/warehouses/locations/${locationId}`);
  },
};
