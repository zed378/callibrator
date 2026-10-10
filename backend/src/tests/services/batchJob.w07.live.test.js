/**
 * W-07 / W-12 against a REAL PostgreSQL — the batch-job row as the claim.
 *
 * The unit suite (batchJob.service.test.js) proves what runJob does with each
 * UPDATE result. Only a real server proves the UPDATE itself:
 *  - two runners racing on one PENDING row: exactly ONE claims it and runs
 *    the handler; the other gets `ran: false` (a redelivery on a second
 *    replica is a no-op, with or without Redis);
 *  - a runner confined to ANOTHER tenant (W-12) cannot claim the row at all,
 *    and leaves it PENDING — the global isolation hooks add the predicate to
 *    the conditional UPDATE;
 *  - a running job's heartbeat moves `updated_at`, and the abandoned-job sweep
 *    fails a PROCESSING row whose heartbeat stopped, but not a live one.
 *
 * NEEDS a PostgreSQL server where DB_USER may CREATE DATABASE:
 *
 *   DB_HOST=... DB_PORT=... DB_USER=... DB_PASS=... \
 *     npm run test:live:jest -- src/tests/services/batchJob.w07.live
 *
 * ADR-095 follow-up (O-2): the suite builds its OWN database the way the
 * backend boots (db.sync() + every migration, 0091's append-only audit_logs
 * included), then runs as the application role through enterApplicationRole —
 * the boot's own switch and self-check. Its audit rows cannot be deleted, by
 * design, so it does not try: the whole database is dropped afterwards
 * (fixtures/disposableDatabase.ts). DB_NAME is not used.
 */
const { createDisposableDatabase, LIVE_BOOT_TIMEOUT_MS } = require("../fixtures/disposableDatabase");
const { bootSchemaAsApplicationRole } = require("../fixtures/liveBoot");

const TENANT = "b7b7b7b7-0000-4000-8000-0000000000b7";
const OTHER = "b8b8b8b8-0000-4000-8000-0000000000b8";

describe("batch jobs — the row is the claim, live PostgreSQL (W-07, W-12)", () => {
  jest.setTimeout(60000);
  let db;
  let svc;
  const handler = jest.fn();

  let scratch;

  const newJob = async (status = "PENDING") => {
    const id = require("crypto").randomUUID();
    await db.query(
      `INSERT INTO batch_jobs (id, tenant_id, type, status, progress, created_at, updated_at)
       VALUES (:id, :t, 'w07-live', :status, 0, now(), now())`,
      { replacements: { id, t: TENANT, status } },
    );
    return id;
  };

  const rowOf = async (id) =>
    (await db.query("SELECT status, error_details, updated_at FROM batch_jobs WHERE id = :id", { replacements: { id } }))[0][0];

  beforeAll(async () => {
    process.env.BATCH_JOB_HEARTBEAT_MS = "100";
    process.env.BATCH_JOB_STALE_MINUTES = "10";
    scratch = await createDisposableDatabase("w07");
    ({ db } = require("../../config"));
    db.options.logging = false;
    require("../../models");
    await bootSchemaAsApplicationRole(db);
    svc = require("../../services/batchJob.service");
    svc.registerHandler("w07-live", handler);
    for (const [id, sub] of [[TENANT, "w07-live-a"], [OTHER, "w07-live-b"]]) {
      await db.query(
        `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
         VALUES (:id, :sub, :sub, :email, now(), now())`,
        { replacements: { id, sub, email: `${sub}@example.test` } },
      );
    }
    // db.sync() of every model plus every migration can exceed the suite's 60 s.
  }, LIVE_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (db) {
      await db.close();
    }
    if (scratch) {
      await scratch.drop();
    }
  }, LIVE_BOOT_TIMEOUT_MS);

  it("runs as the application role, on a database where audit rows cannot be deleted", async () => {
    const [[row]] = await db.query("SELECT current_user AS u, has_table_privilege('audit_logs', 'DELETE') AS d");
    expect(row).toEqual({ u: "callibrator_app", d: false });
  });

  beforeEach(() => handler.mockReset());

  it("two runners racing on one job: ONE runs it, the other is a no-op", async () => {
    const id = await newJob();
    handler.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { processedItems: 1 };
    });

    const outcomes = await Promise.all([svc.runJob(id, TENANT), svc.runJob(id, TENANT)]);

    expect(outcomes.map((o) => o.ran).sort()).toEqual([false, true]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((await rowOf(id)).status).toBe("COMPLETED");
    // The redelivery of a finished job is a no-op too.
    await expect(svc.runJob(id, TENANT)).resolves.toMatchObject({ ran: false, reason: "job is COMPLETED" });
  });

  it("a runner confined to another tenant cannot claim the job, and leaves it PENDING (W-12)", async () => {
    const id = await newJob();

    await expect(svc.runJob(id, OTHER)).resolves.toEqual({ job: null, ran: false, reason: "job not found" });

    expect(handler).not.toHaveBeenCalled();
    expect((await rowOf(id)).status).toBe("PENDING");
  });

  it("a running job's heartbeat keeps it live; a stopped one is failed by the sweep", async () => {
    const alive = await newJob();
    let finish;
    handler.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const running = svc.runJob(alive, TENANT);
    await new Promise((r) => setTimeout(r, 50));
    const before = (await rowOf(alive)).updated_at;
    await new Promise((r) => setTimeout(r, 350));
    expect((await rowOf(alive)).updated_at.getTime()).toBeGreaterThan(before.getTime());

    const dead = await newJob("PROCESSING");
    await db.query("UPDATE batch_jobs SET updated_at = now() - interval '11 minutes' WHERE id = :id", {
      replacements: { id: dead },
    });

    await expect(svc.failAbandonedJobs()).resolves.toBeGreaterThanOrEqual(1);

    expect(await rowOf(dead)).toMatchObject({ status: "FAILED", error_details: expect.stringMatching(/^Interrupted/) });
    expect((await rowOf(alive)).status).toBe("PROCESSING");
    finish({});
    await running;
    expect((await rowOf(alive)).status).toBe("COMPLETED");
  });
});
