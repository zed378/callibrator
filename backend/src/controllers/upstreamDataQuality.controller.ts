/**
 * P25-02 — the data-quality report's console route, mounted on the admin
 * router (`auth` + `rbac(SUPER_ADMIN)`, and `superAdminOnly`). The `:id` route
 * is allow-listed as `platform` in the two-tenant guard (the run is the
 * platform's record, like the import's own routes).
 */
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import { upstreamDataQualityIdSchema } from "../validators/upstreamDataQuality.validator";
import { reportDataQuality } from "../services/upstreamDataQuality.service";

/** GET /admin/upstream-sql-imports/:id/data-quality — aggregates only, never a value. */
export const dataQuality = asyncHandler(async (req: Request, res: Response) => {
  const { id } = validated(req, upstreamDataQualityIdSchema);
  success(res, await reportDataQuality(id), "Upstream data-quality report retrieved", 200);
});
