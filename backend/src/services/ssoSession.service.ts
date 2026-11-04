/**
 * ARC-01 (the 2026-11 audit) — the SSO sign-in's session, moved out of
 * `sso.controller`. Transactions open in the service, never a controller.
 *
 * Create the session FIRST, then sign its id into the access token (`sid`) —
 * the same order loginUser uses. A-59: the callbacks used to sign
 * `{id, email}` and discard the session, so an SSO-issued token could not be
 * revoked by logout, an administrator's revoke, or a password change (A-48
 * checks the session only when the token names one).
 *
 * A-60: runs at the code exchange, not the callback. The session row, the
 * user's `lastLoginAt` (A-188) and the LOGIN audit row are written in one
 * transaction (Sequelize CLS carries it into createSession), so none exists
 * without the others.
 */
import models from "../models";
import auditService from "./audit.service";
import sessionService from "./session.service";
import { generateAccessToken, generateOpaqueRefreshToken } from "../utils/jwt.util";
import type { TenantId, UserId } from "../types/ids";

const { Users, sequelize } = models;

/** What a hand-off code stands for (A-60), as the controller resolved it. */
interface SsoSignIn {
  userId: UserId;
  email: string;
  tenantId: TenantId;
  ipAddress: string;
  userAgent: string;
  method: string;
}

/**
 * @param entry - the signed-in user, their tenant, the request's address and agent, and the method
 * @returns the access token naming the new session, its refresh token, and the session
 */
const issueSsoTokens = async (entry: SsoSignIn): Promise<{ accessToken: string; refreshToken: string; session: { id: string } }> => {
  const refreshToken = generateOpaqueRefreshToken();

  const session = await sequelize.transaction(async (transaction) => {
    const created = await sessionService.createSession({
      tenantId: entry.tenantId,
      userId: entry.userId,
      refreshToken,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      expiredAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      // A-160: the session is federated; its MFA is the IdP's (0052).
      authMethod: entry.method,
    });
    // A-188: an SSO sign-in is a sign-in — "last login" used to stay at the
    // last PASSWORD sign-in, so an SSO-only account looked dormant. Written in
    // the session's transaction; pre-auth there is no tenant context, and the
    // row is named by id and its own tenant.
    await Users.update(
      { lastLoginAt: new Date() },
      { where: { id: entry.userId, tenantId: entry.tenantId }, transaction, skipTenantScope: true },
    );
    await auditService.logAction(
      {
        tenantId: entry.tenantId,
        userId: entry.userId,
        action: "LOGIN",
        resourceType: "Session",
        resourceId: created.id,
        changes: { method: entry.method },
        // As built: an empty address or agent reads as null (`||`).
        ipAddress: entry.ipAddress || null,
        userAgent: entry.userAgent || null,
      },
      { transaction },
    );
    return created;
  });

  const accessToken = generateAccessToken({
    id: entry.userId,
    email: entry.email,
    sid: session.id,
    // A-160: read by the tenant MFA policy (auth.middleware).
    amr: entry.method,
  });

  // P6-02 (ADR-077): the refresh token goes back too — it was generated,
  // stored as the session's key and then dropped, so an SSO session could
  // never be renewed (the sso-session route reads `refreshToken`).
  return { accessToken, refreshToken, session };
};

const ssoSessionService = { issueSsoTokens };

export = ssoSessionService;
