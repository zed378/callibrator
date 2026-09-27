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
 */

const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const redisService = require("../services/redis.service");
const { verifyPurposeToken } = require("../utils/jwt.util");
const authService = require("../services/auth.service");
const sessionService = require("../services/session.service");
const { tenantStorage } = require("../middlewares/tenantContext.middleware");
const { logger } = require("../middlewares/activityLog.middleware");

const isSuperAdminRole = (name) =>
  name === "SUPER_ADMIN" || name === "SUPERADMIN";

/**
 * The single message any rejected handshake receives. Reporting *why* would
 * turn the handshake into an oracle for account status and tenant state, which
 * the HTTP layer only ever discloses to a caller that already authenticated.
 */
const AUTH_ERROR = "Authentication error";

const deny = (next, reason) => {
  // Server-side only. The client gets AUTH_ERROR and nothing else.
  logger.warn("[Socket] handshake rejected", { reason });
  return next(new Error(AUTH_ERROR));
};

/**
 * The configured allow-list, read per call so a test or a reload sees the
 * current environment. Mirrors index.js.
 */
const allowedOrigins = () =>
  (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

/**
 * CORS policy for the handshake. Same rules as the HTTP layer:
 * no Origin header (server-to-server) allowed, configured origins allowed,
 * everything else allowed outside production and rejected in production.
 */
const corsOrigin = (origin, callback) => {
  if (!origin) {
    return callback(null, true);
  }

  if (allowedOrigins().includes(origin.trim())) {
    return callback(null, true);
  }

  if (process.env.NODE_ENV !== "production") {
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
const readAuthToken = (handshake) => {
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
 * @param {string|undefined} sessionId - the token's `sid`
 * @param {string} userId - the token's `id`
 * @returns {Promise<{user?: object, refusal?: string}>} a server-side-only reason on refusal
 */
const checkPrincipal = async (sessionId, userId) => {
  if (!sessionId) {
    return { refusal: "token names no session" };
  }
  if (!(await sessionService.isSessionLive(sessionId, userId))) {
    return { refusal: `session ${sessionId} is revoked or expired` };
  }

  const user = await authService.getAuthUserWithTenant(userId);

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
 * @param {import("socket.io").Socket} socket
 * @returns {Promise<boolean>} whether the socket was disconnected
 */
const recheckSocket = async (socket) => {
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
      error: err.message,
    });
    return false;
  }
};

/**
 * Handshake authentication and authorization. Deliberately mirrors
 * middlewares/auth.middleware.js#auth: same user loader, same status checks,
 * same tenant-suspension check, same super-admin determination.
 */
const authenticateHandshake = async (socket, next) => {
  try {
    const handshake = socket.handshake || {};
    const token = readAuthToken(handshake);

    if (!token) {
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
    const decoded = verifyPurposeToken(token, "socket");

    const { user, refusal } = await checkPrincipal(decoded.sid, decoded.id);
    if (refusal) {
      return deny(next, refusal);
    }

    socket.user = user;
    // P6-12: the session this socket belongs to, re-checked while it is open.
    socket.sessionId = decoded.sid;
    // The context the Sequelize tenant hooks read. Same shape as
    // tenantContext.middleware.js builds for an HTTP request.
    socket.tenantContext = {
      tenantId: user.tenantId || null,
      isSuperAdmin: isSuperAdminRole(user.role && user.role.name),
      isSystemTask: false,
    };

    return next();
  } catch (err) {
    return deny(next, err.message);
  }
};

/**
 * Wrap a socket event handler so it runs inside this connection's tenant
 * context — the socket equivalent of tenantContextMiddleware.
 */
const withTenantContext = (socket, handler) => {
  return (...args) =>
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
 * @param {import("socket.io").Server} server
 * @returns {boolean} whether the Redis adapter was installed
 */
const attachAdapter = (server) => {
  let shared = null;
  try {
    shared = redisService.getRedisConnection();
  } catch (err) {
    logger.warn("[Socket] Redis client unavailable", { error: err.message });
  }

  if (!shared || shared.status !== "ready") {
    logger.warn(IN_MEMORY_WARNING);
    return false;
  }

  const pubClient = shared.duplicate({ lazyConnect: false });
  const subClient = shared.duplicate({ lazyConnect: false });
  for (const client of [pubClient, subClient]) {
    client.on("error", (err) => {
      logger.warn("[Socket] Redis adapter connection error", { error: err.message });
    });
  }

  server.adapter(createAdapter(pubClient, subClient));
  logger.info("[Socket] Redis adapter enabled: fan-out is shared across replicas");
  return true;
};

let io;

exports.initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  attachAdapter(io);

  // Socket authentication middleware.
  io.use(authenticateHandshake);

  io.on("connection", (socket) => {
    logger.info("[Socket] User connected", {
      userId: socket.user.id,
      tenantId: socket.user.tenantId,
    });

    // P6-12: re-check the principal while the socket is open.
    // unref: an open socket's timer must never keep the process alive.
    const recheckTimer = setInterval(() => recheckSocket(socket), SOCKET_RECHECK_INTERVAL_MS);
    recheckTimer.unref();

    // Join tenant room for tenant-scoped broadcasts (tenant isolation).
    socket.join(`tenant_${socket.user.tenantId}`);

    // Join user room for direct messages.
    socket.join(`user_${socket.user.id}`);

    // Super admins additionally join a global room so they receive EVERY
    // notification across all tenants.
    if (socket.tenantContext.isSuperAdmin) {
      socket.join("super_admins");
    }

    // --- Kanban board rooms (live card/column updates) ---
    // A client opens a board and asks to join its room; we only let them in
    // after confirming they can access the project (same auth the REST layer
    // enforces). Kept lazy-required to avoid a socket <-> service require cycle.
    socket.on(
      "kanban:join",
      withTenantContext(socket, async (projectId, ack) => {
        try {
          const kanban = require("../services/kanban.service");
          await kanban.assertAccess(socket.user, projectId, "viewer");
          socket.join(`board_${projectId}`);
          if (typeof ack === "function") {
            ack({ ok: true });
          }
        } catch (err) {
          if (typeof ack === "function") {
            ack({ ok: false, error: err.message });
          }
        }
      }),
    );

    socket.on("kanban:leave", (projectId) => {
      socket.leave(`board_${projectId}`);
    });

    socket.on("disconnect", () => {
      clearInterval(recheckTimer);
      logger.info("[Socket] User disconnected", { userId: socket.user.id });
    });
  });

  return io;
};

exports.getIo = () => {
  if (!io) {
    throw new Error("Socket.io is not initialized!");
  }
  return io;
};

/**
 * Emit an event to everyone currently viewing a kanban board. Best-effort:
 * never throws (a realtime hiccup must not fail the originating request).
 */
exports.emitToBoard = (projectId, event, payload) => {
  try {
    io && io.to(`board_${projectId}`).emit(event, payload);
  } catch (err) {
    logger.warn("[Socket] emitToBoard failed", { projectId, event, error: err.message });
  }
};

// Exported for tests: the handshake gate and the CORS policy are the security
// surface of this module and are asserted directly.
exports.__testables = {
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
