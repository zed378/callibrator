import { api } from "../client";
import { Warehouse, StorageLocation, PaginatedResponse } from "@/types";

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
    data: Omit<Warehouse, "id" | "locations" | "createdAt" | "updatedAt">
  ): Promise<Warehouse> => {
    const response = await api.post<{ success: boolean; data: Warehouse }>(
      "/api/v1/warehouses",
      data
    );
    return response.data;
  },

  update: async (
    warehouseId: string,
    data: Partial<Omit<Warehouse, "id" | "locations" | "createdAt" | "updatedAt">>
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
    data: Omit<StorageLocation, "id" | "createdAt" | "updatedAt">
  ): Promise<StorageLocation> => {
    const response = await api.post<{ success: boolean; data: StorageLocation }>(
      "/api/v1/warehouses/locations",
      data
    );
    return response.data;
  },

  updateLocation: async (
    locationId: string,
    data: Partial<Omit<StorageLocation, "id" | "warehouseId" | "createdAt" | "updatedAt">>
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
