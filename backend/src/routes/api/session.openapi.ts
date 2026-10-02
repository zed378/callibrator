/**
 * P9-21 / P9-25 (ADR-103) — the contract of `session.route.ts`, code-first.
 *
 * `router.use(auth)` authenticates every route. `/mine` and
 * `/mine/:id/revoke` are the caller's OWN sessions (Q-08, ADR-084): a JWT
 * only (`denyApiKey`), no gate; another user's session id is a 404. Every
 * other route is super admin only (`rbac(["SUPERADMIN"])`), across tenants.
 * The two revoke bodies are the mounted schemas
 * (`@callibrator/contracts/session`); the list filters are read raw.
 * `validateUuid` runs before the gate on the `:id` routes; `:userId` is not
 * shape-checked. Examples are synthetic.
 */
import { z } from "zod";
import { revokeAllSessionsSchema, revokeSessionSchema } from "../../validators/session.validator";
import { defineRouteDocs } from "../../docs/openapi/operation";

const superAdmin = { kind: "rbac", roles: ["SUPERADMIN"] } as const;
const own = { kind: "authenticated", reason: "the caller's own sessions (a JWT; API keys are refused)" } as const;

const idParams = z.object({
  id: z.guid().meta({ description: "The session's id", example: "4e3d2c1b-0a99-4b88-8c77-6d5e4f3a2b1c" }),
});

const SESSION_STATUSES = ["active", "expired", "revoked"] as const;

/** A session as the platform operator's list and detail answer it (session.controller#sessionView). */
const adminSession = z
  .object({
    id: z.guid(),
    userId: z.guid(),
    username: z.string().meta({ description: "`Unknown` when the user is gone" }),
    email: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    ipAddress: z.string().meta({ description: "`N/A` when not recorded" }),
    userAgent: z.string(),
    device: z.string().meta({ description: "Stored, or detected from the user agent" }),
    browser: z.string(),
    os: z.string(),
    role: z.string().meta({ description: "The role's display name; `User` when none" }),
    tenantId: z.guid().nullable(),
    tenantName: z.string().nullable(),
    isRevoked: z.boolean(),
    isActive: z.boolean(),
    expiredAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
    revokedReason: z.string().nullable(),
    lastActivityAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    status: z.enum(SESSION_STATUSES),
  })
  .meta({ id: "AdminSession", description: "A session, as the platform operator sees it" });

/** One of the caller's own sessions (ownSessions.service#toView). */
const ownSession = z.object({
  id: z.guid(),
  current: z.boolean().meta({ description: "Whether it is the session making this request" }),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  device: z.string().nullable(),
  signInMethod: z.string().meta({ example: "password" }),
  impersonated: z.boolean().meta({ description: "A platform operator's support session in this account (A-146)" }),
  createdAt: z.iso.datetime().meta({ description: "When the session signed in (A-339: absent before 2026-10-01)" }),
  lastActivityAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
});

const listQuery = z.object({
  page: z.string().optional().meta({ example: "1" }),
  limit: z.string().optional().meta({ example: "20" }),
  search: z.string().optional().meta({ description: "Substring of the address, device or user agent" }),
  status: z.enum(SESSION_STATUSES).optional(),
  userId: z.string().optional().meta({ description: "One user's sessions" }),
});

export default defineRouteDocs({
  router: "api/session.route",
  mount: "/api/v1/sessions",
  tag: "Sessions",
  tagDescription:
    "Signed-in sessions: the caller's own (list, sign one out), and the platform operator's view across tenants.",
  tenantScoped: false,
  operations: [
    {
      method: "get",
      path: "/mine",
      operationId: "listOwnSessions",
      summary: "List your own live sessions",
      description:
        "Q-08 (ADR-084): every live session of the signed-in user, newest first, with the address and browser recorded " +
        "at sign-in or the last refresh, how it signed in, whether it is this session, and whether it is a platform " +
        "operator's support session.",
      permission: own,
      audited: false,
      success: { status: 200, description: "Your live sessions", data: z.array(ownSession) },
    },
    {
      method: "post",
      path: "/mine/:id/revoke",
      operationId: "revokeOwnSession",
      summary: "Sign out one of your own sessions",
      description:
        "Revokes the session and writes its audit row in the same transaction. Its access token is refused on its next " +
        "request; its open sockets end at the next re-check (ADR-085). Another user's session is a 404.",
      permission: own,
      audited: true,
      params: idParams,
      success: { status: 200, description: "Signed out", data: z.object({ id: z.guid(), current: z.boolean() }) },
    },
    {
      method: "get",
      path: "/stats",
      operationId: "getSessionStats",
      summary: "Count sessions by state",
      permission: superAdmin,
      audited: false,
      query: z.object({ userId: z.string().optional().meta({ description: "One user's sessions" }) }),
      success: {
        status: 200,
        description: "The counts",
        data: z.object({ total: z.number().int(), active: z.number().int(), expired: z.number().int(), revoked: z.number().int() }),
      },
    },
    {
      method: "get",
      path: "/",
      operationId: "listSessions",
      summary: "List sessions",
      description: "Across tenants, newest first.",
      permission: superAdmin,
      audited: false,
      query: listQuery,
      success: { status: 200, description: "A page of sessions", list: adminSession },
    },
    {
      method: "get",
      path: "/:id",
      operationId: "getSession",
      summary: "Get a session",
      permission: superAdmin,
      audited: false,
      params: idParams,
      success: { status: 200, description: "The session", data: adminSession },
    },
    {
      method: "post",
      path: "/:id/revoke",
      operationId: "revokeSession",
      summary: "Revoke a session",
      description: "A session already revoked is a 400.",
      permission: superAdmin,
      audited: true,
      params: idParams,
      body: revokeSessionSchema,
      success: { status: 200, description: "Revoked", empty: true },
    },
    {
      method: "post",
      path: "/user/:userId/revoke-all",
      operationId: "revokeAllUserSessions",
      summary: "Revoke every session of a user",
      permission: superAdmin,
      audited: true,
      params: z.object({ userId: z.string().meta({ description: "The user's id (not shape-checked on this route)", example: "8f7e6d5c-4b3a-4c2d-9e1f-0a9b8c7d6e5f" }) }),
      body: revokeAllSessionsSchema,
      success: { status: 200, description: "How many sessions were revoked", data: z.object({ revokedCount: z.number().int() }) },
    },
    {
      method: "delete",
      path: "/:id",
      operationId: "deleteSession",
      summary: "Delete a revoked or expired session",
      description: "A live session is a 400: revoke it first.",
      permission: superAdmin,
      audited: true,
      params: idParams,
      success: { status: 200, description: "Deleted", empty: true },
    },
  ],
});
