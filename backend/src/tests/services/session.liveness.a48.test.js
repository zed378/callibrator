/**
 * A-48 — session.service liveness cache: the branches the request-path seam
 * test (middlewares/auth.sessionRevocation.a48.test.js) does not reach.
 */

jest.mock("../../models", () => ({
  Sessions: { findOne: jest.fn(), update: jest.fn() },
}));

jest.mock("../../services/redis.service", () => ({
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(true),
  del: jest.fn().mockResolvedValue(true),
}));

const { Sessions } = require("../../models");
const redis = require("../../services/redis.service");
const {
  isSessionLive,
  livenessKey,
  registerLivenessInvalidation,
  runWithSession,
  getCurrentSessionId,
} = require("../../services/session.service");

const fakeModel = () => {
  const hooks = {};
  const model = {
    addHook: jest.fn((type, name, fn) => {
      hooks[type] = fn;
    }),
    unscoped: jest.fn(() => model),
    findAll: jest.fn(),
  };
  return { model, hooks };
};

describe("isSessionLive", () => {
  it("ignores a cache value that is not an entry and reads the database", async () => {
    redis.get.mockResolvedValue("garbage");
    Sessions.findOne.mockResolvedValue({
      id: "s1",
      user_id: "u1",
      expired_at: new Date(Date.now() + 3600 * 1000),
    });

    await expect(isSessionLive("s1", "u1")).resolves.toBe(true);
    expect(Sessions.findOne).toHaveBeenCalledWith({
      where: { id: "s1", is_revoked: false, is_active: true },
      attributes: ["id", "user_id", "expired_at"],
      skipTenantScope: true,
    });
  });

  it("caches a missing or revoked session as revoked, and answers false from the cache after", async () => {
    redis.get.mockResolvedValueOnce(null);
    Sessions.findOne.mockResolvedValue(null);

    await expect(isSessionLive("s2", "u1")).resolves.toBe(false);
    expect(redis.set).toHaveBeenCalledWith(livenessKey("s2"), { revoked: true }, 60);

    redis.get.mockResolvedValueOnce({ revoked: true });
    Sessions.findOne.mockClear();
    await expect(isSessionLive("s2", "u1")).resolves.toBe(false);
    expect(Sessions.findOne).not.toHaveBeenCalled();
  });

  it("caches a session that expires sooner than the TTL only until it expires", async () => {
    redis.get.mockResolvedValue(null);
    Sessions.findOne.mockResolvedValue({
      id: "s3",
      user_id: "u1",
      expired_at: new Date(Date.now() + 10 * 1000),
    });

    await expect(isSessionLive("s3", "u1")).resolves.toBe(true);
    const ttl = redis.set.mock.calls[0][2];
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10);
  });
});

describe("registerLivenessInvalidation", () => {
  it("does nothing for a model that cannot take hooks", () => {
    expect(registerLivenessInvalidation(null)).toBe(false);
    expect(registerLivenessInvalidation({})).toBe(false);
  });

  it("inside a transaction, clears the entry only after commit", async () => {
    const { model, hooks } = fakeModel();
    expect(registerLivenessInvalidation(model)).toBe(true);

    let commit;
    const transaction = {
      afterCommit: jest.fn((fn) => {
        commit = fn;
      }),
    };
    await hooks.afterUpdate({ id: "s1" }, { transaction });
    expect(redis.del).not.toHaveBeenCalled();

    await commit();
    expect(redis.del).toHaveBeenCalledWith(livenessKey("s1"));
  });

  it("a bulk update clears exactly the rows it matched before it ran", async () => {
    const { model, hooks } = fakeModel();
    registerLivenessInvalidation(model);
    model.findAll.mockResolvedValue([{ id: "s1" }, { id: "s2" }]);

    const options = { where: { user_id: "u1", is_revoked: false } };
    await hooks.beforeBulkUpdate(options);
    expect(model.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: options.where, skipTenantScope: true, raw: true }),
    );
    await hooks.afterBulkUpdate(options);

    expect(redis.del.mock.calls.map(([k]) => k)).toEqual([
      livenessKey("s1"),
      livenessKey("s2"),
    ]);
  });

  it("a bulk update whose capture never ran clears nothing", async () => {
    const { model, hooks } = fakeModel();
    registerLivenessInvalidation(model);

    await hooks.afterBulkUpdate({ where: { id: "s1" } });
    expect(redis.del).not.toHaveBeenCalled();
  });

  it("clears the entry when a session is destroyed", async () => {
    const { model, hooks } = fakeModel();
    registerLivenessInvalidation(model);

    await hooks.afterDestroy({ id: "s9" }, {});
    expect(redis.del).toHaveBeenCalledWith(livenessKey("s9"));
  });
});

describe("request session context", () => {
  it("is null outside a request, and inside one that carries no session", () => {
    expect(getCurrentSessionId()).toBeNull();
    expect(runWithSession(null, () => getCurrentSessionId())).toBeNull();
    expect(runWithSession("s1", () => getCurrentSessionId())).toBe("s1");
  });
});
