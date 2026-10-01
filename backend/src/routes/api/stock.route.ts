/**
 * Stock, adjustments, transfers, opnames and inventory reports:
 * `/api/v1/stocks` (index.js mounts it).
 *
 * P9-21 (ADR-087): converted from stock.route.js. Every route, gate and
 * middleware is in the same order as before (checked against the mounted
 * route table). The handlers validate their own input (stock.controller).
 *
 * The contract is code-first: stock.openapi.ts (P9-25, ADR-103); the
 * `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import {
  getAllStocks,
  getSpecificStock,
  createStock,
  updateStock,
  deleteStock,
  createAdjustment,
  getAdjustments,
  createTransfer,
  updateTransferStatus,
  getTransfers,
  createOpname,
  updateOpnameStatus,
  getOpnames,
  getInventoryReport,
  exportInventoryCsv,
} from "../../controllers/stock.controller";

// `Router` is `express.Router` (the same function).
const router = Router();

/* ------------------------------------------------------------------ */
/* STOCK ROUTES                                                       */
/* ------------------------------------------------------------------ */

router.get(
  "/",
  auth,
  dynamicAccess("warehouse", "read"),
  getAllStocks,
);

router.get(
  "/:stockId",
  auth,
  validateUuid("stockId"),
  dynamicAccess("warehouse", "read"),
  getSpecificStock,
);

router.post(
  "/",
  auth,
  dynamicAccess("warehouse", "write"),
  createStock,
);

router.patch(
  "/:stockId",
  auth,
  validateUuid("stockId"),
  dynamicAccess("warehouse", "write"),
  updateStock,
);

router.delete(
  "/:stockId",
  auth,
  validateUuid("stockId"),
  dynamicAccess("warehouse", "write"),
  deleteStock,
);

/* ------------------------------------------------------------------ */
/* ADJUSTMENT ROUTES                                                  */
/* ------------------------------------------------------------------ */

router.post(
  "/adjustment",
  auth,
  dynamicAccess("warehouse", "write"),
  createAdjustment,
);

router.get(
  "/adjustment/history",
  auth,
  dynamicAccess("warehouse", "read"),
  getAdjustments,
);

/* ------------------------------------------------------------------ */
/* TRANSFER ROUTES                                                    */
/* ------------------------------------------------------------------ */

router.post(
  "/transfer",
  auth,
  dynamicAccess("warehouse", "write"),
  createTransfer,
);

// Q-51: an API key is refused (403). Completing or cancelling a transfer
// records its approver in approved_by, a users FK a key cannot fill — and a
// transfer's approval is a person's decision.
router.patch(
  "/transfer/:transferId",
  auth,
  denyApiKey,
  validateUuid("transferId"),
  dynamicAccess("warehouse", "write"),
  updateTransferStatus,
);

router.get(
  "/transfer/history",
  auth,
  dynamicAccess("warehouse", "read"),
  getTransfers,
);

/* ------------------------------------------------------------------ */
/* OPNAME ROUTES                                                      */
/* ------------------------------------------------------------------ */

// Q-51: an API key is refused (403): stock_opnames.performed_by names the
// person who counts, a users FK a key cannot fill.
router.post(
  "/opname",
  auth,
  denyApiKey,
  dynamicAccess("warehouse", "write"),
  createOpname,
);

router.patch(
  "/opname/:opnameId",
  auth,
  validateUuid("opnameId"),
  dynamicAccess("warehouse", "write"),
  updateOpnameStatus,
);

router.get(
  "/opname/history",
  auth,
  dynamicAccess("warehouse", "read"),
  getOpnames,
);

router.get(
  "/reports/summary",
  auth,
  dynamicAccess("warehouse", "read"),
  getInventoryReport,
);

router.get(
  "/reports/export",
  auth,
  dynamicAccess("warehouse", "read"),
  exportInventoryCsv,
);

export = router;
