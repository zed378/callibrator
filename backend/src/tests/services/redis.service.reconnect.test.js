/**
 * redis.service — client lifecycle against the REAL ioredis (W-05)
 *
 * The mocked suite (redis.service.test.js) cannot prove what matters here,
 * because the thing that failed was ioredis's own reconnect machinery: a
 * `retryStrategy` that returned `null` after three attempts made ioredis end
 * the client for good. A mock of ioredis would only replay whatever the test
 * author believed ioredis does — the exact mistake that kept A-24 green.
 *
 * So ioredis is NOT mocked. The server is: a minimal RESP server on a loopback
 * port that answers the handful of commands this path sends (INFO for the
 * ready check, SETEX, GET, QUIT). "Redis restarts" is the server destroying
 * every socket, refusing connections for a while, then listening again on
 * the same port. Everything the client does in between is real ioredis.
 *
 * The outage is held for longer than the old reconnect budget (~1.2 s:
 * 200 + 400 + 600 ms) so that, against the old strategy, the client reaches
 * `end` and never comes back — this test fails on HEAD for that reason.
 */

const net = require("net");

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.setTimeout(20000);

const bulk = (v) => `$${Buffer.byteLength(v)}\r\n${v}\r\n`;

/** Minimal RESP server: enough for ioredis's ready check and SETEX/GET. */
const createFakeRedis = () => {
  const store = new Map();
  const sockets = new Set();
  let server = null;

  const reply = (socket, args) => {
    const cmd = String(args[0] || "").toUpperCase();
    switch (cmd) {
      case "INFO":
        // ioredis's ready check reads `loading:` from INFO.
        return socket.write(bulk("# Server\r\nloading:0\r\n"));
      case "SETEX":
        store.set(args[1], args[3]);
        return socket.write("+OK\r\n");
      case "GET": {
        const v = store.get(args[1]);
        if (v === undefined) {return socket.write("$-1\r\n");}
        return socket.write(bulk(v));
      }
      case "QUIT":
        socket.write("+OK\r\n");
        return socket.end();
      default:
        return socket.write("+OK\r\n");
    }
  };

  // Parses RESP arrays of bulk strings, possibly several per chunk.
  const onConnection = (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        if (!buf.startsWith("*")) {return;}
        const lines = buf.split("\r\n");
        const n = Number(lines[0].slice(1));
        if (lines.length < 1 + n * 2 + 1) {return;}
        const args = [];
        for (let i = 0; i < n; i++) {args.push(lines[2 + i * 2]);}
        const consumed = lines.slice(0, 1 + n * 2).join("\r\n").length + 2;
        buf = buf.slice(consumed);
        reply(socket, args);
      }
    });
  };

  return {
    store,
    listen: (port = 0) =>
      new Promise((resolve) => {
        server = net.createServer(onConnection);
        server.listen(port, "127.0.0.1", () => resolve(server.address().port));
      }),
    // A Redis restart as the client sees it: live sockets drop, new ones are refused.
    crash: () =>
      new Promise((resolve) => {
        for (const s of sockets) {s.destroy();}
        server.close(() => resolve());
      }),
  };
};

const waitFor = async (predicate, timeoutMs) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {return true;}
    await new Promise((r) => setTimeout(r, 50));
  }
  return predicate();
};

describe("redis.service reconnects after an outage longer than the old budget (W-05)", () => {
  const originalUrl = process.env.REDIS_URL;
  let fake;
  let service;
  let logger;

  beforeEach(async () => {
    jest.resetModules();
    fake = createFakeRedis();
    const port = await fake.listen();
    process.env.REDIS_URL = `redis://127.0.0.1:${port}`;
    fake.port = port;
    service = require("../../services/redis.service");
    ({ logger } = require("../../middlewares/activityLog.middleware"));
  });

  afterEach(async () => {
    await service.closeRedis();
    await fake.crash().catch(() => {});
    if (originalUrl === undefined) {delete process.env.REDIS_URL;}
    else {process.env.REDIS_URL = originalUrl;}
  });

  it("returns to ready and serves helpers again after a 2.5 s outage", async () => {
    const client = await service.initRedis();
    expect(client).not.toBeNull();
    expect(client.status).toBe("ready");
    await expect(service.set("k", { v: 1 }, 60)).resolves.toBe(true);

    await fake.crash();

    // During the outage every helper fails over instead of hanging.
    await waitFor(() => client.status !== "ready", 2000);
    await expect(service.get("k")).resolves.toBeNull();
    await expect(service.set("k", "x")).resolves.toBe(false);
    await expect(service.acquireLock("res")).resolves.toBeNull();

    // Hold the outage past 200 + 400 + 600 ms — the old strategy's whole budget.
    await new Promise((r) => setTimeout(r, 2500));
    expect(client.status).not.toBe("end");

    await fake.listen(fake.port);

    const recovered = await waitFor(() => client.status === "ready", 8000);
    expect(recovered).toBe(true);

    // The same shared client serves the helpers again — no re-init needed.
    expect(service.getRedisConnection()).toBe(client);
    await expect(service.get("k")).resolves.toEqual({ v: 1 });
    await expect(service.set("k2", "y", 60)).resolves.toBe(true);
    await expect(service.acquireLock("res")).resolves.toEqual(expect.any(String));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Redis connection lost"),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Redis reconnected"),
    );
  });

  it("does not reconnect a client closeRedis() shut down on purpose", async () => {
    const client = await service.initRedis();
    await service.closeRedis();
    await waitFor(() => client.status === "end", 2000);
    await new Promise((r) => setTimeout(r, 2500));
    expect(client.status).toBe("end");
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Redis connection lost"),
    );
  });
});
