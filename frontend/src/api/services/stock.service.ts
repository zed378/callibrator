import { api } from "../client";
import { Stock, StockTransfer, StockAdjustment, StockOpname, PaginatedResponse } from "@/types";

// Backend response structures
interface BackendStocksResponse {
  success: boolean;
  data: Stock[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface BackendTransfersResponse {
  success: boolean;
  data: StockTransfer[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface BackendAdjustmentsResponse {
  success: boolean;
  data: StockAdjustment[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface BackendOpnamesResponse {
  success: boolean;
  data: StockOpname[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export const stockService = {
  // ==========================================
  // STOCK CRUD
  // ==========================================
  getAll: async (params: {
    page?: number;
    limit?: number;
    find?: string;
    warehouseId?: string;
    locationId?: string;
  }): Promise<PaginatedResponse<Stock>> => {
    const response = await api.get<BackendStocksResponse>("/api/v1/stocks", {
      params,
    });
    return {
      success: response.success,
      data: response.data,
      meta: response.meta,
    };
  },

  getById: async (stockId: string): Promise<Stock> => {
    const response = await api.get<{ success: boolean; data: Stock }>(
      `/api/v1/stocks/${stockId}`
    );
    return response.data;
  },

  create: async (
    data: Omit<Stock, "id" | "createdAt" | "updatedAt">
  ): Promise<Stock> => {
    const response = await api.post<{ success: boolean; data: Stock }>(
      "/api/v1/stocks",
      data
    );
    return response.data;
  },

  update: async (
    stockId: string,
    data: Partial<Omit<Stock, "id" | "warehouseId" | "locationId" | "createdAt" | "updatedAt">>
  ): Promise<Stock> => {
    const response = await api.patch<{ success: boolean; data: Stock }>(
      `/api/v1/stocks/${stockId}`,
      data
    );
    return response.data;
  },

  delete: async (stockId: string): Promise<void> => {
    await api.delete(`/api/v1/stocks/${stockId}`);
  },

  // ==========================================
  // ADJUSTMENTS
  // ==========================================
  createAdjustment: async (data: {
    stockId: string;
    type: "addition" | "subtraction" | "write_off";
    quantity: number;
    reason?: string;
  }): Promise<StockAdjustment> => {
    const response = await api.post<{ success: boolean; data: StockAdjustment }>(
      "/api/v1/stocks/adjustment",
      data
    );
    return response.data;
  },

  getAdjustments: async (params: {
    page?: number;
    limit?: number;
    warehouseId?: string;
    type?: "addition" | "subtraction" | "write_off";
  }): Promise<PaginatedResponse<StockAdjustment>> => {
    const response = await api.get<BackendAdjustmentsResponse>(
      "/api/v1/stocks/adjustment/history",
      { params }
    );
    return {
      success: response.success,
      data: response.data,
      meta: response.meta,
    };
  },

  // ==========================================
  // TRANSFERS
  // ==========================================
  createTransfer: async (data: {
    fromWarehouseId: string;
    toWarehouseId: string;
    itemName: string;
    quantity: number;
    notes?: string;
  }): Promise<StockTransfer> => {
    const response = await api.post<{ success: boolean; data: StockTransfer }>(
      "/api/v1/stocks/transfer",
      data
    );
    return response.data;
  },

  updateTransferStatus: async (
    transferId: string,
    status: "pending" | "in_transit" | "completed" | "cancelled"
  ): Promise<StockTransfer> => {
    const response = await api.patch<{ success: boolean; data: StockTransfer }>(
      `/api/v1/stocks/transfer/${transferId}`,
      { status }
    );
    return response.data;
  },

  getTransfers: async (params: {
    page?: number;
    limit?: number;
    fromWarehouseId?: string;
    toWarehouseId?: string;
    status?: "pending" | "in_transit" | "completed" | "cancelled";
  }): Promise<PaginatedResponse<StockTransfer>> => {
    const response = await api.get<BackendTransfersResponse>(
      "/api/v1/stocks/transfer/history",
      { params }
    );
    return {
      success: response.success,
      data: response.data,
      meta: response.meta,
    };
  },

  // ==========================================
  // OPNAME
  // ==========================================
  createOpname: async (data: {
    warehouseId: string;
    scheduledAt: string;
    notes?: string;
  }): Promise<StockOpname> => {
    const response = await api.post<{ success: boolean; data: StockOpname }>(
      "/api/v1/stocks/opname",
      data
    );
    return response.data;
  },

  updateOpnameStatus: async (
    opnameId: string,
    status: "draft" | "in_progress" | "completed"
  ): Promise<StockOpname> => {
    const response = await api.patch<{ success: boolean; data: StockOpname }>(
      `/api/v1/stocks/opname/${opnameId}`,
      { status }
    );
    return response.data;
  },

  getOpnames: async (params: {
    page?: number;
    limit?: number;
    warehouseId?: string;
    status?: "draft" | "in_progress" | "completed";
  }): Promise<PaginatedResponse<StockOpname>> => {
    const response = await api.get<BackendOpnamesResponse>(
      "/api/v1/stocks/opname/history",
      { params }
    );
    return {
      success: response.success,
      data: response.data,
      meta: response.meta,
    };
  },

  getInventoryReportSummary: async (): Promise<{
    totalItems: number;
    totalUnits: number;
    lowStockCount: number;
    warehouseDistribution: Array<{
      id: string;
      name: string;
      code: string;
      itemCount: number;
      unitCount: number;
    }>;
  }> => {
    const response = await api.get<{
      success: boolean;
      data: {
        totalItems: number;
        totalUnits: number;
        lowStockCount: number;
        warehouseDistribution: Array<{
          id: string;
          name: string;
          code: string;
          itemCount: number;
          unitCount: number;
        }>;
      };
    }>("/api/v1/stocks/reports/summary");
    return response.data;
  },

  exportInventoryCsv: async (): Promise<string> => {
    return api.get<string>("/api/v1/stocks/reports/export", {
      responseType: "text",
    });
  },
};

