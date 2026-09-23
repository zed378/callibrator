/**
 * A-26 — the batch-job consumer had no deduplication either: a redelivered
 * message re-ran the job, repeating whatever side effects its handler has.
 *
 * The identity is `payload.jobId`, the BatchJob row's UUID. It is minted once
 * when the job is created and travels inside the persisted message body, so a
 * redelivery carries the same value. (The AMQP delivery tag does not: it is
 * per-channel and changes on redelivery.)
 *
 * This file is also the first test the batch worker has had at all; it covers
 * the inline-mode short circuit, the invalid-message path and the failure path
 * alongside the dedup behaviour.
 */

jest.mock("../../services/rabbitmq.service", () => ({
  assertQueue: jest.fn(),
  consume: jest.fn(),
  getChannel: jest.fn(),
  claimMessage: jest.fn(),
}));

jest.mock("../../services/batchJob.service", () => ({
  BATCH_QUEUE: "batch_jobs",
  BATCH_DLQ: "batch_jobs_dlq",
  runJob: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const rabbitmq = require("../../services/rabbitmq.service");
const batchJobService = require("../../services/batchJob.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const { startBatchJobWorker } = require("../../workers/batchJob.worker");

const msgFor = (payload) => ({
  content: Buffer.from(JSON.stringify(payload)),
});

describe("batchJob.worker (A-26)", () => {
  let channel;
  let claimStore;
  let savedInline;

  /** Start the worker and return the handler it registered. */
  const startWorker = async () => {
    await startBatchJobWorker();
    return rabbitmq.consume.mock.calls[0][1];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    savedInline = process.env.BATCH_JOBS_INLINE;
    delete process.env.BATCH_JOBS_INLINE;

    channel = { ack: jest.fn(), nack: jest.fn() };
    rabbitmq.getChannel.mockResolvedValue(channel);
    rabbitmq.assertQueue.mockResolvedValue(channel);
    rabbitmq.consume.mockResolvedValue(channel);
    batchJobService.runJob.mockResolvedValue({});

    // A real SET NX: the first claim on an identity wins, the next loses.
    claimStore = new Set();
    rabbitmq.claimMessage.mockImplementation(async (identity) => {
      if (claimStore.has(identity)) {
        return { claimed: false, deduplicated: true, release: async () => false };
      }
      claimStore.add(identity);
      return {
        claimed: true,
        deduplicated: true,
        release: async () => {
          claimStore.delete(identity);
          return true;
        },
      };
    });
  });

  afterEach(() => {
    if (savedInline === undefined) {
      delete process.env.BATCH_JOBS_INLINE;
    } else {
      process.env.BATCH_JOBS_INLINE = savedInline;
    }
  });

  it("runs the job ONCE when the same message is delivered twice, and ACKs both", async () => {
    const handler = await startWorker();
    const msg = msgFor({ jobId: "job-1", tenantId: "t1", type: "export" });

    await handler(msg);
    await handler(msg); // redelivery of the identical body

    expect(batchJobService.runJob).toHaveBeenCalledTimes(1);
    expect(batchJobService.runJob).toHaveBeenCalledWith("job-1");
    expect(channel.ack).toHaveBeenCalledTimes(2);
    expect(channel.nack).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "Duplicate batch job message ignored",
      { jobId: "job-1" },
    );
  });

  it("runs both when the messages are for different jobs", async () => {
    const handler = await startWorker();

    await handler(msgFor({ jobId: "job-1" }));
    await handler(msgFor({ jobId: "job-2" }));

    expect(batchJobService.runJob).toHaveBeenCalledTimes(2);
  });

  it("releases the claim when the job throws, so a DLQ replay can run it", async () => {
    const handler = await startWorker();
    batchJobService.runJob.mockRejectedValueOnce(new Error("handler blew up"));

    await handler(msgFor({ jobId: "job-1" }));

    expect(channel.nack).toHaveBeenCalledWith(expect.any(Object), false, false);
    expect(claimStore.has("batch:job-1")).toBe(false);

    await handler(msgFor({ jobId: "job-1" }));
    expect(batchJobService.runJob).toHaveBeenCalledTimes(2);
  });

  it("processes a message with no jobId and says it was not deduplicated", async () => {
    const handler = await startWorker();

    await handler(msgFor({ tenantId: "t1" }));

    expect(rabbitmq.claimMessage).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Batch job message has no jobId; not deduplicated",
    );
    expect(batchJobService.runJob).toHaveBeenCalledWith(undefined);
  });

  it("does not attempt to release a claim it never took", async () => {
    const handler = await startWorker();
    batchJobService.runJob.mockRejectedValueOnce(new Error("nope"));

    await handler(msgFor({ tenantId: "t1" })); // no jobId, so no claim

    expect(channel.nack).toHaveBeenCalledTimes(1);
  });

  it("ignores a null delivery", async () => {
    const handler = await startWorker();

    await handler(null);

    expect(rabbitmq.claimMessage).not.toHaveBeenCalled();
    expect(batchJobService.runJob).not.toHaveBeenCalled();
  });

  it("drops an unparseable message without claiming an identity", async () => {
    const handler = await startWorker();

    await handler({ content: Buffer.from("not json") });

    expect(rabbitmq.claimMessage).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith("Invalid batch job message; dropping");
  });

  it("does not start a consumer in inline mode", async () => {
    process.env.BATCH_JOBS_INLINE = "true";

    await startBatchJobWorker();

    expect(rabbitmq.consume).not.toHaveBeenCalled();
  });

  it("warns instead of throwing when the queue cannot be declared", async () => {
    rabbitmq.assertQueue.mockRejectedValueOnce(new Error("broker down"));

    await startBatchJobWorker();

    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to start batch job worker",
      { error: "broker down" },
    );
  });
});
