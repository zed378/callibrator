import { create } from "zustand";
import {
  deviceService,
  Device,
  DeviceCreateInput,
  DeviceUpdateInput,
} from "@/api/services/device.service";
import { PaginatedResponse } from "@/types";

interface DeviceState {
  devices: PaginatedResponse<Device> | null;
  currentDevice: Device | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchDevices: (
    page?: number,
    pageSize?: number,
    find?: string,
    status?: string,
    category?: string,
  ) => Promise<void>;
  fetchDeviceById: (id: string) => Promise<void>;
  createDevice: (data: DeviceCreateInput) => Promise<Device>;
  updateDevice: (data: DeviceUpdateInput) => Promise<Device>;
  deleteDevice: (id: string) => Promise<void>;
  setError: (error: string | null) => void;
}

export const useDeviceStore = create<DeviceState>()((set) => ({
  devices: null,
  currentDevice: null,
  isLoading: false,
  error: null,

  fetchDevices: async (page = 1, pageSize = 10, find, status, category) => {
    set({ isLoading: true, error: null });
    try {
      const devices = await deviceService.getAll(
        page,
        pageSize,
        find,
        status,
        category,
      );
      set({ devices, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch devices";
      set({ isLoading: false, error: message });
    }
  },

  fetchDeviceById: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const device = await deviceService.getById(id);
      set({ currentDevice: device, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch device";
      set({ isLoading: false, error: message });
    }
  },

  createDevice: async (data: DeviceCreateInput): Promise<Device> => {
    set({ isLoading: true, error: null });
    try {
      const device = await deviceService.create(data);
      set({ isLoading: false, error: null });
      return device;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to create device";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  updateDevice: async (data: DeviceUpdateInput): Promise<Device> => {
    set({ isLoading: true, error: null });
    try {
      const device = await deviceService.update(data);
      set({ currentDevice: device, isLoading: false, error: null });
      return device;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update device";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  deleteDevice: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await deviceService.delete(id);
      set({ isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to delete device";
      set({ isLoading: false, error: message });
    }
  },

  setError: (error) => set({ error }),
}));
