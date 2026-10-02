/**
 * Realtime hub — Socket.IO.
 *
 * Authenticates the handshake with the short-lived socket token (see
 * POST /api/v1/auth/socket-token — the app JWT lives in an httpOnly cookie that
 * browser JS cannot read). On connect, the socket joins its tenant room and a
 * per-user room; super admins additionally join a global room. Kanban board
 * rooms are joined on demand after an access check.
 *
 * A-05 hardening (2026-09-23):
 *  - CORS origin comes from CORS_ORIGIN, mirroring the HTTP layer in index.js.
 *    `origin: "*"` is never used: the handshake carries a credential.
 *  - The token is read from `handshake.auth` ONLY. A query-string token is
 *    rejected, deliberately: query strings are written to proxy and access
 *    logs, so a token there is a credential at rest in plaintext.
 *  - The handshake applies the same principal checks as the HTTP `auth`
 *    middleware — socket-purpose token only (A-59), live session, user
 *    exists, user active, account not
 *    inactive/suspended, tenant not suspended/deleted — via the same
 *    `authService.getAuthUserWithTenant` loader.
 *  - P6-12 (2026-09-27): the same checks re-run on every OPEN socket every
 *    SOCKET_RECHECK_INTERVAL_MS, and a socket that fails them is disconnected.
 *    A socket token that names no session is refused.
 *  - Every rejection returns ONE opaque message. An unauthenticated socket is
 *    never told whether the user, the account status or the tenant was the
 *    reason; the detail is logged server-side only.
 *  - Socket event handlers run inside the tenant AsyncLocalStorage context, so
 *    the global Sequelize tenant hooks scope their queries exactly as they do
 *    on an HTTP request. Without it every socket-initiated query ran with no
 *    context at all, which the scope resolver treats as "skip".
 *
 * A-54 (2026-09-24): the fan-out goes through the Redis adapter whenever the
 * shared Redis client is ready at startup (`initRedis()` runs before
 * `initSocket()` in index.js), so an emit on one replica reaches clients
 * connected to every replica. Without Redis it falls back to the in-memory
 * adapter with a warning — correct for exactly one replica, and only one.
 *
 * Exported surface: initSocket / getIo / emitToBoard.
 *
 * P9-21 (ADR-087): converted from socket.js with no behaviour change. `export =`
 * keeps the object `require()` returned, with the keys the .js assigned, in its
 * order (nothing requires this module while it loads, so assigning them at the
 * end is the same object for every caller). `verifyPurposeToken` is captured
 * at load as the .js destructured it; kanban.service is still required inside
 * the `kanban:join` handler, at call time. Proved by socket.test.js unchanged
 * (58 tests, 100% of this file), an identity run of every exported helper
 * against the .js (return values included), and the A-54 cross-replica case
 * on a real Redis. It replaces `socket.d.ts`, which described the `.js` and
 * is removed.
 */

import { Server } from "socket.io";
import type { Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { createAdapter } from "@socket.io/redis-adapter";
import redisService from "../services/redis.service";
import jwtUtil from "../utils/jwt.util";
import authService from "../services/auth.service";
import sessionService from "../services/session.service";
import { tenantStorage } from "../middlewares/tenantContext.middleware";
import type { TenantContextStore } from "../middlewares/tenantContext.middleware";
import { logger } from "../middlewares/activityLog.middleware";

// N-01 / V-15: the one super-admin predicate (utils/role.util.ts).
import { isSuperAdminRoleName as isSuperAdminRole } from "../utils/role.util";
import type KanbanService from "../services/kanban.service";
import type { TenantId } from "../types/ids";

const { verifyPurposeToken } = jwtUtil;

/** What the handshake reads of the user `getAuthUserWithTenant` loads. */
interface SocketPrincipal {
  id: string;
  tenantId?: string | null;
  isActive?: boolean;
  status?: string;
  tenant?: { status?: string | null } | null;
  role?: { name?: unknown } | null;
}

/** A socket that passed the handshake: its principal, session and tenant context. */
type AppSocket = Socket & {
  user: SocketPrincipal;
  sessionId?: string;
  tenantContext: TenantContextStore;
};

/** socket.io's middleware `next` (its return value is passed back, as the .js returned it). */
type Next = (err?: Error) => unknown;

const messageOf = (err: unknown): unknown => (err as { message?: unknown }).message;

/**
 * The single message any rejected handshake receives. Reporting *why* would
 * turn the handshake into an oracle for account status and tenant state, which
 * the HTTP layer only ever discloses to a caller that already authenticated.
 */
const AUTH_ERROR = "Authentication error";

const deny = (next: Next, reason: unknown): unknown => {
  // Server-side only. The client gets AUTH_ERROR and nothing else.
  logger.warn("[Socket] handshake rejected", { reason });
  return next(new Error(AUTH_ERROR));
};

/**
 * The configured allow-list, read per call so a test or a reload sees the
 * current environment. Mirrors index.js.
 */
const allowedOrigins = (): string[] =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty CORS_ORIGIN allows none
  (process.env["CORS_ORIGIN"] || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

/**
 * CORS policy for the handshake. Same rules as the HTTP layer:
 * no Origin header (server-to-server) allowed, configured origins allowed,
 * everything else allowed outside production and rejected in production.
 */
const corsOrigin = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => unknown): unknown => {
  if (!origin) {
    return callback(null, true);
  }

  if (allowedOrigins().includes(origin.trim())) {
    return callback(null, true);
  }

  if (process.env["NODE_ENV"] !== "production") {
    return callback(null, true);
  }

  logger.warn("[Socket] CORS: origin rejected", { origin });
  return callback(new Error("Not allowed by CORS"));
};

/**
 * Read the handshake token. `handshake.auth` only — see the header comment.
 * Returns null when absent so the caller can distinguish "missing" from
 * "supplied somewhere we refuse to read".
 */
const readAuthToken = (handshake: { auth?: { token?: unknown } | null }): string | null => {
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `auth && auth.token` (a falsy auth yields that falsy value, then null below)
  const token = handshake.auth && handshake.auth.token;
  if (typeof token === "string" && token.trim()) {
    return token.trim();
  }
  return null;
};

/**
 * The principal checks a socket must pass — at the handshake AND while it
 * stays open (P6-12). The same checks the HTTP `auth` middleware makes: a
 * live session (A-48), the user exists and is active and not
 * inactive/suspended/erased, and its tenant is neither deleted nor suspended.
 *
 * A socket token that names no session is refused (P6-12, as an access token
 * without `sid` is refused over HTTP): it could never be revoked.
 *
 * @param sessionId - the token's `sid`
 * @param userId - the token's `id`
 * @returns the user, or a server-side-only reason on refusal
 */
const checkPrincipal = async (
  sessionId: string | undefined,
  userId: string,
): Promise<{ user?: SocketPrincipal; refusal?: string }> => {
  if (!sessionId) {
    return { refusal: "token names no session" };
  }
  if (!(await sessionService.isSessionLive(sessionId, userId))) {
    return { refusal: `session ${sessionId} is revoked or expired` };
  }

  const user = (await authService.getAuthUserWithTenant(userId)) as SocketPrincipal | null;

  if (!user) {
    return { refusal: "user not found" };
  }

  if (!user.isActive) {
    return { refusal: `user ${user.id} is banned` };
  }

  if (user.status === "INACTIVE" || user.status === "SUSPENDED" || user.status === "erased") {
    return { refusal: `user ${user.id} is ${user.status.toLowerCase()}` };
  }

  if (user.tenantId) {
    // A-101: a soft-deleted or destroyed tenant is hidden by the Tenant
    // default scope and paranoid, so the include comes back null. That is a
    // deleted tenant, not "no tenant" — refuse it, as sign-in does (A-83).
    if (!user.tenant) {
      return { refusal: `tenant ${user.tenantId} is deleted` };
    }
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-type-conversion -- as built: an empty status reads as none, and String() stays for a value the model did not type
    const tenantStatus = String(user.tenant.status || "").toLowerCase();
    if (tenantStatus === "suspended" || tenantStatus === "deleted") {
      return { refusal: `tenant ${user.tenantId} is ${tenantStatus}` };
    }
  }

  return { user };
};

/**
 * P6-12. How often an OPEN socket re-runs checkPrincipal. Until 2026-09-27 the
 * checks ran at the handshake only, so a revoked session, a banned user or a
 * suspended tenant kept receiving realtime events for as long as the socket
 * stayed connected. This is the bound on that window: at most one interval
 * (plus the session-liveness cache TTL when a revocation bypassed the model
 * hooks — session.service.js#SESSION_LIVENESS_TTL_SECONDS).
 */
const SOCKET_RECHECK_INTERVAL_MS = 60 * 1000;

/**
 * Re-check an open socket's principal; disconnect it when it no longer passes.
 * An error (the database or Redis briefly unreachable) is logged and the
 * socket kept: the next interval tries again. Disconnecting every socket on a
 * blip would turn an infrastructure hiccup into a reconnect storm, and the
 * reconnect's handshake runs the same checks anyway.
 *
 * @param socket - an authenticated socket
 * @returns whether the socket was disconnected
 */
const recheckSocket = async (socket: AppSocket): Promise<boolean> => {
  try {
    const { refusal } = await checkPrincipal(socket.sessionId, socket.user.id);
    if (!refusal) {
      return false;
    }
    logger.warn("[Socket] open socket refused on re-check", {
      userId: socket.user.id,
      reason: refusal,
    });
    socket.disconnect(true);
    return true;
  } catch (err) {
    logger.warn("[Socket] re-check failed; socket kept until the next one", {
      userId: socket.user.id,
      error: messageOf(err),
    });
    return false;
  }
};

/**
 * Handshake authentication and authorization. Deliberately mirrors
 * middlewares/auth.middleware.js#auth: same user loader, same status checks,
 * same tenant-suspension check, same super-admin determination.
 */
const authenticateHandshake = async (socket: Socket, next: Next): Promise<unknown> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: a socket without a handshake reads as an empty one
    const handshake = (socket.handshake || {}) as Socket["handshake"] & { query?: { token?: unknown } };
    const token = readAuthToken(handshake);

    if (!token) {
      // eslint-disable-next-line @typescript-eslint/prefer-optional-chain, @typescript-eslint/no-unnecessary-condition -- as built: `query && query.token`
      if (handshake.query && handshake.query.token) {
        return deny(
          next,
          "token supplied in the query string — not accepted, use handshake auth",
        );
      }
      return deny(next, "token missing");
    }

    // A-59: ONLY a "socket" purpose token (POST /auth/socket-token) opens a
    // socket. An access token, an MFA-pending token and an activation token
    // are all refused here — and the socket token is refused everywhere else.
    const decoded = verifyPurposeToken(token, "socket") as { sid?: string; id: string };

    const { user, refusal } = await checkPrincipal(decoded.sid, decoded.id);
    if (refusal) {
      return deny(next, refusal);
    }

    const appSocket = socket as AppSocket;
    // checkPrincipal answers a user whenever it answers no refusal.
    const principal = user as SocketPrincipal;
    appSocket.user = principal;
    // P6-12: the session this socket belongs to, re-checked while it is open.
    appSocket.sessionId = decoded.sid as string;
    // The context the Sequelize tenant hooks read. Same shape as
    // tenantContext.middleware.js builds for an HTTP request.
    appSocket.tenantContext = {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty tenantId reads as none
      tenantId: (principal.tenantId || null) as TenantId | null,
      // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `role && role.name`
      isSuperAdmin: isSuperAdminRole(principal.role && principal.role.name),
      isSystemTask: false,
    };

    return next();
  } catch (err) {
    return deny(next, messageOf(err));
  }
};

/**
 * Wrap a socket event handler so it runs inside this connection's tenant
 * context — the socket equivalent of tenantContextMiddleware.
 */
const withTenantContext = <Args extends unknown[], R>(
  socket: AppSocket,
  handler: (...args: Args) => R,
): ((...args: Args) => R) => {
  return (...args: Args) =>
    tenantStorage.run(socket.tenantContext, () => handler(...args));
};

const IN_MEMORY_WARNING =
  "[Socket] Redis is not available: using the in-memory adapter. Realtime " +
  "events reach only clients connected to THIS process — run exactly one " +
  "backend replica until Redis is configured (A-54).";

/**
 * Put the server's fan-out on Redis pub/sub (A-54).
 *
 * The adapter needs two connections of its own — a subscriber cannot issue
 * ordinary commands — so both are duplicates of the shared client and inherit
 * its URL, credentials and `protocol: 2` (redis.service.js). `lazyConnect` is
 * overridden so they dial now rather than on their first command.
 *
 * Enabled only when the shared client is `ready`: index.js has already awaited
 * `initRedis()`, so anything else means Redis is unconfigured or unreachable,
 * and the in-memory adapter is the only one that can work. A connection lost
 * LATER is ioredis's job: the duplicates reconnect with the shared retry
 * strategy and re-subscribe on their own.
 *
 * @param server - the Socket.IO server
 * @returns whether the Redis adapter was installed
 */
const attachAdapter = (server: Server): boolean => {
  let shared: ReturnType<typeof redisService.getRedisConnection> | null = null;
  try {
    shared = redisService.getRedisConnection();
  } catch (err) {
    logger.warn("[Socket] Redis client unavailable", { error: messageOf(err) });
  }

  // As built: no client, or a client that is not ready (the same test as `!shared || shared.status !== "ready"`).
  if (shared?.status !== "ready") {
    logger.warn(IN_MEMORY_WARNING);
    return false;
  }

  const pubClient = shared.duplicate({ lazyConnect: false });
  const subClient = shared.duplicate({ lazyConnect: false });
  for (const client of [pubClient, subClient]) {
    client.on("error", (err: unknown) => {
      logger.warn("[Socket] Redis adapter connection error", { error: messageOf(err) });
    });
  }

  server.adapter(createAdapter(pubClient, subClient));
  logger.info("[Socket] Redis adapter enabled: fan-out is shared across replicas");
  return true;
};

let io: Server | undefined;

const initSocket = (server: HttpServer): Server => {
  io = new Server(server, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  attachAdapter(io);

  // Socket authentication middleware (it catches its own errors; socket.io ignores the promise).
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- see above
  io.use(authenticateHandshake);

  io.on("connection", (connected: Socket) => {
    const socket = connected as AppSocket;
    logger.info("[Socket] User connected", {
      userId: socket.user.id,
      tenantId: socket.user.tenantId,
    });

    // P6-12: re-check the principal while the socket is open.
    // unref: an open socket's timer must never keep the process alive.
    const recheckTimer = setInterval(() => {
      void recheckSocket(socket);
    }, SOCKET_RECHECK_INTERVAL_MS);
    recheckTimer.unref();

    // Join tenant room for tenant-scoped broadcasts (tenant isolation).
    void socket.join(`tenant_${socket.user.tenantId as string}`);

    // Join user room for direct messages.
    void socket.join(`user_${socket.user.id}`);

    // Super admins additionally join a global room so they receive EVERY
    // notification across all tenants.
    if (socket.tenantContext.isSuperAdmin) {
      void socket.join("super_admins");
    }

    // --- Kanban board rooms (live card/column updates) ---
    // A client opens a board and asks to join its room; we only let them in
    // after confirming they can access the project (same auth the REST layer
    // enforces). Kept lazy-required to avoid a socket <-> service require cycle.
    socket.on(
      "kanban:join",
      withTenantContext(socket, async (projectId: unknown, ack: unknown) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required at call time (see above)
          const kanban = require("../services/kanban.service") as typeof KanbanService;
          await kanban.assertAccess(socket.user as Parameters<typeof kanban.assertAccess>[0], projectId as Parameters<typeof kanban.assertAccess>[1], "viewer");
          void socket.join(`board_${projectId as string}`);
          if (typeof ack === "function") {
            (ack as (reply: unknown) => void)({ ok: true });
          }
        } catch (err) {
          if (typeof ack === "function") {
            (ack as (reply: unknown) => void)({ ok: false, error: messageOf(err) });
          }
        }
      }),
    );

    socket.on("kanban:leave", (projectId: unknown) => {
      void socket.leave(`board_${projectId as string}`);
    });

    socket.on("disconnect", () => {
      clearInterval(recheckTimer);
      logger.info("[Socket] User disconnected", { userId: socket.user.id });
    });
  });

  return io;
};

const getIo = (): Server => {
  if (!io) {
    throw new Error("Socket.io is not initialized!");
  }
  return io;
};

/**
 * Emit an event to everyone currently viewing a kanban board. Best-effort:
 * never throws (a realtime hiccup must not fail the originating request).
 */
const emitToBoard = (projectId: unknown, event: string, payload?: unknown): void => {
  try {
    if (io) {
      io.to(`board_${projectId as string}`).emit(event, payload);
    }
  } catch (err) {
    logger.warn("[Socket] emitToBoard failed", { projectId, event, error: messageOf(err) });
  }
};

// Exported for tests: the handshake gate and the CORS policy are the security
// surface of this module and are asserted directly.
const __testables = {
  authenticateHandshake,
  checkPrincipal,
  recheckSocket,
  SOCKET_RECHECK_INTERVAL_MS,
  corsOrigin,
  readAuthToken,
  withTenantContext,
  attachAdapter,
  AUTH_ERROR,
  IN_MEMORY_WARNING,
};

export = { initSocket, getIo, emitToBoard, __testables };
