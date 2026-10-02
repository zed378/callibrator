/**
 * P9-21 / P9-25 (ADR-103) — the contract of `finance.route.ts`, code-first.
 *
 * Bodies are the objects `validate()` mounts (`validators/finance.validator`
 * → `@callibrator/contracts/finance`). The list reads its filters RAW from
 * `req.query`. Responses are the contract's records (with their computed
 * depreciation) and the depreciation report. Examples are synthetic.
 */
import { z } from "zod";
import { createAssetFinance, updateAssetFinance } from "../../validators/finance.validator";
import {
  DEPRECIATION_METHODS,
  assetFinanceResponse,
  assetFinanceWithRefs,
  depreciationReport,
} from "@callibrator/contracts/finance";
import { defineRouteDocs } from "../../docs/openapi/operation";

/** `:financeId`, checked by `validateUuid` before `auth` (the SHAPE: `z.guid()`). */
const params = z.object({
  financeId: z.guid().meta({ description: "The finance record's id", example: "6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d" }),
});

/** The filters `finance.service#fetchAssetFinances` reads, raw from `req.query`. */
const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional().meta({ description: "1-based page", example: 1 }),
  limit: z.coerce.number().int().min(1).optional().meta({ description: "Rows per page (capped by the server)", example: 25 }),
  deviceId: z.guid().optional().meta({ description: "Only this device's record" }),
  method: z.enum(DEPRECIATION_METHODS).optional(),
});

/** The report's options, read raw from `req.query`. */
const reportQuery = z.object({
  asOf: z.string().optional().meta({ description: "Report date, any date `new Date()` reads (default: now); unreadable is a 400", example: "2026-09-30" }),
  format: z.string().optional().meta({ description: "`csv` (any case) answers a CSV file; anything else, JSON", example: "csv" }),
});

const access = (action: string) => ({ kind: "dynamicAccess", resource: "finance", action }) as const;

export default defineRouteDocs({
  router: "api/finance.route",
  mount: "/api/v1/finance",
  tag: "Finance",
  tagDescription: "Asset finance records and depreciation reporting for calibration devices",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/reports/depreciation",
      operationId: "getDepreciationReport",
      summary: "Depreciation report (capex, accumulated depreciation, book value)",
      description:
        "Every record purchased on or before `asOf`, with its figures as of that date and the totals. " +
        "With `format=csv` the same rows are answered as an attachment (`depreciation-report.csv`), not JSON.",
      permission: access("read"),
      audited: false,
      query: reportQuery,
      success: { status: 200, description: "The report (JSON; see the description for CSV)", data: depreciationReport },
    },
    {
      method: "get",
      path: "/",
      operationId: "listAssetFinances",
      summary: "List asset finance records",
      description: "The caller's tenant's records, with each device and vendor and the depreciation as of now.",
      permission: access("read"),
      audited: false,
      query: listQuery,
      success: { status: 200, description: "A page of records; pagination in the top-level `meta`", list: assetFinanceWithRefs },
    },
    {
      method: "post",
      path: "/",
      operationId: "createAssetFinance",
      summary: "Create an asset finance record",
      description:
        "One record per device: the device, and the vendor if one is named, must be the caller's tenant's (else " +
        "404, as for one that does not exist; A-337). A soft-deleted record of the device is revived with the new figures.",
      permission: access("create"),
      audited: true,
      body: createAssetFinance,
      success: { status: 201, description: "The created (or revived) record", data: assetFinanceResponse },
      conflict: "the device already has a finance record: update it instead.",
    },
    {
      method: "get",
      path: "/:financeId",
      operationId: "getAssetFinance",
      summary: "Get an asset finance record",
      permission: access("read"),
      audited: false,
      params,
      success: { status: 200, description: "The record with its device, vendor and depreciation", data: assetFinanceWithRefs },
    },
    {
      method: "patch",
      path: "/:financeId",
      operationId: "updateAssetFinance",
      summary: "Update an asset finance record",
      description: "A `vendorId` that is sent must be a vendor of the caller's tenant (else 404, as for one that does not exist; A-337).",
      permission: access("update"),
      audited: true,
      params,
      body: updateAssetFinance,
      success: { status: 200, description: "The updated record with its depreciation", data: assetFinanceResponse },
    },
    {
      method: "delete",
      path: "/:financeId",
      operationId: "deleteAssetFinance",
      summary: "Delete an asset finance record",
      description: "Soft delete: a later create for the same device revives it.",
      permission: access("delete"),
      audited: true,
      params,
      success: { status: 200, description: "Deleted; `data` is null", empty: true },
    },
  ],
});
