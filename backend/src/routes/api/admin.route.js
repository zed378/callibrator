/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Super Admin backend management endpoints
 */

const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { rbac } = require("../../middlewares/rbac.middleware");
const {
  getAllTenants,
  updateTenantStatus,
  updateTenantFlags,
} = require("../../controllers/admin.controller");
const { validate } = require("../../middlewares/validation.middleware");
const { updateTenantFlagsSchema } = require("../../validators/admin.validator");
// P10-04 / P10-05 / P10-07 (ADR-098): TypeScript controllers and validators.
const accessRequests = require("../../controllers/accessRequest.controller");
const ssoDomains = require("../../controllers/ssoDomains.controller");
const {
  listAccessRequestsSchema,
  accessRequestIdSchema,
  approveAccessRequestSchema,
  rejectAccessRequestSchema,
  eraseAccessRequestsSchema,
} = require("../../validators/accessRequest.validator");
const { ssoEmailDomainsSchema } = require("../../validators/publicAuth.validator");
const { tenantIdParamsSchema } = ssoDomains;

// All admin routes require SUPER_ADMIN role
router.use(auth);
router.use(rbac(["SUPER_ADMIN", "SUPERADMIN"]));

/**
 * @swagger
 * /api/v1/admin/tenants:
 *   get:
 *     tags: [Admin]
 *     summary: Get all tenants system-wide
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: List of tenants
 */
router.get("/tenants", getAllTenants);

/**
 * @swagger
 * /api/v1/admin/tenants/{id}/status:
 *   patch:
 *     tags: [Admin]
 *     summary: Update tenant status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, suspended, deleted]
 *     responses:
 *       '200':
 *         description: Tenant status updated
 */
router.patch("/tenants/:id/status", updateTenantStatus);

/**
 * @swagger
 * /api/v1/admin/tenants/{id}/flags:
 *   patch:
 *     tags: [Admin]
 *     summary: Update tenant feature flags
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - flags
 *             properties:
 *               flags:
 *                 type: object
 *                 additionalProperties: true
 *     responses:
 *       '200':
 *         description: Tenant flags updated
 */
// A-174: `flags` is a plain object of flag keys to scalar values, and never a
// secret-named key (validators/admin.validator.js).
router.patch("/tenants/:id/flags", validate(updateTenantFlagsSchema), updateTenantFlags);

// ---------------------------------------------------------------------------
// P10-04 (ADR-098 §7.2) — a tenant's SSO email-domain claim, read by the
// public identifier-first discovery. Platform-controlled: super admin only
// (this router's rbac), never a tenant setting a tenant can write.
// Contract: accessRequestAdmin.openapi.ts.
// ---------------------------------------------------------------------------
/**
 * @swagger
 * /api/v1/admin/tenants/{id}/sso-domains:
 *   get:
 *     tags: [Admin]
 *     summary: A tenant's SSO email-domain claim (P10-04)
 *     description: Super admin only. The domains whose sign-in discovery starts this tenant's SSO.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: OK
 */
router.get("/tenants/:id/sso-domains", validate(tenantIdParamsSchema, { from: "params" }), ssoDomains.getDomains);
/**
 * @swagger
 * /api/v1/admin/tenants/{id}/sso-domains:
 *   put:
 *     tags: [Admin]
 *     summary: Set a tenant's SSO email-domain claim (P10-04)
 *     description: Super admin only; replaces the list, audited. 409 when another tenant has claimed a domain; 400 for a public mailbox domain.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [domains]
 *             properties:
 *               domains:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       '200':
 *         description: The saved list
 *       '409':
 *         description: A domain another tenant has claimed
 */
router.put(
  "/tenants/:id/sso-domains",
  validate(ssoEmailDomainsSchema, { from: ["params", "body"] }),
  ssoDomains.putDomains,
);

// ---------------------------------------------------------------------------
// P10-05 / P10-07 (ADR-098 §6) — the access-request queue. Super admin only
// (this router's rbac): approving creates a tenant, a platform operation
// (A-76). The table has no tenant; the :id routes are allow-listed as
// `platform` in the two-tenant guard. Contract: accessRequestAdmin.openapi.ts.
// ---------------------------------------------------------------------------
/**
 * @swagger
 * /api/v1/admin/access-requests:
 *   get:
 *     tags: [Admin]
 *     summary: The access-request queue (P10-07)
 *     description: Super admin only. Rows in data; pagination and per-status counts in a top-level meta. Filtered by the query parameter status (pending, approved, rejected, spam or expired; default pending), paged by page and limit.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: OK
 */
router.get("/access-requests", validate(listAccessRequestsSchema, { from: "query" }), accessRequests.list);
/**
 * @swagger
 * /api/v1/admin/access-requests/erasure:
 *   post:
 *     tags: [Admin]
 *     summary: Erase a requester's access requests by address (DSAR)
 *     description: Super admin only. Requests that never became a tenant are deleted; an approved one keeps its tenant link with its personal fields masked. Audited.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       '200':
 *         description: OK
 */
router.post("/access-requests/erasure", validate(eraseAccessRequestsSchema), accessRequests.erase);
/**
 * @swagger
 * /api/v1/admin/access-requests/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: One access request (P10-07)
 *     description: Super admin only. The request, its decider, its tenant, its invitation state and the other requests from the same address.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: The request
 *       '404':
 *         description: No such request
 */
router.get("/access-requests/:id", validate(accessRequestIdSchema, { from: "params" }), accessRequests.detail);
/**
 * @swagger
 * /api/v1/admin/access-requests/{id}/approve:
 *   post:
 *     tags: [Admin]
 *     summary: Approve an access request (P10-05)
 *     description: Super admin only. In ONE transaction under a row lock - creates the tenant (tenant.service createTenant), its first administrator with no usable password, and a single-use seven-day invitation; audited. The invitation email goes to the request's own address after commit. 409 with a state explanation when the request is not pending, the tenant code or name is taken, or the address already has an account - the request then stays pending.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tenantCode]
 *             properties:
 *               tenantCode:
 *                 type: string
 *               tenantName:
 *                 type: string
 *               adminFirstName:
 *                 type: string
 *               adminLastName:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Approved
 *       '404':
 *         description: No such request
 *       '409':
 *         description: Not pending, or a clash (state explained)
 */
router.post(
  "/access-requests/:id/approve",
  validate(approveAccessRequestSchema, { from: ["params", "body"] }),
  accessRequests.approve,
);
/**
 * @swagger
 * /api/v1/admin/access-requests/{id}/reject:
 *   post:
 *     tags: [Admin]
 *     summary: Reject an access request, or mark it spam (P10-05)
 *     description: Super admin only; a reason is required; audited. 409 when the request is not pending.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *               spam:
 *                 type: boolean
 *     responses:
 *       '200':
 *         description: Rejected
 *       '404':
 *         description: No such request
 *       '409':
 *         description: Not pending
 */
router.post(
  "/access-requests/:id/reject",
  validate(rejectAccessRequestSchema, { from: ["params", "body"] }),
  accessRequests.reject,
);
/**
 * @swagger
 * /api/v1/admin/access-requests/{id}/resend-invitation:
 *   post:
 *     tags: [Admin]
 *     summary: Re-issue an approved request's invitation (P10-07)
 *     description: Super admin only. A new token; the old one stops working; audited. 409 when the request is not approved or the invitation was already accepted.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: Re-issued
 *       '409':
 *         description: Nothing to re-issue
 */
router.post(
  "/access-requests/:id/resend-invitation",
  validate(accessRequestIdSchema, { from: "params" }),
  accessRequests.resendInvitation,
);

module.exports = router;
