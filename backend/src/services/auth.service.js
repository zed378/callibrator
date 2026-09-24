// auth.service.js
const { AppError } = require("../utils/appError.util");
const crypto = require("crypto");
const { Op } = require("sequelize");
const { db } = require("../config");
const { Users, Role, Tenants } = require("../models");
const { hashPassword, comparePassword } = require("../utils/password.util");
const {
  generateAccessToken,
  generatePurposeToken,
  verifyPurposeToken,
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
  revokeSessionById,
  revokeOtherSessions,
  getCurrentSessionId,
} = require("../services/session.service");
const { PASSWORD_MIN_LENGTH, ROLE_IDS } = require("../constants");
const auditService = require("./audit.service");
// A-99: the one place TOTP is done, on the otplib 13 API. `authenticator`,
// which this file used to take from otplib, does not exist in otplib 13.
const mfaService = require("./mfa.service");
const {
  MFA_POLICY_KEYS,
  NO_POLICY: NO_MFA_POLICY,
  parseMfaPolicy,
} = require("../utils/mfaPolicy.util");

// User statuses auth.middleware refuses on every request (and config/socket.js
// at the handshake). A login is refused for the same set, so no session or
// LOGIN audit row is created for a principal that could never use it.
// A-180: "erased" is what a GDPR anonymisation writes (gdpr.service).
const REFUSED_STATUSES = ["INACTIVE", "SUSPENDED", "erased"];

// ------------------------------------------------------------------
// A-83 — THE TENANT IS CHECKED AT SIGN-IN, NOT ONLY AFTER IT
//
// auth.middleware refuses every request from a user whose tenant is suspended
// or deleted, but password login, the MFA step and the SSO exchange did not
// ask — so each created a session and a LOGIN audit row for a sign-in whose
// token no request would accept. Each sign-in point now loads the tenant with
// the user (tenantInclude()) and refuses through tenantRefusal().
//
// A user whose tenantId names no tenant the include can see is refused as
// deleted: the Tenant model's default scope hides a soft-deleted tenant
// (isDeleted) and paranoid hides a destroyed one, so that is what "not found"
// means here. auth.middleware (auth, optionalAuth) and the Socket.IO handshake
// apply the same rule to every request since A-101.
// ------------------------------------------------------------------

const REFUSED_TENANT_STATUSES = ["suspended", "deleted"];

/**
 * The tenant projection every sign-in point loads with the user. A fresh
 * object per query: Sequelize annotates include options in place.
 *
 * @returns {object} a Sequelize include
 */
const tenantInclude = () => ({
  model: Tenants,
  as: "tenant",
  attributes: ["id", "status"],
  // An optional include without `required: false` is an INNER JOIN, and a
  // user whose tenant is gone would come back as "no such user".
  required: false,
});

/**
 * Why this user's tenant may not sign in, or null when it may.
 *
 * @param {{tenantId?: string|null, tenant?: {status?: string}|null}} user -
 *   loaded with tenantInclude()
 * @returns {string|null} the refusal message (answered with 403)
 */
const tenantRefusal = (user) => {
  if (!user.tenantId) {
    return null;
  }
  if (!user.tenant) {
    return "Tenant account is deleted";
  }
  const status = String(user.tenant.status || "").toLowerCase();
  return REFUSED_TENANT_STATUSES.includes(status)
    ? `Tenant account is ${status}`
    : null;
};

exports.tenantInclude = tenantInclude;
exports.tenantRefusal = tenantRefusal;

/**
 * Audit a change to a user's own credentials — password, second factor —
 * INSIDE its transaction, so a failed insert rolls the change back (A-41).
 * `changes` never carries a secret: audit_logs is permanent.
 *
 * audit_logs.tenant_id is NOT NULL, so a tenant-less principal (a platform
 * super admin) has no trail to write into; the change proceeds with an
 * `error` log as the evidence — the rule openLoginSession and verifyMfaSetup
 * already follow. Refusing would lock such an account out of its own
 * security controls on an audit-schema constraint.
 *
 * @param {object} transaction
 * @param {object} entry
 * @param {{id: string, tenantId: string|null}} entry.user - the account
 *   changed, which is also the actor: every caller is the user acting on
 *   their own credentials
 * @param {string} entry.operation - changes.operation
 * @param {object} entry.details - more non-secret fields for `changes`
 * @param {string|null} [entry.ipAddress]
 * @param {string|null} [entry.userAgent]
 * @returns {Promise<void>}
 */
const auditCredentialChange = async (
  transaction,
  { user, operation, details, ipAddress = null, userAgent = null },
) => {
  if (!user.tenantId) {
    logger.error("Credential change not audited: the user has no tenant", {
      userId: user.id,
      operation,
    });
    return;
  }
  await auditService.logAction(
    {
      tenantId: user.tenantId,
      userId: user.id,
      action: "UPDATE",
      resourceType: "User",
      resourceId: user.id,
      changes: { operation, ...details },
      ipAddress,
      userAgent,
    },
    { transaction },
  );
};

exports.auditCredentialChange = auditCredentialChange;

/**
 * How many unused MFA recovery codes the account has (A-141). A count, never
 * a code.
 *
 * @param {{mfaRecoveryCodes?: string[]|null}} user
 * @returns {number}
 */
const recoveryCodesRemaining = (user) =>
  Array.isArray(user.mfaRecoveryCodes) ? user.mfaRecoveryCodes.length : 0;

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

    // Generate activation token. A-59: a purpose token, not an access token —
    // it travels by email (forwarded, archived, logged), so it must not work
    // as a bearer credential. Only activateAccount accepts it.
    const activationToken = generatePurposeToken({ id: user.id }, "activation");
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
// A-72 — A LOGIN IS A SESSION AND ITS AUDIT ROW, OR NEITHER
//
// SSO sign-in has written a LOGIN audit row since A-60; password and MFA login
// wrote none, so "who accessed the system, when" (21 CFR 11.10(e), ISO 27001
// A.8.15) existed for SSO users only. The session and the row are written in
// ONE transaction — the same shape as sso.controller's issueSsoTokens: CLS
// (config/index.js) carries the transaction into createSession, and logAction
// takes it explicitly, so a failed audit insert rolls the session back and the
// login fails rather than succeeding unattributed.
//
// A user with no tenant cannot be audited — audit_logs.tenant_id is NOT NULL —
// so that login proceeds with an `error` log instead of a row. Refusing it
// would lock such an account out on an audit-schema constraint; the log is the
// evidence that it happened.
// ------------------------------------------------------------------

/**
 * @param {object} params
 * @param {{id: string, tenantId: string|null}} params.user
 * @param {string} params.refreshToken
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 * @param {"password"|"password+totp"|"password+recovery_code"} params.method
 * @param {(transaction: object) => Promise<object>} [params.secondFactor] -
 *   A-141: spends a one-time factor INSIDE the transaction and returns extra
 *   non-secret audit fields; it throws to refuse. A recovery code is spent
 *   only if the session and its LOGIN row commit.
 * @returns {Promise<object>} the session row
 */
const openLoginSession = ({ user, refreshToken, ipAddress, userAgent, method, secondFactor }) =>
  db.transaction(async (transaction) => {
    const details = secondFactor ? await secondFactor(transaction) : {};
    const session = await createSession({
      tenantId: user.tenantId,
      userId: user.id,
      refreshToken,
      ipAddress: ipAddress || "",
      userAgent: userAgent || "",
      expiredAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    });
    if (!user.tenantId) {
      logger.error("LOGIN not audited: the user has no tenant", {
        userId: user.id,
        sessionId: session.id,
        method,
      });
      return session;
    }
    await auditService.logAction(
      {
        tenantId: user.tenantId,
        userId: user.id,
        action: "LOGIN",
        resourceType: "Session",
        resourceId: session.id,
        changes: { method, ...details },
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
      { transaction },
    );
    return session;
  });

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
        // ADR-043: `roleLevel` is what rbac() compares against. The model is
        // `underscored: true`, so the JS attribute is `roleLevel` and the
        // column is `role_level`; projecting the snake_case name selects
        // nothing. Omitting it leaves every rbac([TENANT_ADMIN]) gate reading 0.
        attributes: ["id", "name", "roleLevel"],
        required: false,
      },
      tenantInclude(),
    ],
  });
  if (!dbUser) {
    throw new AppError(401, "Invalid credentials");
  }
  // Refuse exactly what auth.middleware refuses. `isActive` alone let a user
  // whose `status` is SUSPENDED — which is what SCIM deprovisioning sets
  // (scim.service.js) — through to a session, and (A-72) a LOGIN audit row,
  // for a token no request would then accept.
  if (!dbUser.isActive || REFUSED_STATUSES.includes(dbUser.status)) {
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
      const lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      // A-126 (ADR-051 Q-15): the lock and its ACCOUNT_LOCKED row commit
      // together; if the row cannot be written the lock is still persisted.
      await auditService.recordAccountLock({
        persistLock: (transaction) =>
          transaction ? dbUser.update({ lockedUntil }, { transaction }) : dbUser.update({ lockedUntil }),
        user: dbUser,
        lockedUntil,
        failedAttempts: attempts,
        endpoint: "login",
        ipAddress: ip || null,
        userAgent: userAgent || null,
      });
      throw new AppError(423, "Account locked due to too many failed attempts");
    }
    throw new AppError(401, "Invalid credentials");
  }

  // A-83: refused AFTER the password, so the tenant's state is disclosed only
  // to someone who already holds the account's password — and before the MFA
  // token, the session and the LOGIN row.
  const refusal = tenantRefusal(dbUser);
  if (refusal) {
    throw new AppError(403, refusal);
  }

  // Reset failed attempts on success
  if (dbUser.failedLoginAttempts > 0) {
    await dbUser.update({ failedLoginAttempts: 0, lockedUntil: null });
  }

  // Update last login
  await dbUser.update({ lastLoginAt: new Date() });

  // If MFA is enabled, issue a temporary token and require the second factor.
  // A-59: this is an "mfa" purpose token, accepted ONLY by POST /auth/mfa/login
  // — it used to be minted by generateAccessToken, i.e. it was an access
  // token for a login that had not finished. It is issued BEFORE any session
  // exists: loginMfa creates the session once the second factor passes (this
  // used to create one here too, and leave it live and unused).
  if (dbUser.mfaEnabled) {
    const mfaToken = generatePurposeToken(
      {
        id: dbUser.id,
        email: dbUser.email,
        mfaRequired: true,
      },
      "mfa",
    );

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

  const refreshToken = generateOpaqueRefreshToken();

  // Create session — and its LOGIN audit row, in one transaction (A-72).
  const session = await openLoginSession({
    user: dbUser,
    refreshToken,
    ipAddress: ip,
    userAgent,
    method: "password",
  });

  // A-48: the access token names its session (`sid`), so revoking the session
  // stops the token on the next request (auth.middleware.js).
  const accessToken = generateAccessToken({
    id: dbUser.id,
    email: dbUser.email,
    sid: session.id,
  });

  // Include role info with the user data
  const role = dbUser.role
    ? {
        id: dbUser.role.id,
        name: dbUser.role.name,
        roleLevel: dbUser.role.roleLevel,
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
      // A-123: the frontend goes straight to the change-password screen.
      mustChangePassword: !!dbUser.mustChangePassword,
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
  // A-59: only an activation token activates. An access token (or any other
  // purpose token) is refused, and an activation token is refused everywhere
  // else (verifyAccessToken rejects its `typ`).
  let decoded;
  try {
    decoded = verifyPurposeToken(token, "activation");
  } catch {
    throw new AppError(400, "Invalid or expired activation token");
  }
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

  const hashedPassword = await hashPassword(newPassword);

  // One transaction: the new password, the revoked sessions and the audit row
  // commit together or not at all (A-98 / F-12). CLS carries the transaction
  // into revokeAllSessions.
  await db.transaction(async (transaction) => {
    await user.update(
      {
        password: hashedPassword,
        otpCode: null,
        otpExpiredAt: null,
        passwordChangedAt: new Date(),
        // ADR-051 Q-11: a completed e-mail-code reset proves the holder reads
        // this mailbox, so the address is verified.
        isEmailVerified: true,
        // A-123: the password is now one the holder chose, not an
        // administrator — the forced change is satisfied.
        mustChangePassword: false,
      },
      { transaction },
    );

    // Revoke all sessions — invalidates all active refresh tokens
    await revokeAllSessions(user.id, "PASSWORD_RESET");

    await auditCredentialChange(transaction, {
      user,
      operation: "PASSWORD_RESET",
      details: { method: "email_otp" },
    });
  });

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
        // ADR-043 — see loginUser. The reshaped literal below carries it too.
        attributes: ["id", "name", "roleLevel"],
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
      role: user.role
        ? {
            id: user.role.id,
            name: user.role.name,
            roleLevel: user.role.roleLevel,
          }
        : null,
      tenantId: user.tenantId,
      // A-123: "who am I" is one of the routes a flagged account may call,
      // so this is where the frontend learns it must change the password.
      mustChangePassword: !!user.mustChangePassword,
      // A-141: the MFA page offers disable / re-enrol from this, and warns
      // when the recovery codes are running out. Only a count, never a code.
      mfaEnabled: !!user.mfaEnabled,
      mfaRecoveryCodesRemaining: recoveryCodesRemaining(user),
    },
  };
};

// ------------------------------------------------------------------
// GET AUTH USER (FOR MIDDLEWARE)
// ------------------------------------------------------------------
exports.getAuthUserWithTenant = async (userId) => {
  const { Roles, Tenants, TenantSettings } = require("../models");
  const user = await Users.findByPk(userId, {
    include: [
      {
        model: Roles,
        as: "role",
        // ADR-043 — this loader builds req.user on EVERY authenticated
        // request (auth.middleware.js), so this is the projection that decides
        // whether rbac() sees a level at all.
        attributes: ["id", "name", "description", "roleLevel"],
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
  if (!user) {
    return user;
  }
  // A-160: the tenant's "MFA required" policy, read only when it could apply
  // — a user in a tenant, without MFA. auth.middleware decides from it.
  // skipTenantScope with an explicit tenantId: this runs before any tenant
  // context exists, and the tenant is the user's own, never request input.
  user.mfaPolicy = NO_MFA_POLICY;
  if (user.tenantId && user.mfaEnabled !== true) {
    const rows = await TenantSettings.findAll({
      where: { tenantId: user.tenantId, key: MFA_POLICY_KEYS },
      attributes: ["key", "value"],
      skipTenantScope: true,
      raw: true,
    });
    user.mfaPolicy = parseMfaPolicy(rows);
  }
  return user;
};

// ------------------------------------------------------------------
// JUST UPDATE PASSWORD
// ------------------------------------------------------------------
/**
 * Change the caller's own password.
 *
 * A-98 / F-12: audited (UPDATE on User, `changes.operation` PASSWORD_CHANGE)
 * in the same transaction as the new hash and the session revocation.
 * A-123: clears `mustChangePassword` — this is the route a flagged account is
 * sent to, and the only way out of the flag besides an e-mail-code reset.
 *
 * @param {string} userId - the authenticated caller
 * @param {string} newPassword
 * @param {string} currentPassword
 * @param {object} [context]
 * @param {string|null} [context.ipAddress]
 * @param {string|null} [context.userAgent]
 */
exports.justUpdatePassword = async (
  userId,
  newPassword,
  currentPassword,
  { ipAddress = null, userAgent = null } = {},
) => {
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
  // A-123: "changing" to the same password would clear the forced-change
  // flag while the administrator still knows the password.
  if (newPassword === currentPassword) {
    throw new AppError(400, "The new password must be different from the current one");
  }
  const hashed = await hashPassword(newPassword);
  const wasForced = !!user.mustChangePassword;
  await db.transaction(async (transaction) => {
    await user.update(
      {
        password: hashed,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
      { transaction },
    );
    // Revoke all sessions — invalidates all active refresh tokens. CLS
    // carries the transaction into revokeAllSessions.
    await revokeAllSessions(userId, "PASSWORD_CHANGED");
    await auditCredentialChange(transaction, {
      user,
      operation: "PASSWORD_CHANGE",
      details: { forced: wasForced },
      ipAddress,
      userAgent,
    });
  });
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
// A-48. This used to read `req.token` — the ACCESS token — and revoke the
// session whose token_hash matched its hash. token_hash is the hash of the
// REFRESH token, so that matched no row; and auth.controller.js calls this
// with no arguments, so `req.token` threw and logout answered 500 (which the
// frontend's logout route swallows). Logout revoked nothing either way.
//
// The session is now the one the access token names (`sid`), taken from `req`
// when given and otherwise from the request context auth.middleware.js sets.
exports.logoutSession = async (req) => {
  const sessionId = (req && req.sessionId) || getCurrentSessionId();
  if (sessionId) {
    await revokeSessionById(sessionId, "LOGOUT");
  }
  return { success: true, status: 200, message: "Logout successful" };
};

// ------------------------------------------------------------------
// REFRESH USER TOKEN
// ------------------------------------------------------------------
/**
 * A-146 — an impersonation session is refreshed only while its operator is
 * still an active super admin. Otherwise the impersonation ends here: the
 * session is revoked and the refresh answered 401. The claim is re-issued
 * from the SESSION ROW (sessions.impersonator_id), never from the request.
 *
 * @param {string} impersonatorId - sessions.impersonator_id
 * @param {string} refreshToken - the token being refreshed, to revoke its session
 * @throws {AppError} 401 when the operator may no longer impersonate
 */
const assertImpersonatorEntitled = async (impersonatorId, refreshToken) => {
  const operator = await Users.findByPk(impersonatorId, {
    // A-109: LEFT — a role-less operator is refused below, not lost to a JOIN.
    include: [{ model: Role, as: "role", required: false }],
  });
  const entitled =
    Boolean(operator) &&
    operator.isActive !== false &&
    !REFUSED_STATUSES.includes(operator.status) &&
    ["SUPER_ADMIN", "SUPERADMIN"].includes(operator.role?.name);
  if (!entitled) {
    await revokeSession(refreshToken, "IMPERSONATOR_REVOKED");
    throw new AppError(401, "The impersonation has ended: the operator may no longer impersonate");
  }
};

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
  // A-180: the statuses a sign-in refuses end a refresh too. An account
  // suspended, deactivated or erased after its session opened got a fresh
  // session here — one no request would then accept, but a session all the same.
  if (user.isActive === false || REFUSED_STATUSES.includes(user.status)) {
    await revokeSession(refreshToken, "ACCOUNT_REFUSED");
    throw new AppError(403, "Account is suspended");
  }

  // A-146: an impersonation session keeps its operator through a refresh —
  // the claim that F-8 attributes audit rows with and A-127 refuses Part 11
  // acts on. It used to be dropped here: one refresh made the operator's
  // requests look like the hospital user's own.
  const impersonatorId = session.impersonator_id || null;
  if (impersonatorId) {
    await assertImpersonatorEntitled(impersonatorId, refreshToken);
  }

  // 5. Revoke old session (token rotation). The access token issued with it
  //    stops working too (A-48): it names the old session.
  await revokeSession(refreshToken, "TOKEN_ROTATION");

  // 6. Create new session with new token
  const newSession = await createSession({
    tenantId: session.tenant_id,
    userId: session.user_id,
    refreshToken: newRefreshToken,
    ipAddress: ipAddress || session.ip_address,
    userAgent: userAgent || session.user_agent,
    device: session.device,
    // A-146: an impersonation is not extended by refreshing it — it keeps the
    // hour impersonateUser gave it. Any other session gets a fresh 7 days.
    expiredAt: impersonatorId
      ? session.expired_at
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    impersonatorId,
  });

  const newAccessToken = generateAccessToken({
    id: user.id,
    email: user.email,
    ...(impersonatorId ? { impersonatorId } : {}),
    sid: newSession.id,
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
/**
 * Second step of an MFA sign-in.
 *
 * @param {string} userId - from the verified "mfa" purpose token
 * @param {unknown} tokenCode - the TOTP code (ignored when `recoveryCode` is given)
 * @param {string} [inputIp]
 * @param {string} [inputUserAgent]
 * @param {object} [options]
 * @param {unknown} [options.recoveryCode] - A-141: a one-time recovery code in
 *   place of the TOTP code
 */
exports.loginMfa = async (userId, tokenCode, inputIp, inputUserAgent, { recoveryCode } = {}) => {
  const dbUser = await Users.findByPk(userId, {
    include: [
      {
        model: Role,
        as: "role",
        // ADR-043 — see loginUser.
        attributes: ["id", "name", "roleLevel"],
        // A-109: LEFT, as in loginUser. As an implicit INNER JOIN a user
        // without a live role passed the password step (202, MFA required)
        // and was then told here that MFA "is not enabled" — a half-login
        // with a false reason. Whether a role-less user may sign in at all is
        // decided in one place, the password step; this step only checks the
        // second factor. The role reads as null and rbac() grants nothing.
        required: false,
      },
      tenantInclude(),
    ],
  });
  
  if (!dbUser || !dbUser.mfaEnabled || !dbUser.mfaSecret) {
    throw new AppError(400, "MFA is not enabled for this account");
  }

  // The mfa token is good for five minutes after the password step; an account
  // suspended inside that window is refused here, before any session or LOGIN
  // row exists — the same rule loginUser applies.
  if (!dbUser.isActive || REFUSED_STATUSES.includes(dbUser.status)) {
    throw new AppError(403, "Account is suspended");
  }

  // A-83: the lock loginUser honours. It used to be ignored here, so an
  // account locked after its MFA token was issued — including by wrong codes
  // on this very step (A-81, which persists locked_until) — still signed in.
  // Checked before the code, so a locked account learns nothing from a guess.
  if (dbUser.lockedUntil && new Date(dbUser.lockedUntil) > new Date()) {
    throw new AppError(423, "Account temporarily locked");
  }

  // A-83: the tenant may have been suspended since the password step.
  const refusal = tenantRefusal(dbUser);
  if (refusal) {
    throw new AppError(403, refusal);
  }

  const useRecovery = recoveryCode !== undefined && recoveryCode !== null && recoveryCode !== "";
  const spendRecoveryCode = async (transaction) => {
    if (!(await mfaService.consumeRecoveryCode(dbUser, recoveryCode, { transaction }))) {
      throw new AppError(401, "Invalid MFA code");
    }
    return { recoveryCodesRemaining: recoveryCodesRemaining(dbUser) };
  };

  // A-115: consumeCode, not checkCode — the code is accepted once. A replay
  // inside its ~90-second window is the same 401 as a wrong code (and counts
  // against the caller the same way, A-81).
  if (!useRecovery && !(await mfaService.consumeCode(dbUser, tokenCode))) {
    throw new AppError(401, "Invalid MFA code");
  }

  const refreshToken = generateOpaqueRefreshToken();

  // Create session — and its LOGIN audit row, in one transaction (A-72).
  // A-141: a recovery code is spent in that transaction. A wrong or spent one
  // is the same 401 as a wrong TOTP code, counted by the same limiter (A-81).
  const session = await openLoginSession({
    user: dbUser,
    refreshToken,
    ipAddress: inputIp,
    userAgent: inputUserAgent,
    method: useRecovery ? "password+recovery_code" : "password+totp",
    secondFactor: useRecovery ? spendRecoveryCode : undefined,
  });

  // Update last login — after the second factor, whichever it was, passed.
  await dbUser.update({ lastLoginAt: new Date() });

  const accessToken = generateAccessToken({
    id: dbUser.id,
    email: dbUser.email,
    sid: session.id,
  });

  const role = dbUser.role
    ? {
        id: dbUser.role.id,
        name: dbUser.role.name,
        roleLevel: dbUser.role.roleLevel,
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
      mfaEnabled: true,
      mustChangePassword: !!dbUser.mustChangePassword,
      // A-141: how many recovery codes are left, so the UI can say "re-enrol
      // soon" after one is used. A count, never a code.
      mfaRecoveryCodesRemaining: recoveryCodesRemaining(dbUser),
      usedRecoveryCode: useRecovery,
    },
    token: accessToken,
    refreshToken,
    session,
  };
};

// ------------------------------------------------------------------
// SETUP / ROTATE MFA  (A-114)
//
// setupMfa used to write the new secret straight into `mfaSecret`. On an
// account that already had MFA that REPLACED the live second factor at once,
// with no re-authentication: anyone holding the session (a stolen cookie, an
// unlocked workstation) could swap the victim's authenticator for their own,
// and the victim's next sign-in would fail.
//
// Now:
//  - the new secret is PENDING (`mfaPendingSecret`, migration 0028). Nothing
//    signs in or signs with it; the live `mfaSecret` keeps working until
//    verifyMfaSetup accepts a code from the pending one and promotes it;
//  - on an account with MFA enabled, starting a rotation needs the current
//    password AND a current code from the live authenticator. Without them it
//    is a 409 that says what is needed. A wrong password or a wrong code is
//    one combined 400 — the endpoint does not tell a session thief which of
//    the two they got right. (400, not 401: the frontend client treats a 401
//    as an expired session and signs the user out, and this is the same
//    choice justUpdatePassword makes for a wrong current password);
//  - a pending secret expires after MFA_PENDING_TTL_MS;
//  - enabling and rotating are audited (UPDATE on User, `changes.operation`
//    MFA_ENABLE / MFA_ROTATE) in the SAME transaction as the promotion.
//
// Disabling is disableMfa below (A-141), audited as MFA_DISABLE.
// ------------------------------------------------------------------

const MFA_PENDING_TTL_MS = 15 * 60 * 1000;
const MFA_ALREADY_ENABLED =
  "MFA is already enabled; disable or rotate with your current code";
const MFA_REAUTH_FAILED = "Current password or MFA code is incorrect";

exports.MFA_PENDING_TTL_MS = MFA_PENDING_TTL_MS;

/**
 * Start MFA enrolment, or a rotation on an account that already has MFA.
 *
 * @param {string} userId - the authenticated caller
 * @param {object} [reauth] - required when MFA is already enabled
 * @param {string} [reauth.currentPassword]
 * @param {string} [reauth.code] - a code from the CURRENT authenticator
 * @returns {Promise<{ secret: string, qrCodeUrl: string, rotation: boolean }>}
 * @throws {AppError} 404 no user; 409 MFA enabled and no re-authentication
 *   given; 400 the re-authentication is wrong
 */
exports.setupMfa = async (userId, { currentPassword, code } = {}) => {
  const qrcode = require("qrcode");

  const dbUser = await Users.findByPk(userId);
  if (!dbUser) {
    throw new AppError(404, "User not found");
  }

  const rotation = Boolean(dbUser.mfaEnabled);
  if (rotation) {
    if (!currentPassword || !code) {
      throw new AppError(409, MFA_ALREADY_ENABLED);
    }
    // The password first: a wrong password must not burn the current code.
    const passwordOk = await comparePassword(currentPassword, dbUser.password);
    if (!passwordOk || !(await mfaService.consumeCode(dbUser, code))) {
      logger.warn("MFA rotation refused: re-authentication failed", {
        userId: dbUser.id,
        reason: passwordOk ? "code" : "password",
      });
      throw new AppError(400, MFA_REAUTH_FAILED);
    }
  }

  const secret = mfaService.createSecret();
  const otpauth = mfaService.buildOtpauthUri(dbUser.email, secret);
  const qrCodeUrl = await qrcode.toDataURL(otpauth);

  // PENDING only. `mfaSecret` — the live factor — is not touched here.
  // Date.now(), the clock verifyMfaSetup measures the TTL with.
  await dbUser.update({ mfaPendingSecret: secret, mfaPendingCreatedAt: new Date(Date.now()) });

  return {
    secret,
    qrCodeUrl,
    rotation,
  };
};

// ------------------------------------------------------------------
// VERIFY MFA SETUP
// ------------------------------------------------------------------
/**
 * Confirm the pending secret with a code from it, and make it the live one.
 *
 * @param {string} userId - the authenticated caller
 * @param {unknown} tokenCode - a code from the NEW authenticator
 * @param {object} [context]
 * @param {string|null} [context.ipAddress]
 * @param {string|null} [context.userAgent]
 * @returns {Promise<{ success: true, message: string }>}
 */
exports.verifyMfaSetup = async (
  userId,
  tokenCode,
  { ipAddress = null, userAgent = null, sessionId = null } = {},
) => {
  const dbUser = await Users.findByPk(userId);
  if (!dbUser) {
    throw new AppError(404, "User not found");
  }

  const pending = dbUser.mfaPendingSecret;
  if (!pending) {
    throw new AppError(400, "MFA setup has not been initiated");
  }
  const issuedAt = dbUser.mfaPendingCreatedAt ? new Date(dbUser.mfaPendingCreatedAt).getTime() : 0;
  if (Date.now() - issuedAt > MFA_PENDING_TTL_MS) {
    await dbUser.update({ mfaPendingSecret: null, mfaPendingCreatedAt: null });
    throw new AppError(400, "MFA setup has expired; start it again");
  }

  const rotation = Boolean(dbUser.mfaEnabled);
  // A-141: a new set of one-time recovery codes with every new authenticator.
  // The old set (if any) is replaced in the same update. Only the hashes are
  // stored; the codes themselves are returned ONCE, in this response.
  const recoveryCodes = mfaService.createRecoveryCodes();

  await db.transaction(async (transaction) => {
    // Consumed in the transaction: a rolled-back promotion does not burn it.
    const isValid = await mfaService.consumeCode(dbUser, tokenCode, {
      secret: pending,
      transaction,
    });
    if (!isValid) {
      throw new AppError(400, "Invalid MFA code");
    }

    await dbUser.update(
      {
        mfaSecret: pending,
        mfaEnabled: true,
        mfaPendingSecret: null,
        mfaPendingCreatedAt: null,
        mfaRecoveryCodes: mfaService.hashRecoveryCodes(dbUser.id, recoveryCodes),
      },
      { transaction },
    );

    // A-141: replacing the authenticator signs out every OTHER session. If the
    // old phone was lost or the rotation answers a compromise, the session
    // that holds it must end now, not when it expires. The caller's own
    // session survives. A first enrolment replaces nothing and revokes nothing.
    const otherSessionsRevoked = rotation
      ? await revokeOtherSessions(dbUser.id, sessionId, "MFA_ROTATED", { transaction })
      : 0;

    await auditCredentialChange(transaction, {
      user: dbUser,
      // Never the secret or a code: audit_logs is permanent.
      operation: rotation ? "MFA_ROTATE" : "MFA_ENABLE",
      details: {
        recoveryCodesIssued: recoveryCodes.length,
        ...(rotation ? { otherSessionsRevoked } : {}),
      },
      ipAddress,
      userAgent,
    });
  });

  return {
    success: true,
    message: rotation ? "MFA authenticator replaced successfully" : "MFA enabled successfully",
    recoveryCodes,
  };
};

// ------------------------------------------------------------------
// DISABLE MFA  (A-141)
//
// There was no way to turn MFA off, so a user who lost their authenticator
// had no way back in and no way to start over. Disabling needs BOTH the
// current password AND a second factor — a current TOTP code, or one of the
// recovery codes (the path for someone whose phone is gone: sign in with a
// recovery code, then disable and enrol again). As for a rotation, a wrong
// password and a wrong code are one combined 400.
//
// It clears the live secret, any pending enrolment, the replay step and the
// recovery codes; signs out every other session; and is audited (MFA_DISABLE)
// in the same transaction.
// ------------------------------------------------------------------

const MFA_NOT_ENABLED = "MFA is not enabled for this account";

/**
 * @param {string} userId - the authenticated caller
 * @param {object} reauth
 * @param {string} [reauth.currentPassword]
 * @param {string} [reauth.code] - a current TOTP code
 * @param {string} [reauth.recoveryCode] - or a recovery code
 * @param {object} [context]
 * @param {string|null} [context.ipAddress]
 * @param {string|null} [context.userAgent]
 * @param {string|null} [context.sessionId] - the caller's session, which survives
 * @returns {Promise<{ success: true, message: string, otherSessionsRevoked: number }>}
 * @throws {AppError} 404 no user; 409 MFA not enabled; 400 re-authentication
 *   missing or wrong
 */
exports.disableMfa = async (
  userId,
  { currentPassword, code, recoveryCode } = {},
  { ipAddress = null, userAgent = null, sessionId = null } = {},
) => {
  const dbUser = await Users.findByPk(userId);
  if (!dbUser) {
    throw new AppError(404, "User not found");
  }
  if (!dbUser.mfaEnabled) {
    throw new AppError(409, MFA_NOT_ENABLED);
  }
  if (!currentPassword || (!code && !recoveryCode)) {
    throw new AppError(400, "Current password and an MFA or recovery code are required");
  }

  // The password first: a wrong password must not burn a code.
  const passwordOk = await comparePassword(currentPassword, dbUser.password);
  if (!passwordOk) {
    logger.warn("MFA disable refused: re-authentication failed", {
      userId: dbUser.id,
      reason: "password",
    });
    throw new AppError(400, MFA_REAUTH_FAILED);
  }

  const method = recoveryCode ? "recovery_code" : "totp";
  const otherSessionsRevoked = await db.transaction(async (transaction) => {
    const factorOk = recoveryCode
      ? await mfaService.consumeRecoveryCode(dbUser, recoveryCode, { transaction })
      : await mfaService.consumeCode(dbUser, code, { transaction });
    if (!factorOk) {
      logger.warn("MFA disable refused: re-authentication failed", {
        userId: dbUser.id,
        reason: method,
      });
      throw new AppError(400, MFA_REAUTH_FAILED);
    }

    await dbUser.update({ ...mfaService.MFA_CLEARED }, { transaction });
    const revoked = await revokeOtherSessions(dbUser.id, sessionId, "MFA_DISABLED", { transaction });
    await auditCredentialChange(transaction, {
      user: dbUser,
      operation: "MFA_DISABLE",
      details: { method, otherSessionsRevoked: revoked },
      ipAddress,
      userAgent,
    });
    return revoked;
  });

  return {
    success: true,
    message: "MFA disabled",
    otherSessionsRevoked,
  };
};

// ------------------------------------------------------------------
// IMPERSONATE USER
// ------------------------------------------------------------------
exports.impersonateUser = async (superAdminId, targetTenantId, targetUserId, inputIp, inputUserAgent) => {
  // Validate caller is Super Admin
  // A-109: LEFT. A caller whose role is gone is refused by the role-name
  // check below (role null), not by a row that silently vanished.
  const superAdmin = await Users.findByPk(superAdminId, {
    include: [{ model: Role, as: "role", required: false }],
  });

  if (!superAdmin || superAdmin.role?.name !== "SUPER_ADMIN" && superAdmin.role?.name !== "SUPERADMIN") {
    throw new AppError(403, "Only Super Admins can impersonate users");
  }

  // Find target user
  const targetUser = await Users.findOne({
    where: { id: targetUserId, tenantId: targetTenantId },
    // A-109: LEFT. As an implicit INNER JOIN a user without a live role was
    // "not found" — exactly the user support most needs to see as they see
    // the app. The response's `role` is already null-safe.
    include: [{ model: Role, as: "role", required: false }],
  });

  if (!targetUser) {
    throw new AppError(404, "Target user not found in the specified tenant");
  }
  
  if (targetUser.id === superAdmin.id) {
    throw new AppError(400, "Cannot impersonate yourself");
  }

  const refreshToken = generateOpaqueRefreshToken();

  // A-82: the session and its audit row, in ONE transaction. Impersonation
  // used to call only logger.info — a super admin acting as a hospital user,
  // the act an audit trail exists to record, left no row. The row is written
  // in the TARGET's tenant (whose trail it belongs in) with the SUPER ADMIN as
  // `userId`, the actor; `changes` names who was impersonated. A failed insert
  // rolls the session back and the impersonation fails rather than proceeding
  // unrecorded. Same wiring as openLoginSession: CLS carries the transaction
  // into createSession, logAction takes it explicitly.
  //
  // audit_logs.action has no IMPERSONATE member (AUDIT_ACTIONS), so it is a
  // LOGIN with `changes.operation` naming it, as the closed ENUM prescribes.
  const session = await db.transaction(async (transaction) => {
    // The session row is still the target's, marked in its user agent.
    const created = await createSession({
      tenantId: targetUser.tenantId,
      userId: targetUser.id,
      refreshToken,
      ipAddress: inputIp || "",
      userAgent: (inputUserAgent || "") + " (Impersonated by " + superAdmin.email + ")",
      expiredAt: new Date(Date.now() + 1 * 60 * 60 * 1000), // 1 hour for impersonation
      // A-146: recorded on the row, so a refresh re-issues the claim.
      impersonatorId: superAdmin.id,
    });
    await auditService.logAction(
      {
        tenantId: targetUser.tenantId,
        userId: superAdmin.id,
        action: "LOGIN",
        resourceType: "Session",
        resourceId: created.id,
        changes: {
          operation: "impersonate",
          method: "impersonation",
          impersonatorId: superAdmin.id,
          targetUserId: targetUser.id,
          targetTenantId: targetUser.tenantId,
        },
        ipAddress: inputIp || null,
        userAgent: inputUserAgent || null,
      },
      { transaction },
    );
    return created;
  });

  // Issue tokens for the target user, but with the impersonator claim. The
  // `sid` makes the session's one-hour expiry bind the access token too
  // (A-48); without it the token lasted JWT_ACCESS_EXPIRED.
  const accessToken = generateAccessToken({
    id: targetUser.id,
    email: targetUser.email,
    impersonatorId: superAdmin.id, // THE CRITICAL CLAIM
    sid: session.id,
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
