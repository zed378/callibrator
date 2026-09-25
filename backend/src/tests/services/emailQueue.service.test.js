/**
 * emailQueue.service — producer, supervised consumer and broker-side retries
 * (W-06, W-09, W-18, W-31), on the REAL rabbitmq.service over
 * tests/fixtures/fakeAmqp.js.
 *
 * The previous version of this file mocked amqplib with jest.fn() channels and
 * asserted the design W-09 removed: a failed send nacked to the DLQ AND
 * re-published from an in-process setTimeout, plus a private connection this
 * module no longer owns (W-18). It is replaced, not patched.
 *
 * The fake broker keeps queue state and enforces the amqplib behaviour the
 * consumer depends on (a closed channel throws on send/ack; unacked messages
 * return on close; `x-message-ttl` dead-letters to `x-dead-letter-routing-key`;
 * nack without requeue dead-letters). TTLs run in real time here (ttlScale 1)
 * with a 5 ms retry base, so a retry's delay really passes. It is still a
 * fake: a live broker run is what settles W-09 for good.
 */

const mockDedup = new Map();
const mockRedis = { ready: true };

jest.mock("amqplib", () => ({ connect: jest.fn() }));
jest.mock("../../services/redis.service", () => ({
  getRedisConnection: jest.fn(() =>
    mockRedis.ready
      ? {
        status: "ready",
        set: jest.fn(async (key, value, _ex, _ttl, nx) => {
          if (nx === "NX" && mockDedup.has(key)) {
            return null;
          }
          mockDedup.set(key, value);
          return "OK";
        }),
      }
      : null,
  ),
  del: jest.fn(async (key) => mockDedup.delete(key)),
}));
jest.mock("../../services/email.service", () => ({
  sendOtpEmail: jest.fn(),
  sendActivationEmail: jest.fn(),
  sendNotificationEmail: jest.fn(),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { createBroker, settle } = require("../fixtures/fakeAmqp");

const ENV = { ...process.env };
let broker;
let svc;
let rabbitmq;
let email;
let logger;

const load = () => {
  jest.resetModules();
  process.env = {
    ...ENV,
    RABBITMQ_URL: "amqp://broker.test:5672",
    RABBITMQ_RECONNECT_BASE_MS: "5",
    RABBITMQ_RECONNECT_MAX_MS: "20",
    RABBITMQ_DRAIN_TIMEOUT_MS: "20",
    EMAIL_RETRY_BASE_MS: "5",
  };
  require("amqplib").connect.mockImplementation(broker.connect);
  email = require("../../services/email.service");
  logger = require("../../middlewares/activityLog.middleware").logger;
  rabbitmq = require("../../services/rabbitmq.service");
  svc = require("../../services/emailQueue.service");
};

const waitFor = async (predicate, ms = 2000) => {
  const until = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > until) {
      throw new Error("condition not met in time");
    }
    await new Promise((r) => setTimeout(r, 2));
  }
};

const job = (overrides = {}) => ({
  id: "job-1",
  type: "activation",
  data: { email: "nurse@hospital.example", firstName: "A" },
  retries: 0,
  maxRetries: 3,
  ...overrides,
});

beforeEach(() => {
  mockDedup.clear();
  mockRedis.ready = true;
  broker = createBroker({ ttlScale: 1 });
  load();
  jest.clearAllMocks();
});

afterEach(async () => {
  await svc.closeRabbitMQ();
  broker.dispose();
  process.env = { ...ENV };
});

describe("retry schedule", () => {
  it("retry n waits base * 2^n, clamped to the declared tiers", () => {
    expect(svc.retryDelayMs(0)).toBe(10);
    expect(svc.retryDelayMs(1)).toBe(10);
    expect(svc.retryDelayMs(2)).toBe(20);
    expect(svc.retryDelayMs(3)).toBe(40);
    expect(svc.retryDelayMs(9)).toBe(40);
    expect(svc.retryQueueOf(2)).toBe("email_retry_20");
  });

  it("defaults the base to 1 s and the prefetch to 10", () => {
    jest.resetModules();
    process.env = { ...ENV };
    delete process.env.EMAIL_RETRY_BASE_MS;
    delete process.env.RABBITMQ_PREFETCH_COUNT;
    const fresh = require("../../services/emailQueue.service");
    expect(fresh.retryDelayMs(1)).toBe(2000);
    expect(fresh.retryQueueOf(3)).toBe("email_retry_8000");
  });
});

describe("producer (W-18: one connection, the shared publishing channel)", () => {
  it("queues each type as a persistent message whose messageId is the job id", async () => {
    await expect(
      svc.queueActivationEmail({ email: "a@hospital.example", firstName: "A", lastName: "B", activationLink: "l" }),
    ).resolves.toBe(true);
    await svc.queueOtpEmail({ email: "b@hospital.example", firstName: "A", lastName: "B", otp: "123456" });
    await svc.queueNotificationEmail({
      email: "c@hospital.example",
      firstName: "C",
      title: "Device due",
      message: "Calibration is due",
      actionUrl: "https://app.example/d/1",
    });

    const queued = broker.messages("email_queue");
    expect(queued.map((m) => m.body.type)).toEqual(["activation", "otp", "notification"]);
    for (const m of queued) {
      expect(m.properties).toMatchObject({ persistent: true, messageId: m.body.id });
      expect(m.body).toMatchObject({ retries: 0, maxRetries: 3 });
    }
    expect(queued[2].body.data).toEqual({
      email: "c@hospital.example",
      firstName: "C",
      title: "Device due",
      message: "Calibration is due",
      actionUrl: "https://app.example/d/1",
    });
    expect(broker.connectCount).toBe(1);
    expect(broker.openConnections()).toBe(1);
  });

  it("declares the queue, its DLQ and the three delay queues once per channel", async () => {
    await svc.queueOtpEmail({ email: "a@hospital.example", otp: "1" });
    await svc.queueOtpEmail({ email: "b@hospital.example", otp: "2" });

    expect(broker.queueArgs("email_queue")).toEqual({
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": "email_dlq",
    });
    for (const n of [1, 2, 3]) {
      expect(broker.queueArgs(svc.retryQueueOf(n))).toEqual({
        "x-message-ttl": svc.retryDelayMs(n),
        "x-dead-letter-exchange": "",
        "x-dead-letter-routing-key": "email_queue",
      });
    }
  });

  it("logs the recipient's domain, never the address (A-186)", async () => {
    await svc.queueOtpEmail({ email: "Nurse@Hospital.Example", otp: "999111" });

    expect(logger.info).toHaveBeenCalledWith("Email job added to queue", {
      jobId: expect.any(String),
      type: "otp",
      recipientDomain: "hospital.example",
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/Nurse@|999111/);
  });

  describe("broker unavailable: the direct send is the answer (A-158)", () => {
    beforeEach(() => broker.refuseConnections(true));

    it.each([
      ["activation", () => svc.queueActivationEmail({ email: "a@h.example" }), "sendActivationEmail"],
      ["otp", () => svc.queueOtpEmail({ email: "a@h.example", otp: "1" }), "sendOtpEmail"],
      ["notification", () => svc.queueNotificationEmail({ email: "a@h.example", title: "t" }), "sendNotificationEmail"],
    ])("%s is sent directly and its result returned", async (_type, queue, fn) => {
      email[fn].mockResolvedValueOnce(true);

      await expect(queue()).resolves.toBe(true);

      expect(email[fn]).toHaveBeenCalledWith(expect.objectContaining({ email: "a@h.example" }));
      expect(logger.warn).toHaveBeenCalledWith("RabbitMQ unavailable, sending email synchronously");
      expect(logger.error).toHaveBeenCalledWith("Failed to add email job to queue", {
        error: expect.stringContaining("ECONNREFUSED"),
        type: _type,
        recipientDomain: "h.example",
      });
    });

    it("a failed direct send returns false, and logs no address", async () => {
      email.sendActivationEmail.mockRejectedValueOnce(new Error("SMTP down"));

      await expect(svc.queueActivationEmail({ email: "no-at-sign" })).resolves.toBe(false);

      expect(logger.error).toHaveBeenCalledWith("Failed to send email", {
        error: "SMTP down",
        type: "activation",
        recipientDomain: null,
      });
    });
  });
});

describe("consumer (W-06: supervised)", () => {
  it("says whether the first registration succeeded", async () => {
    await expect(svc.processEmailQueue()).resolves.toBe(true);
    expect(logger.info).toHaveBeenCalledWith("Email queue worker started (RabbitMQ)");

    await svc.closeRabbitMQ();
    broker.refuseConnections(true);
    load();
    await expect(svc.processEmailQueue()).resolves.toBe(false);
    expect(logger.info).toHaveBeenCalledWith("Email queue worker not registered yet; retrying in the background");
  });

  it("an email queued after a broker restart is still sent: the consumer re-registered", async () => {
    email.sendOtpEmail.mockResolvedValue(true);
    await svc.processEmailQueue();

    broker.restart();
    await waitFor(() => broker.consumerCount("email_queue") === 1);
    await svc.queueOtpEmail({ email: "a@h.example", otp: "1" });
    await waitFor(() => email.sendOtpEmail.mock.calls.length === 1);
    await settle();

    expect(broker.messages("email_queue")).toHaveLength(0);
  });

  it.each([
    ["activation", "sendActivationEmail"],
    ["otp", "sendOtpEmail"],
    ["notification", "sendNotificationEmail"],
  ])("sends a %s job and acks it", async (type, fn) => {
    email[fn].mockResolvedValue(true);
    await svc.processEmailQueue();

    broker.publish("email_queue", job({ type }));
    await waitFor(() => email[fn].mock.calls.length === 1);
    await settle();

    expect(email[fn]).toHaveBeenCalledWith(job().data);
    expect(broker.messages("email_queue")).toHaveLength(0);
    expect(broker.messages("email_dlq")).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith("Email sent successfully", {
      jobId: "job-1",
      type,
      recipientDomain: "hospital.example",
    });
  });

  it("dead-letters a body that is not JSON, or JSON that is not an object", async () => {
    await svc.processEmailQueue();

    // Raw bodies: broker.publish() would JSON-encode them.
    const ch = await rabbitmq.getChannel();
    for (const body of ["not json", "null", "42"]) {
      ch.sendToQueue("email_queue", Buffer.from(body));
    }
    const dlqDepth = async () => (await ch.checkQueue("email_dlq")).messageCount;
    for (let i = 0; i < 500 && (await dlqDepth()) < 3; i += 1) {
      await new Promise((r) => setTimeout(r, 2));
    }

    expect(await dlqDepth()).toBe(3);
    expect(logger.error).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledWith("Invalid email job data");
  });

  it("acks a redelivered job it already sent, without sending again (A-26)", async () => {
    email.sendOtpEmail.mockResolvedValue(true);
    await svc.processEmailQueue();

    broker.publish("email_queue", job({ type: "otp" }));
    broker.publish("email_queue", job({ type: "otp" }));
    await waitFor(() => logger.info.mock.calls.some(([m]) => m === "Duplicate email job ignored"));
    await settle();

    expect(email.sendOtpEmail).toHaveBeenCalledTimes(1);
    expect(broker.messages("email_queue")).toHaveLength(0);
    expect(broker.messages("email_dlq")).toHaveLength(0);
  });

  it("processes a job with no id, and says it was not deduplicated", async () => {
    email.sendOtpEmail.mockResolvedValue(true);
    await svc.processEmailQueue();

    broker.publish("email_queue", job({ id: undefined, type: "otp", data: undefined }));
    await waitFor(() => email.sendOtpEmail.mock.calls.length === 1);
    await settle();

    expect(logger.warn).toHaveBeenCalledWith("Email job has no id; processing without deduplication");
    expect(logger.info).toHaveBeenCalledWith("Email sent successfully", {
      jobId: undefined,
      type: "otp",
      recipientDomain: null,
    });
  });
});

describe("retries live in the broker (W-09)", () => {
  it("a job that fails twice and then succeeds is sent once, and nothing reaches the DLQ", async () => {
    email.sendActivationEmail
      .mockRejectedValueOnce(new Error("SMTP 421"))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await svc.processEmailQueue();

    broker.publish("email_queue", job());
    await waitFor(() => email.sendActivationEmail.mock.calls.length === 3);
    await settle();

    expect(broker.messages("email_dlq")).toHaveLength(0);
    expect(broker.messages("email_queue")).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith("Retrying email job 1/3 after 10ms", { jobId: "job-1" });
    expect(logger.info).toHaveBeenCalledWith("Retrying email job 2/3 after 20ms", { jobId: "job-1" });
  });

  it("a job that always fails produces exactly ONE DLQ message, after the last attempt", async () => {
    email.sendActivationEmail.mockRejectedValue(new Error("SMTP 550"));
    await svc.processEmailQueue();

    broker.publish("email_queue", job());
    await waitFor(() => broker.messages("email_dlq").length === 1);
    await new Promise((r) => setTimeout(r, 60)); // longer than every delay tier
    await settle();

    expect(email.sendActivationEmail).toHaveBeenCalledTimes(4); // the first try + 3 retries
    expect(broker.messages("email_dlq")).toHaveLength(1);
    expect(broker.messages("email_dlq")[0].body).toMatchObject({ id: "job-1", retries: 3 });
    expect(logger.warn).toHaveBeenCalledWith("Email job exhausted its 3 retries; dead-lettered", { jobId: "job-1" });
  });

  it("an unknown type is a failure: retried, then dead-lettered", async () => {
    await svc.processEmailQueue();

    broker.publish("email_queue", job({ type: "fax", retries: 3 }));
    await waitFor(() => broker.messages("email_dlq").length === 1);

    expect(logger.warn).toHaveBeenCalledWith("Unknown email job type", { type: "fax" });
  });

  it("a job without retry counters uses 0 and 3", async () => {
    email.sendActivationEmail.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(true);
    await svc.processEmailQueue();

    broker.publish("email_queue", job({ retries: undefined, maxRetries: undefined }));
    await waitFor(() => email.sendActivationEmail.mock.calls.length === 2);

    expect(logger.info).toHaveBeenCalledWith("Retrying email job 1/3 after 10ms", { jobId: "job-1" });
  });

  it("a restart during the backoff still delivers the retry: the delay is a durable queue", async () => {
    email.sendActivationEmail.mockRejectedValueOnce(new Error("SMTP 421"));
    await svc.processEmailQueue();
    broker.publish("email_queue", job());
    await waitFor(() => email.sendActivationEmail.mock.calls.length === 1);

    // The process goes away before the retry is due.
    await svc.closeRabbitMQ();
    await waitFor(() => broker.messages("email_queue").length === 1);

    // A new process comes up and sends it.
    load();
    email.sendActivationEmail.mockResolvedValue(true);
    await svc.processEmailQueue();
    await waitFor(() => email.sendActivationEmail.mock.calls.length === 1);
    await settle();

    expect(email.sendActivationEmail.mock.calls[0][0]).toEqual(job().data);
    expect(broker.messages("email_dlq")).toHaveLength(0);
    expect(broker.messages("email_queue")).toHaveLength(0);
  });

  it("the channel closing mid-send cannot throw out of the consumer: the job is redelivered and sent", async () => {
    email.sendActivationEmail
      .mockImplementationOnce(async () => {
        broker.restart(); // the consumer's channel is gone when the retry is sent
        throw new Error("SMTP 421");
      })
      .mockResolvedValue(true);
    await svc.processEmailQueue();

    broker.publish("email_queue", job());
    await waitFor(() => email.sendActivationEmail.mock.calls.length === 2);
    await settle();

    expect(logger.warn).toHaveBeenCalledWith(
      "Email retry not scheduled (channel closed); the broker redelivers the job",
      { jobId: "job-1", error: "Channel closed" },
    );
    expect(broker.messages("email_dlq")).toHaveLength(0);
    expect(broker.messages("email_queue")).toHaveLength(0);
  });
});

describe("stats, purge and close", () => {
  it("reports the queue and DLQ depths", async () => {
    await svc.queueOtpEmail({ email: "a@h.example", otp: "1" });

    await expect(svc.getQueueStats()).resolves.toMatchObject({
      emailQueueMessages: 1,
      dlqMessages: 0,
      status: "connected",
    });
  });

  it("reports an error state when the broker is unreachable", async () => {
    broker.refuseConnections(true);

    await expect(svc.getQueueStats()).resolves.toEqual({ emailQueueMessages: 0, dlqMessages: 0, status: "error" });
    expect(logger.error).toHaveBeenCalledWith("Failed to get queue stats", expect.any(Object));
  });

  it("purges the queue, or returns false when it cannot", async () => {
    await svc.queueOtpEmail({ email: "a@h.example", otp: "1" });
    await expect(svc.clearQueue()).resolves.toBe(true);
    expect(broker.messages("email_queue")).toHaveLength(0);

    await svc.closeRabbitMQ();
    broker.refuseConnections(true);
    await expect(svc.clearQueue()).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith("Failed to clear queue", expect.any(Object));
  });

  it("closeRabbitMQ closes the process's ONE connection (W-18)", async () => {
    await svc.processEmailQueue();
    await svc.queueOtpEmail({ email: "a@h.example", otp: "1" });
    expect(broker.openConnections()).toBe(1);

    await svc.closeRabbitMQ();

    expect(broker.openConnections()).toBe(0);
  });
});
