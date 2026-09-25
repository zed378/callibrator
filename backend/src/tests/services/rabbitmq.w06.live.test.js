/**
 * W-06 / W-09 / W-31 against a REAL RabbitMQ — what the in-memory fake
 * (tests/fixtures/fakeAmqp.js) cannot settle.
 *
 *  - W-06: a supervised consumer survives a broker RESTART (the container is
 *    restarted underneath it) and consumes a message published afterwards.
 *  - W-09: an email that always fails leaves exactly ONE message in email_dlq,
 *    after the last attempt, with every retry delayed by the broker's own
 *    `x-message-ttl` queues; one that fails then succeeds leaves none.
 *  - W-31: every settlement goes to the arrival channel — a wrong-channel ack
 *    is a PRECONDITION_FAILED that the real broker raises and the fake only
 *    imitates; none is raised here.
 *
 * OPT-IN — needs a broker it may restart (a throwaway container):
 *
 *   docker run -d --name rmq-live -p 127.0.0.1:55672:5672 rabbitmq:4-alpine
 *   RABBITMQ_LIVE_TEST=1 RABBITMQ_URL=amqp://127.0.0.1:55672 RABBITMQ_LIVE_CONTAINER=rmq-live \
 *     npm test -- src/tests/services/rabbitmq.w06.live --coverage=false
 *
 * It declares and purges its own queues and the email queues.
 */
const { execFile } = require("child_process");
const { promisify } = require("util");

// Asynchronous on purpose: execFileSync would block the event loop through the
// restart, so the client could not see its socket close until afterwards.
const docker = promisify(execFile);

jest.mock("../../services/redis.service", () => ({
  getRedisConnection: jest.fn(() => null),
  del: jest.fn(),
}));
jest.mock("../../services/email.service", () => ({
  sendOtpEmail: jest.fn(),
  sendActivationEmail: jest.fn(),
  sendNotificationEmail: jest.fn(),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const live = process.env.RABBITMQ_LIVE_TEST === "1" ? describe : describe.skip;

const waitFor = async (predicate, ms = 30000) => {
  const until = Date.now() + ms;
  for (;;) {
    if (await predicate()) {
      return;
    }
    if (Date.now() > until) {
      throw new Error("condition not met in time");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
};

live("RabbitMQ live (W-06, W-09, W-31)", () => {
  jest.setTimeout(120000);
  let rabbitmq;
  let emailQueue;
  let email;
  let logger;

  const depth = async (queue) => (await (await rabbitmq.getChannel()).checkQueue(queue)).messageCount;

  beforeAll(() => {
    process.env.RABBITMQ_RECONNECT_BASE_MS = "100";
    process.env.RABBITMQ_RECONNECT_MAX_MS = "1000";
    process.env.EMAIL_RETRY_BASE_MS = "50";
    rabbitmq = require("../../services/rabbitmq.service");
    emailQueue = require("../../services/emailQueue.service");
    email = require("../../services/email.service");
    logger = require("../../middlewares/activityLog.middleware").logger;
  });

  afterAll(async () => {
    await rabbitmq.closeRabbitMQ();
  });

  it("W-09: an email that always fails dead-letters ONCE, after the last broker-delayed retry", async () => {
    email.sendActivationEmail.mockRejectedValue(new Error("SMTP 550"));
    await expect(emailQueue.processEmailQueue()).resolves.toBe(true);
    const ch = await rabbitmq.getChannel();
    await ch.purgeQueue(emailQueue.EMAIL_QUEUE);
    await ch.purgeQueue(emailQueue.EMAIL_DLQ);

    await emailQueue.queueActivationEmail({ email: "live@hospital.example", activationLink: "x" });
    await waitFor(async () => (await depth(emailQueue.EMAIL_DLQ)) === 1);
    // Longer than the three delay tiers (100 + 200 + 400 ms) once more.
    await new Promise((r) => setTimeout(r, 1500));

    expect(await depth(emailQueue.EMAIL_DLQ)).toBe(1);
    expect(email.sendActivationEmail).toHaveBeenCalledTimes(4);
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.stringContaining("channel error"),
      expect.anything(),
    );
  });

  it("W-09: one that fails once and then succeeds is sent, and nothing is dead-lettered", async () => {
    email.sendActivationEmail.mockReset();
    email.sendActivationEmail.mockRejectedValueOnce(new Error("SMTP 421")).mockResolvedValue(true);
    const ch = await rabbitmq.getChannel();
    await ch.purgeQueue(emailQueue.EMAIL_DLQ);

    await emailQueue.queueActivationEmail({ email: "live@hospital.example", activationLink: "x" });
    await waitFor(() => email.sendActivationEmail.mock.calls.length === 2);
    await new Promise((r) => setTimeout(r, 300));

    expect(await depth(emailQueue.EMAIL_DLQ)).toBe(0);
    expect(await depth(emailQueue.EMAIL_QUEUE)).toBe(0);
  });

  it("W-06: a consumer survives a broker restart and consumes what is published after it", async () => {
    const received = [];
    const QUEUE = "w06_live_queue";
    await rabbitmq.startConsumer(
      QUEUE,
      async (msg, ch) => {
        received.push(JSON.parse(msg.content.toString()));
        rabbitmq.ack(ch, msg);
      },
      { setup: (ch) => rabbitmq.assertQueue(QUEUE, undefined, ch) },
    );
    await rabbitmq.publish(QUEUE, { n: "before" });
    await waitFor(() => received.length === 1);

    logger.info.mockClear();
    await docker("docker", ["restart", process.env.RABBITMQ_LIVE_CONTAINER]);

    // Both consumers (this queue's and the email queue's) say they are back.
    await waitFor(
      () => logger.info.mock.calls.filter(([m]) => /re-registered after \d+ attempt/.test(m)).length >= 2,
      60000,
    );
    expect(rabbitmq.consumerStatus().every((c) => c.registered)).toBe(true);
    await rabbitmq.publish(QUEUE, { n: "after" });
    await waitFor(() => received.length === 2);

    expect(received).toEqual([{ n: "before" }, { n: "after" }]);
    expect(rabbitmq.consumerStatus()).toEqual(
      expect.arrayContaining([{ queue: QUEUE, registered: true, attempt: 0 }]),
    );
  });

  it("W-06: the email consumer re-registered too, and still sends", async () => {
    email.sendOtpEmail.mockResolvedValue(true);

    await emailQueue.queueOtpEmail({ email: "live@hospital.example", otp: "123456" });
    await waitFor(() => email.sendOtpEmail.mock.calls.length === 1);

    expect(await depth(emailQueue.EMAIL_QUEUE)).toBe(0);
  });
});
