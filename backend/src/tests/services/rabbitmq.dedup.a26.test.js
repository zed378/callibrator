/**
 * A-26 — nothing deduplicated at-least-once delivery.
 *
 * `claimMessage` is the primitive both consumers use: a Redis `SET NX EX` on a
 * message identity taken before the side effect, released if the side effect
 * failed.
 *
 * The two failure modes that must NOT be conflated are the reason this does
 * not reuse `redis.service#acquireLock`: that helper returns `null` both when
 * the claim is held and when Redis is unreachable. Here, a held claim means
 * "skip the work" and an unreachable Redis means "do the work anyway".
 */

jest.mock("../../services/redis.service", () => ({
  getRedisConnection: jest.fn(),
  del: jest.fn(),
}));
jest.mock("amqplib", () => ({ connect: jest.fn() }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const redis = require("../../services/redis.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const rabbitmq = require("../../services/rabbitmq.service");

/** An ioredis stand-in. Readiness is `status`; ioredis has no `.connected`. */
const readyClient = () => ({ status: "ready", set: jest.fn() });

describe("rabbitmq.claimMessage (A-26)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redis.del.mockResolvedValue(true);
  });

  it("claims an identity with SET NX EX and lets the first delivery through", async () => {
    const client = readyClient();
    client.set.mockResolvedValue("OK");
    redis.getRedisConnection.mockReturnValue(client);

    const claim = await rabbitmq.claimMessage("email:job-1");

    expect(claim.claimed).toBe(true);
    expect(claim.deduplicated).toBe(true);
    expect(client.set).toHaveBeenCalledWith(
      "dedup:msg:email:job-1",
      "1",
      "EX",
      rabbitmq.DEDUP_TTL_SECONDS,
      "NX",
    );
  });

  it("refuses the claim when the identity was already processed", async () => {
    const client = readyClient();
    client.set.mockResolvedValue(null); // SET NX lost the race
    redis.getRedisConnection.mockReturnValue(client);

    const claim = await rabbitmq.claimMessage("email:job-1");

    expect(claim.claimed).toBe(false);
    expect(claim.deduplicated).toBe(true);
  });

  it("honours an explicit TTL", async () => {
    const client = readyClient();
    client.set.mockResolvedValue("OK");
    redis.getRedisConnection.mockReturnValue(client);

    await rabbitmq.claimMessage("batch:job-1", 60);

    expect(client.set).toHaveBeenCalledWith(
      "dedup:msg:batch:job-1",
      "1",
      "EX",
      60,
      "NX",
    );
  });

  it("releases a held claim by deleting the key", async () => {
    const client = readyClient();
    client.set.mockResolvedValue("OK");
    redis.getRedisConnection.mockReturnValue(client);

    const claim = await rabbitmq.claimMessage("email:job-1");
    await claim.release();

    expect(redis.del).toHaveBeenCalledWith("dedup:msg:email:job-1");
  });

  it("FAILS OPEN when the Redis client is not ready — the work still happens", async () => {
    redis.getRedisConnection.mockReturnValue({ status: "wait", set: jest.fn() });

    const claim = await rabbitmq.claimMessage("email:job-1");

    expect(claim.claimed).toBe(true);
    // Says plainly that nothing was deduplicated; it does not pretend.
    expect(claim.deduplicated).toBe(false);
    expect(await claim.release()).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      "Dedup store unavailable; processing without deduplication",
      { key: "dedup:msg:email:job-1" },
    );
  });

  it("fails open when there is no Redis client at all", async () => {
    redis.getRedisConnection.mockReturnValue(null);

    const claim = await rabbitmq.claimMessage("email:job-1");

    expect(claim).toMatchObject({ claimed: true, deduplicated: false });
  });

  it("fails open when the SET itself throws", async () => {
    const client = readyClient();
    client.set.mockRejectedValue(new Error("READONLY"));
    redis.getRedisConnection.mockReturnValue(client);

    const claim = await rabbitmq.claimMessage("email:job-1");

    expect(claim).toMatchObject({ claimed: true, deduplicated: false });
    expect(logger.error).toHaveBeenCalledWith(
      "Dedup claim failed; processing without deduplication",
      { key: "dedup:msg:email:job-1", error: "READONLY" },
    );
  });
});
