/**
 * Additional branch/error coverage for tenant.service.js
 *
 * NOTE ON AppError: unlike tenant.service.test.js, this file uses the REAL
 * src/utils/appError.util.js. Its constructor is `AppError(status, message)`
 * and it exposes `.status` (never `.statusCode`). Mocking it with a swapped
 * `(message, status)` signature masks argument-order defects in the service,
 * so it is left unmocked here.
 *
 * Mocked collaborators mirror their real modules:
 *  - services/redis.service exports { get, set, del, delPattern, cacheKeys, ... }
 *    where cacheKeys.tenant / tenantByCode / tenantSettings are (id) => string.
 *  - validators/tenant.validator exports `validate(body, schema)` which returns
 *    the validated VALUE directly (it throws a 400 itself on failure).
 *  - src/models/index.js exports the plural aliases Tenants (models.Tenant),
 *    Users (models.User) and TenantSettings.
 */

jest.mock("../../services/redis.service", () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delPattern: jest.fn(),
  cacheKeys: {
    tenant: (tenantId) => `tenant:${tenantId}`,
    tenantByCode: (code) => `tenant:code:${code}`,
    tenantSettings: (tenantId) => `tenant:settings:${tenantId}`,
  },
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock("../../utils/upload.util", () => ({
  deleteUpload: jest.fn(),
}));

jest.mock("../../constants", () => ({
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
}));

jest.mock("../../validators/tenant.validator", () => ({
  createTenantSchema: "createTenantSchema",
  updateTenantSchema: "updateTenantSchema",
  // Real signature: validate(body, schema) -> validated value (throws on error)
  validate: jest.fn((body) => ({ ...body })),
  formatErrors: jest.fn((details) => details),
}));

jest.mock("../../config", () => ({
  db: {
    transaction: jest.fn(),
    sequelize: { fn: jest.fn((name, col) => `${name}(${col})`) },
  },
}));

jest.mock("../../models", () => ({
  Tenants: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  },
  Users: {
    findAll: jest.fn(),
    count: jest.fn(),
  },
  TenantSettings: {
    findAll: jest.fn(),
    findOrCreate: jest.fn(),
  },
}));

const { db } = require("../../config");
const { Tenants, Users, TenantSettings } = require("../../models");
const { get, set, del, delPattern } = require("../../services/redis.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const { deleteUpload } = require("../../utils/upload.util");
const { validate: validateInput } = require("../../validators/tenant.validator");
const { AppError } = require("../../utils/appError.util");

const tenantService = require("../../services/tenant.service");

/**
 * Mirrors sequelize's Transaction: once commit()/rollback() resolves, the
 * instance's `finished` field is set to "commit"/"rollback". The service's
 * catch blocks read `!transaction.finished` to decide whether a rollback is
 * still needed, so a mock without this flag would silently permit (and hide)
 * double-rollback bugs.
 */
const mockTransaction = () => {
  const tx = {
    finished: undefined,
    commit: jest.fn(async () => {
      tx.finished = "commit";
    }),
    rollback: jest.fn(async () => {
      tx.finished = "rollback";
    }),
  };
  return tx;
};

const catchErr = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("Expected the promise to reject, but it resolved");
};

const makeTenant = (overrides = {}) => ({
  id: "t-1",
  name: "Acme",
  code: "ACM",
  logo: null,
  status: "active",
  maxUsers: 10,
  update: jest.fn().mockResolvedValue(undefined),
  destroy: jest.fn().mockResolvedValue(undefined),
  toJSON() {
    const { update, destroy, toJSON, ...rest } = this;
    return { ...rest };
  },
  ...overrides,
});

describe("tenant.service - branch & error coverage", () => {
  beforeEach(() => {
    // resetMocks is false in jest.config.js, so queued `...Once` values would
    // leak across tests. Reset each mock and use plain (non-Once) defaults.
    Tenants.findAll.mockReset().mockResolvedValue([]);
    Tenants.findOne.mockReset().mockResolvedValue(null);
    Tenants.findByPk.mockReset().mockResolvedValue(null);
    Tenants.create.mockReset().mockResolvedValue(makeTenant());
    Tenants.count.mockReset().mockResolvedValue(0);
    Users.findAll.mockReset().mockResolvedValue([]);
    Users.count.mockReset().mockResolvedValue(0);
    TenantSettings.findAll.mockReset().mockResolvedValue([]);
    TenantSettings.findOrCreate.mockReset().mockResolvedValue([{}, true]);
    get.mockReset().mockResolvedValue(null);
    set.mockReset().mockResolvedValue(undefined);
    del.mockReset().mockResolvedValue(undefined);
    delPattern.mockReset().mockResolvedValue(undefined);
    deleteUpload.mockReset().mockResolvedValue(undefined);
    db.transaction.mockReset().mockResolvedValue(mockTransaction());
    validateInput.mockReset().mockImplementation((body) => ({ ...body }));
  });

  // ==============================================================
  // fetchTenants
  // ==============================================================
  describe("fetchTenants", () => {
    it("should map user counts onto tenants and default absent counts to 0", async () => {
      Tenants.findAll.mockResolvedValue([
        makeTenant({ id: "t-1", logo: "a.png" }),
        makeTenant({ id: "t-2", logo: null }),
      ]);
      Tenants.count.mockResolvedValue(2);
      Users.findAll.mockResolvedValue([{ id: "t-1", count: "7" }]);

      const result = await tenantService.fetchTenants({ page: 1, limit: 10 });

      expect(result.data.rows[0].userCount).toBe(7);
      expect(result.data.rows[1].userCount).toBe(0);
      expect(result.data.rows[0].logoBaseUrl).toContain("/uploads/tenant/a.png");
      expect(result.data.rows[1].logoBaseUrl).toBeNull();
    });

    it("should paginate with an offset derived from page and limit", async () => {
      Tenants.findAll.mockResolvedValue([]);
      Tenants.count.mockResolvedValue(55);

      const result = await tenantService.fetchTenants({ page: 3, limit: 10 });

      expect(Tenants.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 20 }),
      );
      expect(result.data.meta).toEqual({
        total: 55,
        page: 3,
        limit: 10,
        totalPages: 6,
      });
      // Page 3 is not cacheable
      expect(set).not.toHaveBeenCalled();
    });

    it("should cache the first unfiltered page for 5 minutes", async () => {
      Tenants.findAll.mockResolvedValue([makeTenant()]);
      Tenants.count.mockResolvedValue(1);

      await tenantService.fetchTenants({ page: 1, limit: 10 });

      expect(set).toHaveBeenCalledWith(
        "tenants:page:1:limit:10",
        expect.objectContaining({
          rows: expect.any(Array),
          meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
        }),
        300,
      );
    });

    it("should serve the cached first page without querying the database", async () => {
      get.mockResolvedValue({
        rows: [{ id: "t-cached" }],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      });

      const result = await tenantService.fetchTenants({ page: 1, limit: 10 });

      expect(Tenants.findAll).not.toHaveBeenCalled();
      expect(result.message).toBe("Fetch tenants successful (cached)");
      expect(result.data.rows).toEqual([{ id: "t-cached" }]);
      expect(result.data.count).toBe(1);
    });

    it("should default the cached count to 0 when meta is absent", async () => {
      get.mockResolvedValue({ rows: [] });

      const result = await tenantService.fetchTenants({ page: 1, limit: 10 });

      expect(result.data.count).toBe(0);
      expect(result.data.meta).toBeUndefined();
    });

    it("should not consult the cache when a search term is supplied", async () => {
      Tenants.findAll.mockResolvedValue([]);
      Tenants.count.mockResolvedValue(0);

      await tenantService.fetchTenants({ page: 1, limit: 10, find: "acme" });

      expect(get).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
    });

    it("should build a lowercased LIKE search over name, code and description", async () => {
      const { Op } = require("sequelize");
      Tenants.findAll.mockResolvedValue([]);
      Tenants.count.mockResolvedValue(0);

      await tenantService.fetchTenants({ page: 1, limit: 10, find: "AcMe" });

      const where = Tenants.findAll.mock.calls[0][0].where;
      expect(where[Op.or]).toEqual([
        { name: { [Op.like]: "%acme%" } },
        { code: { [Op.like]: "%acme%" } },
        { description: { [Op.like]: "%acme%" } },
      ]);
    });

    it("should default page to 1 and limit to DEFAULT_LIMIT when both are omitted", async () => {
      Tenants.findAll.mockResolvedValue([]);
      Tenants.count.mockResolvedValue(0);

      const result = await tenantService.fetchTenants({});

      expect(Tenants.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20, offset: 0 }),
      );
      expect(result.data.meta).toEqual({
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
    });

    it("should handle raw rows that have no toJSON method", async () => {
      Tenants.findAll.mockResolvedValue([
        { id: "t-raw", name: "Raw", logo: "raw.png" },
      ]);
      Tenants.count.mockResolvedValue(1);
      Users.findAll.mockResolvedValue([]);

      const result = await tenantService.fetchTenants({ page: 1, limit: 10 });

      expect(result.data.rows[0]).toEqual({
        id: "t-raw",
        name: "Raw",
        logo: "raw.png",
        logoBaseUrl: expect.stringContaining("/uploads/tenant/raw.png"),
        userCount: 0,
      });
    });

    it("should map a query failure to a 500", async () => {
      Tenants.findAll.mockRejectedValue(new Error("select failed"));

      const err = await catchErr(tenantService.fetchTenants({ page: 1, limit: 10 }));

      expect(err).toEqual({ status: 500, message: "select failed" });
      expect(logger.error).toHaveBeenCalledWith(
        "Error fetching tenants",
        expect.objectContaining({ error: "select failed" }),
      );
    });

    it("should preserve a thrown status and default a missing message", async () => {
      Tenants.findAll.mockRejectedValue({ status: 418 });

      const err = await catchErr(tenantService.fetchTenants({ page: 1, limit: 10 }));

      expect(err).toEqual({ status: 418, message: "Internal server error" });
    });
  });

  // ==============================================================
  // fetchSpecificTenant
  // ==============================================================
  describe("fetchSpecificTenant", () => {
    it("should cache the tenant for 10 minutes after a miss", async () => {
      Tenants.findByPk.mockResolvedValue(makeTenant({ logo: "logo.png" }));

      const result = await tenantService.fetchSpecificTenant("t-1");

      expect(get).toHaveBeenCalledWith("tenant:t-1");
      expect(set).toHaveBeenCalledWith(
        "tenant:t-1",
        expect.objectContaining({ id: "t-1" }),
        600,
      );
      expect(result.data.logoBaseUrl).toContain("/uploads/tenant/logo.png");
    });

    it("should not write to the cache when the tenant is missing", async () => {
      Tenants.findByPk.mockResolvedValue(null);

      const result = await tenantService.fetchSpecificTenant("ghost");

      expect(result).toEqual({
        success: true,
        status: 404,
        message: "Tenant not found",
        data: null,
      });
      expect(set).not.toHaveBeenCalled();
    });

    it("should wrap a lookup failure in a 500 AppError", async () => {
      Tenants.findByPk.mockRejectedValue(new Error("db down"));

      const err = await catchErr(tenantService.fetchSpecificTenant("t-1"));

      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(500);
      expect(err.message).toBe("Internal server error");
      expect(logger.error).toHaveBeenCalledWith("Error fetching specific tenant", {
        error: "db down",
      });
    });
  });

  // ==============================================================
  // getPublicBranding
  // ==============================================================
  describe("getPublicBranding", () => {
    it("should expose only non-sensitive branding fields and cache them", async () => {
      Tenants.findOne.mockResolvedValue({
        toJSON: () => ({
          id: "t-1",
          name: "Acme",
          code: "ACM",
          primaryColor: "#ff0000",
          logo: "brand.png",
        }),
      });

      const result = await tenantService.getPublicBranding("t-1");

      expect(result).toEqual({
        id: "t-1",
        name: "Acme",
        code: "ACM",
        primaryColor: "#ff0000",
        logoBaseUrl: expect.stringContaining("/uploads/tenant/brand.png"),
      });
      expect(set).toHaveBeenCalledWith("tenant:branding:t-1", result, 300);
    });

    it("should null out an absent primaryColor and logo", async () => {
      Tenants.findOne.mockResolvedValue({
        toJSON: () => ({ id: "t-1", name: "Acme", code: "ACM" }),
      });

      const result = await tenantService.getPublicBranding("t-1");

      expect(result.primaryColor).toBeNull();
      expect(result.logoBaseUrl).toBeNull();
    });

    it("should return the cached branding without querying", async () => {
      get.mockResolvedValue({ id: "t-1", name: "Cached" });

      const result = await tenantService.getPublicBranding("t-1");

      expect(Tenants.findOne).not.toHaveBeenCalled();
      expect(result).toEqual({ id: "t-1", name: "Cached" });
    });

    it("should not cache when the tenant is missing or inactive", async () => {
      Tenants.findOne.mockResolvedValue(null);

      const result = await tenantService.getPublicBranding("ghost");

      expect(result).toBeNull();
      expect(set).not.toHaveBeenCalled();
    });
  });

  // ==============================================================
  // createTenant
  // ==============================================================
  describe("createTenant", () => {
    it("should apply defaults for every optional field", async () => {
      const created = makeTenant({ id: "t-new", code: "NEW" });
      Tenants.create.mockResolvedValue(created);

      await tenantService.createTenant({ name: "New", code: "NEW" }, "creator-1");

      expect(Tenants.create.mock.calls[0][0]).toEqual({
        name: "New",
        code: "NEW",
        subdomain: "new",
        description: null,
        logo: "default.svg",
        primaryColor: null,
        maxUsers: 10,
        email: "new@example.com",
        phone: null,
        address: null,
        city: null,
        state: null,
        zipCode: null,
        country: null,
        website: null,
        createdBy: "creator-1",
      });
    });

    it("should keep every supplied field", async () => {
      Tenants.create.mockResolvedValue(makeTenant());

      await tenantService.createTenant(
        {
          name: "Full",
          code: "FUL",
          subdomain: "custom-subdomain",
          description: "desc",
          logo: "l.png",
          primaryColor: "#123456",
          maxUsers: 99,
          email: "a@b.com",
          phone: "123",
          address: "addr",
          city: "city",
          state: "state",
          zipCode: "zip",
          country: "country",
          website: "https://x.com",
        },
        "creator-1",
      );

      expect(Tenants.create.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          description: "desc",
          logo: "l.png",
          primaryColor: "#123456",
          maxUsers: 99,
          website: "https://x.com",
          subdomain: "custom-subdomain",
        }),
      );
    });

    it("should handle subdomain generation fallback when input and code strip to empty", async () => {
      const created = makeTenant({ id: "t-fallback", code: "-" });
      Tenants.create.mockResolvedValue(created);

      await tenantService.createTenant({ name: "Fallback", code: "-" }, "creator-1");

      expect(Tenants.create.mock.calls[0][0].subdomain).toBe("-");
    });

    it("should prime both caches and invalidate the list cache on success", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      Tenants.create.mockResolvedValue(makeTenant({ id: "t-new", code: "NEW" }));

      const result = await tenantService.createTenant(
        { name: "New", code: "NEW" },
        "creator-1",
      );

      expect(tx.commit).toHaveBeenCalled();
      expect(set).toHaveBeenCalledWith("tenant:t-new", expect.any(Object), 600);
      expect(set).toHaveBeenCalledWith("tenant:code:NEW", expect.any(Object), 600);
      expect(delPattern).toHaveBeenCalledWith("tenants:*");
      expect(result.status).toBe(201);
    });

    it("should reject a duplicate code with a 409 and roll back", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      Tenants.findOne.mockResolvedValue({ id: "existing" });

      const err = await catchErr(
        tenantService.createTenant({ name: "New", code: "DUP" }, "creator-1"),
      );

      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(409);
      expect(err.message).toBe("Tenant code already exists");
      expect(tx.rollback).toHaveBeenCalledTimes(1);
      expect(Tenants.create).not.toHaveBeenCalled();
    });

    it("should reject a duplicate name with a 409 and roll back", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      Tenants.findOne
        .mockResolvedValueOnce(null) // code is free
        .mockResolvedValueOnce({ id: "existing" }); // name is taken

      const err = await catchErr(
        tenantService.createTenant({ name: "Dup", code: "NEW" }, "creator-1"),
      );

      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(409);
      expect(err.message).toBe("Tenant name already exists");
      expect(Tenants.create).not.toHaveBeenCalled();
    });

    it("should roll back and rethrow when the insert fails", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      Tenants.create.mockRejectedValue(new Error("insert failed"));

      const err = await catchErr(
        tenantService.createTenant({ name: "New", code: "NEW" }, "creator-1"),
      );

      expect(err.message).toBe("insert failed");
      expect(tx.rollback).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith("Error creating tenant", {
        error: "insert failed",
      });
    });

    it("should swallow a secondary rollback failure and surface the original error", async () => {
      const tx = {
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockRejectedValue(new Error("already finished")),
      };
      db.transaction.mockResolvedValue(tx);
      Tenants.create.mockRejectedValue(new Error("insert failed"));

      const err = await catchErr(
        tenantService.createTenant({ name: "New", code: "NEW" }, "creator-1"),
      );

      expect(err.message).toBe("insert failed");
    });

    it("should not roll back a transaction that already finished", async () => {
      const tx = {
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        finished: "commit",
      };
      db.transaction.mockResolvedValue(tx);
      Tenants.create.mockResolvedValue(makeTenant());
      set.mockRejectedValue(new Error("redis down"));

      const err = await catchErr(
        tenantService.createTenant({ name: "New", code: "NEW" }, "creator-1"),
      );

      expect(err.message).toBe("redis down");
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it("should surface an error rather than cache a null tenant when the insert yields no row", async () => {
      // transformTenant() tolerates a falsy tenant (returns null), but the
      // caching step immediately dereferences tenant.id -- and the commit has
      // already happened by the time that surfaces.
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      Tenants.create.mockResolvedValue(null);

      const err = await catchErr(
        tenantService.createTenant({ name: "New", code: "NEW" }, "creator-1"),
      );

      expect(err).toBeInstanceOf(TypeError);
      expect(tx.commit).toHaveBeenCalled();
      expect(tx.rollback).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(delPattern).not.toHaveBeenCalled();
    });
  });

  // ==============================================================
  // TENANT_LOGO_BASE_URL (resolved once at module load)
  // ==============================================================
  describe("TENANT_LOGO_BASE_URL", () => {
    it("should fall back to http://localhost:5000 when HOST_URL is unset at load time", async () => {
      const original = process.env.HOST_URL;
      delete process.env.HOST_URL;
      jest.resetModules();

      try {
        // Re-require so the module-level base URL is recomputed. The jest.mock
        // factories above are re-applied, so these are fresh mock instances.
        const freshService = require("../../services/tenant.service");
        const freshModels = require("../../models");
        const freshRedis = require("../../services/redis.service");

        freshRedis.get.mockResolvedValue(null);
        freshRedis.set.mockResolvedValue(undefined);
        freshModels.Tenants.findOne.mockResolvedValue({
          toJSON: () => ({ id: "t-1", name: "Acme", code: "ACM", logo: "x.png" }),
        });

        const result = await freshService.getPublicBranding("t-1");

        expect(result.logoBaseUrl).toBe(
          "http://localhost:5000/uploads/tenant/x.png",
        );
      } finally {
        if (original === undefined) {
          delete process.env.HOST_URL;
        } else {
          process.env.HOST_URL = original;
        }
        jest.resetModules();
      }
    });
  });

  // ==============================================================
  // updateTenant
  // ==============================================================
  describe("updateTenant", () => {
    it("should throw a 404 AppError when the tenant does not exist", async () => {
      Tenants.findByPk.mockResolvedValue(null);

      const err = await catchErr(tenantService.updateTenant("ghost", { name: "X" }));

      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(404);
      expect(err.message).toBe("Tenant not found");
    });

    it("should reject a code that belongs to another tenant", async () => {
      const { Op } = require("sequelize");
      Tenants.findByPk.mockResolvedValue(makeTenant());
      Tenants.findOne.mockResolvedValue({ id: "t-other" });

      const err = await catchErr(tenantService.updateTenant("t-1", { code: "TAKEN" }));

      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(409);
      expect(err.message).toBe("Tenant code already exists");
      expect(Tenants.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { code: "TAKEN", id: { [Op.ne]: "t-1" } },
        }),
      );
    });

    it("should reject a name that belongs to another tenant", async () => {
      Tenants.findByPk.mockResolvedValue(makeTenant());
      Tenants.findOne.mockResolvedValue({ id: "t-other" });

      const err = await catchErr(tenantService.updateTenant("t-1", { name: "TAKEN" }));

      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(409);
      expect(err.message).toBe("Tenant name already exists");
    });

    it("should skip the uniqueness lookups when neither name nor code changes", async () => {
      const tenant = makeTenant();
      Tenants.findByPk.mockResolvedValue(tenant);

      await tenantService.updateTenant("t-1", { maxUsers: 42 });

      expect(Tenants.findOne).not.toHaveBeenCalled();
      expect(tenant.update.mock.calls[0][0].maxUsers).toBe(42);
    });

    it("should delete the previous logo file when a new logo is supplied", async () => {
      const tenant = makeTenant({ logo: "old-logo.png" });
      Tenants.findByPk.mockResolvedValue(tenant);

      await tenantService.updateTenant("t-1", { logo: "new-logo.png" });

      expect(deleteUpload).toHaveBeenCalledWith("old-logo.png", "uploads/tenant");
      expect(tenant.update.mock.calls[0][0].logo).toBe("new-logo.png");
    });

    it("should not delete the shared default logo", async () => {
      Tenants.findByPk.mockResolvedValue(makeTenant({ logo: "default.svg" }));

      await tenantService.updateTenant("t-1", { logo: "new-logo.png" });

      expect(deleteUpload).not.toHaveBeenCalled();
    });

    it("should tolerate a tenant with no previous logo", async () => {
      Tenants.findByPk.mockResolvedValue(makeTenant({ logo: null }));

      await tenantService.updateTenant("t-1", { logo: "new-logo.png" });

      expect(deleteUpload).not.toHaveBeenCalled();
    });

    it("should not delete the logo when it is unchanged", async () => {
      Tenants.findByPk.mockResolvedValue(makeTenant({ logo: "same.png" }));

      await tenantService.updateTenant("t-1", { logo: "same.png" });

      expect(deleteUpload).not.toHaveBeenCalled();
    });

    it("should continue the update when deleting the old logo fails", async () => {
      const tenant = makeTenant({ logo: "old.png" });
      Tenants.findByPk.mockResolvedValue(tenant);
      deleteUpload.mockRejectedValue(new Error("ENOENT"));

      const result = await tenantService.updateTenant("t-1", { logo: "new.png" });

      expect(logger.warn).toHaveBeenCalledWith(
        "Failed to delete old logo: old.png",
        expect.any(Error),
      );
      expect(tenant.update).toHaveBeenCalled();
      expect(result.status).toBe(200);
    });

    it("should keep the existing logo when no new logo is supplied", async () => {
      const tenant = makeTenant({ logo: "keep.png" });
      Tenants.findByPk.mockResolvedValue(tenant);

      await tenantService.updateTenant("t-1", { name: "Renamed" });

      expect(tenant.update.mock.calls[0][0].logo).toBe("keep.png");
    });

    it("should fall back to existing values for fields that are not supplied", async () => {
      const tenant = makeTenant({
        name: "Old",
        code: "OLD",
        description: "old desc",
        primaryColor: "#000000",
        status: "active",
        maxUsers: 5,
        email: "old@x.com",
        phone: "1",
        address: "a",
        city: "c",
        state: "s",
        zipCode: "z",
        country: "co",
        website: "https://old.com",
      });
      Tenants.findByPk.mockResolvedValue(tenant);

      await tenantService.updateTenant("t-1", {});

      expect(tenant.update.mock.calls[0][0]).toEqual({
        name: "Old",
        code: "OLD",
        description: "old desc",
        logo: null,
        primaryColor: "#000000",
        status: "active",
        maxUsers: 5,
        email: "old@x.com",
        phone: "1",
        address: "a",
        city: "c",
        state: "s",
        zipCode: "z",
        country: "co",
        website: "https://old.com",
      });
    });

    it("should apply every supplied contact and address field", async () => {
      const tenant = makeTenant();
      Tenants.findByPk.mockResolvedValue(tenant);

      await tenantService.updateTenant("t-1", {
        maxUsers: 77,
        email: "new@x.com",
        phone: "555",
        address: "1 New St",
        city: "Jakarta",
        state: "DKI",
        zipCode: "12345",
        country: "ID",
        website: "https://new.example.com",
        status: "inactive",
      });

      expect(tenant.update.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          maxUsers: 77,
          email: "new@x.com",
          phone: "555",
          address: "1 New St",
          city: "Jakarta",
          state: "DKI",
          zipCode: "12345",
          country: "ID",
          website: "https://new.example.com",
          status: "inactive",
        }),
      );
    });

    it("should coerce a blank primaryColor to null", async () => {
      const tenant = makeTenant({ primaryColor: "#ffffff" });
      Tenants.findByPk.mockResolvedValue(tenant);

      await tenantService.updateTenant("t-1", { primaryColor: "" });

      expect(tenant.update.mock.calls[0][0].primaryColor).toBeNull();
    });

    it("should allow clearing optional fields to null", async () => {
      const tenant = makeTenant({ description: "old", email: "old@x.com" });
      Tenants.findByPk.mockResolvedValue(tenant);

      await tenantService.updateTenant("t-1", { description: null, email: null });

      const payload = tenant.update.mock.calls[0][0];
      expect(payload.description).toBeNull();
      expect(payload.email).toBeNull();
    });

    it("should move the by-code cache entry when the code changes", async () => {
      Tenants.findByPk.mockResolvedValue(makeTenant({ code: "OLD" }));

      await tenantService.updateTenant("t-1", { code: "NEW" });

      expect(del).toHaveBeenCalledWith("tenant:code:OLD");
      expect(set).toHaveBeenCalledWith("tenant:code:NEW", expect.any(Object), 600);
      expect(set).toHaveBeenCalledWith("tenant:t-1", expect.any(Object), 600);
      expect(delPattern).toHaveBeenCalledWith("tenants:*");
    });

    it("should not touch the by-code cache when the code is unchanged", async () => {
      Tenants.findByPk.mockResolvedValue(makeTenant({ code: "SAME" }));

      await tenantService.updateTenant("t-1", { code: "SAME" });

      expect(del).not.toHaveBeenCalled();
    });

    it("should roll back and rethrow when the update fails", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      Tenants.findByPk.mockResolvedValue(
        makeTenant({ update: jest.fn().mockRejectedValue(new Error("write failed")) }),
      );

      const err = await catchErr(tenantService.updateTenant("t-1", { name: "X" }));

      expect(err.message).toBe("write failed");
      expect(tx.rollback).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith("Error updating tenant", {
        error: "write failed",
      });
    });

    it("should not roll back a transaction that already finished", async () => {
      const tx = {
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        finished: "commit",
      };
      db.transaction.mockResolvedValue(tx);
      Tenants.findByPk.mockResolvedValue(makeTenant());
      set.mockRejectedValue(new Error("redis down"));

      const err = await catchErr(tenantService.updateTenant("t-1", { name: "X" }));

      expect(err.message).toBe("redis down");
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it("should swallow a secondary rollback failure", async () => {
      const tx = {
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockRejectedValue(new Error("rollback failed")),
      };
      db.transaction.mockResolvedValue(tx);
      Tenants.findByPk.mockRejectedValue(new Error("lookup failed"));

      const err = await catchErr(tenantService.updateTenant("t-1", { name: "X" }));

      expect(err.message).toBe("lookup failed");
    });
  });

  // ==============================================================
  // deleteTenant
  // ==============================================================
  describe("deleteTenant", () => {
    it("should throw a 404 AppError and roll back when the tenant is missing", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      Tenants.findByPk.mockResolvedValue(null);

      const err = await catchErr(tenantService.deleteTenant("ghost", "admin"));

      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(404);
      expect(err.message).toBe("Tenant not found");
      expect(tx.rollback).toHaveBeenCalledTimes(1);
    });

    it("should refuse to delete a tenant that still has users", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      const tenant = makeTenant();
      Tenants.findByPk.mockResolvedValue(tenant);
      Users.count.mockResolvedValue(3);

      const err = await catchErr(tenantService.deleteTenant("t-1", "admin"));

      // The important guarantee: the tenant is NOT destroyed and the
      // transaction is rolled back.
      expect(err).toBeInstanceOf(AppError);
      expect(tenant.destroy).not.toHaveBeenCalled();
      expect(tx.rollback).toHaveBeenCalledTimes(1);
      expect(tx.commit).not.toHaveBeenCalled();
      expect(Users.count).toHaveBeenCalledWith({
        where: { tenantId: "t-1" },
        transaction: tx,
      });
    });

    it("should delete the tenant logo file before destroying the tenant", async () => {
      const tenant = makeTenant({ logo: "logo.png" });
      Tenants.findByPk.mockResolvedValue(tenant);

      await tenantService.deleteTenant("t-1", "admin");

      expect(deleteUpload).toHaveBeenCalledWith("logo.png", "uploads/tenant");
      expect(tenant.destroy).toHaveBeenCalled();
    });

    it("should not delete the shared default logo", async () => {
      const tenant = makeTenant({ logo: "default.svg" });
      Tenants.findByPk.mockResolvedValue(tenant);

      await tenantService.deleteTenant("t-1", "admin");

      expect(deleteUpload).not.toHaveBeenCalled();
      expect(tenant.destroy).toHaveBeenCalled();
    });

    it("should still delete the tenant when logo removal fails", async () => {
      const tenant = makeTenant({ logo: "logo.png" });
      Tenants.findByPk.mockResolvedValue(tenant);
      deleteUpload.mockRejectedValue(new Error("ENOENT"));

      const result = await tenantService.deleteTenant("t-1", "admin");

      expect(logger.warn).toHaveBeenCalledWith(
        "Failed to delete tenant logo: logo.png",
        expect.any(Error),
      );
      expect(tenant.destroy).toHaveBeenCalled();
      expect(result.status).toBe(200);
    });

    it("should invalidate every tenant cache after a successful delete", async () => {
      const tenant = makeTenant({ code: "ACM" });
      Tenants.findByPk.mockResolvedValue(tenant);

      const result = await tenantService.deleteTenant("t-1", "admin");

      expect(del).toHaveBeenCalledWith("tenant:t-1");
      expect(del).toHaveBeenCalledWith("tenant:code:ACM");
      expect(delPattern).toHaveBeenCalledWith("tenants:*");
      expect(delPattern).toHaveBeenCalledWith("tenant:settings:t-1");
      expect(result).toEqual({
        success: true,
        status: 200,
        message: "Tenant deleted successfully",
        data: null,
      });
    });

    it("should roll back and rethrow when destroy fails", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      Tenants.findByPk.mockResolvedValue(
        makeTenant({ destroy: jest.fn().mockRejectedValue(new Error("FK constraint")) }),
      );

      const err = await catchErr(tenantService.deleteTenant("t-1", "admin"));

      expect(err.message).toBe("FK constraint");
      expect(tx.rollback).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith("Error deleting tenant", {
        error: "FK constraint",
      });
    });

    it("should not roll back a transaction that already finished", async () => {
      const tx = {
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        finished: "commit",
      };
      db.transaction.mockResolvedValue(tx);
      Tenants.findByPk.mockResolvedValue(makeTenant());
      del.mockRejectedValue(new Error("redis down"));

      const err = await catchErr(tenantService.deleteTenant("t-1", "admin"));

      expect(err.message).toBe("redis down");
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it("should swallow a secondary rollback failure", async () => {
      const tx = {
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockRejectedValue(new Error("rollback failed")),
      };
      db.transaction.mockResolvedValue(tx);
      Tenants.findByPk.mockRejectedValue(new Error("lookup failed"));

      const err = await catchErr(tenantService.deleteTenant("t-1", "admin"));

      expect(err.message).toBe("lookup failed");
    });
  });

  // ==============================================================
  // getTenantSettings
  // ==============================================================
  describe("getTenantSettings", () => {
    it("should merge the key-value table over the JSONB column", async () => {
      Tenants.findByPk.mockResolvedValue(
        makeTenant({ settings: { theme: "light", locale: "id" } }),
      );
      TenantSettings.findAll.mockResolvedValue([{ key: "theme", value: "dark" }]);

      const result = await tenantService.getTenantSettings("t-1");

      // The key-value row wins; the JSONB-only key is merged in
      expect(result.data.settings).toEqual({ theme: "dark", locale: "id" });
      expect(set).toHaveBeenCalledWith(
        "tenant:settings:t-1",
        expect.any(Object),
        900,
      );
    });

    it("should ignore a non-object settings column", async () => {
      Tenants.findByPk.mockResolvedValue(makeTenant({ settings: "not-an-object" }));
      TenantSettings.findAll.mockResolvedValue([{ key: "a", value: "1" }]);

      const result = await tenantService.getTenantSettings("t-1");

      expect(result.data.settings).toEqual({ a: "1" });
    });

    it("should tolerate a null settings column", async () => {
      Tenants.findByPk.mockResolvedValue(makeTenant({ settings: null }));

      const result = await tenantService.getTenantSettings("t-1");

      expect(result.data.settings).toEqual({});
    });

    it("should serve cached settings without querying", async () => {
      get.mockResolvedValue({ tenant: { id: "t-1" }, settings: { theme: "dark" } });

      const result = await tenantService.getTenantSettings("t-1");

      expect(Tenants.findByPk).not.toHaveBeenCalled();
      expect(result.message).toBe("Fetch tenant settings successful (cached)");
      expect(result.data.settings).toEqual({ theme: "dark" });
    });

    it("should return 404 without caching when the tenant is missing", async () => {
      Tenants.findByPk.mockResolvedValue(null);

      const result = await tenantService.getTenantSettings("ghost");

      expect(result.status).toBe(404);
      expect(set).not.toHaveBeenCalled();
    });

    it("should wrap a failure in a 500 AppError", async () => {
      Tenants.findByPk.mockRejectedValue(new Error("db down"));

      const err = await catchErr(tenantService.getTenantSettings("t-1"));

      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(500);
      expect(err.message).toBe("Internal server error");
      expect(logger.error).toHaveBeenCalledWith("Error fetching tenant settings", {
        error: "db down",
      });
    });
  });

  // ==============================================================
  // updateTenantSettings
  // ==============================================================
  describe("updateTenantSettings", () => {
    it("should throw a 404 AppError and roll back when the tenant is missing", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      Tenants.findByPk.mockResolvedValue(null);

      const err = await catchErr(tenantService.updateTenantSettings("ghost", {}));

      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(404);
      expect(tx.rollback).toHaveBeenCalledTimes(1);
    });

    it("should skip the internal tenantId and settings keys", async () => {
      Tenants.findByPk.mockResolvedValue(makeTenant());

      await tenantService.updateTenantSettings(
        "t-1",
        { tenantId: "hack", settings: { nested: true }, theme: "dark" },
        "admin",
      );

      expect(TenantSettings.findOrCreate).toHaveBeenCalledTimes(1);
      expect(TenantSettings.findOrCreate.mock.calls[0][0].where).toEqual({
        tenantId: "t-1",
        key: "theme",
      });
    });

    it("should JSON-stringify object values and String() everything else", async () => {
      Tenants.findByPk.mockResolvedValue(makeTenant());

      await tenantService.updateTenantSettings(
        "t-1",
        { obj: { a: 1 }, num: 42, bool: false },
        "admin",
      );

      const defaults = TenantSettings.findOrCreate.mock.calls.map(
        (c) => c[0].defaults.value,
      );
      expect(defaults).toEqual(['{"a":1}', "42", "false"]);
    });

    it("should update an existing setting rather than creating a duplicate", async () => {
      Tenants.findByPk.mockResolvedValue(makeTenant());
      const existing = { update: jest.fn().mockResolvedValue(undefined) };
      TenantSettings.findOrCreate.mockResolvedValue([existing, false]);

      await tenantService.updateTenantSettings("t-1", { theme: "dark" }, "admin");

      expect(existing.update).toHaveBeenCalledWith(
        { value: "dark" },
        { transaction: expect.any(Object) },
      );
    });

    it("should sync all settings back to the JSONB column and clear the cache", async () => {
      const tenant = makeTenant();
      Tenants.findByPk.mockResolvedValue(tenant);
      TenantSettings.findAll.mockResolvedValue([
        { key: "theme", value: "dark" },
        { key: "locale", value: "id" },
      ]);

      const result = await tenantService.updateTenantSettings(
        "t-1",
        { theme: "dark" },
        "admin",
      );

      expect(tenant.update).toHaveBeenCalledWith(
        { settings: { theme: "dark", locale: "id" } },
        { transaction: expect.any(Object) },
      );
      expect(del).toHaveBeenCalledWith("tenant:settings:t-1");
      expect(result.data).toEqual({ theme: "dark", locale: "id" });
    });

    it("should roll back and rethrow when a setting write fails", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValue(tx);
      Tenants.findByPk.mockResolvedValue(makeTenant());
      TenantSettings.findOrCreate.mockRejectedValue(new Error("upsert failed"));

      const err = await catchErr(
        tenantService.updateTenantSettings("t-1", { theme: "dark" }, "admin"),
      );

      expect(err.message).toBe("upsert failed");
      expect(tx.rollback).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith("Error updating tenant settings", {
        error: "upsert failed",
      });
    });

    it("should not roll back a transaction that already finished", async () => {
      const tx = {
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        finished: "commit",
      };
      db.transaction.mockResolvedValue(tx);
      Tenants.findByPk.mockResolvedValue(makeTenant());
      del.mockRejectedValue(new Error("redis down"));

      const err = await catchErr(
        tenantService.updateTenantSettings("t-1", {}, "admin"),
      );

      expect(err.message).toBe("redis down");
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it("should swallow a secondary rollback failure", async () => {
      const tx = {
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockRejectedValue(new Error("rollback failed")),
      };
      db.transaction.mockResolvedValue(tx);
      Tenants.findByPk.mockRejectedValue(new Error("lookup failed"));

      const err = await catchErr(tenantService.updateTenantSettings("t-1", {}));

      expect(err.message).toBe("lookup failed");
    });
  });

  // ==============================================================
  // getTenantUserCount
  // ==============================================================
  describe("getTenantUserCount", () => {
    it("should report the remaining slots", async () => {
      Tenants.findByPk.mockResolvedValue(makeTenant({ maxUsers: 50 }));
      Users.count.mockResolvedValue(20);

      const result = await tenantService.getTenantUserCount("t-1");

      expect(result.data).toEqual({
        tenantId: "t-1",
        userCount: 20,
        maxUsers: 50,
        remainingSlots: 30,
      });
    });

    it("should floor the remaining slots at 0 when the tenant is over quota", async () => {
      Tenants.findByPk.mockResolvedValue(makeTenant({ maxUsers: 5 }));
      Users.count.mockResolvedValue(9);

      const result = await tenantService.getTenantUserCount("t-1");

      expect(result.data.remainingSlots).toBe(0);
    });

    it("should return 404 when the tenant is missing", async () => {
      Tenants.findByPk.mockResolvedValue(null);

      const result = await tenantService.getTenantUserCount("ghost");

      expect(result).toEqual({
        success: true,
        status: 404,
        message: "Tenant not found",
        data: null,
      });
      expect(Users.count).not.toHaveBeenCalled();
    });

    it("should wrap a failure in a 500 AppError", async () => {
      Tenants.findByPk.mockRejectedValue(new Error("db down"));

      const err = await catchErr(tenantService.getTenantUserCount("t-1"));

      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(500);
      expect(logger.error).toHaveBeenCalledWith("Error fetching tenant user count", {
        error: "db down",
      });
    });
  });

  // ==============================================================
  // Middleware helpers
  // ==============================================================
  describe("middleware helpers", () => {
    it("getTenantByIdForMiddleware should return only id, name and status", async () => {
      const tenant = { id: "t-1", name: "Acme", status: "active" };
      Tenants.findByPk.mockResolvedValue(tenant);

      const result = await tenantService.getTenantByIdForMiddleware("t-1");

      expect(Tenants.findByPk).toHaveBeenCalledWith("t-1", {
        attributes: ["id", "name", "status"],
      });
      expect(result).toBe(tenant);
    });

    it("getTenantByCodeForMiddleware should look up active tenants by code", async () => {
      const tenant = { id: "t-1", name: "Acme", status: "active" };
      Tenants.findOne.mockResolvedValue(tenant);

      const result = await tenantService.getTenantByCodeForMiddleware("ACM");

      expect(Tenants.findOne).toHaveBeenCalledWith({
        where: { code: "ACM", status: "active" },
        attributes: ["id", "name", "status"],
      });
      expect(result).toBe(tenant);
    });

    it("getTenantByCodeForMiddleware should return null for an inactive or unknown code", async () => {
      Tenants.findOne.mockResolvedValue(null);

      await expect(
        tenantService.getTenantByCodeForMiddleware("NOPE"),
      ).resolves.toBeNull();
    });
  });
});
