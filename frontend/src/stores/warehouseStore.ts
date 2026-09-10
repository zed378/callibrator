import { create } from "zustand";
import { warehouseService } from "@/api/services/warehouse.service";
import { Warehouse, StorageLocation, PaginatedResponse } from "@/types";

interface WarehouseState {
  warehouses: PaginatedResponse<Warehouse> | null;
  currentWarehouse: Warehouse | null;
  locations: StorageLocation[];
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchWarehouses: (page?: number, limit?: number, search?: string) => Promise<void>;
  fetchWarehouseById: (id: string) => Promise<void>;
  createWarehouse: (data: Omit<Warehouse, "id" | "locations" | "createdAt" | "updatedAt">) => Promise<Warehouse>;
  updateWarehouse: (id: string, data: Partial<Omit<Warehouse, "id" | "locations" | "createdAt" | "updatedAt">>) => Promise<Warehouse>;
  deleteWarehouse: (id: string) => Promise<void>;
  fetchLocations: (warehouseId: string) => Promise<void>;
  createLocation: (data: Omit<StorageLocation, "id" | "createdAt" | "updatedAt">) => Promise<StorageLocation>;
  updateLocation: (id: string, data: Partial<Omit<StorageLocation, "id" | "warehouseId" | "createdAt" | "updatedAt">>) => Promise<StorageLocation>;
  deleteLocation: (id: string, warehouseId: string) => Promise<void>;
  setError: (error: string | null) => void;
}

export const useWarehouseStore = create<WarehouseState>()((set) => ({
  warehouses: null,
  currentWarehouse: null,
  locations: [],
  isLoading: false,
  error: null,

  fetchWarehouses: async (page = 1, limit = 25, search) => {
    set({ isLoading: true, error: null });
    try {
      const response = await warehouseService.getAll(page, limit, search);
      set({ warehouses: response, isLoading: false, error: null });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch warehouses";
      set({ isLoading: false, error: message });
    }
  },

  fetchWarehouseById: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const warehouse = await warehouseService.getById(id);
      set({ currentWarehouse: warehouse, isLoading: false, error: null });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch warehouse details";
      set({ isLoading: false, error: message });
    }
  },

  createWarehouse: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const warehouse = await warehouseService.create(data);
      set({ isLoading: false, error: null });
      return warehouse;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create warehouse";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  updateWarehouse: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      const warehouse = await warehouseService.update(id, data);
      set({ currentWarehouse: warehouse, isLoading: false, error: null });
      return warehouse;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update warehouse";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  deleteWarehouse: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await warehouseService.delete(id);
      set({ isLoading: false, error: null });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete warehouse";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  fetchLocations: async (warehouseId: string) => {
    set({ isLoading: true, error: null });
    try {
      const locations = await warehouseService.getLocations(warehouseId);
      set({ locations, isLoading: false, error: null });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch storage locations";
      set({ locations: [], isLoading: false, error: message });
    }
  },

  createLocation: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const location = await warehouseService.createLocation(data);
      set((state) => ({
        locations: [...state.locations, location],
        isLoading: false,
        error: null,
      }));
      return location;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create storage location";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  updateLocation: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      const location = await warehouseService.updateLocation(id, data);
      set((state) => ({
        locations: state.locations.map((loc) => (loc.id === id ? location : loc)),
        isLoading: false,
        error: null,
      }));
      return location;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update storage location";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  deleteLocation: async (id: string, warehouseId: string) => {
    set({ isLoading: true, error: null });
    try {
      await warehouseService.deleteLocation(id);
      set((state) => ({
        locations: state.locations.filter((loc) => loc.id !== id),
        isLoading: false,
        error: null,
      }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete storage location";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  setError: (error) => set({ error }),
}));
