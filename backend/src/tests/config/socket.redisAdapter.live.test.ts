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
 * NEEDS a reachable Redis (REDIS_URL / REDIS_HOST / REDIS_PORT):
 *
 *   npm run test:live:jest -- src/tests/config/socket.redisAdapter.live
 *
 * socket.io-client is not a backend dependency; it resolves from the root
 * node_modules (the frontend workspace's copy, hoisted). The unit suite
 * (socket.test.js) covers the branches for the coverage gate.
 */

import http from "http";
import type { Socket as ClientSocket } from "socket.io-client";

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../utils/jwt.util", () => ({
  // A-345: a socket token names its session (`sid`); since P6-12 one without it is refused.
  verifyPurposeToken: jest.fn(() => ({ id: "user-1", sid: "session-1" })),
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

interface Replica {
  socketModule: any;
  redisService: any;
  logger: any;
  server: http.Server;
  io: any;
  url: string;
}

describe("Socket.IO Redis adapter — live Redis (A-54)", () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { io: ioClient } = require("socket.io-client") as { io: (url: string, opts: unknown) => ClientSocket };
  /* eslint-enable @typescript-eslint/no-require-imports */
  const replicas: Replica[] = [];
  const clients: ClientSocket[] = [];

  /** Load an independent copy of the realtime hub and start it on a port. */
  async function startReplica({ withRedis = true }: { withRedis?: boolean } = {}): Promise<Replica> {
    let socketModule: any;
    let redisService: any;
    let logger: any;
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports */
      redisService = require("../../services/redis.service");
      socketModule = require("../../config/socket");
      // A-42: the hub logs through the (mocked) winston logger of ITS registry.
      ({ logger } = require("../../middlewares/activityLog.middleware"));
      /* eslint-enable @typescript-eslint/no-require-imports */
    });
    if (withRedis) {
      await redisService.initRedis();
    }
    const server = http.createServer();
    const io = socketModule.initSocket(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address() as { port: number };
    const replica: Replica = {
      socketModule,
      redisService,
      logger,
      server,
      io,
      url: `http://127.0.0.1:${address.port}`,
    };
    replicas.push(replica);
    return replica;
  }

  function connectClient(url: string): Promise<ClientSocket> {
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
      await new Promise<void>((resolve) => io.close(() => resolve()));
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      await redisService.closeRedis();
    }
  });

  it("A-54: an emit on replica A reaches a client connected only to replica B", async () => {
    const a = await startReplica();
    const b = await startReplica();

    expect(a.io.of("/").adapter.constructor.name).toBe("RedisAdapter");
    expect(b.io.of("/").adapter.constructor.name).toBe("RedisAdapter");

    // Each adapter subscribes asynchronously, and fetchSockets counts replicas by PUBSUB NUMSUB:
    // until B's subscription lands, A waits for nobody and answers [] (3 of 8 runs on Linux).
    const adapter = a.io.of("/").adapter as unknown as { serverCount: () => Promise<number> };
    const deadline = Date.now() + 5000;
    while ((await adapter.serverCount()) < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const client = await connectClient(b.url);
    const joined = await (client as ClientSocket & { emitWithAck: (ev: string, arg: string) => Promise<unknown> }).emitWithAck("kanban:join", "proj-54");
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
    expect(replica.logger.warn).toHaveBeenCalledWith(
      replica.socketModule.__testables.IN_MEMORY_WARNING,
    );
  });
});

