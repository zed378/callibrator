/**
 * A-186 — emailQueue.service never logs a recipient's address, nor the job
 * payload (the OTP, the activation link and its token).
 *
 * Every log call the service makes, on every path — queued, queue down and
 * sent directly, direct send failed, consumed and sent — is serialised and
 * searched for the mailbox, the OTP and the activation token. The recipient's
 * DOMAIN is what remains, so a provider-specific failure is still visible.
 *
 * The assertion is on the service's own calls (the logger is replaced), not on
 * the winston redaction format: before A-186 the format would have let both
 * the address (key `to`) and the activation link (key `activationLink`) through.
 */

jest.mock("amqplib", () => ({ connect: jest.fn() }));
jest.mock("../../services/email.service", () => ({
  sendOtpEmail: jest.fn(),
  sendActivationEmail: jest.fn(),
  sendNotificationEmail: jest.fn(),
}));
// W-18: the email queue now uses rabbitmq.service's one connection. This
// stand-in routes it to the amqplib mock below, so the paths under test (queued,
// queue down, consumed) are the same as before.
jest.mock("../../services/rabbitmq.service", () => {
  const amqp = require("amqplib");
  let ch = null;
  const getChannel = async () => {
    if (!ch) {
      const conn = await amqp.connect("amqp://test");
      ch = await conn.createChannel();
    }
    return ch;
  };
  return {
    claimMessage: jest.fn(async () => ({ claimed: true, release: jest.fn(async () => undefined) })),
    getChannel,
    assertQueue: async (queue, dlq, target) => target || getChannel(),
    startConsumer: async (queue, handler, { setup }) => {
      const c = await getChannel();
      await setup(c);
      await c.consume(queue, (msg) => handler(msg, c));
      return true;
    },
    ack: (c, msg) => c.ack(msg),
    nack: (c, msg) => c.nack(msg, false, false),
    closeRabbitMQ: async () => {
      ch = null;
    },
  };
});
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const ADDRESS = "Dr.Jane.Doe@Hospital-A.example";
const OTP = "734215";
const TOKEN = "act-3f9c2b7d51e04a6c";
const ACTIVATION_LINK = `https://app.example/activate?t=${TOKEN}`;

const leaks = (logger) => {
  const text = JSON.stringify(
    ["info", "warn", "error", "debug"].flatMap((level) => logger[level].mock.calls),
  ).toLowerCase();
  return ["dr.jane.doe", OTP, TOKEN].filter((secret) => text.includes(secret.toLowerCase()));
};

describe("A-186 — the email queue logs no recipient address and no payload", () => {
  let amqplib;
  let emailService;
  let logger;
  let svc;
  let channel;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    amqplib = require("amqplib");
    emailService = require("../../services/email.service");
    logger = require("../../middlewares/activityLog.middleware").logger;
    svc = require("../../services/emailQueue.service");
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
    await svc.closeRabbitMQ();
  });

  it("queued: logs the job id, type and recipient domain only", async () => {
    await expect(
      svc.queueActivationEmail({ email: ADDRESS, firstName: "Jane", activationLink: ACTIVATION_LINK }),
    ).resolves.toBe(true);

    expect(logger.info).toHaveBeenCalledWith("Email job added to queue", {
      jobId: expect.any(String),
      type: "activation",
      recipientDomain: "hospital-a.example",
    });
    expect(leaks(logger)).toEqual([]);
  });

  it("queue down, sent directly: neither the failure nor the success line carries the job", async () => {
    amqplib.connect.mockRejectedValue(new Error("ECONNREFUSED"));
    emailService.sendActivationEmail.mockResolvedValue(true);

    await expect(
      svc.queueActivationEmail({ email: ADDRESS, firstName: "Jane", activationLink: ACTIVATION_LINK }),
    ).resolves.toBe(true);

    expect(logger.error).toHaveBeenCalledWith("Failed to add email job to queue", {
      error: expect.any(String),
      type: "activation",
      recipientDomain: "hospital-a.example",
    });
    expect(logger.info).toHaveBeenCalledWith("Email sent successfully", {
      type: "activation",
      recipientDomain: "hospital-a.example",
    });
    expect(leaks(logger)).toEqual([]);
  });

  it("queue down, direct send fails: the error names the domain, not the address or the OTP", async () => {
    amqplib.connect.mockRejectedValue(new Error("ECONNREFUSED"));
    emailService.sendOtpEmail.mockRejectedValue(new Error("SMTP 550"));

    await expect(svc.queueOtpEmail({ email: ADDRESS, firstName: "Jane", otp: OTP })).resolves.toBe(false);

    expect(logger.error).toHaveBeenCalledWith("Failed to send email", {
      error: "SMTP 550",
      type: "otp",
      recipientDomain: "hospital-a.example",
    });
    expect(leaks(logger)).toEqual([]);
  });

  it("consumed and sent: the worker's success line names the job and the domain", async () => {
    emailService.sendNotificationEmail.mockResolvedValue(true);
    await svc.processEmailQueue();
    const processJob = channel.consume.mock.calls[0][1];

    await processJob({
      content: Buffer.from(
        JSON.stringify({ id: "job-1", type: "notification", data: { email: ADDRESS, title: "t" }, retries: 0, maxRetries: 3 }),
      ),
    });

    expect(channel.ack).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("Email sent successfully", {
      jobId: "job-1",
      type: "notification",
      recipientDomain: "hospital-a.example",
    });
    expect(leaks(logger)).toEqual([]);
  });

  it("an address with no usable domain is logged as null, never as itself", async () => {
    await svc.queueNotificationEmail({ email: "not-an-address", title: "t", message: "m" });
    await svc.queueNotificationEmail({ email: "@nobody", title: "t", message: "m" });
    await svc.queueNotificationEmail({ email: undefined, title: "t", message: "m" });

    const domains = logger.info.mock.calls
      .filter(([message]) => message === "Email job added to queue")
      .map(([, meta]) => meta.recipientDomain);
    expect(domains).toEqual([null, null, null]);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("not-an-address");
  });
});
