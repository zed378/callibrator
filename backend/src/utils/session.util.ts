/**
 * Session rows keyed by a token's SHA-256 (the raw token is never stored).
 *
 * P9-21 (ADR-087): converted from session.util.js with no behaviour change.
 * `export =` keeps the exact object `require()` returned (the same keys, in the
 * same order). `crypto` and the `Sessions` model (the barrel's alias of
 * `Session`) are captured at load, in the `.js`'s require order; the functions
 * call `hashToken` as a local binding, as the `.js` did. The model's attributes
 * are snake_case (CLAUDE.md, traps).
 */
import loadedCrypto from "crypto";
import models from "../models";
import type { WhereOptions } from "sequelize";
import type { ModelInstance } from "../types/models";

const crypto = loadedCrypto;
const { Sessions } = models;

type SessionRow = ModelInstance<"Session">;

// ==========================================
// HASH TOKEN
// ==========================================

const hashToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

// ==========================================
// CREATE SESSION
// ==========================================

const createSession = async ({
  userId,
  token,
  ipAddress = null,
  userAgent = null,
  expiredAt,
}: {
  userId: SessionRow["user_id"];
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  expiredAt: Date;
}): Promise<SessionRow> => {
  const tokenHash = hashToken(token);

  return Sessions.create({
    user_id: userId,
    token_hash: tokenHash,
    ip_address: ipAddress,
    user_agent: userAgent,
    expired_at: expiredAt,
    is_revoked: false,
  });
};

// ==========================================
// FIND SESSION
// ==========================================

const findSession = async ({
  token,
  userId,
  sessionId,
}: {
  token: string;
  userId?: string | null;
  sessionId?: string | null;
}): Promise<SessionRow | null> => {
  const tokenHash = hashToken(token);

  const where: Record<string, unknown> = {
    is_revoked: false,
  };

  // Prioritize session ID from x-session header
  if (sessionId) {
    where["id"] = sessionId;
  } else {
    // Fallback to token-based lookup
    where["token_hash"] = tokenHash;
    where["user_id"] = userId;
  }

  return Sessions.findOne({
    where: where as WhereOptions,
  });
};

// ==========================================
// REVOKE SESSION
// ==========================================

const revokeSession = async ({ token, userId }: { token: string; userId: SessionRow["user_id"] }): Promise<[affectedCount: number]> => {
  const tokenHash = hashToken(token);

  return Sessions.update(
    {
      is_revoked: true,
    },
    {
      where: {
        token_hash: tokenHash,
        user_id: userId,
      },
    },
  );
};

// ==========================================
// REVOKE ALL USER SESSIONS
// ==========================================

const revokeAllUserSessions = async (userId: SessionRow["user_id"]): Promise<[affectedCount: number]> => {
  return Sessions.update(
    {
      is_revoked: true,
    },
    {
      where: {
        user_id: userId,
      },
    },
  );
};

export = {
  hashToken,
  createSession,
  findSession,
  revokeSession,
  revokeAllUserSessions,
};
