jest.mock("../../models", () => ({
  ApiKey: {
    create: jest.fn(),
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
  },
  Tenant: {},
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const crypto = require("crypto");
const apiKeyService = require("../../services/apiKey.service");
const { ApiKey } = require("../../models");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../../constants");

describe("apiKey.service", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("scopeAllows", () => {
    const { scopeAllows } = apiKeyService;

    it("'*' allows everything", () => {
      expect(scopeAllows(["*"], "calibration", "write")).toBe(true);
    });
    it("resource:read allows read only", () => {
      expect(scopeAllows(["calibration:read"], "calibration", "read")).toBe(true);
      expect(scopeAllows(["calibration:read"], "calibration", "write")).toBe(false);
    });
    it("resource:write implies read", () => {
      expect(scopeAllows(["calibration:write"], "calibration", "read")).toBe(true);
      expect(scopeAllows(["calibration:write"], "calibration", "write")).toBe(true);
    });
    it("resource:* allows both actions", () => {
      expect(scopeAllows(["calibration:*"], "calibration", "write")).toBe(true);
    });
    it("*:read allows read on any resource but not write", () => {
      expect(scopeAllows(["*:read"], "anything", "read")).toBe(true);
      expect(scopeAllows(["*:read"], "anything", "write")).toBe(false);
    });
    it("bare resource implies write", () => {
      expect(scopeAllows(["calibration"], "calibration", "write")).toBe(true);
    });
    it("is case-insensitive on the resource", () => {
      expect(scopeAllows(["Calibration:read"], "calibration", "read")).toBe(true);
    });
    it("denies an unrelated resource", () => {
      expect(scopeAllows(["certificate:read"], "calibration", "read")).toBe(false);
    });
    it("handles a non-array scopes value", () => {
      expect(scopeAllows(null, "x", "read")).toBe(false);
    });
  });

  describe("createApiKey", () => {
    it("returns the raw key once and persists only a hash + prefix", async () => {
      ApiKey.create.mockImplementation(async (v) => ({ ...v, id: "k1", createdAt: new Date() }));
      const res = await apiKeyService.createApiKey("t1", { name: "n", scopes: ["*"], createdBy: "u1" });
      expect(res.key).toMatch(/^cbk_/);
      expect(res.keyPrefix).toMatch(/^cbk_/);
      const created = ApiKey.create.mock.calls[0][0];
      expect(created.keyHash).toHaveLength(64);
      expect(created.keyHash).not.toContain(res.key);
    });
    it("throws 400 without a name", async () => {
      await expect(apiKeyService.createApiKey("t1", { scopes: ["*"] })).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("verifyApiKey", () => {
    it("returns null for a non-cbk key", async () => {
      expect(await apiKeyService.verifyApiKey("xyz")).toBeNull();
    });
    it("returns null when not found", async () => {
      ApiKey.findOne.mockResolvedValue(null);
      expect(await apiKeyService.verifyApiKey("cbk_abc")).toBeNull();
    });
    it("returns null when inactive", async () => {
      ApiKey.findOne.mockResolvedValue({ isActive: false });
      expect(await apiKeyService.verifyApiKey("cbk_abc")).toBeNull();
    });
    it("returns null when expired", async () => {
      ApiKey.findOne.mockResolvedValue({ isActive: true, expiresAt: new Date(Date.now() - 1000) });
      expect(await apiKeyService.verifyApiKey("cbk_abc")).toBeNull();
    });
    it("returns the key when valid and refreshes lastUsedAt", async () => {
      const update = jest.fn().mockResolvedValue();
      ApiKey.findOne.mockResolvedValue({ isActive: true, expiresAt: null, lastUsedAt: null, scopes: ["*"], update });
      const key = await apiKeyService.verifyApiKey("cbk_abc");
      expect(key).toBeTruthy();
      expect(update).toHaveBeenCalled();
    });

    it("returns null for an empty key without querying the database", async () => {
      expect(await apiKeyService.verifyApiKey("")).toBeNull();
      expect(await apiKeyService.verifyApiKey(null)).toBeNull();
      expect(ApiKey.findOne).not.toHaveBeenCalled();
    });

    it("looks the key up by its sha-256 hash, never by the raw value", async () => {
      const raw = "cbk_abc";
      const expectedHash = crypto.createHash("sha256").update(raw).digest("hex");
      ApiKey.findOne.mockResolvedValue(null);

      await apiKeyService.verifyApiKey(raw);

      expect(ApiKey.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { keyHash: expectedHash } }),
      );
    });

    it("accepts a not-yet-expired key", async () => {
      const update = jest.fn().mockResolvedValue();
      ApiKey.findOne.mockResolvedValue({
        id: "k1",
        isActive: true,
        expiresAt: new Date(Date.now() + 60_000),
        lastUsedAt: null,
        update,
      });
      const key = await apiKeyService.verifyApiKey("cbk_abc");
      expect(key).toMatchObject({ id: "k1" });
    });

    it("throttles the lastUsedAt refresh when it was updated recently", async () => {
      const update = jest.fn().mockResolvedValue();
      ApiKey.findOne.mockResolvedValue({
        isActive: true,
        expiresAt: null,
        lastUsedAt: new Date(),
        update,
      });
      const key = await apiKeyService.verifyApiKey("cbk_abc");
      expect(key).toBeTruthy();
      expect(update).not.toHaveBeenCalled();
    });

    it("still authenticates when the best-effort lastUsedAt write rejects", async () => {
      const update = jest.fn().mockRejectedValue(new Error("db down"));
      ApiKey.findOne.mockResolvedValue({ id: "k1", isActive: true, expiresAt: null, lastUsedAt: null, update });

      const key = await apiKeyService.verifyApiKey("cbk_abc");

      expect(key).toMatchObject({ id: "k1" });
      expect(update).toHaveBeenCalledWith({ lastUsedAt: expect.any(Date) });
      // Let the swallowed rejection settle so it cannot surface as an unhandled rejection.
      await Promise.resolve();
    });
  });

  describe("createApiKey", () => {
    it("coerces a non-array scopes value to an empty array", async () => {
      ApiKey.create.mockImplementation(async (v) => ({ ...v, id: "k1" }));
      const res = await apiKeyService.createApiKey("t1", { name: "n", scopes: "not-an-array" });
      expect(ApiKey.create.mock.calls[0][0].scopes).toEqual([]);
      expect(res.scopes).toEqual([]);
    });

    it("defaults expiresAt and createdBy to null", async () => {
      ApiKey.create.mockImplementation(async (v) => ({ ...v, id: "k1" }));
      await apiKeyService.createApiKey("t1", { name: "n" });
      expect(ApiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt: null, createdBy: null }),
      );
    });

    it("persists the supplied expiresAt and createdBy", async () => {
      ApiKey.create.mockImplementation(async (v) => ({ ...v, id: "k1" }));
      const expiresAt = new Date("2030-01-01");
      await apiKeyService.createApiKey("t1", { name: "n", expiresAt, createdBy: "u1" });
      expect(ApiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt, createdBy: "u1" }),
      );
    });
  });

  describe("listApiKeys", () => {
    it("uses DEFAULT_LIMIT and page 1 when called with no options", async () => {
      ApiKey.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      const res = await apiKeyService.listApiKeys("t1");

      expect(ApiKey.findAndCountAll).toHaveBeenCalledWith({
        where: { tenantId: "t1" },
        limit: DEFAULT_LIMIT,
        offset: 0,
        order: [["createdAt", "DESC"]],
      });
      expect(res.meta).toEqual({ total: 0, page: 1, limit: DEFAULT_LIMIT, totalPages: 0 });
    });

    it("caps the limit at MAX_LIMIT and computes the offset from the page", async () => {
      ApiKey.findAndCountAll.mockResolvedValue({ count: 401, rows: [] });

      const res = await apiKeyService.listApiKeys("t1", { page: 3, limit: 5000 });

      expect(ApiKey.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: MAX_LIMIT, offset: 2 * MAX_LIMIT }),
      );
      expect(res.meta).toEqual({ total: 401, page: 3, limit: MAX_LIMIT, totalPages: 3 });
    });

    it("falls back to DEFAULT_LIMIT when limit is not a number", async () => {
      ApiKey.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
      await apiKeyService.listApiKeys("t1", { page: 1, limit: "abc" });
      expect(ApiKey.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: DEFAULT_LIMIT }),
      );
    });

    it("projects rows through publicKey and never leaks the key hash", async () => {
      ApiKey.findAndCountAll.mockResolvedValue({
        count: 1,
        rows: [{
          id: "k1",
          tenantId: "t1",
          name: "n",
          keyPrefix: "cbk_1234",
          keyHash: "super-secret-hash",
          scopes: ["*"],
          lastUsedAt: null,
          expiresAt: null,
          isActive: true,
          createdBy: "u1",
          createdAt: "2025-01-01",
        }],
      });

      const res = await apiKeyService.listApiKeys("t1", { page: 1, limit: 10 });

      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]).not.toHaveProperty("keyHash");
      expect(res.rows[0]).toEqual({
        id: "k1",
        tenantId: "t1",
        name: "n",
        keyPrefix: "cbk_1234",
        scopes: ["*"],
        lastUsedAt: null,
        expiresAt: null,
        isActive: true,
        createdBy: "u1",
        createdAt: "2025-01-01",
      });
    });
  });

  describe("getApiKey", () => {
    it("returns the public projection of a tenant-owned key", async () => {
      ApiKey.findOne.mockResolvedValue({ id: "k1", tenantId: "t1", name: "n", keyHash: "secret" });

      const res = await apiKeyService.getApiKey("t1", "k1");

      expect(ApiKey.findOne).toHaveBeenCalledWith({ where: { id: "k1", tenantId: "t1" } });
      expect(res).toMatchObject({ id: "k1", tenantId: "t1", name: "n" });
      expect(res).not.toHaveProperty("keyHash");
    });

    it("throws 404 when the key belongs to another tenant or does not exist", async () => {
      ApiKey.findOne.mockResolvedValue(null);
      await expect(apiKeyService.getApiKey("t1", "k1")).rejects.toMatchObject({
        status: 404,
        message: "API key not found",
      });
    });
  });

  describe("revokeApiKey", () => {
    it("deactivates then soft-deletes the key", async () => {
      const update = jest.fn().mockResolvedValue();
      const softDelete = jest.fn().mockResolvedValue();
      ApiKey.findOne.mockResolvedValue({ id: "k1", update, softDelete });

      const res = await apiKeyService.revokeApiKey("t1", "k1");

      expect(update).toHaveBeenCalledWith({ isActive: false });
      expect(softDelete).toHaveBeenCalled();
      expect(res).toEqual({ id: "k1" });
    });

    it("throws 404 for an unknown key", async () => {
      ApiKey.findOne.mockResolvedValue(null);
      await expect(apiKeyService.revokeApiKey("t1", "k1")).rejects.toMatchObject({
        status: 404,
        message: "API key not found",
      });
    });
  });
});
