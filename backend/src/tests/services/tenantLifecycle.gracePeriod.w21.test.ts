/**
 * W-21 (ADR-079) -- a grace period can be set only on a SUSPENDED tenant.
 *
 * `enterGracePeriod` used to accept any tenant and stamp the deadline. On an
 * active tenant the deadline waited silently; a suspension after it had passed
 * was offboarded by the next scheduler run (tenantLifecycle#runLifecycleChecks
 * offboards a suspended tenant whose deadline is past), with no grace at all.
 * Any other state is now a 409 that explains the state, and nothing is saved.
 */
import type * as TenantLifecycleModule from "../../services/tenantLifecycle.service";
import type { TenantId } from "../../types/ids";

jest.mock("../../models", () => ({
  Tenant: { findByPk: jest.fn() },
  TenantSettings: {},
  User: {},
  Subscription: {},
  Invoice: {},
}));
// A-278 (ADR-094): the deadline is saved in a transaction with its audit rows.
jest.mock("../../config", () => ({
  db: { transaction: jest.fn((cb: (tx: string) => unknown) => Promise.resolve(cb("tx"))) },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const tenantLifecycle = require("../../services/tenantLifecycle.service") as typeof TenantLifecycleModule;
const { Tenant } = require("../../models") as {
  Tenant: { findByPk: jest.Mock };
};
/* eslint-enable @typescript-eslint/no-require-imports */

interface TenantRow {
  id: string;
  status: string;
  gracePeriodExpiresAt: Date | null;
  save: jest.Mock;
}

const TID = "t1" as TenantId;

const tenant = (status: string): TenantRow => ({
  id: "t1",
  status,
  gracePeriodExpiresAt: null,
  save: jest.fn(),
});

describe("W-21 -- enterGracePeriod accepts only a suspended tenant", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(["active", "trial", "deleted"])(
    "a %s tenant is refused with 409, naming its state, and no deadline is saved",
    async (status: string) => {
      const row = tenant(status);
      Tenant.findByPk.mockResolvedValue(row);

      const err = (await tenantLifecycle.enterGracePeriod(TID).catch((e: unknown) => e)) as {
        status: number;
        message: string;
      };

      expect(err.status).toBe(409);
      expect(err.message).toContain(`"${status}", not suspended`);
      expect(row.save).not.toHaveBeenCalled();
      expect(row.gracePeriodExpiresAt).toBeNull();
    },
  );

  it("a suspended tenant gets a deadline in the future", async () => {
    const row = tenant("suspended");
    Tenant.findByPk.mockResolvedValue(row);

    await tenantLifecycle.enterGracePeriod(TID);

    expect(row.save).toHaveBeenCalledTimes(1);
    expect((row.gracePeriodExpiresAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("an unknown tenant is still a 404, before any state check", async () => {
    Tenant.findByPk.mockResolvedValue(null);
    await expect(tenantLifecycle.enterGracePeriod(TID)).rejects.toMatchObject({ status: 404 });
  });
});
