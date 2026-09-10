import { api } from "../client";
import { PaginatedResponse } from "@/types";

export interface Device {
  id: string;
  tenantId?: string;
  name: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  category?: string;
  status: "active" | "inactive" | "maintenance" | "retired";
  locationId?: string;
  warehouse?: {
    id: string;
    name: string;
    code: string;
  };
  installationDate?: string;
  nextCalibrationDate?: string;
  calibrationIntervalDays?: number;
  remarks?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceCreateInput {
  name: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  category?: string;
  status?: "active" | "inactive" | "maintenance" | "retired";
  locationId?: string;
  installationDate?: string;
  nextCalibrationDate?: string;
  calibrationIntervalDays?: number;
  remarks?: string;
}

export interface DeviceUpdateInput extends Partial<DeviceCreateInput> {
  id: string;
}

export interface BulkImportResult {
  successCount: number;
  failedCount: number;
  totalCount: number;
  errors: Array<{ row: number; errors: string }>;
}

interface BackendDevicesResponse {
  success: boolean;
  status: number;
  message: string;
  data: {
    rows: Device[];
    count: number;
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  };
}

interface BackendDeviceResponse {
  success: boolean;
  status: number;
  message: string;
  data: Device;
}

export const deviceService = {
  getAll: async (
    page = 1,
    limit = 20,
    find?: string,
    status?: string,
    category?: string,
  ): Promise<PaginatedResponse<Device>> => {
    const response = await api.get<BackendDevicesResponse>(
      "/api/v1/calibration-devices",
      {
        params: { page, limit, find, status, category },
      },
    );

    // Defensive: guard against a plain-array `data` or missing `meta`
    // so the UI never crashes reading `meta.total`.
    const payload = response?.data as
      | BackendDevicesResponse["data"]
      | Device[]
      | null
      | undefined;
    const rows: Device[] = Array.isArray(payload)
      ? payload
      : (payload?.rows ?? []);
    // House style puts pagination in a TOP-LEVEL `meta` (sibling of `data`),
    // not `data.meta` — read that first so `total`/`totalPages` are not lost.
    const meta =
      (response as { meta?: BackendDevicesResponse["data"]["meta"] })?.meta ??
      (payload && !Array.isArray(payload) ? payload.meta : undefined);
    const total = meta?.total ?? rows.length;
    const lim = meta?.limit ?? limit;

    return {
      success: response?.success ?? true,
      message: response?.message ?? "",
      data: rows,
      meta: {
        total,
        page: meta?.page ?? page,
        limit: lim,
        totalPages: meta?.totalPages ?? Math.max(1, Math.ceil(total / lim)),
      },
    };
  },

  getById: async (id: string): Promise<Device> => {
    const response = await api.get<BackendDeviceResponse>(
      `/api/v1/calibration-devices/${id}`,
    );
    return response.data;
  },

  create: async (data: DeviceCreateInput): Promise<Device> => {
    const response = await api.post<BackendDeviceResponse>(
      "/api/v1/calibration-devices",
      data,
    );
    return response.data;
  },

  update: async (data: DeviceUpdateInput): Promise<Device> => {
    const { id, ...rest } = data;
    const response = await api.put<BackendDeviceResponse>(
      `/api/v1/calibration-devices/${id}`,
      rest,
    );
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/v1/calibration-devices/${id}`);
  },

  /**
   * Bulk-import calibration devices from a CSV file.
   * Backend route: POST /api/v1/calibration-devices/bulk-import (multipart)
   * The client interceptor strips Content-Type for FormData so the
   * browser sets the multipart boundary itself.
   */
  bulkImport: async (file: File): Promise<BulkImportResult> => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await api.post<{
      success: boolean;
      status: number;
      message: string;
      data: BulkImportResult;
    }>("/api/v1/calibration-devices/bulk-import", formData);
    return response.data;
  },
};
