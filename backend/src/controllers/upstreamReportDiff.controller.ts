/**
 * P25-03 — the report diff's console route, mounted on the admin router
 * (`auth` + `rbac(SUPER_ADMIN)`, and `superAdminOnly`). The `:id` route is
 * allow-listed as `platform` in the two-tenant guard (the run is the
 * platform's record, like the import's own routes).
 */
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import { upstreamReportDiffSchema } from "../validators/upstreamReportDiff.validator";
import { diffRun } from "../services/upstreamReportDiff.service";

/** GET /admin/upstream-sql-imports/:id/report-diff — aggregates only, never a value. */
export const reportDiff = asyncHandler(async (req: Request, res: Response) => {
  const { id, sample } = validated(req, upstreamReportDiffSchema);
  success(res, await diffRun(id, sample), "Upstream report diff retrieved", 200);
});
