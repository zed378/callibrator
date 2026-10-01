/**
 * W-21 (ADR-079) — a grace period can be set only on a SUSPENDED tenant.
 *
 * `enterGracePeriod` used to accept any tenant and stamp the deadline. On an
 * active tenant the deadline waited silently; a suspension after it had passed
 * was offboarded by the next scheduler run (tenantLifecycle#runLifecycleChecks
 * offboards a suspended tenant whose deadline is past), with no grace at all.
 * Any other state is now a 409 that explains the state, and nothing is saved.
 */
jest.mock("../../models", () => ({
  Tenant: { findByPk: jest.fn() },
  TenantSettings: {},
  User: {},
  Subscription: {},
  Invoice: {},
}));
// A-278 (ADR-094): the deadline is saved in a transaction with its audit rows.
jest.mock("../../config", () => ({ db: { transaction: jest.fn(async (cb) => cb("tx")) } }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

const tenantLifecycle = require("../../services/tenantLifecycle.service");
const { Tenant } = require("../../models");

const tenant = (status) => ({ id: "t1", status, gracePeriodExpiresAt: null, save: jest.fn() });

describe("W-21 — enterGracePeriod accepts only a suspended tenant", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(["active", "trial", "deleted"])(
    "a %s tenant is refused with 409, naming its state, and no deadline is saved",
    async (status) => {
      const row = tenant(status);
      Tenant.findByPk.mockResolvedValue(row);

      const err = await tenantLifecycle.enterGracePeriod("t1").catch((e) => e);

      expect(err.status).toBe(409);
      expect(err.message).toContain(`"${status}", not suspended`);
      expect(row.save).not.toHaveBeenCalled();
      expect(row.gracePeriodExpiresAt).toBeNull();
    },
  );

  it("a suspended tenant gets a deadline in the future", async () => {
    const row = tenant("suspended");
    Tenant.findByPk.mockResolvedValue(row);

    await tenantLifecycle.enterGracePeriod("t1");

    expect(row.save).toHaveBeenCalledTimes(1);
    expect(row.gracePeriodExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("an unknown tenant is still a 404, before any state check", async () => {
    Tenant.findByPk.mockResolvedValue(null);
    await expect(tenantLifecycle.enterGracePeriod("t1")).rejects.toMatchObject({ status: 404 });
  });
});
