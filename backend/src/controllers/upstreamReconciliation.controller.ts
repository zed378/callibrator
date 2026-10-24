/**
 * P25-01 — the reconciliation's console route, mounted on the admin router
 * (`auth` + `rbac(SUPER_ADMIN)`, and `superAdminOnly`). The `:id` route is
 * allow-listed as `platform` in the two-tenant guard (the run is the
 * platform's record, like the import's own routes).
 */
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import { upstreamReconciliationIdSchema } from "../validators/upstreamReconciliation.validator";
import { reconcileRun } from "../services/upstreamReconciliation.service";

/** GET /admin/upstream-sql-imports/:id/reconciliation — aggregates only, never a value. */
export const reconciliation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = validated(req, upstreamReconciliationIdSchema);
  success(res, await reconcileRun(id), "Upstream reconciliation retrieved", 200);
});
