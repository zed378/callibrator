/**
 * fakeAmqp — an in-memory stand-in for a RabbitMQ broker behind amqplib's
 * channel/connection API (W-06, W-07, W-09, W-18).
 *
 * WHY. A jest.fn() `consume` that resolves proves nothing about the property
 * that matters for a consumer: that it is re-established after the socket
 * closes, that an ack goes to the channel the message arrived on, and that a
 * dead-letter queue receives what the queue arguments say it receives. This
 * fixture keeps the broker-side state and enforces the amqplib behaviour the
 * code depends on — read from amqplib 2.0.1's source, not assumed:
 *
 *  - a connection closing closes every channel on it, and each channel emits
 *    "close" (connection.js#_closeChannels → channel.toClosed);
 *  - send/ack/nack on a closed channel THROWS synchronously
 *    (channel.js#invalidateSend → IllegalOperationError "Channel closed");
 *  - an ack of a delivery tag the channel never delivered closes that channel
 *    with PRECONDITION_FAILED (the broker's answer, not amqplib's);
 *  - a closed channel's unacked messages are requeued with `redelivered`;
 *  - `nack(msg, false, false)` dead-letters to the queue's
 *    `x-dead-letter-routing-key` (default exchange) or drops;
 *  - a queue's `x-message-ttl` dead-letters a message after the TTL
 *    (scaled by `ttlScale`, 0 = on the next tick, so tests do not wait);
 *  - `prefetch(n)` bounds unacked deliveries per consumer.
 *
 * It is still a fake: no wire protocol, no confirms, no exchanges beyond the
 * default one. It proves the client's behaviour against the documented
 * contract; a live broker run is still the thing that settles it.
 */
const { EventEmitter } = require("events");

class IllegalOperationError extends Error {}

const createBroker = ({ ttlScale = 0 } = {}) => {
  const queues = new Map();
  const connections = new Set();
  let refuse = false;
  let tagSeq = 0;
  let consumerSeq = 0;
  const timers = new Set();

  const queue = (name) => {
    if (!queues.has(name)) {
      queues.set(name, { name, args: {}, messages: [], consumers: [] });
    }
    return queues.get(name);
  };

  const later = (ms, fn) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };

  const enqueue = (name, content, properties = {}, redelivered = false) => {
    const q = queue(name);
    const message = { content, properties: { ...properties }, redelivered };
    q.messages.push(message);
    const ttl = q.args["x-message-ttl"];
    if (ttl !== undefined) {
      later(ttl * ttlScale, () => {
        const i = q.messages.indexOf(message);
        if (i >= 0) {
          q.messages.splice(i, 1);
          deadLetter(q, message);
        }
      });
    }
    later(0, () => pump(name));
  };

  const deadLetter = (q, message) => {
    const target = q.args["x-dead-letter-routing-key"];
    if (target) {
      enqueue(target, message.content, message.properties);
    }
  };

  const pump = (name) => {
    const q = queue(name);
    for (const consumer of q.consumers) {
      while (q.messages.length && !consumer.channel.closed && consumer.unacked < consumer.prefetch()) {
        const message = q.messages.shift();
        consumer.unacked += 1;
        const deliveryTag = ++tagSeq;
        const msg = {
          content: message.content,
          properties: message.properties,
          fields: { deliveryTag, redelivered: message.redelivered, routingKey: name, consumerTag: consumer.tag },
        };
        consumer.channel.delivered.set(deliveryTag, { msg, message, queueName: name, consumer });
        consumer.onMessage(msg);
      }
    }
  };

  class FakeChannel extends EventEmitter {
    constructor(conn) {
      super();
      this.conn = conn;
      this.closed = false;
      this.delivered = new Map();
      this.prefetchCount = 0;
      this.consumerTags = new Set();
    }

    guard() {
      if (this.closed) {
        throw new IllegalOperationError("Channel closed");
      }
    }

    async assertQueue(name, options = {}) {
      this.guard();
      const q = queue(name);
      const args = (options && options.arguments) || {};
      if (q.declared && JSON.stringify(q.args) !== JSON.stringify(args)) {
        this.toClosed(new Error(`PRECONDITION_FAILED - inequivalent arg for queue '${name}'`));
        throw new Error(`PRECONDITION_FAILED - inequivalent arg for queue '${name}'`);
      }
      q.args = args;
      q.declared = true;
      return { queue: name, messageCount: q.messages.length, consumerCount: q.consumers.length };
    }

    async checkQueue(name) {
      this.guard();
      const q = queue(name);
      return { queue: name, messageCount: q.messages.length, consumerCount: q.consumers.length };
    }

    async purgeQueue(name) {
      this.guard();
      const q = queue(name);
      const count = q.messages.length;
      q.messages = [];
      return { messageCount: count };
    }

    async prefetch(n) {
      this.guard();
      this.prefetchCount = n;
    }

    sendToQueue(name, content, properties = {}) {
      this.guard();
      enqueue(name, content, properties);
      return true;
    }

    async consume(name, onMessage) {
      this.guard();
      const tag = `ctag-${++consumerSeq}`;
      const limit = this.prefetchCount;
      const consumer = { tag, channel: this, onMessage, unacked: 0, prefetch: () => limit || Infinity };
      queue(name).consumers.push(consumer);
      this.consumerTags.add(tag);
      later(0, () => pump(name));
      return { consumerTag: tag };
    }

    async cancel(tag) {
      this.guard();
      for (const q of queues.values()) {
        q.consumers = q.consumers.filter((c) => c.tag !== tag);
      }
      this.consumerTags.delete(tag);
      return { consumerTag: tag };
    }

    settle(msg) {
      const entry = this.delivered.get(msg.fields.deliveryTag);
      if (!entry) {
        // The broker's answer to an unknown delivery tag.
        later(0, () => this.toClosed(new Error("PRECONDITION_FAILED - unknown delivery tag")));
        return null;
      }
      this.delivered.delete(msg.fields.deliveryTag);
      entry.consumer.unacked -= 1;
      later(0, () => pump(entry.queueName));
      return entry;
    }

    ack(msg) {
      this.guard();
      this.settle(msg);
    }

    nack(msg, allUpTo = false, requeue = true) {
      this.guard();
      const entry = this.settle(msg);
      if (!entry) {
        return;
      }
      if (requeue) {
        enqueue(entry.queueName, entry.message.content, entry.message.properties, true);
      } else {
        deadLetter(queue(entry.queueName), entry.message);
      }
    }

    toClosed(error) {
      if (this.closed) {
        return;
      }
      this.closed = true;
      for (const q of queues.values()) {
        q.consumers = q.consumers.filter((c) => c.channel !== this);
      }
      // Unacked messages go back to their queues, marked redelivered.
      for (const { message, queueName } of this.delivered.values()) {
        enqueue(queueName, message.content, message.properties, true);
      }
      this.delivered.clear();
      this.conn.channels.delete(this);
      if (error) {
        this.emit("error", error);
      }
      this.emit("close");
    }

    async close() {
      this.guard();
      this.toClosed(null);
    }
  }

  class FakeConnection extends EventEmitter {
    constructor() {
      super();
      this.closed = false;
      this.channels = new Set();
    }

    async createChannel() {
      if (this.closed) {
        throw new IllegalOperationError("Connection closed");
      }
      const ch = new FakeChannel(this);
      this.channels.add(ch);
      return ch;
    }

    kill(error) {
      if (this.closed) {
        return;
      }
      this.closed = true;
      for (const ch of [...this.channels]) {
        ch.toClosed(null);
      }
      connections.delete(this);
      if (error) {
        this.emit("error", error);
      }
      this.emit("close");
    }

    async close() {
      if (this.closed) {
        throw new IllegalOperationError("Connection closed");
      }
      this.kill(null);
    }
  }

  const broker = {
    connectCount: 0,
    connect: jest.fn(async () => {
      broker.connectCount += 1;
      if (refuse) {
        throw new Error("connect ECONNREFUSED 127.0.0.1:5672");
      }
      const conn = new FakeConnection();
      connections.add(conn);
      return conn;
    }),
    /** Refuse (true) or accept (false) new connections — "the broker is down". */
    refuseConnections(value = true) {
      refuse = value;
    },
    /** Drop every open connection, as a broker restart does. */
    restart() {
      for (const conn of [...connections]) {
        conn.kill(new Error("CONNECTION_FORCED - broker forced connection closure"));
      }
    },
    openConnections: () => connections.size,
    messages: (name) => queue(name).messages.map((m) => ({ ...m, body: JSON.parse(m.content.toString()) })),
    consumerCount: (name) => queue(name).consumers.length,
    queueArgs: (name) => queue(name).args,
    publish: (name, body, properties) => enqueue(name, Buffer.from(JSON.stringify(body)), properties),
    /** Stop every pending TTL/delivery timer (afterEach). */
    dispose() {
      for (const t of timers) {
        clearTimeout(t);
      }
      timers.clear();
    },
  };
  return broker;
};

/** Resolve after pending timers and microtasks have run (a few ticks). */
const settle = async (ticks = 5) => {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

module.exports = { createBroker, settle, IllegalOperationError };
