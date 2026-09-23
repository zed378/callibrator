/**
 * Tests for the shared RabbitMQ service.
 */

jest.mock("amqplib", () => ({ connect: jest.fn() }));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const amqplib = require("amqplib");
const { logger } = require("../../middlewares/activityLog.middleware");

// Build a fresh mock channel/connection pair and a freshly-required module so the
// module-level connection/channel cache does not leak between tests.
//
// The mocks expose ONLY what amqplib actually exposes. In particular there is
// no `isOpen`: amqplib 2.0.1 defines no such property (`grep -rn isOpen
// node_modules/amqplib` returns nothing), and the previous mock inventing one
// is what kept a dead connection cache green for the whole life of this file.
// Both the connection (ChannelModel) and the channel are EventEmitters that
// emit "close" and "error"; that is the liveness signal the service now uses.
function makeChannel() {
  const handlers = {};
  return {
    assertQueue: jest.fn().mockResolvedValue({}),
    sendToQueue: jest.fn().mockReturnValue(true),
    prefetch: jest.fn(),
    consume: jest.fn().mockResolvedValue({}),
    close: jest.fn().mockResolvedValue(),
    on: jest.fn((evt, cb) => {
      handlers[evt] = cb;
    }),
    emit: (evt, arg) => handlers[evt] && handlers[evt](arg),
    handlers,
  };
}

// A reconnect must hand back a DIFFERENT object, exactly as amqplib does —
// otherwise a test cannot tell a reused cache from a fresh connection, and the
// stale-event guard cannot be exercised at all.
function makeConnection() {
  const handlers = {};
  const channels = [makeChannel()];
  let next = 0;
  return {
    createChannel: jest.fn(async () => {
      if (next >= channels.length) {
        channels.push(makeChannel());
      }
      return channels[next++];
    }),
    on: jest.fn((evt, cb) => {
      handlers[evt] = cb;
    }),
    close: jest.fn().mockResolvedValue(),
    emit: (evt, arg) => handlers[evt] && handlers[evt](arg),
    handlers,
    channels,
  };
}

function setup() {
  jest.resetModules();

  const connections = [makeConnection()];
  let next = 0;
  const connect = jest.fn(async () => {
    if (next >= connections.length) {
      connections.push(makeConnection());
    }
    return connections[next++];
  });

  jest.doMock("amqplib", () => ({ connect }));
  jest.doMock("../../middlewares/activityLog.middleware", () => ({ logger }));

  const svc = require("../../services/rabbitmq.service");
  const amqp = require("amqplib");
  const connection = connections[0];
  return {
    svc,
    amqp,
    connection,
    channel: connection.channels[0],
    handlers: connection.handlers,
    connections,
  };
}

describe("rabbitmq.service", () => {
  beforeEach(() => jest.clearAllMocks());

  it("connects using RABBITMQ_URL and caches the connection", async () => {
    const { svc, amqp, connection } = setup();
    process.env.RABBITMQ_URL = "amqp://custom:5672";

    const c1 = await svc.getConnection();
    const c2 = await svc.getConnection();

    expect(c1).toBe(connection);
    expect(c2).toBe(connection); // cached, not reconnected
    expect(amqp.connect).toHaveBeenCalledTimes(1);
    expect(amqp.connect).toHaveBeenCalledWith("amqp://custom:5672");

    delete process.env.RABBITMQ_URL;
  });

  it("builds the URL from host/port when RABBITMQ_URL is unset", async () => {
    const { svc, amqp } = setup();
    delete process.env.RABBITMQ_URL;
    process.env.RABBITMQ_HOST = "rabbit";
    process.env.RABBITMQ_PORT = "5673";

    await svc.getConnection();

    expect(amqp.connect).toHaveBeenCalledWith("amqp://rabbit:5673");

    delete process.env.RABBITMQ_HOST;
    delete process.env.RABBITMQ_PORT;
  });

  it("registers error/close handlers that reset the cache", async () => {
    const { svc, amqp, handlers } = setup();

    await svc.getConnection();
    // Fire the registered listeners.
    handlers.error(new Error("link down"));
    handlers.close();

    expect(logger.error).toHaveBeenCalledWith(
      "RabbitMQ connection error",
      expect.objectContaining({ error: "link down" }),
    );
    // After close the cache is cleared, so the next call reconnects.
    await svc.getConnection();
    expect(amqp.connect).toHaveBeenCalledTimes(2);
  });

  it("reuses one connection across calls instead of opening a new one each time", async () => {
    const { svc, amqp, connection } = setup();

    const c1 = await svc.getConnection();
    const c2 = await svc.getConnection();
    await svc.getChannel();
    await svc.getChannel();

    // The regression this guards: `connection.isOpen` does not exist on
    // amqplib, so the old cache guard was always false and every call dialled
    // the broker again, leaking a connection per call.
    expect(amqp.connect).toHaveBeenCalledTimes(1);
    expect(connection.createChannel).toHaveBeenCalledTimes(1);
    expect(c1).toBe(c2);
  });

  it("reconnects after the connection emits close", async () => {
    const { svc, amqp, handlers } = setup();

    await svc.getConnection();
    expect(amqp.connect).toHaveBeenCalledTimes(1);

    handlers.close(); // broker went away

    await svc.getConnection();
    expect(amqp.connect).toHaveBeenCalledTimes(2);
  });

  it("reconnects after the connection emits error", async () => {
    const { svc, amqp, handlers } = setup();

    await svc.getConnection();
    handlers.error(new Error("socket reset"));

    await svc.getConnection();
    expect(amqp.connect).toHaveBeenCalledTimes(2);
  });

  it("a close from a superseded connection does not evict the live one", async () => {
    const { svc, amqp, handlers } = setup();

    await svc.getConnection();
    const staleClose = handlers.close;
    staleClose(); // the first connection dies
    await svc.getConnection(); // a second connection is established
    expect(amqp.connect).toHaveBeenCalledTimes(2);

    staleClose(); // late event from the DEAD connection

    await svc.getConnection();
    expect(amqp.connect).toHaveBeenCalledTimes(2); // still cached
  });

  it("reopens the channel after it emits close, keeping the connection", async () => {
    const { svc, amqp, connection, channel } = setup();

    await svc.getChannel();
    channel.emit("close");

    await svc.getChannel();

    expect(connection.createChannel).toHaveBeenCalledTimes(2);
    expect(amqp.connect).toHaveBeenCalledTimes(1); // connection untouched
  });

  it("reopens the channel after it emits error and logs it", async () => {
    const { svc, connection, channel } = setup();

    await svc.getChannel();
    channel.emit("error", new Error("channel closed by server"));

    await svc.getChannel();

    expect(logger.error).toHaveBeenCalledWith(
      "RabbitMQ channel error",
      expect.objectContaining({ error: "channel closed by server" }),
    );
    expect(connection.createChannel).toHaveBeenCalledTimes(2);
  });

  it("a close from a superseded channel does not evict the live one", async () => {
    const { svc, connection, channel } = setup();

    await svc.getChannel();
    channel.emit("close"); // the first channel dies
    await svc.getChannel(); // a second channel is created
    expect(connection.createChannel).toHaveBeenCalledTimes(2);

    channel.emit("close"); // late event from the FIRST channel

    await svc.getChannel();
    expect(connection.createChannel).toHaveBeenCalledTimes(2); // still cached
  });

  it("caches the channel and reuses it", async () => {
    const { svc, connection, channel } = setup();

    const ch1 = await svc.getChannel();
    const ch2 = await svc.getChannel();

    expect(ch1).toBe(channel);
    expect(ch2).toBe(channel);
    expect(connection.createChannel).toHaveBeenCalledTimes(1);
  });

  it("asserts a queue with a dead-letter queue", async () => {
    const { svc, channel } = setup();

    await svc.assertQueue("q", "q_dlq");

    expect(channel.assertQueue).toHaveBeenCalledWith("q_dlq", { durable: true });
    expect(channel.assertQueue).toHaveBeenCalledWith("q", {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": "",
        "x-dead-letter-routing-key": "q_dlq",
      },
    });
  });

  it("asserts a plain durable queue without a DLQ", async () => {
    const { svc, channel } = setup();

    await svc.assertQueue("q");

    expect(channel.assertQueue).toHaveBeenCalledWith("q", { durable: true });
    expect(channel.assertQueue).toHaveBeenCalledTimes(1);
  });

  it("publishes a persistent JSON message", async () => {
    const { svc, channel } = setup();

    const ok = await svc.publish("q", { a: 1 });

    expect(ok).toBe(true);
    const [queue, buf, opts] = channel.sendToQueue.mock.calls[0];
    expect(queue).toBe("q");
    expect(JSON.parse(buf.toString())).toEqual({ a: 1 });
    expect(opts).toEqual({ persistent: true });
  });

  it("consumes with an optional prefetch", async () => {
    const { svc, channel } = setup();
    const handler = jest.fn();

    await svc.consume("q", handler, 7);

    expect(channel.prefetch).toHaveBeenCalledWith(7);
    expect(channel.consume).toHaveBeenCalledWith("q", handler);
  });

  it("consumes without prefetch when not provided", async () => {
    const { svc, channel } = setup();
    const handler = jest.fn();

    await svc.consume("q", handler);

    expect(channel.prefetch).not.toHaveBeenCalled();
    expect(channel.consume).toHaveBeenCalledWith("q", handler);
  });

  it("closes the channel and connection", async () => {
    const { svc, connection, channel } = setup();
    await svc.getChannel(); // populate cache

    await svc.closeRabbitMQ();

    expect(channel.close).toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("RabbitMQ connection closed");
  });

  it("logs and swallows a close error", async () => {
    const { svc, channel } = setup();
    await svc.getChannel();
    channel.close.mockRejectedValue(new Error("close fail"));

    await svc.closeRabbitMQ();

    expect(logger.error).toHaveBeenCalledWith(
      "Error closing RabbitMQ connection",
      expect.objectContaining({ error: "close fail" }),
    );
  });

  it("closeRabbitMQ is a no-op when nothing is open", async () => {
    const { svc, connection, channel } = setup();

    await svc.closeRabbitMQ();

    expect(channel.close).not.toHaveBeenCalled();
    expect(connection.close).not.toHaveBeenCalled();
  });

  it("rejects when the connection times out", async () => {
    jest.useFakeTimers();
    jest.resetModules();
    // A connect that never settles, so only the timeout can resolve the race.
    jest.doMock("amqplib", () => ({
      connect: jest.fn().mockReturnValue(new Promise(() => {})),
    }));
    jest.doMock("../../middlewares/activityLog.middleware", () => ({ logger }));
    const svc = require("../../services/rabbitmq.service");

    const p = svc.getConnection();
    const assertion = expect(p).rejects.toThrow(/timed out/);
    jest.advanceTimersByTime(10000);
    await assertion;

    jest.useRealTimers();
  });
});
