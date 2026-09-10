// auth.service.js
const { AppError } = require("../utils/appError.util");
const crypto = require("crypto");
const { Op } = require("sequelize");
const { db } = require("../config");
const { Users, Role } = require("../models");
const { hashPassword, comparePassword } = require("../utils/password.util");
const {
  generateAccessToken,
  verifyAccessToken,
  generateOpaqueRefreshToken,
} = require("../utils/jwt.util");
// Email service (sendOtpEmail/sendActivationEmail not used — emailQueue.service is used instead)
const {
  queueActivationEmail,
  queueOtpEmail,
} = require("../services/emailQueue.service");
const {
  validate: validateInput,
  formatErrors,
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require("../validators/auth.validator");
const {
  acquireLock,
  releaseLock,
  // get not used
  set,
  del,
  cacheKeys,
} = require("../services/redis.service");
const { logger } = require("../middlewares/activityLog.middleware");
const {
  createSession,
  validateSession,
  revokeSession,
  revokeAllSessions,
} = require("../services/session.service");
const { PASSWORD_MIN_LENGTH, ROLE_IDS } = require("../constants");

const validate = (data, schema) => {
  const { error, value } = validateInput(data, schema);
  if (error) {
    throw new AppError(
      400,
      "Validation failed",
      true,
      formatErrors(error.details),
    );
  }
  return value;
};

// Safe user attributes — exclude sensitive/secret fields (used by user.service)
// const safeUserAttrs = { exclude: ["updatedAt", "otpCode", ...] };

// ------------------------------------------------------------------
// REGISTER USER
// ------------------------------------------------------------------
exports.registerUser = async (input, origin) => {
  const data = validate(input, registerSchema);
  const { firstName, lastName, username, email, password } = data;
  const baseOrigin = origin || "";
  const lockKey = `register:${email}:${username}`;
  const lockId = await acquireLock(lockKey, 10000);
  if (!lockId) {
    throw new AppError(
      429,
      "Registration in progress. Please wait and try again.",
    );
  }

  let transaction;
  try {
    transaction = await db.transaction();

    const existingUser = await Users.findOne({
      where: { email },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (existingUser) {
      await transaction.rollback();
      throw new AppError(409, "Email already registered");
    }

    const existingUsername = await Users.findOne({
      where: { username },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (existingUsername) {
      await transaction.rollback();
      throw new AppError(409, "Username already used");
    }

    const hashedPassword = await hashPassword(password);

    const user = await Users.create(
      {
        firstName,
        lastName,
        username,
        email,
        password: hashedPassword,
        roleId: ROLE_IDS.USER,
        isEmailVerified: false,
      },
      { transaction },
    );

    await transaction.commit();

    // Cache user lookup
    await set(cacheKeys.userByEmail(email), user.id, 86400);
    await set(cacheKeys.userByUsername(username), user.id, 86400);

    // Generate activation token
    const activationToken = generateAccessToken({ id: user.id });
    const activationLink = baseOrigin + "/activation?token=" + activationToken;

    // Queue activation email (async, non-blocking).
    // queueActivationEmail takes ONE destructured object — it was being called
    // as (email, {...}), so every field was destructured off the email STRING
    // and arrived undefined, sending activation mail with no recipient/link.
    try {
      queueActivationEmail({ email, firstName, lastName, activationLink });
    } catch (e) {
      logger.warn("queueActivationEmail failed", { err: e.message });
    }

    logger.info("User registered", { userId: user.id, email });
    return { success: true, status: 201, message: "Registration successful" };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    throw error;
  } finally {
    /* istanbul ignore else -- a falsy lockId throws above (before the try), so
       this finally block is only ever reached with a truthy lockId. */
    if (lockId) {
      await releaseLock(lockKey, lockId).catch(() => {});
    }
  }
};

// ------------------------------------------------------------------
// LOGIN USER
// ------------------------------------------------------------------
exports.loginUser = async (input) => {
  const validated = validate(input, loginSchema);
  const loginIdentifier =
    validated.user || validated.username || validated.email;
  const password = validated.password;
  // Normalize: schema uses 'user' (email or username), service uses 'username'
  const username = typeof loginIdentifier === "string" ? loginIdentifier : null;
  if (!username) {
    throw new AppError(401, "Invalid credentials");
  }
  const { ip, userAgent } = input;

  // Support login by username OR email
  const dbUser = await Users.findOne({
    where: {
      [Op.or]: [{ username }, { email: username }],
    },
    include: [
      {
        model: Role,
        as: "role",
        attributes: ["id", "name"],
        required: false,
      },
    ],
  });
  if (!dbUser) {
    throw new AppError(401, "Invalid credentials");
  }
  if (!dbUser.isActive) {
    throw new AppError(403, "Account is suspended");
  }

  const lockedUntil = dbUser.lockedUntil;
  if (lockedUntil && new Date(lockedUntil) > new Date()) {
    throw new AppError(423, "Account temporarily locked");
  }

  const match = await comparePassword(password, dbUser.password);
  if (!match) {
    const attempts = (dbUser.failedLoginAttempts || 0) + 1;
    await dbUser.update({ failedLoginAttempts: attempts });

    if (attempts >= 5) {
      await dbUser.update({
        lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
      });
      throw new AppError(423, "Account locked due to too many failed attempts");
    }
    throw new AppError(401, "Invalid credentials");
  }

  // Reset failed attempts on success
  if (dbUser.failedLoginAttempts > 0) {
    await dbUser.update({ failedLoginAttempts: 0, lockedUntil: null });
  }

  // Update last login
  await dbUser.update({ lastLoginAt: new Date() });

  const accessToken = generateAccessToken({
    id: dbUser.id,
    email: dbUser.email,
  });
  const refreshToken = generateOpaqueRefreshToken();

  // Create session
  const session = await createSession({
    tenantId: dbUser.tenantId,
    userId: dbUser.id,
    refreshToken,
    ipAddress: ip || "",
    userAgent: userAgent || "",
    expiredAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });

  // If MFA is enabled, issue a temporary token and require the second factor
  if (dbUser.mfaEnabled) {
    const mfaToken = generateAccessToken({
      id: dbUser.id,
      email: dbUser.email,
      mfaRequired: true
    }, { expiresIn: '5m' });

    return {
      success: true,
      status: 202, // Accepted, but not complete
      message: "MFA required",
      data: {
        id: dbUser.id,
        username: dbUser.username,
        email: dbUser.email,
        mfaRequired: true
      },
      token: mfaToken,
      refreshToken: null
    };
  }

  // Include role info with the user data
  const role = dbUser.role
    ? {
        id: dbUser.role.id,
        name: dbUser.role.name,
      }
    : null;

  return {
    success: true,
    status: 200,
    message: "Login successful",
    data: {
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      first_name: dbUser.first_name,
      last_name: dbUser.last_name,
      picture: dbUser.picture,
      roleId: dbUser.roleId,
      role,
      tenantId: dbUser.tenantId,
      mfaEnabled: !!dbUser.mfaEnabled,
    },
    token: accessToken,
    refreshToken,
    session,
  };
};

// ------------------------------------------------------------------
// ACTIVATE ACCOUNT
// ------------------------------------------------------------------
exports.activateAccount = async (token) => {
  const decoded = verifyAccessToken(token);
  const user = await Users.findByPk(decoded.id);
  if (!user) {
    throw new AppError(404, "User not found");
  }

  if (user.isEmailVerified) {
    return { success: true, status: 200, message: "Account already activated" };
  }

  await user.update({ isEmailVerified: true });
  await del(cacheKeys.userByEmail(user.email));
  await del(cacheKeys.userByUsername(user.username));

  logger.info("Account activated", { userId: user.id });
  return {
    success: true,
    status: 200,
    message: "Account activated successfully",
  };
};

// ------------------------------------------------------------------
// REQUEST OTP
// ------------------------------------------------------------------
exports.requestOTP = async (input) => {
  const { email } = validate(input, forgotPasswordSchema);

  const user = await Users.findOne({ where: { email } });
  if (!user) {
    return {
      success: true,
      status: 200,
      message: "If the account exists, OTP has been sent",
    };
  }

  // Cryptographically secure 6-digit OTP (Math.random is predictable).
  const otpCode = crypto.randomInt(100000, 1000000).toString();
  const otpHashed = crypto.createHash("sha256").update(otpCode).digest("hex");
  const otpExpiredAt = new Date(Date.now() + 5 * 60 * 1000);

  await user.update({
    otpCode: otpHashed,
    otpExpiredAt: otpExpiredAt,
    otpRequestCount: (user.otpRequestCount || 0) + 1,
    otpLastRequestedAt: new Date(),
  });

  // queueOtpEmail takes ONE destructured object — it was being called as
  // (email, {...}), so email/otp were destructured off the email STRING and
  // arrived undefined: password-reset mail went out with no recipient and no
  // code.
  try {
    queueOtpEmail({
      email,
      firstName: user.firstName,
      lastName: user.lastName,
      otp: otpCode,
    });
  } catch (e) {
    logger.warn("queueOtpEmail failed", { err: e.message });
  }

  return { success: true, status: 200, message: "OTP sent" };
};

// ------------------------------------------------------------------
// PROCESS RESET PASSWORD
// ------------------------------------------------------------------
exports.processResetPassword = async (input) => {
  // The schema field is `password` (see resetPasswordSchema); this used to
  // destructure `newPassword`, which is never present after Joi's
  // stripUnknown. Validation still passed, so the reset ran with
  // hashPassword(undefined) and silently replaced the user's password with a
  // hash of `undefined` — locking them out of their account.
  const { email, otp, password: newPassword } = validate(
    input,
    resetPasswordSchema,
  );

  const user = await Users.findOne({ where: { email } });
  // Never reveal whether the account exists — an unknown email returns the
  // same generic error as a wrong code, preventing user enumeration on reset.
  if (!user) {
    throw new AppError(400, "Invalid OTP");
  }

  // Verify OTP (a null stored otpCode never equals a real hash, so this also
  // covers the "no reset requested" case).
  const providedHash = crypto.createHash("sha256").update(otp).digest("hex");
  if (user.otpCode !== providedHash) {
    throw new AppError(400, "Invalid OTP");
  }
  if (new Date(user.otpExpiredAt) <= new Date()) {
    throw new AppError(400, "OTP expired");
  }

  // Update password and clear OTP
  const hashedPassword = await hashPassword(newPassword);
  await user.update({
    password: hashedPassword,
    otpCode: null,
    otpExpiredAt: null,
    passwordChangedAt: new Date(),
  });

  // Revoke all sessions — invalidates all active refresh tokens
  await revokeAllSessions(user.id, "PASSWORD_RESET");

  return { success: true, status: 200, message: "Password reset successful" };
};

// ------------------------------------------------------------------
// VERIFY USER SESSION
// ------------------------------------------------------------------
exports.verifyUserSession = async (userId, _session) => {
  const user = await Users.findByPk(userId, {
    include: [
      {
        model: Role,
        as: "role",
        attributes: ["id", "name"],
        required: false,
      },
    ],
  });
  if (!user) {
    throw new AppError(401, "Invalid session");
  }
  if (!user.isActive) {
    throw new AppError(403, "Account is suspended");
  }
  return {
    success: true,
    status: 200,
    message: "Token valid",
    data: {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      first_name: user.first_name,
      last_name: user.last_name,
      picture: user.picture,
      roleId: user.roleId,
      role: user.role ? { id: user.role.id, name: user.role.name } : null,
      tenantId: user.tenantId,
    },
  };
};

// ------------------------------------------------------------------
// GET AUTH USER (FOR MIDDLEWARE)
// ------------------------------------------------------------------
exports.getAuthUserWithTenant = async (userId) => {
  const { Roles, Tenants } = require("../models");
  return await Users.findByPk(userId, {
    include: [
      {
        model: Roles,
        as: "role",
        attributes: ["id", "name", "description"],
        required: false,
      },
      {
        model: Tenants,
        as: "tenant",
        attributes: ["id", "name", "status"],
        required: false,
      },
    ],
  });
};

// ------------------------------------------------------------------
// JUST UPDATE PASSWORD
// ------------------------------------------------------------------
exports.justUpdatePassword = async (userId, newPassword, currentPassword) => {
  if (!newPassword || newPassword.length < PASSWORD_MIN_LENGTH) {
    throw new AppError(
      400,
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    );
  }
  const user = await Users.findByPk(userId);
  if (!user) {
    throw new AppError(404, "User not found");
  }
  // Re-authenticate: holding a valid session must NEVER be enough to change a
  // password. Without this, a stolen/hijacked token allows account takeover,
  // and any client-side "current password" check is trivially bypassed.
  if (!currentPassword) {
    throw new AppError(400, "Current password is required");
  }
  const currentMatches = await comparePassword(currentPassword, user.password);
  if (!currentMatches) {
    throw new AppError(400, "Current password is incorrect");
  }
  await user.update({
    password: await hashPassword(newPassword),
    passwordChangedAt: new Date(),
  });
  // Revoke all sessions — invalidates all active refresh tokens
  await revokeAllSessions(userId, "PASSWORD_CHANGED");
  return {
    success: true,
    status: 200,
    message: "Password updated successfully",
  };
};

// ------------------------------------------------------------------
// CHECK PASSWORD VALIDITY
// ------------------------------------------------------------------
exports.passIsValid = async (userId, password) => {
  const user = await Users.findByPk(userId);
  if (!user) {
    throw new AppError(404, "User not found");
  }
  const match = await comparePassword(password, user.password);
  // 200 with `data.valid` is intentional (this is a check endpoint), but the
  // message must reflect the result — callers that only read the message or
  // the success flag were treating a wrong password as valid.
  return {
    success: true,
    status: 200,
    message: match ? "Password is valid" : "Password is incorrect",
    data: { valid: match },
  };
};

// ------------------------------------------------------------------
// LOGOUT SESSION
// ------------------------------------------------------------------
exports.logoutSession = async (req) => {
  const token = req.token || null;
  if (token) {
    await revokeSession(token, "LOGOUT");
  }
  return { success: true, status: 200, message: "Logout successful" };
};

// ------------------------------------------------------------------
// REFRESH USER TOKEN
// ------------------------------------------------------------------
exports.refreshUserToken = async (
  refreshToken,
  sessionId = null,
  ipAddress = null,
  userAgent = null,
) => {
  // 1. Validate the opaque token hash against sessions table
  const session = await validateSession(refreshToken);

  if (!session) {
    throw new AppError(401, "Invalid or expired refresh token");
  }

  // 2. Token binding check (optional but recommended)
  if (sessionId && session.id !== sessionId) {
    await revokeAllSessions(session.user_id, "TOKEN_MISMATCH");
    throw new AppError(
      401,
      "Session mismatch. All sessions have been revoked for security.",
    );
  }

  // 3. Generate new opaque refresh token
  const newRefreshToken = generateOpaqueRefreshToken();

  // 4. Generate new access token
  const user = await Users.findByPk(session.user_id);
  if (!user) {
    throw new AppError(401, "User not found");
  }

  const newAccessToken = generateAccessToken({
    id: user.id,
    email: user.email,
  });

  // 5. Revoke old session (token rotation)
  await revokeSession(refreshToken, "TOKEN_ROTATION");

  // 6. Create new session with new token
  const newSession = await createSession({
    tenantId: session.tenant_id,
    userId: session.user_id,
    refreshToken: newRefreshToken,
    ipAddress: ipAddress || session.ip_address,
    userAgent: userAgent || session.user_agent,
    device: session.device,
    expiredAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });

  return {
    success: true,
    status: 200,
    message: "Token refreshed successfully",
    data: {
      token: newAccessToken,
      refreshToken: newRefreshToken,
      session: newSession,
    },
  };
};

// ------------------------------------------------------------------
// LOGOUT ALL SESSIONS
// ------------------------------------------------------------------
exports.logoutAllUserSessions = async (userId) => {
  // NOTE: this used to also call `del(cacheKeys.userSessions(userId))`.
  // `cacheKeys` has no `userSessions` member (see redis.service.js), so that
  // threw "cacheKeys.userSessions is not a function" on every call — logging
  // out of all sessions always failed. Nothing caches a per-user session list
  // either (this was its only reference), so the call was dead as well as
  // broken. revokeAllSessions is the operation that actually matters.
  await revokeAllSessions(userId, "USER_REQUESTED");
  return {
    success: true,
    status: 200,
    message: "All sessions revoked successfully",
  };
};

// ------------------------------------------------------------------
// MFA LOGIN
// ------------------------------------------------------------------
exports.loginMfa = async (userId, tokenCode, inputIp, inputUserAgent) => {
  const { authenticator } = require("otplib");
  
  const dbUser = await Users.findByPk(userId, {
    include: [
      {
        model: Role,
        as: "role",
        attributes: ["id", "name"],
      },
    ],
  });
  
  if (!dbUser || !dbUser.mfaEnabled || !dbUser.mfaSecret) {
    throw new AppError(400, "MFA is not enabled for this account");
  }

  const isValid = authenticator.check(tokenCode, dbUser.mfaSecret);
  if (!isValid) {
    throw new AppError(401, "Invalid MFA code");
  }

  // Update last login
  await dbUser.update({ lastLoginAt: new Date() });

  const accessToken = generateAccessToken({
    id: dbUser.id,
    email: dbUser.email,
  });
  const refreshToken = generateOpaqueRefreshToken();

  // Create session
  const session = await createSession({
    tenantId: dbUser.tenantId,
    userId: dbUser.id,
    refreshToken,
    ipAddress: inputIp || "",
    userAgent: inputUserAgent || "",
    expiredAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });

  const role = dbUser.role ? { id: dbUser.role.id, name: dbUser.role.name } : null;

  return {
    success: true,
    status: 200,
    message: "Login successful",
    data: {
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      first_name: dbUser.first_name,
      last_name: dbUser.last_name,
      picture: dbUser.picture,
      roleId: dbUser.roleId,
      role,
      tenantId: dbUser.tenantId,
      mfaEnabled: true,
    },
    token: accessToken,
    refreshToken,
    session,
  };
};

// ------------------------------------------------------------------
// SETUP MFA
// ------------------------------------------------------------------
exports.setupMfa = async (userId) => {
  const { authenticator } = require("otplib");
  const qrcode = require("qrcode");

  const dbUser = await Users.findByPk(userId);
  if (!dbUser) {
    throw new AppError(404, "User not found");
  }

  // Generate a new secret
  const secret = authenticator.generateSecret();
  
  // Create otpauth url
  const otpauth = authenticator.keyuri(dbUser.email, "Callibrator", secret);
  
  // Generate QR Code data URL
  const qrCodeUrl = await qrcode.toDataURL(otpauth);
  
  // Save secret temporarily (we will only enable it if verified)
  await dbUser.update({ mfaSecret: secret });

  return {
    secret,
    qrCodeUrl
  };
};

// ------------------------------------------------------------------
// VERIFY MFA SETUP
// ------------------------------------------------------------------
exports.verifyMfaSetup = async (userId, tokenCode) => {
  const { authenticator } = require("otplib");
  
  const dbUser = await Users.findByPk(userId);
  if (!dbUser) {
    throw new AppError(404, "User not found");
  }
  
  if (!dbUser.mfaSecret) {
    throw new AppError(400, "MFA setup has not been initiated");
  }

  const isValid = authenticator.check(tokenCode, dbUser.mfaSecret);
  if (!isValid) {
    throw new AppError(400, "Invalid MFA code");
  }

  await dbUser.update({ mfaEnabled: true });

  return {
    success: true,
    message: "MFA enabled successfully"
  };
};

// ------------------------------------------------------------------
// IMPERSONATE USER
// ------------------------------------------------------------------
exports.impersonateUser = async (superAdminId, targetTenantId, targetUserId, inputIp, inputUserAgent) => {
  // Validate caller is Super Admin
  const superAdmin = await Users.findByPk(superAdminId, {
    include: [{ model: Role, as: "role" }],
  });

  if (!superAdmin || superAdmin.role?.name !== "SUPER_ADMIN" && superAdmin.role?.name !== "SUPERADMIN") {
    throw new AppError(403, "Only Super Admins can impersonate users");
  }

  // Find target user
  const targetUser = await Users.findOne({
    where: { id: targetUserId, tenantId: targetTenantId },
    include: [{ model: Role, as: "role" }],
  });

  if (!targetUser) {
    throw new AppError(404, "Target user not found in the specified tenant");
  }
  
  if (targetUser.id === superAdmin.id) {
    throw new AppError(400, "Cannot impersonate yourself");
  }

  // Issue tokens for the target user, but with the impersonator claim
  const accessToken = generateAccessToken({
    id: targetUser.id,
    email: targetUser.email,
    impersonatorId: superAdmin.id, // THE CRITICAL CLAIM
  });
  
  const refreshToken = generateOpaqueRefreshToken();

  // Create a session for the target user, but we should track that it's an impersonated session
  // For now, we just create a normal session for them
  const session = await createSession({
    tenantId: targetUser.tenantId,
    userId: targetUser.id,
    refreshToken,
    ipAddress: inputIp || "",
    userAgent: (inputUserAgent || "") + " (Impersonated by " + superAdmin.email + ")",
    expiredAt: new Date(Date.now() + 1 * 60 * 60 * 1000), // 1 hour for impersonation
  });

  const { logger } = require("../middlewares/activityLog.middleware");
  logger.info(`SUPER_ADMIN ${superAdmin.email} impersonated user ${targetUser.email} (Tenant: ${targetTenantId})`);

  const role = targetUser.role ? { id: targetUser.role.id, name: targetUser.role.name } : null;

  return {
    success: true,
    status: 200,
    message: `Successfully impersonating ${targetUser.email}`,
    data: {
      id: targetUser.id,
      username: targetUser.username,
      email: targetUser.email,
      firstName: targetUser.firstName,
      lastName: targetUser.lastName,
      first_name: targetUser.first_name,
      last_name: targetUser.last_name,
      picture: targetUser.picture,
      roleId: targetUser.roleId,
      role,
      tenantId: targetUser.tenantId,
      isImpersonating: true,
    },
    token: accessToken,
    refreshToken,
    session,
  };
};
