const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const { validate } = require("../../middlewares/validation.middleware");
const vendorValidator = require("../../validators/vendor.validator");
const vendorController = require("../../controllers/vendor.controller");

// P9-25 (ADR-103): this router's contract is code-first — vendor.openapi.ts.
// Its @swagger JSDoc blocks were removed; a new route here is documented there
// (tests/guards/openapiRoutes.p925.test.ts fails a route with no document).

router.get(
  "/",
  auth,
  dynamicAccess("vendors", "read", { checkTenant: true }),
  vendorController.fetchVendors,
);

router.get(
  "/:vendorId",
  auth,
  validateUuid("vendorId"),
  dynamicAccess("vendors", "read", { checkTenant: true }),
  vendorController.getVendorById,
);

router.post(
  "/",
  auth,
  dynamicAccess("vendors", "create", { checkTenant: true }),
  validate(vendorValidator.createVendor),
  vendorController.createVendor,
);

router.patch(
  "/:vendorId",
  auth,
  validateUuid("vendorId"),
  dynamicAccess("vendors", "update", { checkTenant: true }),
  validate(vendorValidator.updateVendor),
  vendorController.updateVendor,
);

router.delete(
  "/:vendorId",
  auth,
  validateUuid("vendorId"),
  dynamicAccess("vendors", "delete", { checkTenant: true }),
  vendorController.deleteVendor,
);

router.patch(
  "/:vendorId/qualify",
  auth,
  dynamicAccess("vendors", "update"),
  validateUuid("vendorId"),
  validate(vendorValidator.qualifyVendor),
  vendorController.qualifyVendor,
);
module.exports = router;
