/**
 * Custom Domains Routes
 *
 * Routes for custom domain and vanity subdomain management.
 * Mounted at /api/v1/custom-domains
 */

const express = require("express");
const router = express.Router();

const { auth, denyApiKey } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { MENU_SLUGS, PERMISSION_TYPES } = require("../../constants");
const {
  getCustomDomains,
  addCustomDomain,
  verifyDomain,
  removeCustomDomain,
  getDomainStatus,
  setDefaultDomain,
  getDnsRecords,
} = require("../../controllers/customDomains.controller");
const { addDomain } = require("../../validators/customDomains.validator");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
// `addDomain` is a Joi SCHEMA. It was passed as `addDomain.validate`, i.e.
// Joi's own (value, options) method, which express called as (req, res, next)
// — it threw and 500'd POST /domains. `validate(schema)` is the router-facing
// factory.
const { validate } = require("../../middlewares/validation.middleware");

// A-02. A custom domain decides which hostname serves this tenant, and
// verification issues a TLS certificate for it. Until 2026-09-23 these routes
// carried `auth` alone. `custom-domains` is already a menu slug with WRITE for
// the admin roles and READ below them, so the gate is the standard one.
const domainRead = [auth, dynamicAccess(MENU_SLUGS.CUSTOM_DOMAINS, PERMISSION_TYPES.READ)];
const domainWrite = [auth, denyApiKey, dynamicAccess(MENU_SLUGS.CUSTOM_DOMAINS, PERMISSION_TYPES.WRITE)];

/**
 * @swagger
 * /api/v1/custom-domains/domains:
 *   get:
 *     summary: Get custom domains
 *     description: Retrieves all custom domains configured for the tenant. Requires read access to CustomDomains.
 *     tags: [CustomDomains]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Custom domains retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 domains:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       domain:
 *                         type: string
 *                       status:
 *                         type: string
 *                         enum: [pending, verified, failed]
 *       401:
 *         description: Unauthorized
 */
router.get("/domains", ...domainRead, getCustomDomains);

/**
 * @swagger
 * /api/v1/custom-domains/domains:
 *   post:
 *     summary: Add a custom domain
 *     description: Adds a new custom domain to the tenant. Requires write access to CustomDomains.
 *     tags: [CustomDomains]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - domain
 *             properties:
 *               domain:
 *                 type: string
 *                 format: uri
 *                 description: The custom domain to add (e.g., app.example.com)
 *               vanitySubdomain:
 *                 type: string
 *                 description: Optional vanity subdomain
 *     responses:
 *       201:
 *         description: Custom domain added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 domain:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [pending, verified, failed]
 *       400:
 *         description: Invalid domain format
 *       401:
 *         description: Unauthorized
 */
router.post("/domains", ...domainWrite, validate(addDomain), addCustomDomain);

/**
 * @swagger
 * /api/v1/custom-domains/domains/{domainId}/verify:
 *   post:
 *     summary: Verify a custom domain
 *     description: Triggers DNS verification for a custom domain. Requires write access to CustomDomains.
 *     tags: [CustomDomains]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: domainId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Domain verification initiated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [pending, verified, failed]
 *                 dnsRecords:
 *                   type: object
 *       404:
 *         description: Domain not found
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/domains/:domainId/verify",
  ...domainWrite,
  validateUuid("domainId"),
  verifyDomain,
);

/**
 * @swagger
 * /api/v1/custom-domains/domains/{domainId}:
 *   delete:
 *     summary: Remove a custom domain
 *     description: Removes a custom domain from the tenant. Requires write access to CustomDomains.
 *     tags: [CustomDomains]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: domainId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Custom domain removed successfully
 *       404:
 *         description: Domain not found
 *       401:
 *         description: Unauthorized
 */
router.delete(
  "/domains/:domainId",
  ...domainWrite,
  validateUuid("domainId"),
  removeCustomDomain,
);

/**
 * @swagger
 * /api/v1/custom-domains/domains/{domainId}/status:
 *   get:
 *     summary: Get domain verification status
 *     description: Retrieves the current verification status and DNS records for a custom domain. Requires read access to CustomDomains.
 *     tags: [CustomDomains]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: domainId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Domain status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [pending, verified, failed]
 *                 dnsRecords:
 *                   type: object
 *       404:
 *         description: Domain not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/domains/:domainId/status",
  ...domainRead,
  validateUuid("domainId"),
  getDomainStatus,
);

/**
 * @swagger
 * /api/v1/custom-domains/domains/{domainId}/default:
 *   post:
 *     summary: Set default domain
 *     description: Sets a custom domain as the default for the tenant. Requires write access to CustomDomains.
 *     tags: [CustomDomains]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: domainId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Default domain updated successfully
 *       404:
 *         description: Domain not found
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/domains/:domainId/default",
  ...domainWrite,
  validateUuid("domainId"),
  setDefaultDomain,
);

/**
 * @swagger
 * /api/v1/custom-domains/domains/{domainId}/dns:
 *   get:
 *     summary: Get DNS records
 *     description: Retrieves the DNS records required to verify a custom domain. Requires read access to CustomDomains.
 *     tags: [CustomDomains]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: domainId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: DNS records retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cname:
 *                   type: object
 *                   properties:
 *                     host:
 *                       type: string
 *                     value:
 *                       type: string
 *                 txt:
 *                   type: array
 *                   items:
 *                     type: object
 *       404:
 *         description: Domain not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/domains/:domainId/dns",
  ...domainRead,
  validateUuid("domainId"),
  getDnsRecords,
);

module.exports = router;
