/**
 * Realtime hub — Socket.IO.
 *
 * Authenticates the handshake with the short-lived socket token (see
 * POST /api/v1/auth/socket-token — the app JWT lives in an httpOnly cookie that
 * browser JS cannot read). On connect, the socket joins its tenant room and a
 * per-user room; super admins additionally join a global room. Kanban board
 * rooms are joined on demand after an access check.
 *
 * Exported surface: initSocket / getIo / emitToBoard.
 */

const { Server } = require("socket.io");
const { verifyAccessToken } = require("../utils/jwt.util");
const { User, Tenant, Role } = require("../models");

const isSuperAdminRole = (name) =>
  name === "SUPER_ADMIN" || name === "SUPERADMIN";

let io;

exports.initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*", // Adjust for production
      methods: ["GET", "POST"],
    },
  });

  // Socket authentication middleware.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;

      if (!token) {
        return next(new Error("Authentication error: Token missing"));
      }

      // App tokens are signed with JWT_ACCESS_SECRET (HS256).
      const decoded = verifyAccessToken(token);

      const user = await User.findByPk(decoded.id, {
        include: [
          { model: Tenant, as: "tenant", attributes: ["id"] },
          { model: Role, as: "role", attributes: ["name"] },
        ],
      });

      if (!user) {
        return next(new Error("Authentication error: User not found"));
      }

      socket.user = user;
      next();
    } catch (err) {
      console.error("Socket authentication failed:", err.message);
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket) => {
    console.log(
      `[Socket] User connected: ${socket.user.id} (Tenant: ${socket.user.tenantId})`,
    );

    // Join tenant room for tenant-scoped broadcasts (tenant isolation).
    socket.join(`tenant_${socket.user.tenantId}`);

    // Join user room for direct messages.
    socket.join(`user_${socket.user.id}`);

    // Super admins additionally join a global room so they receive EVERY
    // notification across all tenants.
    if (isSuperAdminRole(socket.user.role?.name)) {
      socket.join("super_admins");
    }

    // --- Kanban board rooms (live card/column updates) ---
    // A client opens a board and asks to join its room; we only let them in
    // after confirming they can access the project (same auth the REST layer
    // enforces). Kept lazy-required to avoid a socket <-> service require cycle.
    socket.on("kanban:join", async (projectId, ack) => {
      try {
        const kanban = require("../services/kanban.service");
        await kanban.assertAccess(socket.user, projectId, "viewer");
        socket.join(`board_${projectId}`);
        if (typeof ack === "function") ack({ ok: true });
      } catch (err) {
        if (typeof ack === "function") ack({ ok: false, error: err.message });
      }
    });

    socket.on("kanban:leave", (projectId) => {
      socket.leave(`board_${projectId}`);
    });

    socket.on("disconnect", () => {
      console.log(`[Socket] User disconnected: ${socket.user.id}`);
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
    console.warn("[Socket] emitToBoard failed:", err.message);
  }
};
