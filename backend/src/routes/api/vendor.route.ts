/**
 * Vendors: `/api/v1/vendors` (index.js mounts it).
 *
 * P9-21 (ADR-087): converted from vendor.route.js. Every route, gate and
 * middleware is in the same order as before (checked against the mounted
 * route table) — including qualify's, whose gate runs BEFORE `validateUuid`.
 *
 * P9-25 (ADR-103): the contract is code-first — vendor.openapi.ts. A new route
 * here is documented there (tests/guards/openapiRoutes.p925.test.ts fails a
 * route with no document).
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { validate } from "../../middlewares/validation.middleware";
import {
  createVendor as createVendorSchema,
  updateVendor as updateVendorSchema,
  qualifyVendor as qualifyVendorSchema,
} from "../../validators/vendor.validator";
import {
  fetchVendors,
  getVendorById,
  createVendor,
  updateVendor,
  deleteVendor,
  qualifyVendor,
} from "../../controllers/vendor.controller";

// `Router` is `express.Router` (the same function).
const router = Router();

router.get(
  "/",
  auth,
  dynamicAccess("vendors", "read", { checkTenant: true }),
  fetchVendors,
);

router.get(
  "/:vendorId",
  auth,
  validateUuid("vendorId"),
  dynamicAccess("vendors", "read", { checkTenant: true }),
  getVendorById,
);

router.post(
  "/",
  auth,
  dynamicAccess("vendors", "create", { checkTenant: true }),
  validate(createVendorSchema),
  createVendor,
);

router.patch(
  "/:vendorId",
  auth,
  validateUuid("vendorId"),
  dynamicAccess("vendors", "update", { checkTenant: true }),
  validate(updateVendorSchema),
  updateVendor,
);

router.delete(
  "/:vendorId",
  auth,
  validateUuid("vendorId"),
  dynamicAccess("vendors", "delete", { checkTenant: true }),
  deleteVendor,
);

router.patch(
  "/:vendorId/qualify",
  auth,
  dynamicAccess("vendors", "update"),
  validateUuid("vendorId"),
  validate(qualifyVendorSchema),
  qualifyVendor,
);

export = router;
