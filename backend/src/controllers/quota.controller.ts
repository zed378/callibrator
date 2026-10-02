/**
 * Quota: the current tenant's plan, seat/storage usage and features,
 * `/api/v1/quota`.
 *
 * P9-21 (ADR-087): converted from quota.controller.js, behaviour unchanged.
 * `req.user` is read inline (optionally, as before). Everything it required at
 * load is captured at load, in its order. `export =` keeps the exact object
 * `require()` returned.
 */
import type { Request, Response } from "express";
import quotaService from "../services/quota.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import { AppError as LoadedAppError } from "../utils/appError.util";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const AppError = LoadedAppError;

// GET /api/v1/quota — the current tenant's plan, seat/storage usage, and features.
const getUsage = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user?.tenantId;
  const summary = await quotaService.getUsageSummary(tenantId);
  if (!summary) {
    throw new AppError(404, "Tenant not found");
  }
  success(res, summary, null, "Quota usage retrieved", 200);
});

export = { getUsage };
