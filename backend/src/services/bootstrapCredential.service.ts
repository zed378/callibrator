/**
 * P10-16 (ADR-099) — the first super admin's one-time password.
 *
 *   Issued    password_one_time, must_change_password, expiry = now + 72 h
 *   Consumed  (first sign-in) one_time cleared, expiry = NOW — the password is
 *             now an expired temporary password, refused by loginUser's A-215
 *             path with the same 401 as a wrong one
 *   Changed   (POST /auth/first-sign-in/password) every flag cleared
 *
 * The plaintext exists in exactly two places: this process's memory while it
 * is issued, and the 0600 file of utils/bootstrapSecret.util.ts. It is never
 * logged, never audited, never returned, never put in the environment. The
 * database holds the bcrypt hash (utils/password.util, the same hasher as every
 * password).
 *
 * Every mutation writes its audit row in the same transaction (A-41). The file
 * is written INSIDE the transaction that stores the hash, so a failed write
 * leaves no account whose password nobody can read.
 */
import { createHash } from "crypto";
import { Op } from "sequelize";

import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import { AppError } from "../utils/appError.util";
import { logger } from "../middlewares/activityLog.middleware";
import { comparePassword, hashPassword } from "../utils/password.util";
import jwtUtil from "../utils/jwt.util";
import { checkInput } from "../validators/input";
import { firstSignInPasswordSchema } from "../validators/auth.validator";
import { ROLE_IDS } from "../constants";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";
import { SYSTEM_ACTORS } from "../constants/systemActors";
import {
  bootstrapPointer,
  bootstrapSecretExists,
  generateBootstrapPassword,
  removeBootstrapSecret,
  writeBootstrapSecret,
} from "../utils/bootstrapSecret.util";
import type { ModelInstance } from "../types/models";

const { Users, Sessions } = models;

type UserRow = ModelInstance<"User">;

/** An unused one-time password stops signing in after this (the A-215 TTL). */
const ONE_TIME_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * The public default the seed used to give sys@mail.com. Kept for ONE purpose:
 * retireKnownDefaultPassword finds a super admin still holding it. Nothing
 * issues it.
 */
const RETIRED_DEFAULT_PASSWORD = "123123";

/** Word for word loginUser's answer to a wrong password. */
const INVALID_CREDENTIALS = "Invalid credentials";
/** Every refusal of a password-change token, whatever the reason. */
const TOKEN_REFUSED = "Invalid or expired password-change token";

/** What the seed asks for: the system super admin's profile, never a password. */
interface SystemUserSpec {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  status: string;
  roleId: string;
  tenantId: string;
  isEmailVerified: boolean;
}

/** What ensureSystemSuperAdmin did. `bootstrapPasswordFile` is a path, never the value. */
interface EnsureResult {
  created: boolean;
  updated: boolean;
  bootstrapPasswordFile: string | null;
}

/** Request context for the audit row. */
interface RequestContext {
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
}

/** The token's binding to the credential state: it dies when the hash changes. */
const credentialFingerprint = (passwordHash: string): string =>
  createHash("sha256").update(passwordHash).digest("hex").slice(0, 32);

const expiryFromNow = (): Date => new Date(Date.now() + ONE_TIME_PASSWORD_TTL_MS);

/** The tenant an account's credential rows are recorded in. */
const auditTenantOf = (user: { tenantId: string | null }): string => user.tenantId ?? PLATFORM_TENANT_ID;

/** Revoke every live session of the account — session.service#revokeAllSessions' update. */
const revokeSessions = async (userId: string, reason: string): Promise<void> => {
  await Sessions.update(
    { is_revoked: true, revoked_at: new Date(), revoked_reason: reason, is_active: false },
    { where: { user_id: userId, is_revoked: false }, skipTenantScope: true },
  );
};

/**
 * Store a fresh one-time password for `user` and put its plaintext in the
 * file, in one transaction with the account's revoked sessions and an audit
 * row by `system:bootstrap`.
 *
 * A static, conditional-free UPDATE (not `user.update`): the User beforeSave
 * hook clears `passwordOneTime` when the password changes and the flag's VALUE
 * does not, which is exactly a re-issue on an account that is already one-time.
 *
 * @returns the file path
 */
const issueOneTimePassword = async (
  user: UserRow,
  details: Record<string, unknown>,
): Promise<string> => {
  const plain = generateBootstrapPassword();
  const hash = await hashPassword(plain);
  const expiresAt = expiryFromNow();
  const out: { file: string | null } = { file: null };
  let file: string;
  try {
    file = await db.transaction(async (transaction) => {
      await Users.update(
        {
          password: hash,
          passwordOneTime: true,
          mustChangePassword: true,
          temporaryPasswordExpiresAt: expiresAt,
        },
        { where: { id: user.id }, transaction },
      );
      await revokeSessions(user.id, "PASSWORD_RESET");
      await auditService.logAction(
        {
          tenantId: auditTenantOf(user),
          systemActor: SYSTEM_ACTORS.BOOTSTRAP,
          action: "UPDATE",
          resourceType: "User",
          resourceId: user.id,
          changes: { ...details, kind: "one_time_password", expiresAt: expiresAt.toISOString() },
        },
        { transaction },
      );
      out.file = writeBootstrapSecret(plain);
      return out.file;
    });
  } catch (err) {
    if (out.file) {
      removeBootstrapSecret();
    }
    throw err;
  }
  logger.warn(bootstrapPointer(user.email, file));
  return file;
};

// ==========================================
// BOOTSTRAP (the seed)
// ==========================================

/**
 * The seed's system super admin. Idempotent:
 *  - the account exists: restored if deleted, profile refreshed — its
 *    password and credential flags are NEVER touched (the seed used to reset
 *    it to a public default on every call);
 *  - another live super admin exists: nothing is created;
 *  - otherwise: created with a one-time password, the file written inside the
 *    creating transaction, and a pointer logged.
 */
const ensureSystemSuperAdmin = async (spec: SystemUserSpec): Promise<EnsureResult> => {
  const profile = {
    email: spec.email,
    username: spec.username,
    firstName: spec.firstName,
    lastName: spec.lastName,
    status: spec.status,
    roleId: spec.roleId,
    tenantId: spec.tenantId as UserRow["tenantId"],
    isEmailVerified: spec.isEmailVerified,
  };

  const existing = await Users.findOne({ where: { email: spec.email }, paranoid: false });
  if (existing) {
    if (existing.deletedAt) {
      await existing.restore();
    }
    await existing.update(profile);
    logger.info(`Updated existing system user: ${spec.email} (credential unchanged)`);
    return { created: false, updated: true, bootstrapPasswordFile: null };
  }

  const otherSuperAdmins = await Users.count({ where: { roleId: ROLE_IDS.SUPER_ADMIN } });
  if (otherSuperAdmins > 0) {
    logger.info(`A super admin already exists; ${spec.email} is not created`);
    return { created: false, updated: false, bootstrapPasswordFile: null };
  }

  const plain = generateBootstrapPassword();
  const hash = await hashPassword(plain);
  const expiresAt = expiryFromNow();
  const out: { file: string | null; userId: string } = { file: null, userId: "" };
  let file: string;
  try {
    file = await db.transaction(async (transaction) => {
      const created = await Users.create(
        {
          ...profile,
          password: hash,
          passwordOneTime: true,
          mustChangePassword: true,
          temporaryPasswordExpiresAt: expiresAt,
        },
        { transaction, oneTimePassword: true },
      );
      out.userId = created.id;
      await auditService.logAction(
        {
          tenantId: auditTenantOf(created),
          systemActor: SYSTEM_ACTORS.BOOTSTRAP,
          action: "CREATE",
          resourceType: "User",
          resourceId: created.id,
          changes: {
            operation: "BOOTSTRAP_SUPER_ADMIN",
            kind: "one_time_password",
            expiresAt: expiresAt.toISOString(),
          },
        },
        { transaction },
      );
      out.file = writeBootstrapSecret(plain);
      return out.file;
    });
  } catch (err) {
    if (out.file) {
      removeBootstrapSecret();
    }
    throw err;
  }
  logger.warn(bootstrapPointer(spec.email, file), { userId: out.userId });
  return { created: true, updated: false, bootstrapPasswordFile: file };
};

// ==========================================
// BOOT: retire the old public default, sweep a stale file
// ==========================================

/**
 * Every live super admin still holding the retired public default is moved to
 * a fresh one-time password. One bcrypt compare per super admin.
 *
 * @returns how many were rotated
 */
const retireKnownDefaultPassword = async (): Promise<number> => {
  const admins = await Users.findAll({
    where: { roleId: ROLE_IDS.SUPER_ADMIN, passwordOneTime: false },
  });
  let rotated = 0;
  for (const admin of admins) {
    if (await comparePassword(RETIRED_DEFAULT_PASSWORD, admin.password)) {
      await issueOneTimePassword(admin, { operation: "RETIRE_DEFAULT_PASSWORD" });
      rotated += 1;
    }
  }
  return rotated;
};

/**
 * Delete the file when no account holds an unexpired one-time password: it was
 * consumed in another process, or it expired unused.
 *
 * @returns whether a file was removed
 */
const sweepStaleBootstrapSecret = async (): Promise<boolean> => {
  if (!bootstrapSecretExists()) {
    return false;
  }
  const live = await Users.count({
    where: { passwordOneTime: true, temporaryPasswordExpiresAt: { [Op.gt]: new Date() } },
  });
  if (live > 0) {
    return false;
  }
  removeBootstrapSecret();
  logger.info("Removed a one-time password file no account can use any more");
  return true;
};

/**
 * index.js, after the role switch. Never refuses the boot: a failure is logged
 * (never with a value) and the server starts.
 */
const runBootChecks = async (): Promise<void> => {
  try {
    const rotated = await retireKnownDefaultPassword();
    if (rotated > 0) {
      logger.warn(`Retired the public default password of ${String(rotated)} super admin(s)`);
    }
    await sweepStaleBootstrapSecret();
  } catch (err) {
    logger.error("Bootstrap credential check failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

// ==========================================
// FIRST SIGN-IN
// ==========================================

/** loginUser's return shape for this branch: a token, never a session. */
interface FirstSignInResult {
  success: true;
  status: 200;
  message: string;
  data: { id: string; username: string; email: string; passwordChangeRequired: true };
  token: string;
  refreshToken: null;
}

/**
 * auth.service#loginUser, once the one-time password has matched and every
 * refusal (account, lock, tenant) has passed. Consumes it: one conditional
 * UPDATE, so of two concurrent sign-ins exactly one wins; the other is the
 * wrong-password 401.
 */
const firstSignIn = async (dbUser: UserRow, context: RequestContext = {}): Promise<FirstSignInResult> => {
  const consumed = await db.transaction(async (transaction) => {
    const [count] = await Users.update(
      { passwordOneTime: false, temporaryPasswordExpiresAt: new Date(), mustChangePassword: true },
      { where: { id: dbUser.id, passwordOneTime: true }, transaction },
    );
    if (count !== 1) {
      return false;
    }
    await auditService.logAction(
      {
        tenantId: auditTenantOf(dbUser),
        userId: dbUser.id,
        action: "UPDATE",
        resourceType: "User",
        resourceId: dbUser.id,
        changes: { operation: "ONE_TIME_PASSWORD_CONSUMED" },
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
      { transaction },
    );
    return true;
  });
  if (!consumed) {
    logger.info("Sign-in refused: the one-time password was consumed by a concurrent sign-in", {
      userId: dbUser.id,
    });
    throw new AppError(401, INVALID_CREDENTIALS);
  }
  removeBootstrapSecret();

  const token = jwtUtil.generatePurposeToken(
    { id: dbUser.id, pf: credentialFingerprint(dbUser.password) },
    "password-change",
  );
  return {
    success: true,
    status: 200,
    message: "Password change required",
    data: {
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      passwordChangeRequired: true,
    },
    token,
    refreshToken: null,
  };
};

// ==========================================
// CHANGE PASSWORD (the only thing the token allows)
// ==========================================

/** The claims a password-change token must carry, or null. */
const tokenClaims = (token: string): { id: string; pf: string } | null => {
  let decoded: unknown;
  try {
    decoded = jwtUtil.verifyPurposeToken(token, "password-change");
  } catch {
    return null;
  }
  // verifyPurposeToken returned, so it is an object carrying this `typ`
  // (jwt.util#assertExactTokenType); its claims are still unchecked.
  const { id, pf } = decoded as { id?: unknown; pf?: unknown };
  return typeof id === "string" && typeof pf === "string" ? { id, pf } : null;
};

/**
 * POST /auth/first-sign-in/password. The token is the proof the one-time
 * password was just presented; it is bound to that credential state and dies
 * with the change. Answers "sign in again": the new password then signs in
 * normally (P6-07 sends an operator without MFA to enrolment).
 */
const completeFirstSignInPasswordChange = async (
  input: unknown,
  context: RequestContext = {},
): Promise<{ success: true; status: 200; message: string; data: { signInRequired: true } }> => {
  const checked = checkInput(input, firstSignInPasswordSchema);
  if (!checked.ok) {
    throw new AppError(400, "Validation failed", true, checked.errors);
  }
  const { token, newPassword } = checked.value;

  const claims = tokenClaims(token);
  if (!claims) {
    throw new AppError(401, TOKEN_REFUSED);
  }
  const user = await Users.findByPk(claims.id);
  if (
    !user ||
    !user.mustChangePassword ||
    user.passwordOneTime ||
    credentialFingerprint(user.password) !== claims.pf
  ) {
    throw new AppError(401, TOKEN_REFUSED);
  }
  if (await comparePassword(newPassword, user.password)) {
    throw new AppError(400, "The new password must be different from the one-time password");
  }

  const hash = await hashPassword(newPassword);
  await db.transaction(async (transaction) => {
    const [count] = await Users.update(
      {
        password: hash,
        passwordOneTime: false,
        mustChangePassword: false,
        temporaryPasswordExpiresAt: null,
        passwordChangedAt: new Date(),
      },
      { where: { id: user.id, password: user.password, mustChangePassword: true }, transaction },
    );
    if (count !== 1) {
      // A concurrent submit of the same token changed it first.
      throw new AppError(401, TOKEN_REFUSED);
    }
    await revokeSessions(user.id, "PASSWORD_CHANGED");
    await auditService.logAction(
      {
        tenantId: auditTenantOf(user),
        userId: user.id,
        action: "UPDATE",
        resourceType: "User",
        resourceId: user.id,
        changes: { operation: "PASSWORD_CHANGE", forced: true, method: "one_time_password" },
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
      { transaction },
    );
  });

  return {
    success: true,
    status: 200,
    message: "Password changed. Sign in with your new password.",
    data: { signInRequired: true },
  };
};

// ==========================================
// RECOVERY (scripts/rotateBootstrapPassword.ts)
// ==========================================

/** What the recovery CLI is given. */
interface RotateParams {
  identifier: string;
  requestedBy: string;
  ticket: string;
}

/**
 * Issue a new one-time password to a SUPER ADMIN who lost theirs (or whose
 * expired unused). A tenant user's password is an administrator's reset, not
 * this. Refuses without a requester and a ticket, as the break-glass does.
 *
 * @returns the account id and the file path (never the value)
 */
const rotateOneTimePassword = async ({
  identifier,
  requestedBy,
  ticket,
}: RotateParams): Promise<{ userId: string; file: string }> => {
  if (!identifier || !requestedBy || !ticket) {
    throw new AppError(400, "--user, --requested-by and --ticket are all required");
  }
  const user = await Users.findOne({
    where: { [Op.or]: [{ email: identifier }, { username: identifier }] },
  });
  if (!user) {
    throw new AppError(404, "No such account");
  }
  if (user.roleId !== ROLE_IDS.SUPER_ADMIN) {
    throw new AppError(403, "Only a super admin's password is rotated here; a tenant user's is reset by an administrator");
  }
  const file = await issueOneTimePassword(user, {
    operation: "ROTATE_ONE_TIME_PASSWORD",
    requestedBy,
    ticket,
  });
  return { userId: user.id, file };
};

export {
  ONE_TIME_PASSWORD_TTL_MS,
  RETIRED_DEFAULT_PASSWORD,
  INVALID_CREDENTIALS,
  TOKEN_REFUSED,
  credentialFingerprint,
  ensureSystemSuperAdmin,
  retireKnownDefaultPassword,
  sweepStaleBootstrapSecret,
  runBootChecks,
  firstSignIn,
  completeFirstSignInPasswordChange,
  rotateOneTimePassword,
};
export type { SystemUserSpec, EnsureResult, FirstSignInResult };
