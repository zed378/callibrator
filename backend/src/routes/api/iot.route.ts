/**
 * IoT ingest and device provisioning: `/api/v1/iot` (index.js mounts it).
 *
 * P9-18 (ADR-087): converted from iot.route.js. Every route and middleware is
 * in the same order as before (checked against the mounted route table). The
 * contract is code-first: iot.openapi.ts (P9-25, ADR-103); the `@swagger`
 * JSDoc this file carried is gone.
 */
import { Router } from "express";
import iotController from "../../controllers/iot.controller";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { endpointRateLimiter } from "../../services/rateLimiter.redis.service";
import { ROLE_NAMES } from "../../constants";

// `Router` is `express.Router` (the same function).
const router = Router();

// A-29: ingest is unauthenticated until the token is checked, so it is
// limited per client address (the device principal is unknown at this point).
const ingestLimiter = endpointRateLimiter("iotIngest", {
  byUser: false,
  byToken: false,
  maxRequests: 600,
  windowMs: 60 * 1000,
});

// A-29 / A-46: provisioning — issuing, rotating and revoking an ingest token,
// and setting iotEnabled / readingTolerance — is a tenant-administrator act
// with calibration write access, JWT-only (an API key cannot mint device
// credentials). Reading the provisioning state needs calibration read.
const readGate = [auth, validateUuid("deviceId"), dynamicAccess("calibration", "read")];
const adminGate = [
  auth,
  denyApiKey,
  validateUuid("deviceId"),
  rbac([ROLE_NAMES.TENANT_ADMIN]),
  dynamicAccess("calibration", "write"),
];

// HTTP Ingestion endpoint
// POST /api/v1/iot/ingest
router.post("/ingest", ingestLimiter, iotController.ingestHttp);

router.get("/devices/:deviceId", ...readGate, iotController.getDeviceIotConfig);
router.patch("/devices/:deviceId", ...adminGate, iotController.updateDeviceIotConfig);

router.post("/devices/:deviceId/token", ...adminGate, iotController.issueDeviceToken);
router.delete("/devices/:deviceId/token", ...adminGate, iotController.revokeDeviceToken);

export = router;
