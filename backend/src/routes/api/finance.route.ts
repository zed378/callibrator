/**
 * Asset finance + depreciation: `/api/v1/finance` (index.js mounts it).
 *
 * P9-21 (ADR-087): converted from finance.route.js. Every route, gate and
 * middleware is in the same order as before (checked against the mounted
 * route table) — including `validateUuid` BEFORE `auth` on the `:financeId`
 * routes. The contract is code-first: finance.openapi.ts (P9-25, ADR-103); the
 * `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { validate } from "../../middlewares/validation.middleware";
import {
  createAssetFinance as createAssetFinanceSchema,
  updateAssetFinance as updateAssetFinanceSchema,
} from "../../validators/finance.validator";
import {
  getDepreciationReport,
  fetchAssetFinances,
  createAssetFinance,
  getAssetFinanceById,
  updateAssetFinance,
  deleteAssetFinance,
} from "../../controllers/finance.controller";

// `Router` is `express.Router` (the same function).
const router = Router();

// NOTE: registered before /:financeId so "reports" isn't captured as an id.
router.get(
  "/reports/depreciation",
  auth,
  dynamicAccess("finance", "read", { checkTenant: true }),
  getDepreciationReport,
);

router.get(
  "/",
  auth,
  dynamicAccess("finance", "read", { checkTenant: true }),
  fetchAssetFinances,
);

router.post(
  "/",
  auth,
  dynamicAccess("finance", "create", { checkTenant: true }),
  validate(createAssetFinanceSchema),
  createAssetFinance,
);

router.get(
  "/:financeId",
  validateUuid("financeId"),
  auth,
  dynamicAccess("finance", "read", { checkTenant: true }),
  getAssetFinanceById,
);

router.patch(
  "/:financeId",
  validateUuid("financeId"),
  auth,
  dynamicAccess("finance", "update", { checkTenant: true }),
  validate(updateAssetFinanceSchema),
  updateAssetFinance,
);

router.delete(
  "/:financeId",
  validateUuid("financeId"),
  auth,
  dynamicAccess("finance", "delete", { checkTenant: true }),
  deleteAssetFinance,
);

export = router;
