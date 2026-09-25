/**
 * batchJob.service — the durable queue, the typed-handler registry, and the
 * job row as the claim (W-07, W-08, W-12).
 *
 * The contract this file holds the service to:
 *  - W-08: there is NO default handler. An unregistered type is refused at
 *    create (400) and, if one is queued anyway, ends FAILED with a reason.
 *    `resultUrl` and `processedItems` come only from what the handler returns;
 *    nothing is copied from the caller's `totalItems`.
 *  - W-07: the claim is the row's atomic PENDING -> PROCESSING update; a lost
 *    claim is a no-op (`ran: false`), a running job heartbeats its row, and the
 *    sweep / shutdown fail PROCESSING rows whose worker is gone.
 *  - W-12: a job runs in ITS tenant's context (the tenant its message carries),
 *    and each cross-tenant sweep is an explicit, named runAsSystem.
 *
 * The previous version of this file asserted the opposite of W-08 — a job with
 * no handler "processes and completes", with a resultUrl to a download route
 * that does not exist — and is replaced, not patched.
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

// W-04: every state change and its audit row are one transaction.
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb) => cb("TX")) },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));

const { Op } = require("sequelize");
const batchJobService = require("../../services/batchJob.service");
const { BatchJob } = require("../../models");
const rabbitmq = require("../../services/rabbitmq.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const auditService = require("../../services/audit.service");

const flush = () => new Promise((resolve) => setImmediate(resolve));

const TENANT = "tenant-1";

/** A row double with the instance update the service calls. */
const row = (fields) => {
  const r = { ...fields };
  r.update = jest.fn(async (patch) => Object.assign(r, patch));
  return r;
};

// One registered type for the whole file: the registry is module state.
const handler = jest.fn();
batchJobService.registerHandler("export", handler);

describe("batchJobService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    handler.mockReset();
  });

  describe("registry (W-08)", () => {
    it("lists the registered types", () => {
      expect(batchJobService.registeredTypes()).toEqual(["export"]);
    });
  });

  describe("createJob", () => {
    it("refuses an unregistered type with 400 and creates nothing", async () => {
      await expect(batchJobService.createJob(TENANT, "u1", "reindex", 5)).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('Unknown batch job type "reindex". Registered types: export.'),
      });
      expect(BatchJob.create).not.toHaveBeenCalled();
      expect(rabbitmq.publish).not.toHaveBeenCalled();
    });

    it("says so when no type is registered at all", async () => {
      let fresh;
      jest.isolateModules(() => {
        fresh = require("../../services/batchJob.service");
      });
      await expect(fresh.createJob(TENANT, "u1", "export")).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("No batch job types are available on this server."),
      });
    });

    it("publishes to the queue and does not process inline", async () => {
      BatchJob.create.mockResolvedValue({ id: "j1" });
      rabbitmq.assertQueue.mockResolvedValue({});
      rabbitmq.publish.mockResolvedValue(true);
      const runSpy = jest.spyOn(batchJobService, "runJob").mockResolvedValue({});

      const job = await batchJobService.createJob(TENANT, "u1", "export", 5);

      expect(BatchJob.create).toHaveBeenCalledWith({
        tenantId: TENANT,
        userId: "u1",
        type: "export",
        status: "PENDING",
        progress: 0,
        totalItems: 5,
      });
      expect(rabbitmq.assertQueue).toHaveBeenCalledWith("batch_jobs", "batch_jobs_dlq");
      expect(rabbitmq.publish).toHaveBeenCalledWith("batch_jobs", { jobId: "j1", tenantId: TENANT, type: "export" });
      expect(runSpy).not.toHaveBeenCalled();
      expect(job).toEqual({ id: "j1" });
    });

    it("defaults totalItems to 0 when omitted", async () => {
      BatchJob.create.mockResolvedValue({ id: "j5" });
      rabbitmq.assertQueue.mockResolvedValue({});
      rabbitmq.publish.mockResolvedValue(true);

      await batchJobService.createJob(TENANT, "u1", "export");

      expect(BatchJob.create.mock.calls[0][0].totalItems).toBe(0);
    });

    it("runs inline, in the job's tenant, when publish returns false", async () => {
      BatchJob.create.mockResolvedValue({ id: "j2" });
      rabbitmq.assertQueue.mockResolvedValue({});
      rabbitmq.publish.mockResolvedValue(false);
      const runSpy = jest.spyOn(batchJobService, "runJob").mockResolvedValue({});

      await batchJobService.createJob(TENANT, "u1", "export", 0);
      await flush();

      expect(runSpy).toHaveBeenCalledWith("j2", TENANT);
    });

    it("runs inline when the broker is unavailable, and warns", async () => {
      BatchJob.create.mockResolvedValue({ id: "j3" });
      rabbitmq.assertQueue.mockRejectedValue(new Error("no broker"));
      const runSpy = jest.spyOn(batchJobService, "runJob").mockResolvedValue({});

      await batchJobService.createJob(TENANT, "u1", "export", 0);
      await flush();

      expect(logger.warn).toHaveBeenCalledWith("Batch queue unavailable; processing job inline", {
        jobId: "j3",
        error: "no broker",
      });
      expect(runSpy).toHaveBeenCalledWith("j3", TENANT);
    });

    it("logs but does not throw when the inline job fails", async () => {
      BatchJob.create.mockResolvedValue({ id: "j4" });
      rabbitmq.assertQueue.mockResolvedValue({});
      rabbitmq.publish.mockResolvedValue(false);
      jest.spyOn(batchJobService, "runJob").mockRejectedValue(new Error("kaboom"));

      await expect(batchJobService.createJob(TENANT, "u1", "export", 0)).resolves.toEqual({ id: "j4" });
      await flush();

      expect(logger.error).toHaveBeenCalledWith(
        "Inline batch job failed",
        expect.objectContaining({ jobId: "j4", error: "kaboom" }),
      );
    });
  });

  describe("runJob", () => {
    it("refuses a message with no tenantId rather than run it unscoped (W-12)", async () => {
      await expect(batchJobService.runJob("j1")).rejects.toThrow(/carries no tenantId/);
      expect(BatchJob.update).not.toHaveBeenCalled();
    });

    it("claims PENDING -> PROCESSING atomically, inside the job's tenant context", async () => {
      const contexts = [];
      BatchJob.update.mockImplementation(async () => {
        contexts.push(tenantStorage.getStore());
        return [1];
      });
      const fresh = row({ id: "j1", status: "PROCESSING", processedItems: 0 });
      BatchJob.findByPk.mockResolvedValueOnce(row({ id: "j1", type: "export" })).mockResolvedValueOnce(fresh);
      handler.mockResolvedValue({ processedItems: 7, resultUrl: "/files/j1.csv" });

      const outcome = await batchJobService.runJob("j1", TENANT);

      expect(BatchJob.update).toHaveBeenCalledWith(
        { status: "PROCESSING" },
        { where: { id: "j1", status: "PENDING" }, transaction: "TX" },
      );
      expect(contexts[0]).toEqual({ tenantId: TENANT, isSuperAdmin: false, isSystemTask: false });
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: "j1", type: "export" }));
      expect(fresh.update).toHaveBeenCalledWith(
        {
          status: "COMPLETED",
          progress: 100,
          processedItems: 7,
          resultUrl: "/files/j1.csv",
        },
        { transaction: "TX" },
      );
      expect(outcome).toEqual({ job: fresh, ran: true });
    });

    it("a lost claim is a no-op that says why (W-07: a redelivery of a started job)", async () => {
      BatchJob.update.mockResolvedValue([0]);
      BatchJob.findByPk.mockResolvedValueOnce(row({ id: "j1", status: "COMPLETED" }));

      const outcome = await batchJobService.runJob("j1", TENANT);

      expect(outcome).toEqual({ job: expect.objectContaining({ id: "j1" }), ran: false, reason: "job is COMPLETED" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("a lost claim on a missing row (another tenant's, or deleted) says 'job not found'", async () => {
      BatchJob.update.mockResolvedValue([0]);
      BatchJob.findByPk.mockResolvedValueOnce(null);

      await expect(batchJobService.runJob("j1", TENANT)).resolves.toEqual({
        job: null,
        ran: false,
        reason: "job not found",
      });
    });

    it("a queued job of an unregistered type ends FAILED with the reason, never COMPLETED (W-08)", async () => {
      BatchJob.update.mockResolvedValue([1]);
      const failed = row({ id: "j1", status: "FAILED" });
      BatchJob.findByPk.mockResolvedValueOnce(row({ id: "j1", type: "legacy" })).mockResolvedValueOnce(failed);

      const outcome = await batchJobService.runJob("j1", TENANT);

      const reason = 'No handler is registered for batch job type "legacy"; nothing was processed.';
      expect(BatchJob.update).toHaveBeenLastCalledWith(
        { status: "FAILED", errorDetails: reason },
        { where: { id: "j1", status: "PROCESSING" }, transaction: "TX" },
      );
      expect(outcome).toEqual({ job: failed, ran: false, reason });
      expect(BatchJob.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: "COMPLETED" }), expect.anything());
    });

    it("a handler that returns nothing leaves processedItems as the handler set it and no resultUrl (W-08)", async () => {
      BatchJob.update.mockResolvedValue([1]);
      const fresh = row({ status: "PROCESSING", processedItems: 3, totalItems: 50 });
      BatchJob.findByPk.mockResolvedValueOnce(row({ type: "export" })).mockResolvedValueOnce(fresh);
      handler.mockResolvedValue(undefined);

      await batchJobService.runJob("j1", TENANT);

      expect(fresh.update).toHaveBeenCalledWith(
        {
          status: "COMPLETED",
          progress: 100,
          processedItems: 3,
          resultUrl: null,
        },
        { transaction: "TX" },
      );
    });

    it("ignores a non-integer processedItems from the handler", async () => {
      BatchJob.update.mockResolvedValue([1]);
      const fresh = row({ status: "PROCESSING", processedItems: 2 });
      BatchJob.findByPk.mockResolvedValueOnce(row({ type: "export" })).mockResolvedValueOnce(fresh);
      handler.mockResolvedValue({ processedItems: "lots" });

      await batchJobService.runJob("j1", TENANT);

      expect(fresh.update.mock.calls[0][0].processedItems).toBe(2);
    });

    it("does not overwrite a job the handler marked FAILED", async () => {
      BatchJob.update.mockResolvedValue([1]);
      const fresh = row({ status: "FAILED" });
      BatchJob.findByPk.mockResolvedValueOnce(row({ type: "export" })).mockResolvedValueOnce(fresh);
      handler.mockResolvedValue({ processedItems: 1 });

      const outcome = await batchJobService.runJob("j1", TENANT);

      expect(fresh.update).not.toHaveBeenCalled();
      expect(outcome).toEqual({ job: fresh, ran: true });
    });

    it("tolerates the row vanishing while the handler ran", async () => {
      BatchJob.update.mockResolvedValue([1]);
      BatchJob.findByPk.mockResolvedValueOnce(row({ type: "export" })).mockResolvedValueOnce(null);
      handler.mockResolvedValue({});

      await expect(batchJobService.runJob("j1", TENANT)).resolves.toEqual({ job: null, ran: true });
    });

    it("marks the job FAILED with the handler's message and rethrows", async () => {
      BatchJob.update.mockResolvedValue([1]);
      BatchJob.findByPk.mockResolvedValueOnce(row({ type: "export" }));
      handler.mockRejectedValue(new Error("boom"));

      await expect(batchJobService.runJob("j1", TENANT)).rejects.toThrow("boom");
      expect(BatchJob.update).toHaveBeenLastCalledWith(
        { status: "FAILED", errorDetails: "boom" },
        { where: { id: "j1", status: "PROCESSING" }, transaction: "TX" },
      );
      expect(logger.error).toHaveBeenCalledWith("Batch job failed", { jobId: "j1", error: "boom" });
    });

    describe("heartbeat (W-07)", () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it("touches the PROCESSING row while the handler runs, and stops when it ends", async () => {
        BatchJob.update.mockResolvedValue([1]);
        const fresh = row({ status: "PROCESSING" });
        BatchJob.findByPk.mockResolvedValueOnce(row({ type: "export" })).mockResolvedValueOnce(fresh);
        let finish;
        handler.mockImplementation(() => new Promise((resolve) => (finish = resolve)));

        const running = batchJobService.runJob("j1", TENANT);
        await jest.advanceTimersByTimeAsync(0);
        expect(handler).toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(60 * 1000 * 2);
        const heartbeats = BatchJob.update.mock.calls.filter(
          ([, opts]) => opts.where.status === "PROCESSING",
        );
        expect(heartbeats).toHaveLength(2);
        expect(heartbeats[0]).toEqual([{ status: "PROCESSING" }, { where: { id: "j1", status: "PROCESSING" } }]);

        finish({});
        await running;
        const after = BatchJob.update.mock.calls.length;
        await jest.advanceTimersByTimeAsync(60 * 1000 * 5);
        expect(BatchJob.update.mock.calls.length).toBe(after);
      });

      it("a failed heartbeat is a warning, not a failed job", async () => {
        BatchJob.update.mockResolvedValueOnce([1]).mockRejectedValueOnce(new Error("db blip"));
        const fresh = row({ status: "PROCESSING" });
        BatchJob.findByPk.mockResolvedValueOnce(row({ type: "export" })).mockResolvedValueOnce(fresh);
        let finish;
        handler.mockImplementation(() => new Promise((resolve) => (finish = resolve)));

        const running = batchJobService.runJob("j1", TENANT);
        await jest.advanceTimersByTimeAsync(60 * 1000);
        finish({});
        await running;

        expect(logger.warn).toHaveBeenCalledWith("Batch job heartbeat failed", { jobId: "j1", error: "db blip" });
        expect(fresh.update).toHaveBeenCalledWith(expect.objectContaining({ status: "COMPLETED" }), { transaction: "TX" });
      });
    });
  });

  describe("W-04 — every state change writes one audit row, in its transaction", () => {
    const entry = (from, to, extra = {}) => ({
      tenantId: TENANT,
      systemActor: "system:batch-job",
      action: "UPDATE",
      resourceType: "BatchJob",
      resourceId: "j1",
      changes: {
        operation: "BATCH_JOB_STATE",
        type: "export",
        requestedBy: "u1",
        before: { status: from },
        after: { status: to },
        ...extra,
      },
    });

    it("a completed job: PENDING -> PROCESSING and PROCESSING -> COMPLETED, naming the job and who asked", async () => {
      BatchJob.update.mockResolvedValue([1]);
      const fresh = row({ id: "j1", status: "PROCESSING" });
      BatchJob.findByPk
        .mockResolvedValueOnce(row({ id: "j1", tenantId: TENANT, type: "export", userId: "u1" }))
        .mockResolvedValueOnce(fresh);
      handler.mockResolvedValue({});

      await batchJobService.runJob("j1", TENANT);

      expect(auditService.logAction.mock.calls).toEqual([
        [entry("PENDING", "PROCESSING"), { transaction: "TX" }],
        [entry("PROCESSING", "COMPLETED"), { transaction: "TX" }],
      ]);
    });

    it("a failed job's audit row carries the reason", async () => {
      BatchJob.update.mockResolvedValue([1]);
      BatchJob.findByPk.mockResolvedValueOnce(row({ id: "j1", tenantId: TENANT, type: "export", userId: "u1" }));
      handler.mockRejectedValue(new Error("boom"));

      await expect(batchJobService.runJob("j1", TENANT)).rejects.toThrow("boom");

      expect(auditService.logAction).toHaveBeenLastCalledWith(
        entry("PROCESSING", "FAILED", { reason: "boom" }),
        { transaction: "TX" },
      );
    });

    it("a lost claim writes no audit row", async () => {
      BatchJob.update.mockResolvedValue([0]);
      BatchJob.findByPk.mockResolvedValueOnce(row({ id: "j1", status: "COMPLETED" }));

      await batchJobService.runJob("j1", TENANT);

      expect(auditService.logAction).not.toHaveBeenCalled();
    });

    it("a job the sweep already failed is not failed, or audited, a second time", async () => {
      BatchJob.update.mockResolvedValueOnce([1]).mockResolvedValueOnce([0]);
      BatchJob.findByPk.mockResolvedValueOnce(row({ id: "j1", tenantId: TENANT, type: "export" }));
      handler.mockRejectedValue(new Error("late"));

      await expect(batchJobService.runJob("j1", TENANT)).rejects.toThrow("late");

      // Only the claim was audited; its row names no requester.
      expect(auditService.logAction).toHaveBeenCalledTimes(1);
      expect(auditService.logAction.mock.calls[0][0].changes.requestedBy).toBeNull();
    });

    it("a failed audit insert fails the claim, and the handler never runs", async () => {
      BatchJob.update.mockResolvedValue([1]);
      BatchJob.findByPk.mockResolvedValueOnce(row({ id: "j1", tenantId: TENANT }));
      auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

      await expect(batchJobService.runJob("j1", TENANT)).rejects.toThrow("audit insert failed");
      expect(handler).not.toHaveBeenCalled();
    });

    it("the abandoned-job sweep audits each failed row in ITS OWN tenant", async () => {
      BatchJob.update.mockResolvedValue([
        2,
        [{ id: "j1", tenantId: "t1", type: "export", userId: "u1" }, { id: "j2", tenantId: "t2" }],
      ]);

      await batchJobService.failAbandonedJobs(new Date("2026-09-25T12:00:00Z"));

      expect(BatchJob.update.mock.calls[0][1]).toMatchObject({ returning: true, transaction: "TX" });
      const rows = auditService.logAction.mock.calls.map(([e]) => [e.tenantId, e.resourceId, e.changes.after.status]);
      expect(rows).toEqual([
        ["t1", "j1", "FAILED"],
        ["t2", "j2", "FAILED"],
      ]);
      expect(auditService.logAction.mock.calls[1][0].changes).toMatchObject({ type: null, requestedBy: null });
      expect(auditService.logAction.mock.calls[0][0].changes.reason).toMatch(/^Interrupted/);
    });

    it("the shutdown path audits the jobs it failed", async () => {
      BatchJob.update.mockResolvedValue([1, [{ id: "j1", tenantId: "t1", type: "export", userId: "u1" }]]);

      await batchJobService.failInterruptedJobs(["j1"]);

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "t1", resourceId: "j1", systemActor: "system:batch-job" }),
        { transaction: "TX" },
      );
    });
  });

  describe("failAbandonedJobs (W-07)", () => {
    it("fails PROCESSING rows untouched for STALE_MINUTES, as a named system task", async () => {
      let context;
      BatchJob.update.mockImplementation(async () => {
        context = tenantStorage.getStore();
        return [2, [{ id: "j1", tenantId: "t1", type: "export", userId: "u1" }, { id: "j2", tenantId: "t2" }]];
      });
      const now = new Date("2026-09-25T12:00:00Z");

      await expect(batchJobService.failAbandonedJobs(now)).resolves.toBe(2);

      const [values, options] = BatchJob.update.mock.calls[0];
      expect(values.status).toBe("FAILED");
      expect(values.errorDetails).toMatch(/^Interrupted: the worker running this job stopped/);
      expect(options.where.status).toBe("PROCESSING");
      expect(options.where.updatedAt[Op.lt]).toEqual(
        new Date(now.getTime() - batchJobService.STALE_MINUTES * 60 * 1000),
      );
      expect(context).toMatchObject({ isSystemTask: true, isSuperAdmin: false, systemReason: expect.any(String) });
      expect(logger.warn).toHaveBeenCalledWith("Failed 2 abandoned batch job(s) stuck in PROCESSING");
    });

    it("is silent when nothing is stale, and defaults `now`", async () => {
      BatchJob.update.mockResolvedValue([0, []]);

      await expect(batchJobService.failAbandonedJobs()).resolves.toBe(0);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("failInterruptedJobs (W-07)", () => {
    it("fails only the given jobs still PROCESSING", async () => {
      BatchJob.update.mockResolvedValue([1, [{ id: "j1", tenantId: "t1", type: "export", userId: "u1" }]]);

      await expect(batchJobService.failInterruptedJobs(["j1", "j2"])).resolves.toBe(1);

      const [values, options] = BatchJob.update.mock.calls[0];
      expect(values).toEqual({ status: "FAILED", errorDetails: expect.stringMatching(/server shut down/) });
      expect(options.where).toEqual({ id: { [Op.in]: ["j1", "j2"] }, status: "PROCESSING" });
    });

    it("does nothing for an empty list", async () => {
      await expect(batchJobService.failInterruptedJobs([])).resolves.toBe(0);
      expect(BatchJob.update).not.toHaveBeenCalled();
    });
  });

  describe("getJobs", () => {
    it("returns paginated jobs", async () => {
      BatchJob.findAndCountAll.mockResolvedValue({ count: 25, rows: [{ id: "j1" }] });

      const result = await batchJobService.getJobs(TENANT, 2, 10);

      expect(BatchJob.findAndCountAll).toHaveBeenCalledWith({
        where: { tenantId: TENANT },
        limit: 10,
        offset: 10,
        order: [["createdAt", "DESC"]],
      });
      expect(result).toEqual({ total: 25, page: 2, limit: 10, totalPages: 3, jobs: [{ id: "j1" }] });
    });

    it("defaults page and limit", async () => {
      BatchJob.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      const result = await batchJobService.getJobs(TENANT);

      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });
  });

  describe("getJobStatus", () => {
    it("returns a job by id", async () => {
      BatchJob.findOne.mockResolvedValue({ id: "j1" });

      await expect(batchJobService.getJobStatus(TENANT, "j1")).resolves.toEqual({ id: "j1" });
    });

    it("throws 404 when the job is not found", async () => {
      BatchJob.findOne.mockResolvedValue(null);

      await expect(batchJobService.getJobStatus(TENANT, "j1")).rejects.toMatchObject({ status: 404 });
    });
  });
});

describe("batchJobService — environment", () => {
  afterEach(() => {
    delete process.env.BATCH_JOBS_INLINE;
    delete process.env.BATCH_JOB_STALE_MINUTES;
  });

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
    svc.registerHandler("export", jest.fn());
    const runSpy = jest.spyOn(svc, "runJob").mockResolvedValue({});

    await svc.createJob(TENANT, "u1", "export", 0);
    await new Promise((r) => setImmediate(r));

    expect(rmq.assertQueue).not.toHaveBeenCalled();
    expect(rmq.publish).not.toHaveBeenCalled();
    expect(runSpy).toHaveBeenCalledWith("j9", TENANT);
  });

  it("reads BATCH_JOB_STALE_MINUTES", () => {
    jest.resetModules();
    process.env.BATCH_JOB_STALE_MINUTES = "25";
    const svc = require("../../services/batchJob.service");
    expect(svc.STALE_MINUTES).toBe(25);
  });
});
