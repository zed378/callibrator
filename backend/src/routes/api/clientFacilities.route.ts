/**
 * Client facilities: `/api/v1/client-facilities` (index.ts mounts it) — P21-09 (ADR-124; spec
 * MEMORY/specs/P19-04-client-facilities.md § 13.1).
 *
 * P21-09b mounted the bound user's own read, `GET /mine` (S-8, a `self` exemption and the one
 * route of this router marked facility-accessible). P21-09c mounts the administration routes on
 * the `client-facilities` menu slug P20-06 seeded (migration 0124); none is marked, so a bound
 * principal meets 403 `FACILITY_ROUTE_REFUSED` before a parameter is read (G-10). Every write
 * refuses an API key (a person answers for a facility's lifecycle) and writes its audit row inside
 * its transaction (services/clientFacilityAdmin.service). Another tenant's facility is a 404.
 *
 * Contract: clientFacilities.openapi.ts (ADR-103).
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { ROLE_NAMES } from "../../constants/roleConstants";
import {
  clientFacilityCreate,
  clientFacilityEdit,
  clientFacilityIdParams,
  clientFacilityListQuery,
  clientFacilityStatusRequest,
} from "@callibrator/contracts/clientFacilities";
import { changeStatus, create, getOne, list, mine, options, remove, update, users } from "../../controllers/clientFacility.controller";

const router = Router();

// S-8: registered before every `/:clientFacilityId` route (a shadowing order the route index
// resolves exactly as Express does).
router.get("/mine", auth, mine);

router.get("/", auth, dynamicAccess("client-facilities", "read"), validate(clientFacilityListQuery, { from: "query" }), list);

// The pickers' and the provider filter's list: technicians hold `calibration` / `ipm`, not
// `client-facilities` (any one of the three suffices). Registered before `/:clientFacilityId`.
router.get("/options", auth, dynamicAccess(["calibration", "ipm", "client-facilities"], "read"), options);

router.get("/:clientFacilityId", auth, dynamicAccess("client-facilities", "read"), validate(clientFacilityIdParams, { from: "params" }), getOne);

router.post("/", auth, denyApiKey, dynamicAccess("client-facilities", "write"), validate(clientFacilityCreate), create);

router.patch(
  "/:clientFacilityId",
  auth,
  denyApiKey,
  dynamicAccess("client-facilities", "write"),
  validate(clientFacilityEdit, { from: ["params", "body"] }),
  update,
);

// § 4.4: `ended → active` additionally needs a tenant administrator — decided in the service
// (statusRefusal), because the target status is in the body.
router.post(
  "/:clientFacilityId/status",
  auth,
  denyApiKey,
  dynamicAccess("client-facilities", "write"),
  validate(clientFacilityStatusRequest, { from: ["params", "body"] }),
  changeStatus,
);

// § 4.6: only a facility created by mistake (nothing references it).
router.delete(
  "/:clientFacilityId",
  auth,
  denyApiKey,
  rbac([ROLE_NAMES.TENANT_ADMIN]),
  dynamicAccess("client-facilities", "write"),
  validate(clientFacilityIdParams, { from: "params" }),
  remove,
);

router.get("/:clientFacilityId/users", auth, dynamicAccess("users", "read"), validate(clientFacilityIdParams, { from: "params" }), users);

export = router;
