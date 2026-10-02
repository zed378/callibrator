/**
 * Custom Domains Routes
 *
 * Routes for custom domain and vanity subdomain management.
 * Mounted at /api/v1/custom-domains
 *
 * P9-21 (ADR-087): converted from customDomains.route.js. Every route, gate and
 * middleware is in the same order as before (checked against the mounted route
 * table). The contract is code-first: customDomains.openapi.ts (P9-25,
 * ADR-103); the `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS, PERMISSION_TYPES } from "../../constants";
import { getCustomDomains, addCustomDomain, verifyDomain, removeCustomDomain, getDomainStatus, setDefaultDomain, getDnsRecords } from "../../controllers/customDomains.controller";
import { addDomain } from "../../validators/customDomains.validator";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
// `addDomain` is a SCHEMA. Its own method was once passed to the router
// (`addDomain.validate`), which express called as (req, res, next) — it threw
// and 500'd POST /domains. `validate(schema)` is the only router-facing factory
// (P9-11 guard: tests/guards/schemaAsMiddleware.p911).
import { validate } from "../../middlewares/validation.middleware";

// `Router` is `express.Router` (the same function).
const router = Router();

// A-02. A custom domain decides which hostname serves this tenant, and
// verification issues a TLS certificate for it. Until 2026-09-23 these routes
// carried `auth` alone. `custom-domains` is already a menu slug with WRITE for
// the admin roles and READ below them, so the gate is the standard one.
const domainRead = [auth, dynamicAccess(MENU_SLUGS.CUSTOM_DOMAINS, PERMISSION_TYPES.READ)];
const domainWrite = [auth, denyApiKey, dynamicAccess(MENU_SLUGS.CUSTOM_DOMAINS, PERMISSION_TYPES.WRITE)];

router.get("/domains", ...domainRead, getCustomDomains);

router.post("/domains", ...domainWrite, validate(addDomain), addCustomDomain);

router.post(
  "/domains/:domainId/verify",
  ...domainWrite,
  validateUuid("domainId"),
  verifyDomain,
);

router.delete(
  "/domains/:domainId",
  ...domainWrite,
  validateUuid("domainId"),
  removeCustomDomain,
);

router.get(
  "/domains/:domainId/status",
  ...domainRead,
  validateUuid("domainId"),
  getDomainStatus,
);

router.post(
  "/domains/:domainId/default",
  ...domainWrite,
  validateUuid("domainId"),
  setDefaultDomain,
);

router.get(
  "/domains/:domainId/dns",
  ...domainRead,
  validateUuid("domainId"),
  getDnsRecords,
);

export = router;
