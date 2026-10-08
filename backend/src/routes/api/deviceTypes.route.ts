/**
 * Device types — the global inspection catalogue's types: `/api/v1/device-types` (index.ts mounts
 * it). P21-01 (ADR-125 § 4, § 6, Am. 1 § 2; spec MEMORY/specs/P19-01-inspection-catalogue.md § 8).
 *
 * Reads: any catalogue reader — `calibration`, `ipm` or `ipm-templates` read (G-2) — and marked
 * facility-accessible (global content, no facility-owned rows: constants/facilityAccess). Writes:
 * the platform operator only (`superAdminOnly`; JWT only — `denyApiKey`), every one on
 * tests/guards/inspectionCatalogueGlobal.guard's inventory and allow-listed `platform` in
 * twoTenantRoutes.guard; the reads by id are `not-tenant-owned` (the model has no tenant column).
 *
 * Contract: deviceTypes.openapi.ts (ADR-103).
 */
import { Router } from "express";
import { auth, denyApiKey, superAdminOnly } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validate } from "../../middlewares/validation.middleware";
import {
  createDeviceType,
  deviceTypeIdParams,
  listDeviceTypesQuery,
  renameDeviceType,
} from "@callibrator/contracts/inspectionCatalogue";
import { createType, getType, listTypes, reactivateType, renameType, retireType } from "../../controllers/inspectionCatalogue.controller";

const router = Router();

router.get("/", auth, dynamicAccess(["calibration", "ipm", "ipm-templates"], "read"), validate(listDeviceTypesQuery, { from: "query" }), listTypes);
router.get(
  "/:deviceTypeId",
  auth,
  dynamicAccess(["calibration", "ipm", "ipm-templates"], "read"),
  validate(deviceTypeIdParams, { from: "params" }),
  getType,
);

router.post("/", auth, denyApiKey, superAdminOnly, validate(createDeviceType), createType);
router.patch("/:deviceTypeId", auth, denyApiKey, superAdminOnly, validate(renameDeviceType, { from: ["params", "body"] }), renameType);
router.post("/:deviceTypeId/retire", auth, denyApiKey, superAdminOnly, validate(deviceTypeIdParams, { from: "params" }), retireType);
router.post("/:deviceTypeId/reactivate", auth, denyApiKey, superAdminOnly, validate(deviceTypeIdParams, { from: "params" }), reactivateType);

export = router;
