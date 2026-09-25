/**
 * batchJob.worker — the consumer that drives batch jobs (W-06, W-07, W-31).
 *
 * The previous version of this file tested an A-26 design the worker no longer
 * has: a Redis `claimMessage` taken BEFORE the job, which W-07 showed drops a
 * job for good when the worker dies mid-run (the redelivery is acked as a
 * duplicate while the row sits in PROCESSING). The claim is now the job row's
 * PENDING -> PROCESSING transition (batchJob.service#runJob, tested there).
 *
 * Two layers here:
 *  - handleMessage against a mocked rabbitmq.service: what is settled, how.
 *  - the worker on the REAL rabbitmq.service over tests/fixtures/fakeAmqp.js,
 *    an in-memory broker that enforces the amqplib behaviour the consumer
 *    depends on. That proves re-registration after a broker restart (W-06),
 *    settlement on the arrival channel (W-31) and a drained shutdown that
 *    fails the job it had to abandon, whose redelivery then settles without
 *    running it again (W-07). Still a fake, not a live broker.
 */

jest.mock("../../services/batchJob.service", () => ({
  BATCH_QUEUE: "batch_jobs",
  BATCH_DLQ: "batch_jobs_dlq",
  runJob: jest.fn(),
  failAbandonedJobs: jest.fn(),
  failInterruptedJobs: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("amqplib", () => ({ connect: jest.fn() }));
jest.mock("../../services/redis.service", () => ({
  getRedisConnection: jest.fn(() => null),
  del: jest.fn(),
}));

const { createBroker, settle } = require("../fixtures/fakeAmqp");

const ENV = { ...process.env };

const msgFor = (payload) => ({ content: Buffer.from(JSON.stringify(payload)) });

const waitFor = async (predicate, ms = 1000) => {
  const until = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > until) {
      throw new Error("condition not met in time");
    }
    await new Promise((r) => setTimeout(r, 2));
  }
};

describe("handleMessage (mocked broker)", () => {
  let worker;
  let rabbitmq;
  let batchJobService;
  let logger;
  const ch = { id: "arrival-channel" };

  beforeEach(() => {
    jest.resetModules();
    jest.doMock("../../services/rabbitmq.service", () => ({
      ack: jest.fn(),
      nack: jest.fn(),
      assertQueue: jest.fn(),
      startConsumer: jest.fn(),
      stopConsumers: jest.fn(),
    }));
    rabbitmq = require("../../services/rabbitmq.service");
    batchJobService = require("../../services/batchJob.service");
    logger = require("../../middlewares/activityLog.middleware").logger;
    worker = require("../../workers/batchJob.worker");
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.dontMock("../../services/rabbitmq.service");
    process.env = { ...ENV };
  });

  it("runs the job with the tenant its message carries, and acks on the arrival channel", async () => {
    batchJobService.runJob.mockResolvedValue({ ran: true });
    const msg = msgFor({ jobId: "j1", tenantId: "t1", type: "export" });

    await worker.handleMessage(msg, ch);

    expect(batchJobService.runJob).toHaveBeenCalledWith("j1", "t1");
    expect(rabbitmq.ack).toHaveBeenCalledWith(ch, msg);
    expect(rabbitmq.nack).not.toHaveBeenCalled();
  });

  it("acks, and says why, a message whose job did not run (already claimed, finished or gone)", async () => {
    batchJobService.runJob.mockResolvedValue({ ran: false, reason: "job is COMPLETED" });
    const msg = msgFor({ jobId: "j1", tenantId: "t1" });

    await worker.handleMessage(msg, ch);

    expect(rabbitmq.ack).toHaveBeenCalledWith(ch, msg);
    expect(logger.info).toHaveBeenCalledWith("Batch job message settled without running", {
      jobId: "j1",
      reason: "job is COMPLETED",
    });
  });

  it("acks quietly when runJob returns nothing", async () => {
    batchJobService.runJob.mockResolvedValue(undefined);

    await worker.handleMessage(msgFor({ jobId: "j1", tenantId: "t1" }), ch);

    expect(rabbitmq.ack).toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("dead-letters (nack, no requeue) a job that threw", async () => {
    batchJobService.runJob.mockRejectedValue(new Error("handler blew up"));
    const msg = msgFor({ jobId: "j1", tenantId: "t1" });

    await worker.handleMessage(msg, ch);

    expect(rabbitmq.nack).toHaveBeenCalledWith(ch, msg);
    expect(rabbitmq.ack).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith("Batch worker job failed", { jobId: "j1", error: "handler blew up" });
  });

  it.each([
    ["not JSON", "not json"],
    ["JSON null", "null"],
    ["a JSON number", "42"],
  ])("drops a message whose body is %s, without running anything", async (_label, body) => {
    const msg = { content: Buffer.from(body) };

    await worker.handleMessage(msg, ch);

    expect(logger.error).toHaveBeenCalledWith("Invalid batch job message; dropping");
    expect(rabbitmq.nack).toHaveBeenCalledWith(ch, msg);
    expect(batchJobService.runJob).not.toHaveBeenCalled();
  });

  it("starts nothing but the sweep in inline mode, and the sweep runs once however often it starts", async () => {
    process.env.BATCH_JOBS_INLINE = "true";
    batchJobService.failAbandonedJobs.mockResolvedValue(0);

    await expect(worker.startBatchJobWorker()).resolves.toBe(false);
    await worker.startBatchJobWorker();

    expect(rabbitmq.startConsumer).not.toHaveBeenCalled();
    expect(batchJobService.failAbandonedJobs).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("Batch jobs in inline mode; RabbitMQ worker not started");
    rabbitmq.stopConsumers.mockResolvedValue({ drained: true });
    await worker.stopBatchJobWorker();
  });

  it("a failing sweep is logged, never thrown", async () => {
    process.env.BATCH_JOBS_INLINE = "true";
    batchJobService.failAbandonedJobs.mockRejectedValue(new Error("db down"));

    await expect(worker.startBatchJobWorker()).resolves.toBe(false);

    expect(logger.error).toHaveBeenCalledWith("Abandoned batch-job sweep failed", { error: "db down" });
    rabbitmq.stopConsumers.mockResolvedValue({ drained: true });
    await worker.stopBatchJobWorker();
  });

  it("registers a supervised consumer with prefetch and a setup that re-declares the queues", async () => {
    process.env.BATCH_PREFETCH = "3";
    batchJobService.failAbandonedJobs.mockResolvedValue(0);
    rabbitmq.startConsumer.mockResolvedValue(true);

    await expect(worker.startBatchJobWorker()).resolves.toBe(true);

    const [queue, handler, options] = rabbitmq.startConsumer.mock.calls[0];
    expect(queue).toBe("batch_jobs");
    expect(handler).toBe(worker.handleMessage);
    expect(options.prefetch).toBe(3);
    const consumerChannel = {};
    await options.setup(consumerChannel);
    expect(rabbitmq.assertQueue).toHaveBeenCalledWith("batch_jobs", "batch_jobs_dlq", consumerChannel);
    expect(logger.info).toHaveBeenCalledWith("Batch job worker started (RabbitMQ)");

    rabbitmq.stopConsumers.mockResolvedValue({ drained: true });
    await worker.stopBatchJobWorker();
  });

  it("says it is retrying when the first registration did not succeed", async () => {
    batchJobService.failAbandonedJobs.mockResolvedValue(0);
    rabbitmq.startConsumer.mockResolvedValue(false);

    await expect(worker.startBatchJobWorker()).resolves.toBe(false);

    expect(logger.info).toHaveBeenCalledWith("Batch job worker not registered yet; retrying in the background");
    rabbitmq.stopConsumers.mockResolvedValue({ drained: true });
    await worker.stopBatchJobWorker();
  });

  it("stop with nothing in flight fails nothing", async () => {
    rabbitmq.stopConsumers.mockResolvedValue({ drained: true, pending: 0 });

    await expect(worker.stopBatchJobWorker({ timeoutMs: 5 })).resolves.toEqual({ drained: true, failed: 0 });

    expect(rabbitmq.stopConsumers).toHaveBeenCalledWith({ timeoutMs: 5 });
    expect(batchJobService.failInterruptedJobs).not.toHaveBeenCalled();
  });

  it("stop fails the jobs still running at the deadline; a failure to do so is logged", async () => {
    let finish;
    batchJobService.runJob.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const inFlight = worker.handleMessage(msgFor({ jobId: "j7", tenantId: "t1" }), ch);
    rabbitmq.stopConsumers.mockResolvedValue({ drained: false, pending: 1 });
    batchJobService.failInterruptedJobs.mockRejectedValueOnce(new Error("db gone"));

    await expect(worker.stopBatchJobWorker()).resolves.toEqual({ drained: false, failed: 0 });

    expect(batchJobService.failInterruptedJobs).toHaveBeenCalledWith(["j7"]);
    expect(logger.error).toHaveBeenCalledWith(
      "Could not mark interrupted batch jobs FAILED; the sweep will",
      { error: "db gone" },
    );
    finish({ ran: true });
    await inFlight;
  });
});

describe("the worker on rabbitmq.service over an in-memory broker (W-06, W-07, W-31)", () => {
  let broker;
  let worker;
  let rabbitmq;
  let batchJobService;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ENV,
      RABBITMQ_URL: "amqp://broker.test:5672",
      RABBITMQ_RECONNECT_BASE_MS: "5",
      RABBITMQ_RECONNECT_MAX_MS: "20",
      RABBITMQ_DRAIN_TIMEOUT_MS: "20",
      BATCH_JOBS_INLINE: "false",
    };
    broker = createBroker();
    require("amqplib").connect.mockImplementation(broker.connect);
    rabbitmq = require("../../services/rabbitmq.service");
    batchJobService = require("../../services/batchJob.service");
    batchJobService.failAbandonedJobs.mockResolvedValue(0);
    batchJobService.failInterruptedJobs.mockResolvedValue(0);
    worker = require("../../workers/batchJob.worker");
  });

  afterEach(async () => {
    await worker.stopBatchJobWorker({ timeoutMs: 20 });
    await rabbitmq.closeRabbitMQ();
    broker.dispose();
    process.env = { ...ENV };
  });

  it("consumes, acks on the arrival channel, and dead-letters a failure", async () => {
    batchJobService.runJob.mockResolvedValueOnce({ ran: true }).mockRejectedValueOnce(new Error("boom"));
    await expect(worker.startBatchJobWorker()).resolves.toBe(true);

    broker.publish("batch_jobs", { jobId: "ok", tenantId: "t1" });
    broker.publish("batch_jobs", { jobId: "bad", tenantId: "t1" });
    await waitFor(() => broker.messages("batch_jobs_dlq").length === 1);

    expect(batchJobService.runJob).toHaveBeenCalledWith("ok", "t1");
    expect(broker.messages("batch_jobs_dlq")[0].body.jobId).toBe("bad");
    expect(broker.messages("batch_jobs")).toHaveLength(0);
    // Every settlement went to the channel the message came on: an ack on any
    // other channel is a PRECONDITION_FAILED that would have closed it.
    expect(broker.consumerCount("batch_jobs")).toBe(1);
  });

  it("a job published after a broker restart is still run: the consumer re-registered (W-06)", async () => {
    batchJobService.runJob.mockResolvedValue({ ran: true });
    await worker.startBatchJobWorker();
    await waitFor(() => broker.consumerCount("batch_jobs") === 1);

    broker.restart();
    await waitFor(() => broker.consumerCount("batch_jobs") === 1);
    broker.publish("batch_jobs", { jobId: "after-restart", tenantId: "t1" });
    await waitFor(() => batchJobService.runJob.mock.calls.length === 1);

    expect(batchJobService.runJob).toHaveBeenCalledWith("after-restart", "t1");
  });

  it("shutdown mid-job fails the job; its redelivery elsewhere settles without running it (W-07)", async () => {
    let finish;
    batchJobService.runJob.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await worker.startBatchJobWorker();
    broker.publish("batch_jobs", { jobId: "long", tenantId: "t1" });
    await waitFor(() => batchJobService.runJob.mock.calls.length === 1);

    batchJobService.failInterruptedJobs.mockResolvedValueOnce(1);
    await expect(worker.stopBatchJobWorker({ timeoutMs: 20 })).resolves.toEqual({ drained: false, failed: 1 });
    expect(batchJobService.failInterruptedJobs).toHaveBeenCalledWith(["long"]);

    // The process exits: its connection dies and the unacked message returns.
    await rabbitmq.closeRabbitMQ();
    await settle();
    expect(broker.messages("batch_jobs")).toEqual([expect.objectContaining({ redelivered: true })]);

    // A fresh process picks it up; the row is FAILED, so the claim is lost and
    // the message is acked, not re-run and not left to loop.
    jest.resetModules();
    require("amqplib").connect.mockImplementation(broker.connect);
    rabbitmq = require("../../services/rabbitmq.service");
    batchJobService = require("../../services/batchJob.service");
    batchJobService.failAbandonedJobs.mockResolvedValue(0);
    batchJobService.runJob.mockResolvedValue({ ran: false, reason: "job is FAILED" });
    worker = require("../../workers/batchJob.worker");
    await worker.startBatchJobWorker();
    await waitFor(() => batchJobService.runJob.mock.calls.length >= 1);
    await settle();

    expect(broker.messages("batch_jobs")).toHaveLength(0);
    expect(broker.messages("batch_jobs_dlq")).toHaveLength(0);
    finish({ ran: true });
  });
});
