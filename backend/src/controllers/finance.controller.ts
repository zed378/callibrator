/**
 * Finance Controller
 *
 * Asset finance records + depreciation reporting for calibration devices.
 *
 * P9-20 (ADR-087): converted from finance.controller.js, behaviour unchanged.
 * As the JavaScript did: the tenant is `req.tenantId || req.user.tenantId`
 * (read inline, so a request with neither throws the same TypeError); the list
 * passes `req.query` values RAW; the create and update bodies are what
 * `validate()` left on `req.body`; `success()` answers with the service's
 * status; the depreciation report answers a CSV file when `format` is "csv"
 * (any case) and otherwise the report without its `csv` member.
 */
import type { Request, Response } from "express";
import financeService from "../services/finance.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import { success as loadedSuccess } from "../utils/response.util";
import type { TenantId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const auditPrincipal = loadedAuditPrincipal;
const success = loadedSuccess;

/** The request as these handlers read it: a tenant set upstream, else the principal's. */
interface TenantRequest {
  tenantId?: TenantId;
  user: { tenantId: TenantId };
}

/** `:financeId`, read without a schema (`validateUuid` on the route checked its shape). */
interface FinanceParams {
  financeId: string;
}

/** What reaches the service is what the JavaScript passed: the query values RAW, the body as validated. */
type FetchArg = Parameters<typeof financeService.fetchAssetFinances>[0];
type FinanceBody = Parameters<typeof financeService.createAssetFinance>[1];

/** The list result's `data` (the JavaScript read `.rows` / `.meta` off it unguarded). */
interface ListData {
  rows: unknown;
  meta: object;
}

/** GET /api/v1/finance */
export const fetchAssetFinances = asyncHandler(async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.tenantId || req.user.tenantId`
  const tenantId = (req as unknown as TenantRequest).tenantId || (req as unknown as TenantRequest).user.tenantId;
  const { page, limit, deviceId, method } = req.query;
  const query = {
    tenantId,
    page,
    limit,
    deviceId,
    method,
  };
  const result = await financeService.fetchAssetFinances(query as FetchArg);
  success(res, (result.data as ListData).rows, (result.data as ListData).meta, result.message, result.status);
});

/** GET /api/v1/finance/:financeId */
export const getAssetFinanceById = asyncHandler(async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.tenantId || req.user.tenantId`
  const tenantId = (req as unknown as TenantRequest).tenantId || (req as unknown as TenantRequest).user.tenantId;
  const result = await financeService.getAssetFinanceById(
    tenantId,
    (req.params as unknown as FinanceParams).financeId,
  );
  success(res, result.data, null, result.message, result.status);
});

/** POST /api/v1/finance */
export const createAssetFinance = asyncHandler(async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.tenantId || req.user.tenantId`
  const tenantId = (req as unknown as TenantRequest).tenantId || (req as unknown as TenantRequest).user.tenantId;
  const result = await financeService.createAssetFinance(tenantId, req.body as FinanceBody, auditPrincipal(req));
  success(res, result.data, null, result.message, result.status);
});

/** PATCH /api/v1/finance/:financeId */
export const updateAssetFinance = asyncHandler(async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.tenantId || req.user.tenantId`
  const tenantId = (req as unknown as TenantRequest).tenantId || (req as unknown as TenantRequest).user.tenantId;
  const result = await financeService.updateAssetFinance(
    tenantId,
    (req.params as unknown as FinanceParams).financeId,
    req.body as FinanceBody,
    auditPrincipal(req),
  );
  success(res, result.data, null, result.message, result.status);
});

/** DELETE /api/v1/finance/:financeId */
export const deleteAssetFinance = asyncHandler(async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.tenantId || req.user.tenantId`
  const tenantId = (req as unknown as TenantRequest).tenantId || (req as unknown as TenantRequest).user.tenantId;
  const result = await financeService.deleteAssetFinance(
    tenantId,
    (req.params as unknown as FinanceParams).financeId,
    auditPrincipal(req),
  );
  success(res, result.data, null, result.message, result.status);
});

/** GET /api/v1/finance/reports/depreciation[?asOf=&format=csv] */
export const getDepreciationReport = asyncHandler(async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.tenantId || req.user.tenantId`
  const tenantId = (req as unknown as TenantRequest).tenantId || (req as unknown as TenantRequest).user.tenantId;
  const result = await financeService.getDepreciationReport(tenantId, {
    asOf: req.query["asOf"],
  });

  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: a repeated `format` is stringified as the .js did
  if (String(req.query["format"]).toLowerCase() === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="depreciation-report.csv"',
    );
    return res.status(200).send(result.data.csv);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- as built: `csv` is destructured out of the JSON answer
  const { csv, ...data } = result.data;
  return success(res, data, null, result.message, result.status);
});
