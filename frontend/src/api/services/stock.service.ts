// src/api/services/stock.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
// contract's (backend/src/routes/api/stock.openapi.ts →
// @callibrator/contracts/stock), which replaced the interim `z.input` types
// (ADR-097 Am. 1). The exported names are unchanged. The CSV export stays on
// `api` (text).
import { api } from "../client";
import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type QueryOf } from "../typed";
import { Stock, StockTransfer, StockAdjustment, StockOpname, PaginatedResponse } from "@/types";

type S = "/api/v1/stocks";

export type StockCreateInput = JsonBody<Op<S, "post">>;
export type StockUpdateInput = JsonBody<Op<`${S}/{stockId}`, "patch">>;
export type StockTransferStatus = JsonBody<Op<`${S}/transfer/{transferId}`, "patch">>["status"];
export type StockOpnameStatus = JsonBody<Op<`${S}/opname/{opnameId}`, "patch">>["status"];
export type CreateAdjustmentInput = JsonBody<Op<`${S}/adjustment`, "post">>;
export type CreateTransferInput = JsonBody<Op<`${S}/transfer`, "post">>;
export type CreateOpnameInput = JsonBody<Op<`${S}/opname`, "post">>;
export type InventoryReportSummary = DataOf<Op<`${S}/reports/summary`, "get">>;

export const stockService = {
  // ==========================================
  // STOCK CRUD
  // ==========================================
  getAll: async (params: QueryOf<Op<S, "get">>): Promise<PaginatedResponse<Stock>> => {
    const response = await typedApi.GET("/api/v1/stocks", { params: { query: params } }).then(unwrap);
    return {
      success: response.success,
      data: response.data,
      meta: response.meta,
    };
  },

  getById: async (stockId: string): Promise<Stock> =>
    (await typedApi.GET("/api/v1/stocks/{stockId}", { params: { path: { stockId } } }).then(unwrap)).data,

  create: async (data: StockCreateInput): Promise<Stock> =>
    (await typedApi.POST("/api/v1/stocks", { body: data }).then(unwrap)).data,

  update: async (stockId: string, data: StockUpdateInput): Promise<Stock> =>
    (await typedApi.PATCH("/api/v1/stocks/{stockId}", { params: { path: { stockId } }, body: data }).then(unwrap))
      .data,

  delete: async (stockId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/stocks/{stockId}", { params: { path: { stockId } } });
  },

  // ==========================================
  // ADJUSTMENTS
  // ==========================================
  createAdjustment: async (data: CreateAdjustmentInput): Promise<StockAdjustment> =>
    (await typedApi.POST("/api/v1/stocks/adjustment", { body: data }).then(unwrap)).data,

  getAdjustments: async (
    params: QueryOf<Op<`${S}/adjustment/history`, "get">>,
  ): Promise<PaginatedResponse<StockAdjustment>> => {
    const response = await typedApi
      .GET("/api/v1/stocks/adjustment/history", { params: { query: params } })
      .then(unwrap);
    return {
      success: response.success,
      data: response.data,
      meta: response.meta,
    };
  },

  // ==========================================
  // TRANSFERS
  // ==========================================
  createTransfer: async (data: CreateTransferInput): Promise<StockTransfer> =>
    (await typedApi.POST("/api/v1/stocks/transfer", { body: data }).then(unwrap)).data,

  updateTransferStatus: async (
    transferId: string,
    status: StockTransferStatus,
  ): Promise<StockTransfer> =>
    (
      await typedApi
        .PATCH("/api/v1/stocks/transfer/{transferId}", { params: { path: { transferId } }, body: { status } })
        .then(unwrap)
    ).data,

  getTransfers: async (
    params: QueryOf<Op<`${S}/transfer/history`, "get">>,
  ): Promise<PaginatedResponse<StockTransfer>> => {
    const response = await typedApi
      .GET("/api/v1/stocks/transfer/history", { params: { query: params } })
      .then(unwrap);
    return {
      success: response.success,
      data: response.data,
      meta: response.meta,
    };
  },

  // ==========================================
  // OPNAME
  // ==========================================
  createOpname: async (data: CreateOpnameInput): Promise<StockOpname> =>
    (await typedApi.POST("/api/v1/stocks/opname", { body: data }).then(unwrap)).data,

  updateOpnameStatus: async (
    opnameId: string,
    status: StockOpnameStatus,
  ): Promise<StockOpname> =>
    (
      await typedApi
        .PATCH("/api/v1/stocks/opname/{opnameId}", { params: { path: { opnameId } }, body: { status } })
        .then(unwrap)
    ).data,

  getOpnames: async (
    params: QueryOf<Op<`${S}/opname/history`, "get">>,
  ): Promise<PaginatedResponse<StockOpname>> => {
    const response = await typedApi
      .GET("/api/v1/stocks/opname/history", { params: { query: params } })
      .then(unwrap);
    return {
      success: response.success,
      data: response.data,
      meta: response.meta,
    };
  },

  getInventoryReportSummary: async (): Promise<InventoryReportSummary> =>
    (await typedApi.GET("/api/v1/stocks/reports/summary").then(unwrap)).data,

  exportInventoryCsv: async (): Promise<string> => {
    return api.get<string>("/api/v1/stocks/reports/export", {
      responseType: "text",
    });
  },
};
