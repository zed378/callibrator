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
const { validate } = require("../../middlewares/validation.middleware");
const passkeys = require("../../controllers/webauthnCredentials.controller");
const {
  renamePasskeySchema,
  revokePasskeySchema,
} = require("../../validators/webauthnCredential.validator");

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
 *     description: >-
 *       Removes the current user's passkey. A-213: needs the current password
 *       and, on an account with MFA, a current TOTP `code` or a `recoveryCode`;
 *       audited as WEBAUTHN_DISABLE.
 *     tags: [WebAuthn]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               code: { type: string, description: A current TOTP code (MFA accounts) }
 *               recoveryCode: { type: string, description: Or a recovery code (MFA accounts) }
 *     responses:
 *       200:
 *         description: WebAuthn disabled
 *       400:
 *         description: Re-authentication missing or incorrect
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       409:
 *         description: No passkey is enrolled
 *       429:
 *         description: >-
 *           A-260: the account's signed-in password-check budget is spent
 *           (five wrong passwords in fifteen minutes); Retry-After gives the
 *           seconds until checks resume
 */
router.post("/disable", webauthnController.disable);

// ADR-108 Amendment 1 — several passkeys per user: the caller's own list, and
// rename / revoke one by its row id. Another user's id (in any tenant) is 404.
// Revoking needs the A-213 re-authentication, which is also the lock-out
// guard: the last passkey goes only after the password is proven.
/**
 * @swagger
 * /api/v1/webauthn/credentials:
 *   get:
 *     summary: List my passkeys
 *     description: The caller's own passkeys (id, name, created, last used, transports), oldest first. Never the credential id or key.
 *     tags: [WebAuthn]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The passkeys
 */
router.get("/credentials", passkeys.list);
/**
 * @swagger
 * /api/v1/webauthn/credentials/{id}:
 *   patch:
 *     summary: Rename one of my passkeys
 *     tags: [WebAuthn]
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
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Renamed (audited)
 *       404:
 *         description: Not one of the caller's passkeys (another user's or tenant's id answers the same)
 *   delete:
 *     summary: Remove one of my passkeys
 *     description: >-
 *       Needs the current password (and, with MFA, a current code or recovery code). That proof is the
 *       lock-out guard, so the last passkey goes only after the password sign-in is shown to work. Audited.
 *     tags: [WebAuthn]
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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               currentPassword:
 *                 type: string
 *               code:
 *                 type: string
 *               recoveryCode:
 *                 type: string
 *     responses:
 *       200:
 *         description: Removed; `remaining` passkeys left
 *       400:
 *         description: Re-authentication missing or wrong
 *       404:
 *         description: Not one of the caller's passkeys
 */
router.patch(
  "/credentials/:id",
  validate(renamePasskeySchema, { from: ["params", "body"] }),
  passkeys.rename,
);
router.delete(
  "/credentials/:id",
  validate(revokePasskeySchema, { from: ["params", "body"] }),
  passkeys.revoke,
);

module.exports = router;
