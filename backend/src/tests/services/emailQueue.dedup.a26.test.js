/**
 * A-26 — a redelivered email message was sent twice.
 *
 * RabbitMQ is at-least-once: a message whose ack never reached the broker is
 * delivered again. The consumer had no idempotency of any kind, so the same
 * activation or OTP mail went out once per delivery. (Documentation claimed
 * Redis-held "worker idempotency"; none existed. That claim was corrected on
 * 2026-09-21 and is not being reinstated — what is built here is
 * at-least-once with a dedup claim, not exactly-once.)
 *
 * The dedup store is a Map-backed stand-in with real `SET NX` semantics, so
 * the second delivery loses the race for the same reason it would against a
 * real Redis. The assertions are on the EFFECT — how many emails were sent —
 * not on whether a claim function was called.
 */

const store = new Map();

jest.mock("../../services/redis.service", () => ({
  getRedisConnection: jest.fn(() => ({
    status: "ready",
    // Minimal SET NX EX.
    set: jest.fn(async (key, value, _ex, _ttl, nx) => {
      if (nx === "NX" && store.has(key)) {
        return null;
      }
      store.set(key, value);
      return "OK";
    }),
  })),
  del: jest.fn(async (key) => {
    store.delete(key);
    return true;
  }),
}));

jest.mock("amqplib", () => ({ connect: jest.fn() }));

jest.mock("../../services/email.service", () => ({
  sendOtpEmail: jest.fn(),
  sendActivationEmail: jest.fn(),
  sendNotificationEmail: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const msgFor = (job) => ({ content: Buffer.from(JSON.stringify(job)) });

describe("email consumer deduplication (A-26)", () => {
  let amqplib;
  let emailQueueService;
  let sendActivationEmail;
  let logger;
  let channel;

  /** Boot the consumer and hand back the registered message handler. */
  const startConsumer = async () => {
    await emailQueueService.processEmailQueue();
    return channel.consume.mock.calls[0][1];
  };

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    // The failure path schedules a real 2s retry timer; fake timers keep it
    // from holding the process open after the suite finishes.
    jest.useFakeTimers();
    store.clear();

    amqplib = require("amqplib");
    sendActivationEmail =
      require("../../services/email.service").sendActivationEmail;
    logger = require("../../middlewares/activityLog.middleware").logger;
    emailQueueService = require("../../services/emailQueue.service");

    channel = {
      assertQueue: jest.fn().mockResolvedValue(true),
      sendToQueue: jest.fn().mockReturnValue(true),
      prefetch: jest.fn(),
      consume: jest.fn(),
      ack: jest.fn(),
      nack: jest.fn(),
      close: jest.fn().mockResolvedValue(true),
      on: jest.fn(),
    };

    amqplib.connect.mockResolvedValue({
      createChannel: jest.fn().mockResolvedValue(channel),
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(true),
    });
  });

  afterEach(async () => {
    try {
      await emailQueueService.closeRabbitMQ();
    } catch {
      /* the mock cannot fail, but closing must never break a test */
    }
    jest.useRealTimers();
  });

  it("sends ONE email when the same message is delivered twice, and ACKs the redelivery", async () => {
    sendActivationEmail.mockResolvedValue(true);
    const processJob = await startConsumer();
    const job = {
      id: "job-abc",
      type: "activation",
      data: { email: "a@mail.com" },
      retries: 0,
      maxRetries: 3,
    };

    await processJob(msgFor(job)); // first delivery
    await processJob(msgFor(job)); // broker redelivers the identical body

    expect(sendActivationEmail).toHaveBeenCalledTimes(1);
    // Both are acked: nacking the duplicate would redeliver or dead-letter a
    // message whose work is already done.
    expect(channel.ack).toHaveBeenCalledTimes(2);
    expect(channel.nack).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("Duplicate email job ignored", {
      jobId: "job-abc",
      type: "activation",
    });
  });

  it("sends both when two DIFFERENT jobs go to the same address", async () => {
    sendActivationEmail.mockResolvedValue(true);
    const processJob = await startConsumer();
    const base = {
      type: "activation",
      data: { email: "a@mail.com" },
      retries: 0,
      maxRetries: 3,
    };

    await processJob(msgFor({ ...base, id: "job-1" }));
    await processJob(msgFor({ ...base, id: "job-2" }));

    expect(sendActivationEmail).toHaveBeenCalledTimes(2);
  });

  it("releases the claim when the send fails, so the retry is not read as a duplicate", async () => {
    const processJob = await startConsumer();
    const job = {
      id: "job-retry",
      type: "activation",
      data: { email: "a@mail.com" },
      retries: 0,
      maxRetries: 3,
    };

    sendActivationEmail.mockResolvedValueOnce(false); // first attempt fails
    await processJob(msgFor(job));

    expect(store.has("dedup:msg:email:job-retry")).toBe(false);

    // The retry re-publishes the SAME job.id; it must be allowed through.
    sendActivationEmail.mockResolvedValueOnce(true);
    await processJob(msgFor({ ...job, retries: 1 }));

    expect(sendActivationEmail).toHaveBeenCalledTimes(2);
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it("processes a message with no id and says it was not deduplicated", async () => {
    sendActivationEmail.mockResolvedValue(true);
    const processJob = await startConsumer();

    await processJob(
      msgFor({ type: "activation", data: { email: "a@mail.com" } }),
    );

    expect(sendActivationEmail).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Email job has no id; processing without deduplication",
    );
  });

  it("does not attempt to release a claim it never took", async () => {
    sendActivationEmail.mockResolvedValue(false); // fails, and there is no claim
    const processJob = await startConsumer();

    await processJob(
      msgFor({ type: "activation", data: { email: "a@mail.com" } }),
    );

    expect(channel.nack).toHaveBeenCalledTimes(1);
    expect(require("../../services/redis.service").del).not.toHaveBeenCalled();
  });

  it("stamps the claimed identity onto the published message as messageId", async () => {
    await emailQueueService.queueOtpEmail({ email: "a@mail.com", otp: "1234" });

    const [, body, opts] = channel.sendToQueue.mock.calls[0];
    expect(opts.messageId).toBe(JSON.parse(body.toString()).id);
    expect(opts.persistent).toBe(true);
  });
});
