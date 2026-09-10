/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication endpoints (register, login, OTP, password reset, session management)
 */

const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const {
  authPreCheck,
  authPostFailure,
  authPostSuccess,
} = require("../../services/rateLimiter.redis.service");

const {
  register,
  login,
  activation,
  sendOTP,
  resetPassword,
  logout,
  logoutAll,
  verify,
  justUpdatePassword,
  passIsValid,
  refresh,
  socketToken,
  setupMfa,
  verifyMfaSetup,
  loginMfa,
  impersonateUser,
} = require("../../controllers/auth.controller");

/* ------------------------------------------------------------------ */
/* REGISTER */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new user
 *     description: Public endpoint - no authentication or permission required. Rate limited to 3 attempts per hour to prevent abuse.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       '201':
 *         description: Registration successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '409':
 *         description: Conflict (email or username already exists)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '429':
 *         description: Too many requests - Rate limited (3 attempts per hour)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/register",
  authPreCheck("register"),
  authPostFailure("register"),
  register,
  authPostSuccess("register"),
);

/* ------------------------------------------------------------------ */
/* ACTIVATION */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/auth/activation:
 *   get:
 *     tags: [Auth]
 *     summary: Activate user account using token
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *           description: Activation token sent via email
 *     responses:
 *       '200':
 *         description: Account activated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '400':
 *         description: Invalid, missing or expired token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '404':
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/activation", activation);

/* ------------------------------------------------------------------ */
/* LOGIN */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in a user
 *     description: Public endpoint - no authentication or permission required. Rate limited to 5 attempts per 15 minutes. Account will be locked for 15 minutes after too many failed attempts. Token is revoked if brute force is detected.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       '200':
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Login successful"
 *                 token:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       '401':
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '429':
 *         description: Too many login attempts - Rate limited (5 attempts per 15 minutes)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '423':
 *         description: Account temporarily locked
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/login",
  authPreCheck("login"),
  authPostFailure("login"),
  login,
  authPostSuccess("login"),
);

/* ------------------------------------------------------------------ */
/* SEND OTP (forgot password) */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/auth/send-otp:
 *   post:
 *     tags: [Auth]
 *     summary: Send OTP for password reset
 *     description: Public endpoint - no authentication or permission required. Rate limited to 3 attempts per 15 minutes to prevent OTP abuse.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SendOtpRequest'
 *     responses:
 *       '200':
 *         description: OTP sent
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '404':
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '429':
 *         description: Too many requests - Rate limited (3 attempts per 15 minutes)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/send-otp",
  authPreCheck("forgotPassword"),
  authPostFailure("forgotPassword"),
  sendOTP,
  authPostSuccess("forgotPassword"),
);

/* ------------------------------------------------------------------ */
/* RESET PASSWORD */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password using OTP
 *     description: Public endpoint - no authentication or permission required. Requires valid OTP sent to email. Rate limited to 5 attempts per 5 minutes.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResetPasswordRequest'
 *     responses:
 *       '200':
 *         description: Password reset successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '400':
 *         description: Invalid OTP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '429':
 *         description: Too many requests - Rate limited (5 attempts per 5 minutes)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/reset-password",
  authPreCheck("resetPassword"),
  authPostFailure("resetPassword"),
  resetPassword,
  authPostSuccess("resetPassword"),
);

/* ------------------------------------------------------------------ */
/* LOGOUT (single session) */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     summary: Log out a single session
 *     description: Requires authentication. Users can revoke their current session. No specific permission required - available to all authenticated users.
 *     responses:
 *       '200':
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post("/logout", auth, logout);

/* ------------------------------------------------------------------ */
/* LOGOUT ALL (requires auth) */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/auth/logout-all:
 *   post:
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     summary: Log out all sessions for the authenticated user
 *     description: Requires authentication. Users can revoke all their active sessions. No specific permission required - available to all authenticated users.
 *     responses:
 *       '200':
 *         description: All sessions revoked successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post("/logout-all", auth, logoutAll);

/**
 * @swagger
 * /api/v1/auth/socket-token:
 *   post:
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     summary: Issue a short-lived JWT for the socket.io handshake
 *     description: >
 *       The app JWT is stored in an httpOnly cookie unreadable by browser JS.
 *       This endpoint (cookie-authenticated via the frontend proxy) returns a
 *       short-lived token (5 minutes) to pass as `auth.token` when opening a
 *       socket.io connection.
 *     responses:
 *       200:
 *         description: Socket token issued successfully
 *       401:
 *         description: Unauthorized
 */
router.post("/socket-token", auth, socketToken);

/* ------------------------------------------------------------------ */
/* VERIFY SESSION (requires auth) */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/auth/verify:
 *   post:
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     summary: Verify a user session
 *     description: Requires authentication. Verifies if the current token is valid. No specific permission required - available to all authenticated users.
 *     responses:
 *       '200':
 *         description: Token valid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '401':
 *         description: Invalid session
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/verify", auth, verify);

/* ------------------------------------------------------------------ */
/* JUST UPDATE PASSWORD (requires auth) */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/auth/just-update-password:
 *   post:
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     summary: Update the password of the logged-in user
 *     description: Requires authentication. Users can update their own password. Uses user:self:update permission implicitly.
 *     responses:
 *       '200':
 *         description: Password updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.post("/just-update-password", auth, justUpdatePassword);

/* ------------------------------------------------------------------ */
/* PASSWORD VALIDITY CHECK (requires auth) */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/auth/pass-is-valid:
 *   post:
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     summary: Check whether the supplied password matches
 *     description: Requires authentication. Verifies if the supplied password matches the user's current password. No specific permission required - available to all authenticated users.
 *     responses:
 *       '200':
 *         description: Password is valid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Password is valid"
 *                 data:
 *                   type: object
 *                   properties:
 *                     valid:
 *                       type: boolean
 */
router.post("/pass-is-valid", auth, passIsValid);

/* ------------------------------------------------------------------ */
/* REFRESH TOKEN */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * /api/v1/auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Refresh an access token using a valid refresh token
 *     description: |
 *       - Requires a valid, unexpired, non-revoked refresh token
 *       - Returns a new access token AND a new refresh token (rotation)
 *       - The old refresh token is revoked immediately
 *       - Supports token binding via sessionId for extra security
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *               sessionId:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Tokens refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Token refreshed successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *       '400':
 *         description: Refresh token is required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         description: Invalid or expired refresh token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/refresh",
  authPreCheck("refreshToken"),
  refresh,
);

/* ------------------------------------------------------------------ */
/* ENTERPRISE SSO & SAML INTEGRATION */
/* ------------------------------------------------------------------ */
/**
 * @swagger
 * tags:
 *   name: SSO
 *   description: Single Sign-On (SSO) and SAML integration endpoints for enterprise authentication
 */
const ssoController = require("../../controllers/sso.controller");

/**
 * @swagger
 * /api/v1/auth/sso/login:
 *   post:
 *     tags: [SSO]
 *     summary: Initiate SSO login for a tenant
 *     description: Starts the SSO/OIDC authentication flow for a specific tenant. Redirects user to the OIDC provider.
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
 *                 description: Tenant code for SSO routing
 *     responses:
 *       '200':
 *         description: SSO flow initiated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '404':
 *         description: Tenant not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/sso/login", ssoController.ssoLogin);

/**
 * @swagger
 * /api/v1/auth/sso/callback:
 *   post:
 *     tags: [SSO]
 *     summary: Handle SSO callback from OIDC provider
 *     description: Receives the authorization code from the OIDC provider, exchanges it for tokens, and establishes a session.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code:
 *                 type: string
 *                 description: Authorization code from OIDC provider
 *               state:
 *                 type: string
 *                 description: State parameter for CSRF protection
 *     responses:
 *       '200':
 *         description: SSO authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *       '400':
 *         description: Invalid authorization code or state mismatch
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/sso/callback", ssoController.ssoCallback);

/**
 * @swagger
 * /api/v1/auth/sso/callback/{tenantCode}:
 *   post:
 *     tags: [SSO]
 *     summary: Handle SSO callback with tenant routing
 *     description: Same as /sso/callback but includes tenant code in URL for multi-tenant routing.
 *     parameters:
 *       - in: path
 *         name: tenantCode
 *         required: true
 *         schema:
 *           type: string
 *         description: Tenant code for routing
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code:
 *                 type: string
 *               state:
 *                 type: string
 *     responses:
 *       '200':
 *         description: SSO authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       '404':
 *         description: Tenant not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/sso/callback/:tenantCode", ssoController.ssoCallback);

/**
 * @swagger
 * /api/v1/auth/sso/oidc/login:
 *   post:
 *     tags: [SSO]
 *     summary: Initiate OIDC login for a tenant
 *     description: Starts the OIDC authentication flow for a specific tenant.
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
 *     responses:
 *       '200':
 *         description: OIDC flow initiated
 */
router.post("/sso/oidc/login", ssoController.oidcLogin);

/**
 * @swagger
 * /api/v1/auth/sso/oidc/callback:
 *   post:
 *     tags: [SSO]
 *     summary: Handle OIDC callback from provider
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code:
 *                 type: string
 *               state:
 *                 type: string
 *     responses:
 *       '200':
 *         description: OIDC authentication successful
 */
router.post("/sso/oidc/callback", ssoController.oidcCallback);

/**
 * @swagger
 * /api/v1/auth/sso/oidc/callback/{tenantCode}:
 *   post:
 *     tags: [SSO]
 *     summary: Handle OIDC callback with tenant routing
 *     parameters:
 *       - in: path
 *         name: tenantCode
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code:
 *                 type: string
 *               state:
 *                 type: string
 *     responses:
 *       '200':
 *         description: OIDC authentication successful
 */
router.post("/sso/oidc/callback/:tenantCode", ssoController.oidcCallback);

/**
 * @swagger
 * /api/v1/auth/sso/metadata:
 *   get:
 *     tags: [SSO]
 *     summary: Get SAML/OIDC provider metadata
 *     description: Returns the OpenID Connect discovery document or SAML metadata for the default tenant.
 *     responses:
 *       '200':
 *         description: SSO metadata returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 issuer:
 *                   type: string
 *                 authorization_endpoint:
 *                   type: string
 *                 token_endpoint:
 *                   type: string
 *                 jwks_uri:
 *                   type: string
 *       '404':
 *         description: SSO not configured
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/sso/metadata", ssoController.ssoMetadata);

/**
 * @swagger
 * /api/v1/auth/sso/metadata/{tenantCode}:
 *   get:
 *     tags: [SSO]
 *     summary: Get tenant-specific SSO metadata
 *     description: Returns SAML/OIDC metadata for a specific tenant.
 *     parameters:
 *       - in: path
 *         name: tenantCode
 *         required: true
 *         schema:
 *           type: string
 *         description: Tenant code
 *     responses:
 *       '200':
 *         description: Tenant SSO metadata returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       '404':
 *         description: Tenant or SSO configuration not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/sso/metadata/:tenantCode", ssoController.ssoMetadata);



/* ------------------------------------------------------------------ */
/* MFA SETUP */
/* ------------------------------------------------------------------ */

/**
 * @swagger
 * /api/v1/auth/mfa/setup:
 *   post:
 *     tags: [Auth]
 *     summary: Generate an MFA secret and QR code for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Returns the MFA secret and QR code data URL
 */
router.post("/mfa/setup", auth, setupMfa);

/**
 * @swagger
 * /api/v1/auth/mfa/verify:
 *   post:
 *     tags: [Auth]
 *     summary: Verify an MFA code to complete the setup process
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *             properties:
 *               code:
 *                 type: string
 *     responses:
 *       '200':
 *         description: MFA successfully enabled
 */
router.post("/mfa/verify", auth, verifyMfaSetup);



/* ------------------------------------------------------------------ */
/* IMPERSONATION */
/* ------------------------------------------------------------------ */

/**
 * @swagger
 * /api/v1/auth/impersonate:
 *   post:
 *     tags: [Auth]
 *     summary: Impersonate a user (Super Admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tenantId
 *               - userId
 *             properties:
 *               tenantId:
 *                 type: string
 *               userId:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Successfully impersonated user
 */
router.post('/impersonate', auth, impersonateUser);

/**
 * @swagger
 * /api/v1/auth/impersonate/exit:
 *   post:
 *     tags: [Auth]
 *     summary: Exit impersonation (revokes session)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Successfully exited impersonation
 */
router.post('/impersonate/exit', auth, logout);

// /mfa/setup and /mfa/verify are registered earlier in this file; the
// duplicate registrations that used to sit here were dead (express matches the
// first). Only /mfa/login is unique to this block.

/**
 * @swagger
 * /api/v1/auth/mfa/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login with MFA token
 *     description: >
 *       Second step of an MFA login. Takes the temporary token issued by
 *       /auth/login plus the current TOTP code, and returns a full session.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, token]
 *             properties:
 *               code:
 *                 type: string
 *                 description: The 6-digit TOTP code.
 *               token:
 *                 type: string
 *                 description: The temporary token returned by /auth/login.
 *     responses:
 *       200:
 *         description: Login successful
 *       400:
 *         description: MFA code and temporary token are required
 *       401:
 *         description: Invalid MFA code, or invalid/expired login token
 */
router.post("/mfa/login", loginMfa);

module.exports = router;
