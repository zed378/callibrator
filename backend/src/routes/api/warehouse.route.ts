/**
 * Warehouses and storage locations: `/api/v1/warehouses` (index.js mounts it).
 *
 * P9-21 (ADR-087): converted from warehouse.route.js. Every route, gate and
 * middleware is in the same order as before (checked against the mounted
 * route table). The handlers validate their own input (warehouse.controller).
 *
 * The contract is code-first: warehouse.openapi.ts (P9-25, ADR-103). The
 * `@swagger` JSDoc this file carried is gone; it documented fields the API
 * never accepted (city, province, capacity, ...) and a `search` query the
 * handler never read.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import {
  getAllWarehouses,
  getSpecificWarehouse,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
  getLocations,
  createLocation,
  updateLocation,
  deleteLocation,
} from "../../controllers/warehouse.controller";

// `Router` is `express.Router` (the same function); a named import, as the
// other converted routes use, rather than a default-import interop wrapper.
const router = Router();

/* ------------------------------------------------------------------ */
/* WAREHOUSE ROUTES                                                   */
/* ------------------------------------------------------------------ */

router.get(
  "/",
  auth,
  dynamicAccess("warehouse", "read"),
  getAllWarehouses,
);

router.get(
  "/:warehouseId",
  auth,
  validateUuid("warehouseId"),
  dynamicAccess("warehouse", "read"),
  getSpecificWarehouse,
);

router.post(
  "/",
  auth,
  dynamicAccess("warehouse", "write"),
  createWarehouse,
);

router.patch(
  "/:warehouseId",
  auth,
  validateUuid("warehouseId"),
  dynamicAccess("warehouse", "write"),
  updateWarehouse,
);

router.delete(
  "/:warehouseId",
  auth,
  validateUuid("warehouseId"),
  dynamicAccess("warehouse", "write"),
  deleteWarehouse,
);

/* ------------------------------------------------------------------ */
/* STORAGE LOCATION ROUTES                                            */
/* ------------------------------------------------------------------ */

router.get(
  "/:warehouseId/locations",
  auth,
  validateUuid("warehouseId"),
  dynamicAccess("warehouse", "read"),
  getLocations,
);

router.post(
  "/locations",
  auth,
  dynamicAccess("warehouse", "write"),
  createLocation,
);

router.patch(
  "/locations/:locationId",
  auth,
  validateUuid("locationId"),
  dynamicAccess("warehouse", "write"),
  updateLocation,
);

router.delete(
  "/locations/:locationId",
  auth,
  validateUuid("locationId"),
  dynamicAccess("warehouse", "write"),
  deleteLocation,
);

export = router;
