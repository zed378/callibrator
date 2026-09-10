/**
 * Tests for Batch Job Service (RabbitMQ queue + typed handlers + inline
 * fallback). The old setInterval "simulateProcessing" simulation was removed.
 */

jest.mock("../../models", () => ({
  BatchJob: {
    create: jest.fn(),
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
    findByPk: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock("../../services/rabbitmq.service", () => ({
  assertQueue: jest.fn(),
  publish: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const batchJobService = require("../../services/batchJob.service");
const { BatchJob } = require("../../models");
const rabbitmq = require("../../services/rabbitmq.service");
const { logger } = require("../../middlewares/activityLog.middleware");

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("batchJobService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe("createJob", () => {
    it("publishes to the queue and does not process inline", async () => {
      BatchJob.create.mockResolvedValue({ id: "j1" });
      rabbitmq.assertQueue.mockResolvedValue({});
      rabbitmq.publish.mockResolvedValue(true);
      const runSpy = jest.spyOn(batchJobService, "runJob").mockResolvedValue({});

      const job = await batchJobService.createJob("t1", "u1", "export", 5);

      expect(BatchJob.create).toHaveBeenCalledWith({
        tenantId: "t1",
        userId: "u1",
        type: "export",
        status: "PENDING",
        progress: 0,
        totalItems: 5,
      });
      expect(rabbitmq.assertQueue).toHaveBeenCalledWith("batch_jobs", "batch_jobs_dlq");
      expect(rabbitmq.publish).toHaveBeenCalledWith("batch_jobs", {
        jobId: "j1",
        tenantId: "t1",
        type: "export",
      });
      expect(runSpy).not.toHaveBeenCalled();
      expect(job).toEqual({ id: "j1" });
    });

    it("falls back to inline processing when publish returns false", async () => {
      BatchJob.create.mockResolvedValue({ id: "j2" });
      rabbitmq.assertQueue.mockResolvedValue({});
      rabbitmq.publish.mockResolvedValue(false);
      const runSpy = jest.spyOn(batchJobService, "runJob").mockResolvedValue({});

      await batchJobService.createJob("t1", "u1", "export", 0);
      await flush();

      expect(runSpy).toHaveBeenCalledWith("j2");
    });

    it("defaults totalItems to 0 when omitted", async () => {
      BatchJob.create.mockResolvedValue({ id: "j5" });
      rabbitmq.assertQueue.mockResolvedValue({});
      rabbitmq.publish.mockResolvedValue(true);
      jest.spyOn(batchJobService, "runJob").mockResolvedValue({});

      await batchJobService.createJob("t1", "u1", "export");

      expect(BatchJob.create.mock.calls[0][0].totalItems).toBe(0);
    });

    it("falls back to inline processing when the broker is unavailable", async () => {
      BatchJob.create.mockResolvedValue({ id: "j3" });
      rabbitmq.assertQueue.mockRejectedValue(new Error("no broker"));
      const runSpy = jest.spyOn(batchJobService, "runJob").mockResolvedValue({});

      await batchJobService.createJob("t1", "u1", "export", 0);
      await flush();

      expect(logger.warn).toHaveBeenCalled();
      expect(runSpy).toHaveBeenCalledWith("j3");
    });

    it("logs but does not throw when the inline job fails", async () => {
      BatchJob.create.mockResolvedValue({ id: "j4" });
      rabbitmq.assertQueue.mockResolvedValue({});
      rabbitmq.publish.mockResolvedValue(false);
      jest.spyOn(batchJobService, "runJob").mockRejectedValue(new Error("kaboom"));

      await expect(
        batchJobService.createJob("t1", "u1", "export", 0),
      ).resolves.toEqual({ id: "j4" });
      await flush();

      expect(logger.error).toHaveBeenCalledWith(
        "Inline batch job failed",
        expect.objectContaining({ jobId: "j4", error: "kaboom" }),
      );
    });
  });

  describe("runJob", () => {
    it("returns null when the job does not exist", async () => {
      BatchJob.findByPk.mockResolvedValue(null);

      const result = await batchJobService.runJob("missing");

      expect(result).toBeNull();
    });

    it("processes and completes a job with no handler", async () => {
      const update = jest.fn().mockResolvedValue(true);
      const job = { id: "j1", type: "notype", update };
      const fresh = { id: "j1", status: "PROCESSING", totalItems: 5, update: jest.fn().mockResolvedValue(true) };
      BatchJob.findByPk.mockResolvedValueOnce(job).mockResolvedValueOnce(fresh);

      const result = await batchJobService.runJob("j1");

      expect(update).toHaveBeenCalledWith({ status: "PROCESSING" });
      expect(fresh.update).toHaveBeenCalledWith({
        status: "COMPLETED",
        progress: 100,
        processedItems: 5,
        resultUrl: "/api/v1/jobs/j1/download",
      });
      expect(result).toBe(fresh);
    });

    it("falls back to processedItems then 0 when totalItems is absent", async () => {
      const job = { type: "notype", update: jest.fn().mockResolvedValue(true) };
      const fresh = { status: "PROCESSING", totalItems: 0, processedItems: 3, update: jest.fn().mockResolvedValue(true) };
      BatchJob.findByPk.mockResolvedValueOnce(job).mockResolvedValueOnce(fresh);

      await batchJobService.runJob("j1");

      expect(fresh.update.mock.calls[0][0].processedItems).toBe(3);

      // And zero when neither is present.
      const job2 = { type: "notype", update: jest.fn().mockResolvedValue(true) };
      const fresh2 = { status: "PROCESSING", update: jest.fn().mockResolvedValue(true) };
      BatchJob.findByPk.mockResolvedValueOnce(job2).mockResolvedValueOnce(fresh2);

      await batchJobService.runJob("j2");

      expect(fresh2.update.mock.calls[0][0].processedItems).toBe(0);
    });

    it("invokes a registered handler for the job type", async () => {
      const handler = jest.fn().mockResolvedValue();
      batchJobService.registerHandler("reindex", handler);
      expect(batchJobService.registeredTypes()).toContain("reindex");

      const job = { type: "reindex", update: jest.fn().mockResolvedValue(true) };
      const fresh = { status: "PROCESSING", totalItems: 1, update: jest.fn().mockResolvedValue(true) };
      BatchJob.findByPk.mockResolvedValueOnce(job).mockResolvedValueOnce(fresh);

      await batchJobService.runJob("j1");

      expect(handler).toHaveBeenCalledWith(job);
    });

    it("does not overwrite a job the handler marked FAILED", async () => {
      const job = { type: "notype", update: jest.fn().mockResolvedValue(true) };
      const fresh = { status: "FAILED", update: jest.fn().mockResolvedValue(true) };
      BatchJob.findByPk.mockResolvedValueOnce(job).mockResolvedValueOnce(fresh);

      const result = await batchJobService.runJob("j1");

      expect(fresh.update).not.toHaveBeenCalled();
      expect(result).toBe(fresh);
    });

    it("tolerates the job vanishing mid-run", async () => {
      const job = { type: "notype", update: jest.fn().mockResolvedValue(true) };
      BatchJob.findByPk.mockResolvedValueOnce(job).mockResolvedValueOnce(null);

      const result = await batchJobService.runJob("j1");

      expect(result).toBeNull();
    });

    it("marks the job FAILED and rethrows on error", async () => {
      const job = { type: "notype", update: jest.fn().mockRejectedValue(new Error("boom")) };
      BatchJob.findByPk.mockResolvedValueOnce(job);
      BatchJob.update.mockResolvedValue([1]);

      await expect(batchJobService.runJob("j1")).rejects.toThrow("boom");
      expect(BatchJob.update).toHaveBeenCalledWith(
        { status: "FAILED", errorDetails: "boom" },
        { where: { id: "j1" } },
      );
    });
  });

  describe("getJobs", () => {
    it("returns paginated jobs", async () => {
      BatchJob.findAndCountAll.mockResolvedValue({ count: 25, rows: [{ id: "j1" }] });

      const result = await batchJobService.getJobs("t1", 2, 10);

      expect(BatchJob.findAndCountAll).toHaveBeenCalledWith({
        where: { tenantId: "t1" },
        limit: 10,
        offset: 10,
        order: [["createdAt", "DESC"]],
      });
      expect(result).toEqual({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
        jobs: [{ id: "j1" }],
      });
    });

    it("defaults page and limit", async () => {
      BatchJob.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      const result = await batchJobService.getJobs("t1");

      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });
  });

  describe("getJobStatus", () => {
    it("returns a job by id", async () => {
      BatchJob.findOne.mockResolvedValue({ id: "j1" });

      const result = await batchJobService.getJobStatus("t1", "j1");

      expect(result).toEqual({ id: "j1" });
    });

    it("throws 404 when the job is not found", async () => {
      BatchJob.findOne.mockResolvedValue(null);

      await expect(batchJobService.getJobStatus("t1", "j1")).rejects.toMatchObject({
        status: 404,
      });
    });
  });
});

describe("batchJobService — inline mode", () => {
  it("skips the queue entirely when BATCH_JOBS_INLINE=true", async () => {
    jest.resetModules();
    process.env.BATCH_JOBS_INLINE = "true";

    jest.doMock("../../models", () => ({
      BatchJob: { create: jest.fn().mockResolvedValue({ id: "j9" }) },
    }));
    const rmq = { assertQueue: jest.fn(), publish: jest.fn() };
    jest.doMock("../../services/rabbitmq.service", () => rmq);
    jest.doMock("../../middlewares/activityLog.middleware", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const svc = require("../../services/batchJob.service");
    const runSpy = jest.spyOn(svc, "runJob").mockResolvedValue({});

    await svc.createJob("t1", "u1", "export", 0);
    await new Promise((r) => setImmediate(r));

    expect(rmq.assertQueue).not.toHaveBeenCalled();
    expect(rmq.publish).not.toHaveBeenCalled();
    expect(runSpy).toHaveBeenCalledWith("j9");

    delete process.env.BATCH_JOBS_INLINE;
  });
});
