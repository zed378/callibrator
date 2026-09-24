/**
 * rabbitmq.service — the one connection (W-18), the publishing channel, and
 * supervised consumers (W-06, W-07, W-31).
 *
 * Runs against tests/fixtures/fakeAmqp.js: an in-memory broker that keeps
 * queue state and enforces the amqplib 2.0.1 behaviour the service depends on
 * (a connection close closes and emits "close" on every channel; settling on a
 * closed channel throws; an unknown delivery tag closes the channel; unacked
 * messages are redelivered). It is still a fake — no broker was available —
 * and says so: a live broker run is the thing that settles W-06 for good.
 */
jest.mock("amqplib", () => ({ connect: jest.fn() }));
jest.mock("../../services/redis.service", () => ({
  getRedisConnection: jest.fn(() => null),
  del: jest.fn(),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { createBroker, settle } = require("../fixtures/fakeAmqp");

const ENV = { ...process.env };
let broker;
let amqplib;
let svc;
let logger;

const load = (env = {}) => {
  jest.resetModules();
  process.env = { ...ENV, RABBITMQ_URL: "amqp://broker.test:5672", RABBITMQ_RECONNECT_BASE_MS: "5", RABBITMQ_RECONNECT_MAX_MS: "20", RABBITMQ_DRAIN_TIMEOUT_MS: "50", ...env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) {
      delete process.env[k];
    }
  }
  amqplib = require("amqplib");
  broker = createBroker();
  amqplib.connect.mockImplementation(broker.connect);
  logger = require("../../middlewares/activityLog.middleware").logger;
  svc = require("../../services/rabbitmq.service");
};

const waitFor = async (predicate, ms = 1000) => {
  const until = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > until) {
      throw new Error("condition not met in time");
    }
    await new Promise((r) => setTimeout(r, 2));
  }
};

beforeEach(() => load());
afterEach(async () => {
  await svc.closeRabbitMQ();
  broker.dispose();
  process.env = { ...ENV };
});

describe("connection and publishing channel (W-18)", () => {
  it("connects with RABBITMQ_URL, and builds host:port (or localhost:5672) without it", async () => {
    await svc.getConnection();
    expect(amqplib.connect).toHaveBeenCalledWith("amqp://broker.test:5672");

    await svc.closeRabbitMQ();
    load({ RABBITMQ_URL: undefined, RABBITMQ_HOST: "rabbit.internal", RABBITMQ_PORT: "5673" });
    await svc.getConnection();
    expect(amqplib.connect).toHaveBeenCalledWith("amqp://rabbit.internal:5673");

    await svc.closeRabbitMQ();
    load({ RABBITMQ_URL: undefined, RABBITMQ_HOST: undefined, RABBITMQ_PORT: undefined });
    await svc.getConnection();
    expect(amqplib.connect).toHaveBeenCalledWith("amqp://localhost:5672");
  });

  it("ten concurrent getConnection() calls dial ONCE", async () => {
    const conns = await Promise.all(Array.from({ length: 10 }, () => svc.getConnection()));
    expect(broker.connectCount).toBe(1);
    expect(new Set(conns).size).toBe(1);
  });

  it("ten concurrent first callers share ONE connection and ONE channel", async () => {
    const channels = await Promise.all(Array.from({ length: 10 }, () => svc.getChannel()));
    expect(broker.connectCount).toBe(1);
    expect(new Set(channels).size).toBe(1);
    expect(broker.openConnections()).toBe(1);
  });

  it("a failed connect is not cached: the next call dials again", async () => {
    broker.refuseConnections(true);
    await expect(svc.getConnection()).rejects.toThrow("ECONNREFUSED");
    broker.refuseConnections(false);
    await expect(svc.getConnection()).resolves.toBeTruthy();
    expect(broker.connectCount).toBe(2);
  });

  it("rejects when the connect times out", async () => {
    load({ RABBITMQ_CONNECT_TIMEOUT: "5" });
    amqplib.connect.mockImplementationOnce(() => new Promise(() => {}));
    await expect(svc.getConnection()).rejects.toThrow("RabbitMQ connection timed out after 5ms");
  });

  it("forgets a connection that closed or errored, and reconnects on the next call", async () => {
    const first = await svc.getConnection();
    first.emit("error", new Error("boom"));
    expect(logger.error).toHaveBeenCalledWith("RabbitMQ connection error", { error: "boom" });
    const second = await svc.getConnection();
    expect(second).not.toBe(first);
    broker.restart();
    const third = await svc.getConnection();
    expect(third).not.toBe(second);
    expect(broker.connectCount).toBe(3);
  });

  it("a late close from a superseded connection does not evict the live one", async () => {
    const first = await svc.getConnection();
    first.emit("close");
    const second = await svc.getConnection();
    first.emit("close");
    expect(await svc.getConnection()).toBe(second);
  });

  it("reopens the channel after it closes or errors; a late event from the old one changes nothing", async () => {
    const ch1 = await svc.getChannel();
    ch1.emit("error", new Error("channel closed by server"));
    expect(logger.error).toHaveBeenCalledWith("RabbitMQ channel error", { error: "channel closed by server" });
    const ch2 = await svc.getChannel();
    expect(ch2).not.toBe(ch1);
    ch1.emit("close");
    expect(await svc.getChannel()).toBe(ch2);
    ch2.emit("close");
    expect(await svc.getChannel()).not.toBe(ch2);
    expect(broker.connectCount).toBe(1);
  });

  it("asserts a queue with a dead-letter queue, or a plain durable one", async () => {
    await svc.assertQueue("work", "work_dlq");
    expect(broker.queueArgs("work")).toEqual({ "x-dead-letter-exchange": "", "x-dead-letter-routing-key": "work_dlq" });
    await svc.assertQueue("plain");
    expect(broker.queueArgs("plain")).toEqual({});
  });

  it("publishes persistent JSON, with extra properties", async () => {
    await svc.publish("work", { a: 1 }, { messageId: "m1" });
    expect(broker.messages("work")).toEqual([
      expect.objectContaining({ body: { a: 1 }, properties: { persistent: true, messageId: "m1" } }),
    ]);
    await svc.publish("work", { b: 2 });
    expect(broker.messages("work")[1].properties).toEqual({ persistent: true });
  });
});

describe("supervised consumers (W-06)", () => {
  const collect = () => {
    const seen = [];
    const handler = jest.fn(async (msg, ch) => {
      seen.push(JSON.parse(msg.content.toString()));
      svc.ack(ch, msg);
    });
    return { seen, handler };
  };

  it("registers on its own channel, runs setup and prefetch, and delivers", async () => {
    const { seen, handler } = collect();
    const setup = jest.fn((ch) => svc.assertQueue("work", "work_dlq", ch));
    await expect(svc.startConsumer("work", handler, { prefetch: 3, setup })).resolves.toBe(true);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(await svc.getChannel()).not.toBe(setup.mock.calls[0][0]);

    broker.publish("work", { n: 1 });
    await waitFor(() => seen.length === 1);
    expect(seen).toEqual([{ n: 1 }]);
    expect(svc.consumerStatus()).toEqual([{ queue: "work", registered: true, attempt: 0 }]);
  });

  it("starting the same queue twice registers ONE consumer", async () => {
    const { handler } = collect();
    await Promise.all([svc.startConsumer("work", handler), svc.startConsumer("work", handler)]);
    await settle();
    expect(broker.consumerCount("work")).toBe(1);
  });

  it("a message published AFTER a broker restart is consumed — the consumer re-registered itself", async () => {
    const { seen, handler } = collect();
    await svc.startConsumer("work", handler, { setup: (ch) => svc.assertQueue("work", undefined, ch) });

    broker.restart();
    await svc.publish("work", { after: "restart" });

    await waitFor(() => seen.length === 1);
    expect(seen).toEqual([{ after: "restart" }]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('consumer for "work" is not registered (its channel closed); retry 1'));
    expect(logger.info).toHaveBeenCalledWith('RabbitMQ consumer for "work" re-registered after 1 attempt(s)');
  });

  it("a broker that is down at boot is retried, one log line per attempt, until it is up", async () => {
    broker.refuseConnections(true);
    const { seen, handler } = collect();
    await expect(svc.startConsumer("work", handler)).resolves.toBe(false);
    await waitFor(() => broker.connectCount >= 3);
    const retryLines = logger.warn.mock.calls.filter(([line]) => /consumer for "work" is not registered/.test(line));
    // One line per failed attempt — not one per second, not one per poll.
    expect(retryLines.length).toBeGreaterThanOrEqual(2);
    expect(retryLines.length).toBeLessThanOrEqual(broker.connectCount);
    expect(retryLines[0][0]).toMatch(/ECONNREFUSED 127.0.0.1:5672\); retry 1 in 5ms/);
    expect(retryLines[1][0]).toMatch(/retry 2 in 10ms/);

    broker.refuseConnections(false);
    await waitFor(() => svc.consumerStatus()[0].registered);
    broker.publish("work", { n: 1 });
    await waitFor(() => seen.length === 1);
  });

  it("the backoff is capped", async () => {
    broker.refuseConnections(true);
    await svc.startConsumer("work", jest.fn());
    await waitFor(() => broker.connectCount >= 5, 2000);
    const delays = logger.warn.mock.calls
      .map(([line]) => /retry \d+ in (\d+)ms/.exec(line))
      .filter(Boolean)
      .map((m) => Number(m[1]));
    expect(delays.slice(0, 4)).toEqual([5, 10, 20, 20]);
  });

  it("exactly ONE consumer per queue after ten forced reconnects", async () => {
    const { seen, handler } = collect();
    await svc.startConsumer("work", handler);
    for (let i = 0; i < 10; i += 1) {
      broker.restart();
      await waitFor(() => svc.consumerStatus()[0].registered);
    }
    expect(broker.consumerCount("work")).toBe(1);
    broker.publish("work", { n: "once" });
    await waitFor(() => seen.length === 1);
    await settle();
    expect(seen).toEqual([{ n: "once" }]);
  });

  it("a message unacked when the channel died is redelivered to the re-registered consumer", async () => {
    let calls = 0;
    const seen = [];
    await svc.startConsumer("work", async (msg, ch) => {
      calls += 1;
      if (calls === 1) {
        broker.restart(); // dies mid-message, before the ack
        return;
      }
      seen.push(msg.fields.redelivered);
      svc.ack(ch, msg);
    });
    broker.publish("work", { n: 1 });
    await waitFor(() => seen.length === 1);
    expect(seen).toEqual([true]);
  });

  it("a registration whose setup fails closes its channel and retries", async () => {
    const setup = jest.fn().mockRejectedValueOnce(new Error("PRECONDITION_FAILED")).mockResolvedValue(undefined);
    await expect(svc.startConsumer("work", jest.fn(), { setup })).resolves.toBe(false);
    await waitFor(() => svc.consumerStatus()[0].registered);
    expect(setup).toHaveBeenCalledTimes(2);
  });

  it("a channel that closes during registration is not kept", async () => {
    let first = true;
    const setup = jest.fn(async (ch) => {
      if (first) {
        first = false;
        ch.toClosed(new Error("closed while registering"));
      }
    });
    await expect(svc.startConsumer("work", jest.fn(), { setup })).resolves.toBe(false);
    await waitFor(() => svc.consumerStatus()[0].registered);
    expect(broker.consumerCount("work")).toBe(1);
  });

  it("a channel that closes between consume-ok and bookkeeping is detected and replaced", async () => {
    const realCreate = broker.connect;
    let sabotage = true;
    amqplib.connect.mockImplementation(async (...args) => {
      const conn = await realCreate(...args);
      const createChannel = conn.createChannel.bind(conn);
      conn.createChannel = async () => {
        const ch = await createChannel();
        const consume = ch.consume.bind(ch);
        ch.consume = async (...a) => {
          const r = await consume(...a);
          if (sabotage) {
            sabotage = false;
            ch.toClosed(null);
          }
          return r;
        };
        return ch;
      };
      return conn;
    });
    await expect(svc.startConsumer("work", jest.fn())).resolves.toBe(false);
    await waitFor(() => svc.consumerStatus()[0].registered);
    expect(broker.consumerCount("work")).toBe(1);
  });

  it("a broker-side cancel (null delivery) re-registers the consumer", async () => {
    let deliver;
    const realConnect = broker.connect;
    amqplib.connect.mockImplementation(async (...args) => {
      const conn = await realConnect(...args);
      const createChannel = conn.createChannel.bind(conn);
      conn.createChannel = async () => {
        const ch = await createChannel();
        const consume = ch.consume.bind(ch);
        ch.consume = async (q, cb) => {
          deliver = cb;
          return consume(q, cb);
        };
        return ch;
      };
      return conn;
    });
    await svc.startConsumer("work", jest.fn());
    const before = deliver;
    before(null);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("consumer cancelled by the broker"));
    await waitFor(() => svc.consumerStatus()[0].registered && deliver !== before);
    before(null); // a late cancel for the replaced channel changes nothing
    expect(svc.consumerStatus()[0].registered).toBe(true);
  });

  it("a handler that throws (or rejects with a non-Error) is logged and cannot reach the process handlers", async () => {
    const unhandled = jest.fn();
    process.on("unhandledRejection", unhandled);
    let n = 0;
    await svc.startConsumer("work", async () => {
      n += 1;
      if (n === 1) {
        throw new Error("handler exploded");
      }
      throw "a string"; // eslint-disable-line no-throw-literal
    });
    broker.publish("work", { n: 1 });
    broker.publish("work", { n: 2 });
    await waitFor(() => logger.error.mock.calls.length >= 2);
    await settle();
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('RabbitMQ consumer for "work" failed on a message', { error: "handler exploded" });
    expect(logger.error).toHaveBeenCalledWith('RabbitMQ consumer for "work" failed on a message', { error: "a string" });
  });
});

describe("settling on the arrival channel (W-31)", () => {
  it("ack/nack on the channel the message came on; a closed channel is logged, not thrown", async () => {
    const got = [];
    await svc.startConsumer("work", async (msg, ch) => {
      got.push({ msg, ch });
    });
    broker.publish("work", { n: 1 });
    broker.publish("work", { n: 2 });
    await waitFor(() => got.length === 2);

    expect(svc.ack(got[0].ch, got[0].msg)).toBe(true);
    expect(svc.nack(got[1].ch, got[1].msg)).toBe(true);

    got[0].ch.toClosed(null);
    expect(svc.ack(got[0].ch, got[0].msg)).toBe(false);
    expect(svc.nack(got[0].ch, got[0].msg)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith("RabbitMQ ack not sent (Channel closed); the broker redelivers the message");
  });

  it("acking on the PUBLISHING channel (what the batch worker did) closes that channel", async () => {
    let delivered;
    await svc.startConsumer("work", async (msg) => {
      delivered = msg;
    });
    broker.publish("work", { n: 1 });
    await waitFor(() => delivered);
    const publishing = await svc.getChannel();
    publishing.ack(delivered);
    await settle();
    expect(publishing.closed).toBe(true);
  });
});

describe("draining and closing (W-07, W-18)", () => {
  it("stopConsumers cancels, then waits for in-flight handlers", async () => {
    let finish;
    const started = jest.fn();
    await svc.startConsumer("work", async (msg, ch) => {
      started();
      await new Promise((r) => {
        finish = r;
      });
      svc.ack(ch, msg);
    });
    broker.publish("work", { n: 1 });
    await waitFor(() => started.mock.calls.length === 1);

    const stopping = svc.stopConsumers({ timeoutMs: 1000 });
    await settle();
    expect(broker.consumerCount("work")).toBe(0);
    broker.publish("work", { n: 2 }); // not delivered: consuming has stopped
    finish();
    await expect(stopping).resolves.toEqual({ drained: true, pending: 0 });
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("stopConsumers gives up after the timeout and says how many are still running", async () => {
    await svc.startConsumer("work", () => new Promise(() => {}));
    broker.publish("work", { n: 1 });
    await settle();
    await expect(svc.stopConsumers({ timeoutMs: 5 })).resolves.toEqual({ drained: false, pending: 1 });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("1 RabbitMQ message handler(s) still running after 5ms"));
  });

  it("stopConsumers with nothing in flight returns at once, even with a pending retry and a dead channel", async () => {
    broker.refuseConnections(true);
    await svc.startConsumer("down", jest.fn());
    broker.refuseConnections(false);
    await svc.startConsumer("up", jest.fn());
    // The consumer channel dies without the service noticing yet.
    const status = svc.consumerStatus();
    expect(status.find((s) => s.queue === "down").registered).toBe(false);
    await expect(svc.stopConsumers()).resolves.toEqual({ drained: true, pending: 0 });
  });

  it("a cancel on a channel that is already gone is ignored", async () => {
    await svc.startConsumer("work", jest.fn());
    const conn = await svc.getConnection();
    // Break cancel without firing close: the service still holds the channel.
    for (const ch of conn.channels) {
      ch.cancel = async () => {
        throw new Error("Channel closed");
      };
    }
    await expect(svc.stopConsumers()).resolves.toEqual({ drained: true, pending: 0 });
  });

  it("no consumer re-registers once shutdown has begun", async () => {
    await svc.startConsumer("work", jest.fn());
    await svc.stopConsumers();
    broker.restart();
    await settle(10);
    expect(broker.consumerCount("work")).toBe(0);
    expect(broker.connectCount).toBe(1);
  });

  it("closeRabbitMQ closes the consumer channels, the publishing channel and the ONE connection", async () => {
    await svc.startConsumer("work", jest.fn());
    await svc.getChannel();
    expect(broker.openConnections()).toBe(1);
    await svc.closeRabbitMQ();
    expect(broker.openConnections()).toBe(0);
    expect(logger.info).toHaveBeenCalledWith("RabbitMQ connection closed");
    expect(svc.consumerStatus()).toEqual([]);
  });

  it("closeRabbitMQ logs and swallows a close error, and is a no-op when nothing is open", async () => {
    await svc.closeRabbitMQ();
    const ch = await svc.getChannel();
    ch.close = async () => {
      throw new Error("close failed");
    };
    await svc.closeRabbitMQ();
    expect(logger.error).toHaveBeenCalledWith("Error closing RabbitMQ connection", { error: "close failed" });
  });

  it("closeRabbitMQ tolerates a consumer channel that is already closed", async () => {
    await svc.startConsumer("work", jest.fn());
    const conn = await svc.getConnection();
    for (const ch of conn.channels) {
      ch.close = async () => {
        throw new Error("Channel closed");
      };
    }
    await svc.closeRabbitMQ();
    expect(logger.error).not.toHaveBeenCalledWith("Error closing RabbitMQ connection", expect.anything());
  });
});
