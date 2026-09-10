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
router.get("/key-pairs", auth, getKeyPairs);

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
router.post("/key-pairs", auth, denyApiKey, validate(createKeyPairValidator), createKeyPair);

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
router.get("/workflows", auth, getWorkflows);

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
router.post("/workflows", auth, validate(createWorkflowValidator), createWorkflow);

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
  validateUuid("workflowId"),
  deleteWorkflow,
);

/**
 * @swagger
 * /api/v1/e-signature/sign:
 *   post:
 *     summary: Sign a document
 *     description: Signs a document using the user's key pair and records the signature. Complies with 21 CFR Part 11 Section 11.10(a). Requires write access to ESignature.
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
 *               - workflowId
 *               - documentId
 *             properties:
 *               workflowId:
 *                 type: string
 *                 format: uuid
 *               documentId:
 *                 type: string
 *                 format: uuid
 *               keyPairId:
 *                 type: string
 *                 format: uuid
 *               signatureReason:
 *                 type: string
 *               signatureLocation:
 *                 type: string
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
 *       401:
 *         description: Unauthorized
 */
router.post("/sign", auth, denyApiKey, validate(signDocumentValidator), signDocument);

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
router.post("/verify", auth, validate(verifySignatureValidator), verifySignature);

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
router.get("/history", auth, getSignatureHistory);

module.exports = router;
