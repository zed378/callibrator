/**
 * A-54 — Socket.IO fan-out across replicas, against a REAL Redis.
 *
 * Two in-process Socket.IO servers, each a separately loaded copy of
 * config/socket.js + services/redis.service.js (its own module state, its own
 * ioredis connection — exactly what a second pod is), share one Redis. A real
 * socket.io-client connects to server B only and joins a board room through the
 * real `kanban:join` handler; the board event is emitted on server A. Without
 * the Redis adapter the event never leaves process A.
 *
 * The second case is the fallback: no Redis, one warning, in-memory adapter.
 *
 * OPT-IN — needs a reachable Redis (REDIS_URL / REDIS_HOST / REDIS_PORT):
 *
 *   REDIS_LIVE_TEST=1 npm test -- src/tests/config/socket.redisAdapter.live --coverage=false
 *
 * socket.io-client is not a backend dependency; it resolves from the root
 * node_modules (the frontend workspace's copy, hoisted). The unit suite
 * (socket.test.js) covers the branches for the coverage gate.
 */

const http = require("http");

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../utils/jwt.util", () => ({
  verifyPurposeToken: jest.fn(() => ({ id: "user-1" })),
}));

jest.mock("../../services/session.service", () => ({
  isSessionLive: jest.fn(async () => true),
}));

jest.mock("../../services/auth.service", () => ({
  getAuthUserWithTenant: jest.fn(async () => ({
    id: "user-1",
    tenantId: "tenant-1",
    isActive: true,
    status: "ACTIVE",
    role: { name: "TECHNICIAN" },
    tenant: { id: "tenant-1", status: "ACTIVE" },
  })),
}));

jest.mock("../../services/kanban.service", () => ({
  assertAccess: jest.fn(async () => ({ project: {}, level: "viewer" })),
}));

const liveDescribe =
  process.env.REDIS_LIVE_TEST === "1" ? describe : describe.skip;

liveDescribe("Socket.IO Redis adapter — live Redis (A-54)", () => {
  const { io: ioClient } = require("socket.io-client");
  const replicas = [];
  const clients = [];

  /** Load an independent copy of the realtime hub and start it on a port. */
  async function startReplica({ withRedis = true } = {}) {
    let socketModule;
    let redisService;
    jest.isolateModules(() => {
      redisService = require("../../services/redis.service");
      socketModule = require("../../config/socket");
    });
    if (withRedis) {
      await redisService.initRedis();
    }
    const server = http.createServer();
    const io = socketModule.initSocket(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const replica = {
      socketModule,
      redisService,
      server,
      io,
      url: `http://127.0.0.1:${server.address().port}`,
    };
    replicas.push(replica);
    return replica;
  }

  function connectClient(url) {
    const client = ioClient(url, {
      auth: { token: "socket-token" },
      transports: ["websocket"],
      reconnection: false,
    });
    clients.push(client);
    return new Promise((resolve, reject) => {
      client.once("connect", () => resolve(client));
      client.once("connect_error", reject);
    });
  }

  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterAll(async () => {
    for (const client of clients) {
      client.disconnect();
    }
    for (const { io, server, redisService } of replicas) {
      // io.close() closes the adapter (unsubscribes) and the HTTP server.
      await new Promise((resolve) => io.close(() => resolve()));
      server.closeAllConnections?.();
      await redisService.closeRedis();
    }
  });

  it("A-54: an emit on replica A reaches a client connected only to replica B", async () => {
    const a = await startReplica();
    const b = await startReplica();

    expect(a.io.of("/").adapter.constructor.name).toBe("RedisAdapter");
    expect(b.io.of("/").adapter.constructor.name).toBe("RedisAdapter");

    const client = await connectClient(b.url);
    const joined = await client.emitWithAck("kanban:join", "proj-54");
    expect(joined).toEqual({ ok: true });

    // B's SUBSCRIBE must be live before A publishes. fetchSockets() from A is a
    // request/response round trip through Redis that only B can answer, so it
    // also proves B's socket is visible cluster-wide in the board room.
    const sockets = await a.io.in("board_proj-54").fetchSockets();
    expect(sockets).toHaveLength(1);

    const received = new Promise((resolve) =>
      client.once("kanban:card:created", resolve),
    );
    a.socketModule.emitToBoard("proj-54", "kanban:card:created", {
      card: { id: "card-54" },
    });

    await expect(received).resolves.toEqual({ card: { id: "card-54" } });
  });

  it("A-54: falls back to the in-memory adapter, with a warning, when Redis is not ready", async () => {
    const replica = await startReplica({ withRedis: false });
    expect(replica.io.of("/").adapter.constructor.name).toBe("Adapter");
    expect(console.warn).toHaveBeenCalledWith(
      replica.socketModule.__testables.IN_MEMORY_WARNING,
    );
  });
});
