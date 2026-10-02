/**
 * Callibrator as an OpenID Connect provider: index.js mounts this router at
 * `/api/v1/oidc` and at `/oidc` (the issuer-root path).
 *
 * P9-21 (ADR-087): converted from oidc.route.js. Every route, gate and
 * middleware is in the same order as before, the public routes still before
 * `router.use(auth)` (checked against the mounted route table). The contract
 * is code-first: oidc.openapi.ts (P9-25, ADR-103); the `@swagger` JSDoc this
 * file carried is gone.
 */
import { Router } from "express";
import oidcController from "../../controllers/oidcProvider.controller";
import { auth, superAdminOnly } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS } from "../../constants/roleConstants";
import { validateUuid } from "../../middlewares/validateUuid.middleware";

// `Router` is `express.Router` (the same function).
const router = Router();

// ==========================================================================
// PUBLIC OIDC METADATA — registered BEFORE the auth guard.
// Discovery and JWKS are consumed by relying parties WITHOUT credentials (per
// the OpenID Connect spec); gating them behind `auth` breaks any RP trying to
// discover the provider or fetch its signing keys.
// ==========================================================================

router.get("/.well-known/openid-configuration", oidcController.discover);
router.get("/.well-known/jwks.json", oidcController.jwks);

// --- Public authorization-code flow endpoints ---
// authorize is a browser redirect; token/userinfo authenticate the CLIENT
// (secret/PKCE) or a Bearer access token, not the app session.
router.get("/authorize", oidcController.authorize);
router.post("/token", oidcController.token);
router.get("/userinfo", oidcController.userinfo);

// ==========================================================================
// Everything below requires authentication.
// ==========================================================================
router.use(auth);

// --- Consent screen support (the logged-in user approving a request) ---
router.get("/authorize/request/:requestId", oidcController.getAuthRequest);
router.post("/authorize/decision", oidcController.decision);

router.post("/clients", superAdminOnly, oidcController.registerClient);
// AZ-01 (G-01): the client list (ids, redirect URIs) was readable by every
// authenticated user while registering one is superAdminOnly.
router.get("/clients", dynamicAccess(MENU_SLUGS.OIDC, "read"), oidcController.getClients);
router.post("/clients/:clientId/rotate-secret", superAdminOnly, oidcController.rotateSecret);
router.delete("/clients/:clientId", superAdminOnly, oidcController.deleteClient);

// --------------------------------------------------------------------------
// A-280 (ADR-094) — the same client operations on a tenant the operator
// names in the path. The routes above act on the operator's HOME tenant
// (platform clients, which only that tenant's users may approve, A-275); a
// client a hospital's users sign in to lives in the hospital's tenant.
// Another tenant's id that does not exist is 404.
// --------------------------------------------------------------------------

router.get("/tenants/:tenantId/clients", superAdminOnly, validateUuid("tenantId"), oidcController.getTenantClients);
router.post("/tenants/:tenantId/clients", superAdminOnly, validateUuid("tenantId"), oidcController.registerTenantClient);
router.post(
  "/tenants/:tenantId/clients/:clientId/rotate-secret",
  superAdminOnly,
  validateUuid("tenantId"),
  oidcController.rotateTenantClientSecret,
);
router.delete("/tenants/:tenantId/clients/:clientId", superAdminOnly, validateUuid("tenantId"), oidcController.deleteTenantClient);

export = router;
