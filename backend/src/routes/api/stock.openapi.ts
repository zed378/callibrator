/**
 * P9-21 / P9-25 (ADR-103) — the contract of `stock.route.ts`, code-first.
 *
 * Request schemas are the objects the handlers enforce: stock.controller runs
 * `validateInput(req.query | req.params | req.body, <schema>)` (the chain mounts
 * no `validate()`), all from `@callibrator/contracts/stock` via
 * `validators/stock.validator`. The three history lists read their filters RAW
 * from `req.query` (no schema); those are documented as the handler reads them.
 * Response schemas are the contract's: the rows stock.service returns, as JSON.
 * Examples are synthetic.
 */
import { z } from "zod";
import {
  createAdjustmentSchema,
  createOpnameSchema,
  createStockSchema,
  createTransferSchema,
  getStocksQuery,
  updateOpnameStatusSchema,
  updateStockSchema,
  updateTransferStatusSchema,
} from "../../validators/stock.validator";
import {
  inventoryReportResponse,
  stockAdjustmentListItem,
  stockAdjustmentResponse,
  stockDetailResponse,
  stockOpnameListItem,
  stockOpnameResponse,
  stockResponse,
  stockTransferListItem,
  stockTransferResponse,
} from "@callibrator/contracts/stock";
import { defineRouteDocs } from "../../docs/openapi/operation";
import { STOCK_OPNAME_STATUSES, STOCK_TRANSFER_STATUSES } from "@callibrator/contracts/states";

const idOf = (what: string, example: string): z.ZodGUID => z.guid().meta({ description: `The ${what}'s id`, example });

/** Path parameters, as `validateUuid` checks them (the SHAPE: `z.guid()`), with synthetic examples. */
const stockIdParams = z.object({ stockId: idOf("stock item", "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d") });
const transferIdParams = z.object({ transferId: idOf("transfer", "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e") });
const opnameIdParams = z.object({ opnameId: idOf("opname", "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a") });

/** The paging every history list reads raw (the service applies its defaults). */
const paging = {
  page: z.coerce.number().int().min(1).optional().meta({ description: "1-based page", example: 1 }),
  limit: z.coerce.number().int().min(1).optional().meta({ description: "Rows per page (the service's default applies)", example: 25 }),
};
const adjustmentHistoryQuery = z.object({
  warehouseId: z.guid().optional(),
  type: z.enum(["addition", "subtraction", "write_off"]).optional(),
  ...paging,
});
const transferHistoryQuery = z.object({
  fromWarehouseId: z.guid().optional(),
  toWarehouseId: z.guid().optional(),
  status: z.enum(STOCK_TRANSFER_STATUSES).optional(),
  ...paging,
});
const opnameHistoryQuery = z.object({
  warehouseId: z.guid().optional(),
  status: z.enum(STOCK_OPNAME_STATUSES).optional(),
  ...paging,
});

const read = { kind: "dynamicAccess", resource: "warehouse", action: "read" } as const;
const write = { kind: "dynamicAccess", resource: "warehouse", action: "write" } as const;
const NO_API_KEY =
  "An API key is refused (**403**, Q-51): the record names the person who acts, a users reference a key cannot fill.";

export default defineRouteDocs({
  router: "api/stock.route",
  mount: "/api/v1/stocks",
  tag: "Stock",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/",
      operationId: "listStocks",
      summary: "List stock items",
      description: "The caller's tenant's stock, with each item's warehouse and location.",
      permission: read,
      audited: false,
      query: getStocksQuery,
      success: { status: 200, description: "A page of stock items; pagination in the top-level `meta`", list: stockDetailResponse },
    },
    {
      method: "get",
      path: "/:stockId",
      operationId: "getStock",
      summary: "Get a stock item",
      permission: read,
      audited: false,
      params: stockIdParams,
      success: { status: 200, description: "The stock item with its warehouse and location", data: stockDetailResponse },
    },
    {
      method: "post",
      path: "/",
      operationId: "createStock",
      summary: "Create a stock item",
      permission: write,
      audited: true,
      body: createStockSchema,
      success: { status: 201, description: "The created stock item", data: stockResponse },
    },
    {
      method: "patch",
      path: "/:stockId",
      operationId: "updateStock",
      summary: "Update a stock item",
      description:
        "`quantity` is accepted only if it equals the stored value (an edit form echoing it back); a different " +
        "value is refused and points at the adjustment endpoint (P6-09). A quantity changes through an " +
        "adjustment, a transfer or an opname.",
      permission: write,
      audited: true,
      params: stockIdParams,
      body: updateStockSchema,
      success: { status: 200, description: "The updated stock item", data: stockResponse },
    },
    {
      method: "delete",
      path: "/:stockId",
      operationId: "deleteStock",
      summary: "Delete a stock item",
      description: "Soft delete (`isDeleted`).",
      permission: write,
      audited: true,
      params: stockIdParams,
      success: { status: 200, description: "Deleted; `data` is null", empty: true },
    },
    {
      method: "post",
      path: "/adjustment",
      operationId: "createStockAdjustment",
      summary: "Adjust a stock quantity",
      description: "A reason is required and never blank (P6-09). The quantity before and after are recorded.",
      permission: write,
      audited: true,
      body: createAdjustmentSchema,
      success: { status: 201, description: "The recorded adjustment", data: stockAdjustmentResponse },
    },
    {
      method: "get",
      path: "/adjustment/history",
      operationId: "listStockAdjustments",
      summary: "List stock adjustments",
      description: "Newest first, with the warehouse, the adjusting user and (Q-51) the API key that acted.",
      permission: read,
      audited: false,
      query: adjustmentHistoryQuery,
      success: { status: 200, description: "A page of adjustments; pagination in the top-level `meta`", list: stockAdjustmentListItem },
    },
    {
      method: "post",
      path: "/transfer",
      operationId: "createStockTransfer",
      summary: "Request a stock transfer",
      permission: write,
      audited: true,
      body: createTransferSchema,
      success: { status: 201, description: "The requested transfer", data: stockTransferResponse },
    },
    {
      method: "patch",
      path: "/transfer/:transferId",
      operationId: "updateStockTransferStatus",
      summary: "Move a transfer to its next status",
      description: `Completing a transfer moves the stock between the two warehouses. ${NO_API_KEY}`,
      permission: write,
      audited: true,
      params: transferIdParams,
      body: updateTransferStatusSchema,
      success: { status: 200, description: "The transfer in its new status", data: stockTransferResponse },
    },
    {
      method: "get",
      path: "/transfer/history",
      operationId: "listStockTransfers",
      summary: "List stock transfers",
      permission: read,
      audited: false,
      query: transferHistoryQuery,
      success: { status: 200, description: "A page of transfers; pagination in the top-level `meta`", list: stockTransferListItem },
    },
    {
      method: "post",
      path: "/opname",
      operationId: "createStockOpname",
      summary: "Schedule an opname (stock count)",
      description: NO_API_KEY,
      permission: write,
      audited: true,
      body: createOpnameSchema,
      success: { status: 201, description: "The scheduled opname", data: stockOpnameResponse },
    },
    {
      method: "patch",
      path: "/opname/:opnameId",
      operationId: "updateStockOpnameStatus",
      summary: "Move an opname to its next status",
      permission: write,
      audited: true,
      params: opnameIdParams,
      body: updateOpnameStatusSchema,
      success: { status: 200, description: "The opname in its new status", data: stockOpnameResponse },
    },
    {
      method: "get",
      path: "/opname/history",
      operationId: "listStockOpnames",
      summary: "List opnames",
      permission: read,
      audited: false,
      query: opnameHistoryQuery,
      success: { status: 200, description: "A page of opnames; pagination in the top-level `meta`", list: stockOpnameListItem },
    },
    {
      method: "get",
      path: "/reports/summary",
      operationId: "getInventoryReport",
      summary: "Inventory summary",
      permission: read,
      audited: false,
      success: { status: 200, description: "Totals across the tenant's stock, and per warehouse", data: inventoryReportResponse },
    },
    {
      method: "get",
      path: "/reports/export",
      operationId: "exportInventoryCsv",
      summary: "Export the inventory as CSV",
      description: "A file download (`Content-Disposition: attachment; filename=inventory_report.csv`), not the envelope.",
      permission: read,
      audited: false,
      success: { status: 200, description: "The inventory as CSV", file: { contentType: "text/csv" } },
    },
  ],
});
