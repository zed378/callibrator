import { create } from "zustand";
import { stockService } from "@/api/services/stock.service";
import { Stock, StockTransfer, StockAdjustment, StockOpname, PaginatedResponse } from "@/types";

interface StockState {
  stocks: PaginatedResponse<Stock> | null;
  transfers: PaginatedResponse<StockTransfer> | null;
  adjustments: PaginatedResponse<StockAdjustment> | null;
  opnames: PaginatedResponse<StockOpname> | null;
  currentStock: Stock | null;
  reportSummary: {
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
  } | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchReportSummary: () => Promise<void>;
  fetchStocks: (params: {
    page?: number;
    limit?: number;
    find?: string;
    warehouseId?: string;
    locationId?: string;
  }) => Promise<void>;
  fetchStockById: (id: string) => Promise<void>;
  createStock: (data: Omit<Stock, "id" | "createdAt" | "updatedAt">) => Promise<Stock>;
  updateStock: (id: string, data: Partial<Omit<Stock, "id" | "warehouseId" | "locationId" | "createdAt" | "updatedAt">>) => Promise<Stock>;
  deleteStock: (id: string) => Promise<void>;

  createAdjustment: (data: {
    stockId: string;
    type: "addition" | "subtraction" | "write_off";
    quantity: number;
    reason?: string;
  }) => Promise<StockAdjustment>;
  fetchAdjustments: (params: {
    page?: number;
    limit?: number;
    warehouseId?: string;
    type?: "addition" | "subtraction" | "write_off";
  }) => Promise<void>;

  createTransfer: (data: {
    fromWarehouseId: string;
    toWarehouseId: string;
    itemName: string;
    quantity: number;
    notes?: string;
  }) => Promise<StockTransfer>;
  updateTransferStatus: (
    transferId: string,
    status: "pending" | "in_transit" | "completed" | "cancelled"
  ) => Promise<StockTransfer>;
  fetchTransfers: (params: {
    page?: number;
    limit?: number;
    fromWarehouseId?: string;
    toWarehouseId?: string;
    status?: "pending" | "in_transit" | "completed" | "cancelled";
  }) => Promise<void>;

  createOpname: (data: {
    warehouseId: string;
    scheduledAt: string;
    notes?: string;
  }) => Promise<StockOpname>;
  updateOpnameStatus: (
    opnameId: string,
    status: "draft" | "in_progress" | "completed"
  ) => Promise<StockOpname>;
  fetchOpnames: (params: {
    page?: number;
    limit?: number;
    warehouseId?: string;
    status?: "draft" | "in_progress" | "completed";
  }) => Promise<void>;
  setError: (error: string | null) => void;
}

export const useStockStore = create<StockState>()((set) => ({
  stocks: null,
  transfers: null,
  adjustments: null,
  opnames: null,
  currentStock: null,
  reportSummary: null,
  isLoading: false,
  error: null,

  fetchReportSummary: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await stockService.getInventoryReportSummary();
      set({ reportSummary: response, isLoading: false, error: null });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch report summary";
      set({ isLoading: false, error: message });
    }
  },

  fetchStocks: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const response = await stockService.getAll(params);
      set({ stocks: response, isLoading: false, error: null });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch stocks";
      set({ isLoading: false, error: message });
    }
  },

  fetchStockById: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const stock = await stockService.getById(id);
      set({ currentStock: stock, isLoading: false, error: null });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch stock details";
      set({ isLoading: false, error: message });
    }
  },

  createStock: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const stock = await stockService.create(data);
      set({ isLoading: false, error: null });
      return stock;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create stock item";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  updateStock: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      const stock = await stockService.update(id, data);
      set({ currentStock: stock, isLoading: false, error: null });
      return stock;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update stock item";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  deleteStock: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await stockService.delete(id);
      set({ isLoading: false, error: null });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete stock item";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  createAdjustment: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const adjustment = await stockService.createAdjustment(data);
      set({ isLoading: false, error: null });
      return adjustment;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to submit stock adjustment";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  fetchAdjustments: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const response = await stockService.getAdjustments(params);
      set({ adjustments: response, isLoading: false, error: null });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch stock adjustments";
      set({ isLoading: false, error: message });
    }
  },

  createTransfer: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const transfer = await stockService.createTransfer(data);
      set({ isLoading: false, error: null });
      return transfer;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to initiate stock transfer";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  updateTransferStatus: async (transferId, status) => {
    set({ isLoading: true, error: null });
    try {
      const transfer = await stockService.updateTransferStatus(transferId, status);
      set({ isLoading: false, error: null });
      return transfer;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update transfer status";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  fetchTransfers: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const response = await stockService.getTransfers(params);
      set({ transfers: response, isLoading: false, error: null });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch transfers";
      set({ isLoading: false, error: message });
    }
  },

  createOpname: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const opname = await stockService.createOpname(data);
      set({ isLoading: false, error: null });
      return opname;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to schedule stock opname";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  updateOpnameStatus: async (opnameId, status) => {
    set({ isLoading: true, error: null });
    try {
      const opname = await stockService.updateOpnameStatus(opnameId, status);
      set({ isLoading: false, error: null });
      return opname;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update opname status";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  fetchOpnames: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const response = await stockService.getOpnames(params);
      set({ opnames: response, isLoading: false, error: null });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch stock opnames";
      set({ isLoading: false, error: message });
    }
  },

  setError: (error) => set({ error }),
}));
