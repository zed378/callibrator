// src/api/services/maintenance.service.ts
import { api } from "../client";
import { PaginatedResponse } from "@/types";

export type WorkOrderType = "Preventative" | "Breakdown" | "Repair";
export type WorkOrderStatus = "Open" | "InProgress" | "Completed" | "Cancelled";
export type WorkOrderPriority = "Low" | "Medium" | "High" | "Critical";

export interface WorkOrderDevice {
  id: string;
  name: string;
  serialNumber?: string | null;
}

export interface WorkOrderVendor {
  id: string;
  name: string;
}

export interface WorkOrderAssignee {
  id: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

export interface WorkOrder {
  id: string;
  tenantId?: string;
  deviceId: string;
  title: string;
  description?: string | null;
  type: WorkOrderType;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  vendorId?: string | null;
  assignedTo?: string | null;
  resolutionNotes?: string | null;
  device?: WorkOrderDevice | null;
  vendor?: WorkOrderVendor | null;
  assignee?: WorkOrderAssignee | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkOrderCreateInput {
  deviceId: string;
  title: string;
  type: WorkOrderType;
  description?: string;
  priority?: WorkOrderPriority;
  status?: WorkOrderStatus;
  vendorId?: string;
  assigneeId?: string;
}

export interface WorkOrderUpdateInput extends Partial<WorkOrderCreateInput> {
  id: string;
  resolutionNotes?: string;
}

export interface WorkOrderListParams {
  page?: number;
  limit?: number;
  find?: string;
  status?: string;
  type?: string;
  priority?: string;
  deviceId?: string;
}

// Backend envelope: for LIST endpoints `data` is the array itself and
// `meta` sits at the TOP level of the envelope (unlike devices).
interface BackendWorkOrdersResponse {
  success: boolean;
  status: number;
  message: string;
  data: WorkOrder[] | null;
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface BackendWorkOrderResponse {
  success: boolean;
  status: number;
  message: string;
  data: WorkOrder;
}

export const maintenanceService = {
  getAll: async (
    params: WorkOrderListParams = {},
  ): Promise<PaginatedResponse<WorkOrder>> => {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const response = await api.get<BackendWorkOrdersResponse>(
      "/api/v1/maintenance",
      { params: { ...params, page, limit } },
    );

    // Defensive: `data` may be null and `meta` may be missing.
    const rows: WorkOrder[] = Array.isArray(response?.data)
      ? response.data
      : [];
    const meta = response?.meta;
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

  getById: async (orderId: string): Promise<WorkOrder> => {
    const response = await api.get<BackendWorkOrderResponse>(
      `/api/v1/maintenance/${orderId}`,
    );
    return response.data;
  },

  create: async (data: WorkOrderCreateInput): Promise<WorkOrder> => {
    const response = await api.post<BackendWorkOrderResponse>(
      "/api/v1/maintenance",
      data,
    );
    return response.data;
  },

  update: async (data: WorkOrderUpdateInput): Promise<WorkOrder> => {
    const { id, ...rest } = data;
    const response = await api.patch<BackendWorkOrderResponse>(
      `/api/v1/maintenance/${id}`,
      rest,
    );
    return response.data;
  },

  delete: async (orderId: string): Promise<void> => {
    await api.delete(`/api/v1/maintenance/${orderId}`);
  },
};
