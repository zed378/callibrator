/**
 * @swagger
 * tags:
 *   name: WebAuthn
 *   description: WebAuthn Passkey Authentication
 */

const express = require("express");
const router = express.Router();
const webauthnController = require("../../controllers/webauthn.controller");
const { auth } = require("../../middlewares/auth.middleware");

router.use(auth);

/**
 * @swagger
 * /api/v1/webauthn/status:
 *   get:
 *     summary: Get WebAuthn enrolment status
 *     description: Returns whether the current user has a passkey enrolled.
 *     tags: [WebAuthn]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: WebAuthn status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                     signCount:
 *                       type: integer
 *                     lastUpdatedAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.get("/status", webauthnController.getStatus);
/**
 * @swagger
 * /api/v1/webauthn/registration-options:
 *   post:
 *     summary: Get WebAuthn registration options
 *     description: Returns the options needed to begin a WebAuthn passkey registration.
 *     tags: [WebAuthn]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Registration options
 *       401:
 *         description: Unauthorized
 */
router.post("/registration-options", webauthnController.getRegistrationOptions);
/**
 * @swagger
 * /api/v1/webauthn/verify-registration:
 *   post:
 *     summary: Verify a WebAuthn registration
 *     description: Verifies the attestation response from a WebAuthn registration ceremony.
 *     tags: [WebAuthn]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: WebAuthn attestation response object
 *     responses:
 *       200:
 *         description: Registration verified
 *       400:
 *         description: Invalid attestation
 *       401:
 *         description: Unauthorized
 */
router.post("/verify-registration", webauthnController.verifyRegistration);
/**
 * @swagger
 * /api/v1/webauthn/login-options:
 *   post:
 *     summary: Get WebAuthn login options
 *     description: Returns the assertion options needed to begin a WebAuthn login ceremony.
 *     tags: [WebAuthn]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Login/assertion options
 *       401:
 *         description: Unauthorized
 */
router.post("/login-options", webauthnController.getLoginOptions);
/**
 * @swagger
 * /api/v1/webauthn/verify-login:
 *   post:
 *     summary: Verify a WebAuthn assertion
 *     description: Verifies the assertion response from a WebAuthn login ceremony.
 *     tags: [WebAuthn]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: WebAuthn assertion response object
 *     responses:
 *       200:
 *         description: Assertion verified
 *       400:
 *         description: Invalid assertion
 *       401:
 *         description: Unauthorized
 */
router.post("/verify-login", webauthnController.verifyLogin);
/**
 * @swagger
 * /api/v1/webauthn/disable:
 *   post:
 *     summary: Disable WebAuthn
 *     description: Disables WebAuthn passkey authentication for the current user.
 *     tags: [WebAuthn]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: WebAuthn disabled
 *       401:
 *         description: Unauthorized
 */
router.post("/disable", webauthnController.disable);

module.exports = router;
