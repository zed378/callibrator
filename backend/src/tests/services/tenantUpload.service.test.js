/**
 * Tests for tenantUpload.service.js (A-96).
 *
 * The route-level behaviour (gate, controller clean-up, event order over the
 * two-tenant fixture) is in routes/tenant.audit.a95.test.js. This file covers
 * the service's own branches: the actor check, the placeholder and URL-shaped
 * logo values, the post-commit unlink and its failure, and error wrapping.
 *
 * The previous version of this file asserted the pre-A-96 behaviour — the old
 * file deleted BEFORE the update, and no audit row.
 */

const mockEvents = [];

jest.mock("../../utils/upload.util", () => ({
  deleteUpload: jest.fn(async (name) => {
    mockEvents.push(`unlink:${name}`);
  }),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock("../../models", () => ({
  Tenants: { findByPk: jest.fn() },
}));

jest.mock("../../config", () => ({
  db: {
    transaction: jest.fn(async () => ({
      commit: jest.fn(async () => {
        mockEvents.push("commit");
      }),
      rollback: jest.fn(async () => {
        mockEvents.push("rollback");
      }),
    })),
  },
}));

jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn(async () => {
    mockEvents.push("audit");
    return {};
  }),
}));

const { deleteUpload } = require("../../utils/upload.util");
const { logger } = require("../../middlewares/activityLog.middleware");
const { AppError } = require("../../utils/appError.util");
const { db } = require("../../config");
const auditService = require("../../services/audit.service");
const { updateTenantLogo, removeTenantLogo } = require("../../services/tenantUpload.service");
const { Tenants } = require("../../models");

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const own = { tenantId: TENANT, actorIsSuperAdmin: false, ipAddress: "1.2.3.4", userAgent: "ua" };

const tenantRow = (fields = {}) => {
  const row = {
    id: TENANT,
    logo: "old-logo.png",
    ...fields,
    update: jest.fn(async (values) => {
      mockEvents.push("update");
      Object.assign(row, values);
      return row;
    }),
  };
  return row;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEvents.length = 0;
});

describe("updateTenantLogo", () => {
  it("updates and audits in one transaction, commits, then deletes the old file", async () => {
    const row = tenantRow();
    Tenants.findByPk.mockResolvedValue(row);

    const result = await updateTenantLogo(TENANT, "new.png", "user-1", own);

    const tx = await db.transaction.mock.results[0].value;
    expect(Tenants.findByPk).toHaveBeenCalledWith(TENANT, { transaction: tx });
    expect(row.update).toHaveBeenCalledWith({ logo: "new.png" }, { silent: true, transaction: tx });
    expect(auditService.logAction).toHaveBeenCalledWith(
      {
        tenantId: TENANT,
        userId: "user-1",
        action: "UPDATE",
        resourceType: "Tenant",
        resourceId: TENANT,
        changes: { operation: "UPDATE_LOGO", logo: { before: "old-logo.png", after: "new.png" } },
        ipAddress: "1.2.3.4",
        userAgent: "ua",
      },
      { transaction: tx },
    );
    expect(mockEvents).toEqual(["update", "audit", "commit", "unlink:old-logo.png"]);
    expect(deleteUpload).toHaveBeenCalledWith("old-logo.png", "uploads/tenant");
    expect(result).toEqual({
      data: { logo: "new.png" },
      message: "Tenant logo updated successfully",
      status: 200,
    });
  });

  it("a URL-shaped stored logo is reduced to its filename for the delete", async () => {
    Tenants.findByPk.mockResolvedValue(tenantRow({ logo: "/uploads/tenant/prev.png" }));

    await updateTenantLogo(TENANT, "new.png", "user-1", own);

    expect(deleteUpload).toHaveBeenCalledWith("prev.png", "uploads/tenant");
  });

  it.each([null, "default.svg", "new.png"])(
    "stored logo %s: nothing is deleted (none, the placeholder, or the file just stored)",
    async (logo) => {
      Tenants.findByPk.mockResolvedValue(tenantRow({ logo }));

      await updateTenantLogo(TENANT, "new.png", "user-1", own);

      expect(auditService.logAction).toHaveBeenCalledTimes(1);
      expect(deleteUpload).not.toHaveBeenCalled();
    },
  );

  it("a failed unlink after the commit is logged, not reported as a failure", async () => {
    Tenants.findByPk.mockResolvedValue(tenantRow());
    deleteUpload.mockRejectedValueOnce(new Error("EPERM"));

    await expect(updateTenantLogo(TENANT, "new.png", "user-1", own)).resolves.toMatchObject({
      status: 200,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to delete replaced logo: old-logo.png",
      expect.any(Error),
    );
  });

  it("a failed audit insert rolls back, keeps the old file, and is wrapped as a 500", async () => {
    Tenants.findByPk.mockResolvedValue(tenantRow());
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    const err = await updateTenantLogo(TENANT, "new.png", "user-1", own).catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(500);
    expect(err.message).toBe("Failed to update tenant logo");
    expect(mockEvents).toEqual(["update", "rollback"]);
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it("another tenant is 404 — the same error as a missing one — for a non-super-admin", async () => {
    Tenants.findByPk.mockResolvedValueOnce(tenantRow({ id: OTHER }));
    const foreign = await updateTenantLogo(OTHER, "new.png", "user-1", own).catch((e) => e);
    Tenants.findByPk.mockResolvedValueOnce(null);
    const missing = await updateTenantLogo(OTHER, "new.png", "user-1", own).catch((e) => e);

    expect(foreign).toBeInstanceOf(AppError);
    expect(foreign.status).toBe(404);
    expect(foreign.message).toBe("Tenant not found");
    expect(missing.status).toBe(foreign.status);
    expect(missing.message).toBe(foreign.message);
    expect(auditService.logAction).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "tenantUpload.service: cross-tenant logo change refused",
      expect.objectContaining({ reason: "cross-tenant", tenantId: OTHER }),
    );
  });

  it("with no actor at all, refuses (the actor defaults to nobody)", async () => {
    Tenants.findByPk.mockResolvedValue(tenantRow());

    const err = await updateTenantLogo(TENANT, "new.png", "user-1").catch((e) => e);

    expect(err.status).toBe(404);
  });

  it("the super admin may change any tenant's logo; the row is recorded under that tenant, userId null when unknown", async () => {
    Tenants.findByPk.mockResolvedValue(tenantRow({ id: OTHER }));

    await updateTenantLogo(OTHER, "new.png", undefined, { actorIsSuperAdmin: true });

    expect(auditService.logAction.mock.calls[0][0]).toMatchObject({
      tenantId: OTHER,
      userId: null,
      ipAddress: null,
      userAgent: null,
    });
  });
});

describe("removeTenantLogo", () => {
  it("clears the logo, audits in the transaction, commits, then deletes the file", async () => {
    const row = tenantRow();
    Tenants.findByPk.mockResolvedValue(row);

    const result = await removeTenantLogo(TENANT, "user-1", own);

    expect(row.logo).toBeNull();
    expect(auditService.logAction.mock.calls[0][0].changes).toEqual({
      operation: "REMOVE_LOGO",
      logo: { before: "old-logo.png", after: null },
    });
    expect(mockEvents).toEqual(["update", "audit", "commit", "unlink:old-logo.png"]);
    expect(logger.info).toHaveBeenCalledWith(`Tenant logo removed: ${TENANT} by user-1`);
    expect(result).toEqual({
      data: { logo: null },
      message: "Tenant logo removed successfully",
      status: 200,
    });
  });

  it.each([null, "default.svg"])(
    "no logo of its own (%s): nothing changes, nothing is audited or deleted",
    async (logo) => {
      const row = tenantRow({ logo });
      Tenants.findByPk.mockResolvedValue(row);

      const result = await removeTenantLogo(TENANT, "user-1", own);

      expect(row.update).not.toHaveBeenCalled();
      expect(auditService.logAction).not.toHaveBeenCalled();
      expect(deleteUpload).not.toHaveBeenCalled();
      expect(mockEvents).toEqual(["rollback"]);
      expect(result.status).toBe(200);
    },
  );

  it("with no actor at all, refuses (the actor defaults to nobody)", async () => {
    Tenants.findByPk.mockResolvedValue(tenantRow());

    const err = await removeTenantLogo(TENANT, "user-1").catch((e) => e);

    expect(err.status).toBe(404);
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("a missing tenant is 404, rethrown untouched", async () => {
    Tenants.findByPk.mockResolvedValue(null);

    const err = await removeTenantLogo(TENANT, "user-1", own).catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(404);
  });

  it("an unexpected failure is wrapped as a 500 after rolling back", async () => {
    Tenants.findByPk.mockRejectedValue(new Error("db down"));

    const err = await removeTenantLogo(TENANT, "user-1", own).catch((e) => e);

    expect(err.status).toBe(500);
    expect(err.message).toBe("Failed to remove tenant logo");
    expect(logger.error).toHaveBeenCalledWith("Error removing tenant logo", {
      error: "db down",
    });
    expect(mockEvents).toEqual(["rollback"]);
  });

  it("a rollback that itself fails does not mask the original error", async () => {
    Tenants.findByPk.mockRejectedValue(new Error("db down"));
    db.transaction.mockResolvedValueOnce({
      commit: jest.fn(),
      rollback: jest.fn().mockRejectedValue(new Error("already finished")),
    });

    const err = await removeTenantLogo(TENANT, "user-1", own).catch((e) => e);

    expect(err.message).toBe("Failed to remove tenant logo");
  });
});
