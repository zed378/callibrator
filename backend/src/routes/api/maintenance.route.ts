/**
 * Maintenance work orders: `/api/v1/maintenance` (index.js mounts it).
 *
 * P9-21 (ADR-087): converted from maintenance.route.js. Every route, gate and
 * middleware is in the same order as before (checked against the mounted
 * route table).
 *
 * The contract is code-first: maintenance.openapi.ts (P9-25, ADR-103); the
 * `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { createWorkOrder as createWorkOrderSchema, updateWorkOrder as updateWorkOrderSchema } from "../../validators/maintenance.validator";
import {
  fetchWorkOrders,
  getWorkOrderById,
  createWorkOrder,
  updateWorkOrder,
  deleteWorkOrder,
} from "../../controllers/maintenance.controller";

// `Router` is `express.Router` (the same function).
const router = Router();

router.get(
  "/",
  auth,
  dynamicAccess("maintenance", "read", { checkTenant: true }),
  fetchWorkOrders,
);

router.get(
  "/:orderId",
  auth,
  validateUuid("orderId"),
  dynamicAccess("maintenance", "read", { checkTenant: true }),
  getWorkOrderById,
);

router.post(
  "/",
  auth,
  dynamicAccess("maintenance", "create", { checkTenant: true }),
  validate(createWorkOrderSchema),
  createWorkOrder,
);

router.patch(
  "/:orderId",
  auth,
  validateUuid("orderId"),
  dynamicAccess("maintenance", "update", { checkTenant: true }),
  validate(updateWorkOrderSchema),
  updateWorkOrder,
);

router.delete(
  "/:orderId",
  auth,
  validateUuid("orderId"),
  dynamicAccess("maintenance", "delete", { checkTenant: true }),
  deleteWorkOrder,
);

export = router;
