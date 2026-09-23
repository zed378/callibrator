/**
 * A-05 — Socket.IO handshake hardening.
 *
 * These are unit tests over the exact functions Socket.IO is handed: the
 * `io.use` middleware and the `cors.origin` callback. They do not open a real
 * WebSocket (no socket.io-client in this workspace), so they prove the gate,
 * not the transport.
 */

jest.mock("socket.io", () => ({ Server: jest.fn() }));

jest.mock("../../utils/jwt.util", () => ({
  verifyAccessToken: jest.fn(),
}));

jest.mock("../../services/auth.service", () => ({
  getAuthUserWithTenant: jest.fn(),
}));

jest.mock("../../services/kanban.service", () => ({
  assertAccess: jest.fn(),
}));

const { Server } = require("socket.io");
const { verifyAccessToken } = require("../../utils/jwt.util");
const authService = require("../../services/auth.service");
const kanban = require("../../services/kanban.service");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");

const socketModule = require("../../config/socket");
const { authenticateHandshake, corsOrigin, withTenantContext, AUTH_ERROR } =
  socketModule.__testables;

const activeUser = (over = {}) => ({
  id: "user-1",
  tenantId: "tenant-1",
  isActive: true,
  status: "ACTIVE",
  role: { name: "TECHNICIAN" },
  tenant: { id: "tenant-1", status: "ACTIVE" },
  ...over,
});

const handshakeSocket = (handshake) => ({ handshake });

let ORIGINAL_CORS_ORIGIN;
let ORIGINAL_NODE_ENV;

beforeEach(() => {
  ORIGINAL_CORS_ORIGIN = process.env.CORS_ORIGIN;
  ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (ORIGINAL_CORS_ORIGIN === undefined) {
    delete process.env.CORS_ORIGIN;
  } else {
    process.env.CORS_ORIGIN = ORIGINAL_CORS_ORIGIN;
  }
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

describe("socket CORS origin policy", () => {
  it("allows a request with no Origin header (server-to-server)", () => {
    const cb = jest.fn();
    corsOrigin(undefined, cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it("allows an origin listed in CORS_ORIGIN", () => {
    process.env.CORS_ORIGIN = "https://a.example, https://b.example";
    const cb = jest.fn();
    corsOrigin("https://b.example", cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it("rejects an origin outside the allow-list in production", () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGIN = "https://a.example";
    const cb = jest.fn();
    corsOrigin("https://evil.example", cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(cb.mock.calls[0][0].message).toBe("Not allowed by CORS");
  });

  it("rejects every origin in production when CORS_ORIGIN is unset", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CORS_ORIGIN;
    const cb = jest.fn();
    corsOrigin("https://a.example", cb);
    expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("allows an unlisted origin outside production (dev parity with the HTTP layer)", () => {
    process.env.NODE_ENV = "development";
    process.env.CORS_ORIGIN = "https://a.example";
    const cb = jest.fn();
    corsOrigin("http://localhost:3000", cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });
});

// ---------------------------------------------------------------------------
// Handshake authentication
// ---------------------------------------------------------------------------

describe("socket handshake authentication", () => {
  it("rejects a handshake with no token", async () => {
    const next = jest.fn();
    await authenticateHandshake(handshakeSocket({ auth: {} }), next);
    expect(next.mock.calls[0][0].message).toBe(AUTH_ERROR);
  });

  it("rejects a handshake with no handshake object at all", async () => {
    const next = jest.fn();
    await authenticateHandshake({}, next);
    expect(next.mock.calls[0][0].message).toBe(AUTH_ERROR);
  });

  it("rejects a token supplied in the query string", async () => {
    const next = jest.fn();
    await authenticateHandshake(
      handshakeSocket({ auth: {}, query: { token: "valid-token" } }),
      next,
    );
    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].message).toBe(AUTH_ERROR);
  });

  it("ignores a non-string auth token", async () => {
    const next = jest.fn();
    await authenticateHandshake(handshakeSocket({ auth: { token: 42 } }), next);
    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].message).toBe(AUTH_ERROR);
  });

  it("ignores a blank auth token", async () => {
    const next = jest.fn();
    await authenticateHandshake(
      handshakeSocket({ auth: { token: "  " } }),
      next,
    );
    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].message).toBe(AUTH_ERROR);
  });

  it("rejects an MFA-pending token", async () => {
    verifyAccessToken.mockReturnValue({ id: "user-1", mfaRequired: true });
    const next = jest.fn();
    await authenticateHandshake(
      handshakeSocket({ auth: { token: "t" } }),
      next,
    );
    expect(authService.getAuthUserWithTenant).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].message).toBe(AUTH_ERROR);
  });

  it("rejects a token whose user no longer exists", async () => {
    verifyAccessToken.mockReturnValue({ id: "ghost" });
    authService.getAuthUserWithTenant.mockResolvedValue(null);
    const next = jest.fn();
    await authenticateHandshake(
      handshakeSocket({ auth: { token: "t" } }),
      next,
    );
    expect(next.mock.calls[0][0].message).toBe(AUTH_ERROR);
  });

  it("rejects a banned user (isActive false)", async () => {
    verifyAccessToken.mockReturnValue({ id: "user-1" });
    authService.getAuthUserWithTenant.mockResolvedValue(
      activeUser({ isActive: false }),
    );
    const next = jest.fn();
    await authenticateHandshake(
      handshakeSocket({ auth: { token: "t" } }),
      next,
    );
    expect(next.mock.calls[0][0].message).toBe(AUTH_ERROR);
  });

  it.each(["INACTIVE", "SUSPENDED"])(
    "rejects a user whose status is %s",
    async (status) => {
      verifyAccessToken.mockReturnValue({ id: "user-1" });
      authService.getAuthUserWithTenant.mockResolvedValue(
        activeUser({ status }),
      );
      const next = jest.fn();
      await authenticateHandshake(
        handshakeSocket({ auth: { token: "t" } }),
        next,
      );
      expect(next.mock.calls[0][0].message).toBe(AUTH_ERROR);
    },
  );

  it.each(["suspended", "SUSPENDED", "deleted", "DELETED"])(
    "rejects a valid token whose tenant is %s",
    async (status) => {
      verifyAccessToken.mockReturnValue({ id: "user-1" });
      authService.getAuthUserWithTenant.mockResolvedValue(
        activeUser({ tenant: { id: "tenant-1", status } }),
      );
      const socket = handshakeSocket({ auth: { token: "t" } });
      const next = jest.fn();
      await authenticateHandshake(socket, next);
      expect(next.mock.calls[0][0].message).toBe(AUTH_ERROR);
      expect(socket.user).toBeUndefined();
    },
  );

  it("does not disclose why a handshake was rejected", async () => {
    verifyAccessToken.mockReturnValue({ id: "user-1" });
    authService.getAuthUserWithTenant.mockResolvedValue(
      activeUser({ tenant: { id: "tenant-1", status: "suspended" } }),
    );
    const next = jest.fn();
    await authenticateHandshake(
      handshakeSocket({ auth: { token: "t" } }),
      next,
    );
    const message = next.mock.calls[0][0].message;
    expect(message).toBe("Authentication error");
    expect(message).not.toMatch(/tenant|suspend|user|status/i);
  });

  it("rejects a handshake whose token fails verification", async () => {
    verifyAccessToken.mockImplementation(() => {
      throw new Error("jwt expired");
    });
    const next = jest.fn();
    await authenticateHandshake(
      handshakeSocket({ auth: { token: "t" } }),
      next,
    );
    expect(next.mock.calls[0][0].message).toBe(AUTH_ERROR);
  });

  it("accepts a valid token for an active user in an active tenant", async () => {
    verifyAccessToken.mockReturnValue({ id: "user-1" });
    const user = activeUser();
    authService.getAuthUserWithTenant.mockResolvedValue(user);
    const socket = handshakeSocket({ auth: { token: " t " } });
    const next = jest.fn();

    await authenticateHandshake(socket, next);

    expect(verifyAccessToken).toHaveBeenCalledWith("t");
    expect(next).toHaveBeenCalledWith();
    expect(socket.user).toBe(user);
    expect(socket.tenantContext).toEqual({
      tenantId: "tenant-1",
      isSuperAdmin: false,
      isSystemTask: false,
    });
  });

  it("accepts a tenant-bound user whose tenant row is missing", async () => {
    verifyAccessToken.mockReturnValue({ id: "user-1" });
    authService.getAuthUserWithTenant.mockResolvedValue(
      activeUser({ tenant: null }),
    );
    const socket = handshakeSocket({ auth: { token: "t" } });
    const next = jest.fn();
    await authenticateHandshake(socket, next);
    expect(next).toHaveBeenCalledWith();
    expect(socket.tenantContext.tenantId).toBe("tenant-1");
  });

  it.each(["SUPER_ADMIN", "SUPERADMIN"])(
    "marks a %s connection as cross-tenant in the context",
    async (roleName) => {
      verifyAccessToken.mockReturnValue({ id: "user-1" });
      authService.getAuthUserWithTenant.mockResolvedValue(
        activeUser({ tenantId: null, tenant: null, role: { name: roleName } }),
      );
      const socket = handshakeSocket({ auth: { token: "t" } });
      const next = jest.fn();
      await authenticateHandshake(socket, next);
      expect(next).toHaveBeenCalledWith();
      expect(socket.tenantContext).toEqual({
        tenantId: null,
        isSuperAdmin: true,
        isSystemTask: false,
      });
    },
  );

  it("treats a user with no role as not a super admin", async () => {
    verifyAccessToken.mockReturnValue({ id: "user-1" });
    authService.getAuthUserWithTenant.mockResolvedValue(
      activeUser({ role: null }),
    );
    const socket = handshakeSocket({ auth: { token: "t" } });
    const next = jest.fn();
    await authenticateHandshake(socket, next);
    expect(socket.tenantContext.isSuperAdmin).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tenant context propagation
// ---------------------------------------------------------------------------

describe("withTenantContext", () => {
  it("runs the handler inside this connection's tenant context", () => {
    const socket = {
      tenantContext: {
        tenantId: "tenant-9",
        isSuperAdmin: false,
        isSystemTask: false,
      },
    };
    const seen = [];
    const wrapped = withTenantContext(socket, (arg) => {
      seen.push([arg, tenantStorage.getStore()]);
    });

    expect(tenantStorage.getStore()).toBeUndefined();
    wrapped("payload");

    expect(seen[0][0]).toBe("payload");
    expect(seen[0][1]).toBe(socket.tenantContext);
  });
});

// ---------------------------------------------------------------------------
// initSocket / getIo / emitToBoard
// ---------------------------------------------------------------------------

describe("initSocket", () => {
  let fakeIo;
  let emit;

  const connect = (socket) => {
    const handler = fakeIo.on.mock.calls.find((c) => c[0] === "connection")[1];
    handler(socket);
    return Object.fromEntries(socket.on.mock.calls);
  };

  const fakeSocket = (over = {}) => ({
    user: { id: "user-1", tenantId: "tenant-1" },
    tenantContext: {
      tenantId: "tenant-1",
      isSuperAdmin: false,
      isSystemTask: false,
    },
    join: jest.fn(),
    leave: jest.fn(),
    on: jest.fn(),
    ...over,
  });

  beforeEach(() => {
    emit = jest.fn();
    fakeIo = {
      use: jest.fn(),
      on: jest.fn(),
      to: jest.fn(() => ({ emit })),
    };
    Server.mockImplementation(() => fakeIo);
    socketModule.initSocket({ fake: "http server" });
  });

  it("configures CORS from the allow-list function with credentials, not a wildcard", () => {
    const options = Server.mock.calls[0][1];
    // A-05: the reported `origin: "*"` alongside a credentialed handshake.
    expect(options.cors.origin).not.toBe("*");
    expect(options.cors.origin).toBe(corsOrigin);
    expect(options.cors.credentials).toBe(true);
  });

  it("installs the handshake gate as the connection middleware", () => {
    expect(fakeIo.use).toHaveBeenCalledWith(authenticateHandshake);
  });

  it("joins the tenant and user rooms, and not super_admins", () => {
    const socket = fakeSocket();
    connect(socket);
    expect(socket.join).toHaveBeenCalledWith("tenant_tenant-1");
    expect(socket.join).toHaveBeenCalledWith("user_user-1");
    expect(socket.join).not.toHaveBeenCalledWith("super_admins");
  });

  it("joins super_admins when the context says the principal is one", () => {
    const socket = fakeSocket({
      tenantContext: {
        tenantId: null,
        isSuperAdmin: true,
        isSystemTask: false,
      },
    });
    connect(socket);
    expect(socket.join).toHaveBeenCalledWith("super_admins");
  });

  it("joins a kanban board room inside the tenant context after an access check", async () => {
    const socket = fakeSocket();
    const handlers = connect(socket);
    let contextDuringCheck;
    kanban.assertAccess.mockImplementation(async () => {
      contextDuringCheck = tenantStorage.getStore();
      return { project: {}, level: "viewer" };
    });
    const ack = jest.fn();

    await handlers["kanban:join"]("proj-1", ack);

    expect(contextDuringCheck).toBe(socket.tenantContext);
    expect(kanban.assertAccess).toHaveBeenCalledWith(
      socket.user,
      "proj-1",
      "viewer",
    );
    expect(socket.join).toHaveBeenCalledWith("board_proj-1");
    expect(ack).toHaveBeenCalledWith({ ok: true });
  });

  it("does not join the board room when the access check fails", async () => {
    const socket = fakeSocket();
    const handlers = connect(socket);
    kanban.assertAccess.mockRejectedValue(new Error("Project not found"));
    const ack = jest.fn();

    await handlers["kanban:join"]("proj-1", ack);

    expect(socket.join).not.toHaveBeenCalledWith("board_proj-1");
    expect(ack).toHaveBeenCalledWith({ ok: false, error: "Project not found" });
  });

  it("tolerates kanban:join without an ack callback, on both paths", async () => {
    const socket = fakeSocket();
    const handlers = connect(socket);
    kanban.assertAccess.mockResolvedValue({ project: {}, level: "viewer" });
    await handlers["kanban:join"]("proj-1");
    kanban.assertAccess.mockRejectedValue(new Error("nope"));
    await expect(handlers["kanban:join"]("proj-2")).resolves.toBeUndefined();
  });

  it("leaves the board room on kanban:leave", () => {
    const socket = fakeSocket();
    const handlers = connect(socket);
    handlers["kanban:leave"]("proj-1");
    expect(socket.leave).toHaveBeenCalledWith("board_proj-1");
  });

  it("logs the disconnect", () => {
    const socket = fakeSocket();
    const handlers = connect(socket);
    expect(() => handlers.disconnect()).not.toThrow();
  });

  it("returns the io instance from getIo and emits to a board", () => {
    expect(socketModule.getIo()).toBe(fakeIo);
    socketModule.emitToBoard("proj-1", "card:updated", { id: 1 });
    expect(fakeIo.to).toHaveBeenCalledWith("board_proj-1");
    expect(emit).toHaveBeenCalledWith("card:updated", { id: 1 });
  });

  it("swallows an emit failure", () => {
    fakeIo.to.mockImplementation(() => {
      throw new Error("socket gone");
    });
    expect(() =>
      socketModule.emitToBoard("proj-1", "card:updated", {}),
    ).not.toThrow();
  });
});

describe("getIo before initialisation", () => {
  it("throws", () => {
    jest.isolateModules(() => {
      const fresh = require("../../config/socket");
      expect(() => fresh.getIo()).toThrow("Socket.io is not initialized!");
      expect(() => fresh.emitToBoard("p", "e", {})).not.toThrow();
    });
  });
});
