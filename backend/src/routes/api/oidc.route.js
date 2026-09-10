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
router.get("/clients", oidcController.getClients);
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

module.exports = router;
