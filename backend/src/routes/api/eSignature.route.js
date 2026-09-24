/**
 * E-Signature Routes
 *
 * Routes for digital signature workflow management (21 CFR Part 11 compliant).
 * Mounted at /api/v1/esignature (see index.js) — NOT /api/v1/e-signature.
 */

const express = require("express");
const router = express.Router();

const { auth, denyApiKey } = require("../../middlewares/auth.middleware");
const {
  getKeyPairs,
  createKeyPair,
  deleteKeyPair,
  getWorkflows,
  createWorkflow,
  getWorkflow,
  updateWorkflow,
  deleteWorkflow,
  signDocument,
  verifySignature,
  getSignatureHistory,
  getSignerWorkflows,
  getSignerWorkflow,
} = require("../../controllers/eSignature.controller");
const {
  createKeyPair: createKeyPairValidator,
  createWorkflow: createWorkflowValidator,
  signDocument: signDocumentValidator,
  verifySignature: verifySignatureValidator,
} = require("../../validators/eSignature.validator");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
// These are Joi SCHEMAS. They were previously passed as `schema.validate`,
// i.e. Joi's own (value, options) method, which express called as
// (req, res, next) — it threw and 500'd every write route. `validate(schema)`
// is the router-facing factory.
const { validate } = require("../../middlewares/validation.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { MENU_SLUGS } = require("../../constants");

// A-28 — authorization.
//
// Until 2026-09-23 key-pair and workflow management carried `auth` and nothing
// else, and the service checked tenant only: any role could delete the
// tenant's signing keys or a workflow mid-signature, and DELETE /key-pairs was
// reachable by any API key while POST /key-pairs was already `denyApiKey`.
//
// The signing keys and the workflows that bind them are quality-system
// records, so they are gated on `qms` (MENU_SLUGS.QMS — read for listing,
// write for mutation). `qms:write` is held by SUPERADMIN, HEALTHCARE ADMIN and
// CALIBRATOR ADMIN; ENGINEERING MANAGER holds read.
//
// Deliberately NOT gated on `qms`: POST /sign, POST /verify and GET /history.
// A signer is whoever the workflow names — commonly a TECHNICIAN with no `qms`
// menu — so gating /sign on `qms:write` would make the workflows unsignable.
// Those three have their own gate, `esignature` (A-84, at the routes below).

/**
 * @swagger
 * /api/v1/e-signature/key-pairs:
 *   get:
 *     summary: Get key pairs
 *     description: Retrieves all RSA key pairs configured for the tenant for digital signatures. Requires read access to ESignature.
 *     tags: [ESignature]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Key pairs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 keyPairs:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       label:
 *                         type: string
 *                       publicKeyFingerprint:
 *                         type: string
 *                       status:
 *                         type: string
 *                         enum: [active, revoked, expired]
 *                       expiresAt:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Unauthorized
 */
router.get("/key-pairs", auth, dynamicAccess(MENU_SLUGS.QMS, "read"), getKeyPairs);

/**
 * @swagger
 * /api/v1/e-signature/key-pairs:
 *   post:
 *     summary: Create a key pair
 *     description: Generates a new RSA key pair for digital signatures. The private key is securely stored. Complies with 21 CFR Part 11 Section 11.50. Requires write access to ESignature.
 *     tags: [ESignature]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - label
 *             properties:
 *               label:
 *                 type: string
 *                 description: Human-readable label for the key pair
 *               algorithm:
 *                 type: string
 *                 enum: [RSA-2048, RSA-4096]
 *                 default: RSA-2048
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *                 description: Key pair expiration date
 *     responses:
 *       201:
 *         description: Key pair created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 label:
 *                   type: string
 *                 publicKeyFingerprint:
 *                   type: string
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/key-pairs",
  auth,
  denyApiKey,
  dynamicAccess(MENU_SLUGS.QMS, "write"),
  validate(createKeyPairValidator),
  createKeyPair,
);

/**
 * @swagger
 * /api/v1/e-signature/key-pairs/{keyPairId}:
 *   delete:
 *     summary: Delete a key pair
 *     description: Revokes and deletes a key pair. Requires write access to ESignature.
 *     tags: [ESignature]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: keyPairId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Key pair deleted successfully
 *       404:
 *         description: Key pair not found
 *       401:
 *         description: Unauthorized
 */
router.delete(
  "/key-pairs/:keyPairId",
  auth,
  denyApiKey,
  dynamicAccess(MENU_SLUGS.QMS, "write"),
  validateUuid("keyPairId"),
  deleteKeyPair,
);

/**
 * @swagger
 * /api/v1/e-signature/workflows:
 *   get:
 *     summary: Get workflows
 *     description: Retrieves all digital signature workflows for the tenant. Requires read access to ESignature.
 *     tags: [ESignature]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, pending, completed, rejected, expired]
 *     responses:
 *       200:
 *         description: Workflows retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workflows:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 */
router.get("/workflows", auth, dynamicAccess(MENU_SLUGS.QMS, "read"), getWorkflows);

/**
 * @swagger
 * /api/v1/e-signature/workflows:
 *   post:
 *     summary: Create a workflow
 *     description: Creates a new digital signature workflow. Defines signers, signing order, and document references. Requires write access to ESignature.
 *     tags: [ESignature]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - signers
 *             properties:
 *               name:
 *                 type: string
 *                 description: Workflow name
 *               description:
 *                 type: string
 *                 description: Workflow description
 *               signers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     userId:
 *                       type: string
 *                       format: uuid
 *                     order:
 *                       type: integer
 *                     message:
 *                       type: string
 *               keyPairId:
 *                 type: string
 *                 format: uuid
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Workflow created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 name:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [draft, pending, completed, rejected, expired]
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/workflows",
  auth,
  denyApiKey,
  dynamicAccess(MENU_SLUGS.QMS, "write"),
  validate(createWorkflowValidator),
  createWorkflow,
);

/**
 * @swagger
 * /api/v1/e-signature/workflows/{workflowId}:
 *   get:
 *     summary: Get workflow details
 *     description: Retrieves detailed information about a specific workflow. Requires read access to ESignature.
 *     tags: [ESignature]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workflowId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Workflow details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 name:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [draft, pending, completed, rejected, expired]
 *                 signers:
 *                   type: array
 *                 documents:
 *                   type: array
 *       404:
 *         description: Workflow not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/workflows/:workflowId",
  auth,
  dynamicAccess(MENU_SLUGS.QMS, "read"),
  validateUuid("workflowId"),
  getWorkflow,
);

/**
 * @swagger
 * /api/v1/e-signature/workflows/{workflowId}:
 *   put:
 *     summary: Update workflow
 *     description: Updates a workflow (only if in draft or pending status). Requires write access to ESignature.
 *     tags: [ESignature]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workflowId
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
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               signers:
 *                 type: array
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Workflow updated successfully
 *       404:
 *         description: Workflow not found
 *       401:
 *         description: Unauthorized
 */
router.put(
  "/workflows/:workflowId",
  auth,
  denyApiKey,
  dynamicAccess(MENU_SLUGS.QMS, "write"),
  validateUuid("workflowId"),
  updateWorkflow,
);

/**
 * @swagger
 * /api/v1/e-signature/workflows/{workflowId}:
 *   delete:
 *     summary: Delete workflow
 *     description: Deletes a workflow (only if in draft status). Requires write access to ESignature.
 *     tags: [ESignature]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workflowId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Workflow deleted successfully
 *       404:
 *         description: Workflow not found
 *       401:
 *         description: Unauthorized
 */
router.delete(
  "/workflows/:workflowId",
  auth,
  denyApiKey,
  dynamicAccess(MENU_SLUGS.QMS, "write"),
  validateUuid("workflowId"),
  deleteWorkflow,
);

// A-91 — the signer's own view. GET /workflows and GET /workflows/:id are
// management and stay on `qms`, which technicians and most other roles do not
// hold; a workflow naming one of them could not be opened, so it could never
// complete. These two are gated on `esignature` (read) — the same menu as
// /sign — and the service returns only workflows in which a step names the
// caller. A workflow they are not named in is 404, like another tenant's.

/**
 * @swagger
 * /api/v1/esignature/my-workflows:
 *   get:
 *     summary: Workflows in which the caller is a named signer
 *     description: >-
 *       Lists the tenant's signature workflows in which one of the steps names
 *       the caller as its signer, newest first, each with its steps ordered by
 *       stepNumber. Steps carry no IP address or user agent. Requires read
 *       access to `esignature` (not `qms`).
 *     tags: [ESignature]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: stepStatus
 *         description: Only workflows where the caller's own step has this status ("pending" = awaiting my signature).
 *         schema:
 *           type: string
 *           enum: [waiting, pending, signed, declined]
 *     responses:
 *       200:
 *         description: Rows in `data`, `meta.total` the count
 *       400:
 *         description: Unknown stepStatus
 *       403:
 *         description: The caller lacks `esignature` read
 */
router.get(
  "/my-workflows",
  auth,
  dynamicAccess(MENU_SLUGS.ESIGNATURE, "read"),
  getSignerWorkflows,
);

/**
 * @swagger
 * /api/v1/esignature/my-workflows/{workflowId}:
 *   get:
 *     summary: One workflow in which the caller is a named signer
 *     description: >-
 *       The workflow and its ordered steps, for a caller named as a signer in
 *       it. Requires read access to `esignature` (not `qms`).
 *     tags: [ESignature]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workflowId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: The workflow in `data`
 *       403:
 *         description: The caller lacks `esignature` read
 *       404:
 *         description: >-
 *           Not found — including a workflow in another tenant, and one that
 *           does not name the caller as a signer
 */
router.get(
  "/my-workflows/:workflowId",
  auth,
  dynamicAccess(MENU_SLUGS.ESIGNATURE, "read"),
  validateUuid("workflowId"),
  getSignerWorkflow,
);

/**
 * @swagger
 * /api/v1/e-signature/sign:
 *   post:
 *     summary: Sign a workflow step
 *     description: >-
 *       Signs one workflow step with the tenant's key pair (21 CFR Part 11).
 *       Only the step's assigned signer may sign it (403 otherwise; a step in
 *       another tenant is 404), and the signer re-authenticates with their
 *       password or MFA code (401 when wrong). The IP address and user agent
 *       recorded are the connection's; body values are ignored (A-65).
 *     tags: [ESignature]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - stepId
 *               - authPayload
 *             properties:
 *               stepId:
 *                 type: string
 *                 format: uuid
 *               authenticationMethod:
 *                 type: string
 *                 enum: [password, mfa]
 *                 default: password
 *               authPayload:
 *                 type: string
 *                 description: The signer's password, or a current MFA code. Never stored.
 *               reason:
 *                 type: string
 *                 maxLength: 255
 *                 description: The meaning of the signature (21 CFR 11.50).
 *               polygon:
 *                 type: object
 *                 nullable: true
 *               biometricData:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       201:
 *         description: Document signed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 signatureId:
 *                   type: string
 *                   format: uuid
 *                 signatureValue:
 *                   type: string
 *                 signedAt:
 *                   type: string
 *                   format: date-time
 *                 auditTrail:
 *                   type: object
 *       400:
 *         description: Validation failed, or MFA requested for an account without MFA
 *       401:
 *         description: Unauthenticated, or re-authentication failed
 *       403:
 *         description: The caller is not this step's signer
 *       404:
 *         description: Step not found (including a step in another tenant)
 */
// A-84 — /sign, /verify and /history carried no permission gate (CLAUDE.md:
// every route needs one). They are gated on their own menu, `esignature`, NOT
// on `qms`: a signer is whoever the workflow names. Every seeded role holds
// `esignature:write` (ROLE_MENU_ASSIGNMENTS; migration 0025 for databases
// seeded earlier), so no role that can be named a signer is locked out, and a
// tenant can now narrow signing per role or per user. The gate does not
// replace the A-65 check in signDocument — only the step's own signer signs.
router.post(
  "/sign",
  auth,
  denyApiKey,
  dynamicAccess(MENU_SLUGS.ESIGNATURE, "write"),
  validate(signDocumentValidator),
  signDocument,
);

/**
 * @swagger
 * /api/v1/e-signature/verify:
 *   post:
 *     summary: Verify a signature
 *     description: Verifies the integrity and authenticity of a digital signature. Returns verification status and audit trail.
 *     tags: [ESignature]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signatureId
 *             properties:
 *               signatureId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Signature verification result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 isValid:
 *                   type: boolean
 *                 verifiedAt:
 *                   type: string
 *                   format: date-time
 *                 auditTrail:
 *                   type: object
 *       404:
 *         description: Signature not found
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/verify",
  auth,
  dynamicAccess(MENU_SLUGS.ESIGNATURE, "read"),
  validate(verifySignatureValidator),
  verifySignature,
);

/**
 * @swagger
 * /api/v1/e-signature/history:
 *   get:
 *     summary: Get signature history
 *     description: Retrieves the complete audit trail of all digital signatures for the tenant. Complies with 21 CFR Part 11 Section 11.10(e). Requires read access to ESignature.
 *     tags: [ESignature]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *           format: uuid
 *           description: Filter by user ID
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Signature history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 signatures:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       workflowId:
 *                         type: string
 *                         format: uuid
 *                       userId:
 *                         type: string
 *                         format: uuid
 *                       signedAt:
 *                         type: string
 *                         format: date-time
 *                       signatureValue:
 *                         type: string
 *                       auditTrail:
 *                         type: object
 *       401:
 *         description: Unauthorized
 */
router.get("/history", auth, dynamicAccess(MENU_SLUGS.ESIGNATURE, "read"), getSignatureHistory);

module.exports = router;
