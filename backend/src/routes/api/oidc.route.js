/**
 * @swagger
 * tags:
 *   name: OIDC
 *   description: OpenID Connect Provider
 */

const express = require("express");
const router = express.Router();
const oidcController = require("../../controllers/oidcProvider.controller");
const { auth, superAdminOnly } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { MENU_SLUGS } = require("../../constants/roleConstants");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");

// ==========================================================================
// PUBLIC OIDC METADATA — registered BEFORE the auth guard.
// Discovery and JWKS are consumed by relying parties WITHOUT credentials (per
// the OpenID Connect spec); gating them behind `auth` breaks any RP trying to
// discover the provider or fetch its signing keys.
// ==========================================================================

/**
 * @swagger
 * /api/v1/oidc/.well-known/openid-configuration:
 *   get:
 *     summary: OIDC discovery metadata (public)
 *     description: Returns the OpenID Connect provider discovery metadata document. No authentication required.
 *     tags: [OIDC]
 *     responses:
 *       200:
 *         description: OIDC discovery metadata
 */
router.get("/.well-known/openid-configuration", oidcController.discover);
/**
 * @swagger
 * /api/v1/oidc/.well-known/jwks.json:
 *   get:
 *     summary: Provider JWKS (public)
 *     description: Returns the provider's JSON Web Key Set. No authentication required.
 *     tags: [OIDC]
 *     responses:
 *       200:
 *         description: JSON Web Key Set
 */
router.get("/.well-known/jwks.json", oidcController.jwks);

// --- Public authorization-code flow endpoints ---
// authorize is a browser redirect; token/userinfo authenticate the CLIENT
// (secret/PKCE) or a Bearer access token, not the app session.
/**
 * @swagger
 * /api/v1/oidc/authorize:
 *   get:
 *     summary: OIDC authorization endpoint (public; redirects to consent)
 *     tags: [OIDC]
 */
router.get("/authorize", oidcController.authorize);
/**
 * @swagger
 * /api/v1/oidc/token:
 *   post:
 *     summary: OIDC token endpoint (public; client-authenticated)
 *     tags: [OIDC]
 */
router.post("/token", oidcController.token);
/**
 * @swagger
 * /api/v1/oidc/userinfo:
 *   get:
 *     summary: OIDC userinfo endpoint (public; Bearer access token)
 *     tags: [OIDC]
 */
router.get("/userinfo", oidcController.userinfo);

// ==========================================================================
// Everything below requires authentication.
// ==========================================================================
router.use(auth);

// --- Consent screen support (the logged-in user approving a request) ---
/**
 * @swagger
 * /api/v1/oidc/authorize/request/{requestId}:
 *   get:
 *     summary: Fetch a staged authorization request (for the consent screen)
 *     tags: [OIDC]
 *     security:
 *       - bearerAuth: []
 */
router.get("/authorize/request/:requestId", oidcController.getAuthRequest);
/**
 * @swagger
 * /api/v1/oidc/authorize/decision:
 *   post:
 *     summary: Approve or deny an authorization request
 *     tags: [OIDC]
 *     security:
 *       - bearerAuth: []
 */
router.post("/authorize/decision", oidcController.decision);

/**
 * @swagger
 * /api/v1/oidc/clients:
 *   post:
 *     summary: Register an OIDC client
 *     description: Registers a new OIDC client. Super admin only.
 *     tags: [OIDC]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               redirectUris:
 *                 type: array
 *                 items:
 *                   type: string
 *               scopes:
 *                 type: array
 *                 items:
 *                   type: string
 *               grantTypes:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Client registered
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Unauthorized
 */
router.post("/clients", superAdminOnly, oidcController.registerClient);
/**
 * @swagger
 * /api/v1/oidc/clients:
 *   get:
 *     summary: List tenant OIDC clients
 *     description: Returns the OIDC clients registered for the tenant.
 *     tags: [OIDC]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of OIDC clients
 *       401:
 *         description: Unauthorized
 */
// AZ-01 (G-01): the client list (ids, redirect URIs) was readable by every
// authenticated user while registering one is superAdminOnly.
router.get("/clients", dynamicAccess(MENU_SLUGS.OIDC, "read"), oidcController.getClients);
/**
 * @swagger
 * /api/v1/oidc/clients/{clientId}/rotate-secret:
 *   post:
 *     summary: Rotate a client secret
 *     description: Rotates the secret for an OIDC client. Super admin only.
 *     tags: [OIDC]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Client secret rotated
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Client not found
 */
router.post("/clients/:clientId/rotate-secret", superAdminOnly, oidcController.rotateSecret);
/**
 * @swagger
 * /api/v1/oidc/clients/{clientId}:
 *   delete:
 *     summary: Delete an OIDC client
 *     description: Deletes an OIDC client. Super admin only.
 *     tags: [OIDC]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Client deleted
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Client not found
 */
router.delete("/clients/:clientId", superAdminOnly, oidcController.deleteClient);

// --------------------------------------------------------------------------
// A-280 (ADR-094) — the same client operations on a tenant the operator
// names in the path. The routes above act on the operator's HOME tenant
// (platform clients, which only that tenant's users may approve, A-275); a
// client a hospital's users sign in to lives in the hospital's tenant.
// Another tenant's id that does not exist is 404.
// --------------------------------------------------------------------------

/**
 * @swagger
 * /api/v1/oidc/tenants/{tenantId}/clients:
 *   get:
 *     summary: List a tenant's OIDC clients (super admin)
 *     tags: [OIDC]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: The tenant's OIDC clients
 *       404:
 *         description: Tenant not found
 */
router.get("/tenants/:tenantId/clients", superAdminOnly, validateUuid("tenantId"), oidcController.getTenantClients);
/**
 * @swagger
 * /api/v1/oidc/tenants/{tenantId}/clients:
 *   post:
 *     summary: Register an OIDC client in a tenant (super admin)
 *     tags: [OIDC]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Client registered; the secret is shown once
 *       404:
 *         description: Tenant not found
 */
router.post("/tenants/:tenantId/clients", superAdminOnly, validateUuid("tenantId"), oidcController.registerTenantClient);
/**
 * @swagger
 * /api/v1/oidc/tenants/{tenantId}/clients/{clientId}/rotate-secret:
 *   post:
 *     summary: Rotate a tenant's OIDC client secret (super admin)
 *     tags: [OIDC]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Client secret rotated
 *       404:
 *         description: Tenant or client not found
 */
router.post(
  "/tenants/:tenantId/clients/:clientId/rotate-secret",
  superAdminOnly,
  validateUuid("tenantId"),
  oidcController.rotateTenantClientSecret,
);
/**
 * @swagger
 * /api/v1/oidc/tenants/{tenantId}/clients/{clientId}:
 *   delete:
 *     summary: Delete a tenant's OIDC client (super admin)
 *     tags: [OIDC]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Client deleted
 *       404:
 *         description: Tenant not found
 */
router.delete("/tenants/:tenantId/clients/:clientId", superAdminOnly, validateUuid("tenantId"), oidcController.deleteTenantClient);

module.exports = router;
