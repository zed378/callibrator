/**
 * Client facilities: `/api/v1/client-facilities` (index.ts mounts it) — P21-09 (ADR-124; spec
 * MEMORY/specs/P19-04-client-facilities.md § 13.1).
 *
 * P21-09b mounts the bound user's own read, `GET /mine` (S-8, a `self` exemption and the one
 * route of this router marked facility-accessible). The administration routes (`GET /`,
 * `/options`, `/:clientFacilityId`, create, edit, status, delete, `/:clientFacilityId/users`) are
 * gated on the `client-facilities` menu slug that P20-06's migration seeds; they are mounted by
 * P21-09c once that slug exists — their service (services/clientFacilityAdmin.service) is built.
 *
 * Contract: clientFacilities.openapi.ts (ADR-103).
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { mine } from "../../controllers/clientFacility.controller";

const router = Router();

// S-8: registered before any `/:clientFacilityId` route will be (a shadowing order the route
// index resolves exactly as Express does).
router.get("/mine", auth, mine);

export = router;
