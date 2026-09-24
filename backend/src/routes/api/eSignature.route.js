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
  getEligibleSigners,
  cancelWorkflow,
} = require("../../controllers/eSignature.controller");
const {
  createKeyPair: createKeyPairValidator,
  createWorkflow: createWorkflowValidator,
  cancelWorkflow: cancelWorkflowValidator,
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
const { denyPlatformAuthoring } = require("../../middlewares/denyPlatformAuthoring.middleware"); // A-127, ADR-051 Q-17
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
 *                 meta:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                 data:
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
 *         description: >-
 *           Workflows retrieved successfully. Rows are `data` itself, the count
 *           in a top-level `meta.total` (A-106; formerly `data.workflows`).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 meta:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 */
router.get("/workflows", auth, dynamicAccess(MENU_SLUGS.QMS, "read"), getWorkflows);

/**
 * @swagger
 * /api/v1/e-signature/workflows:
 *   post:
 *     summary: Create a workflow
 *     description: >-
 *       Creates a signature workflow, its steps (one per signer, in order) and
 *       an audit row, in one transaction. Every signer is named by `userId`
 *       and must be an active user of the caller's tenant holding `esignature`
 *       write; the name and email on each step are read from the user record,
 *       and any `name`/`email` in the body is ignored (A-129, F-10). Requires
 *       write access to QMS.
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
 *               - documentId
 *               - subject
 *               - signers
 *             properties:
 *               documentId:
 *                 type: string
 *               subject:
 *                 type: string
 *                 maxLength: 255
 *               message:
 *                 type: string
 *               signers:
 *                 type: array
 *                 minItems: 1
 *                 description: In signing order.
 *                 items:
 *                   type: object
 *                   required: [userId]
 *                   properties:
 *                     userId:
 *                       type: string
 *                       format: uuid
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       400:
 *         description: >-
 *           Validation failed; an email-only (external) signer (A-86); or a
 *           signer who is inactive or does not hold `esignature` write
 *       404:
 *         description: A signer is not a user of this tenant
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
 *     description: >-
 *       Soft-deletes a workflow that carries no signature. A workflow with any
 *       signature — completed, or in progress with some steps signed — cannot
 *       be deleted (409); cancel it instead (A-130, A-144). Requires write
 *       access to QMS.
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
 *       409:
 *         description: The workflow has at least one signature
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

/**
 * @swagger
 * /api/v1/esignature/workflows/{workflowId}/cancel:
 *   post:
 *     summary: Cancel a workflow
 *     description: >-
 *       Cancels an open workflow. Its signatures, if any, are kept and stay
 *       verifiable; no further step can be signed. The cancellation and its
 *       audit row commit together. This is how a workflow with a signature is
 *       withdrawn, since it cannot be deleted (A-130, ADR-051 A-107). Requires
 *       write access to QMS.
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
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 maxLength: 500
 *                 description: Recorded in the audit row.
 *     responses:
 *       200:
 *         description: Workflow cancelled
 *       403:
 *         description: The caller lacks `qms` write
 *       404:
 *         description: Workflow not found (including one in another tenant)
 *       409:
 *         description: The workflow is completed or already cancelled
 */
router.post(
  "/workflows/:workflowId/cancel",
  auth,
  denyApiKey,
  dynamicAccess(MENU_SLUGS.QMS, "write"),
  validateUuid("workflowId"),
  validate(cancelWorkflowValidator),
  cancelWorkflow,
);

/**
 * @swagger
 * /api/v1/esignature/signers:
 *   get:
 *     summary: Users a workflow may name as signers
 *     description: >-
 *       Active users of the caller's tenant who hold `esignature` write — the
 *       rule POST /workflows enforces on every signer (A-129). Each row is
 *       `{ id, name, email }`, sorted by name. Requires write access to QMS
 *       (the permission that creates workflows).
 *     tags: [ESignature]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Rows in `data`, `meta.total` the count
 *       403:
 *         description: The caller lacks `qms` write
 */
router.get("/signers", auth, dynamicAccess(MENU_SLUGS.QMS, "write"), getEligibleSigners);

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
 *               - reason
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
 *                 description: The meaning of the signature (21 CFR 11.50). Required (A-129).
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
 *       409:
 *         description: The step is not pending, or the workflow is cancelled
 */
// A-84 — /sign, /verify and /history carried no permission gate (CLAUDE.md:
// every route needs one). They are gated on their own menu, `esignature`, NOT
// on `qms`: a signer is whoever the workflow names. Since A-129 (ADR-051
// Q-19) the technical roles hold `esignature:write` by default and USER, ROOM
// USER and WAREHOUSE STAFF do not (migration 0031); a workflow cannot name a
// signer without it (checked at creation), so no workflow is left unsignable.
// The gate does not replace the A-65 check in signDocument — only the step's
// own signer signs.
router.post(
  "/sign",
  auth,
  denyApiKey,
  dynamicAccess(MENU_SLUGS.ESIGNATURE, "write"),
  denyPlatformAuthoring,
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
 *     description: >-
 *       Signature history. With `qms` read, the tenant's signatures (the
 *       `userId` filter applies). Without it, only the caller's own
 *       signatures, `userId` ignored, and without `biometricData`,
 *       `ipAddress` or `userAgent` (A-129, F-9). Requires read access to
 *       `esignature`.
 *     tags: [ESignature]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *           format: uuid
 *           description: Filter by user ID (honoured only with `qms` read)
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
 *         description: >-
 *           Signature history retrieved successfully. Rows are `data` itself,
 *           the count in a top-level `meta.total` (A-106; formerly
 *           `data.signatures`).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 meta:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                 data:
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
