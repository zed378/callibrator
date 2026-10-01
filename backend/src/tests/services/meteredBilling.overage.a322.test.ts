/**
 * A-322 — quota enforcement suspends only a free-plan tenant, and a suspension
 * it makes is marked, audited and transactional (the A-276 / ADR-094 rules for
 * billing suspensions).
 *
 * `handleOverage` decided "free tier" by `tenant.subscriptionId`, an attribute
 * the Tenant model does not have, so EVERY over-quota tenant — a paying
 * business-plan hospital included — was suspended with a bare
 * `tenant.update({ status: "suspended" })`: no reason, no audit row, and an
 * operator's suspension or an offboarding overwritten. Nothing calls
 * `enforceQuotas` today (the defect was latent); these tests pin the contract
 * before anything does.
 *
 * Now, as dunning does (stripeWebhook.service):
 *  - a paid plan (`Tenant.plan` other than free, which the Stripe webhooks keep
 *    in step with the subscription) is never suspended — the overage is logged;
 *  - only an ACTIVE free-plan tenant is suspended, marked as the system's
 *    (`suspension_reason` = "billing:quota", no `suspended_by`), with the
 *    lifecycle setting and one audit row under PLATFORM and one under the
 *    tenant, actor `system:usage-quota`, all in one transaction;
 *  - a tenant already suspended (by anyone) or offboarded is left as it is.
 *
 * REAL service, audit service and models on memoryDb. Only the usage figure is
 * a double: `checkQuota` (its SQL aggregate has its own suite).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { TwoTenantWorld } from "../fixtures/routeClient";
import type { Row } from "../fixtures/memoryDb";
import type MeteredBilling from "../../services/meteredBilling.service";
import type AuditService from "../../services/audit.service";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const metered = jest.requireActual<typeof MeteredBilling>("../../services/meteredBilling.service");
const auditService = jest.requireActual<typeof AuditService>("../../services/audit.service");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS constants
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant") as { PLATFORM_TENANT_ID: string };

/** An asymmetric matcher, typed so it can sit inside an object literal. */
const containing = (fields: Record<string, unknown>): unknown => expect.objectContaining(fields) as unknown;

const OPERATOR = "0a000000-0000-4000-8000-0000000000aa";
let fx: TwoTenantWorld;

const tenantA = (): Row => mdb.rows("Tenant").find((t) => t["id"] === fx.tenantA.id) ?? {};

const seed = (tenant: Record<string, unknown>): void => {
  seedTenants(mdb, fx, [], { a: tenant });
  mdb.seed("PlanQuota", [
    { id: "9a000000-0000-4000-8000-000000000001", tenantId: fx.tenantA.id, metric: "api_calls", limit: 100 },
    { id: "9a000000-0000-4000-8000-000000000002", tenantId: fx.tenantA.id, metric: "users", limit: 5 },
  ]);
};

beforeEach(() => {
  mdb.reset();
  jest.restoreAllMocks();
  fx = twoTenants();
  // api_calls is over its quota by 20; users is within.
  jest.spyOn(metered, "checkQuota").mockImplementation((_tenantId, metric, limit) => {
    const usage = metric === "api_calls" ? 120 : 1;
    return Promise.resolve({ exceeded: usage >= limit, usage, limit, percentage: 100, remaining: 0 });
  });
});

describe("A-322 — a paid plan is never suspended for an overage", () => {
  it.each(["professional", "business", "enterprise"])("plan %s: the overage is reported, the tenant stays active, nothing is written", async (plan) => {
    seed({ status: "active", plan });

    const result = await metered.enforceQuotas(fx.tenantA.id as never);

    expect(result.violations).toEqual([expect.objectContaining({ metric: "api_calls", overage: 20 })]);
    expect(tenantA()["status"]).toBe("active");
    expect(mdb.writes()).toEqual([]);
  });
});

describe("A-322 — a free-plan tenant's suspension is marked, audited and atomic", () => {
  it.each([["free"], [null]])("plan %s: suspended as the system's, with the lifecycle setting and two audit rows in one transaction", async (plan) => {
    seed({ status: "active", plan });

    await metered.enforceQuotas(fx.tenantA.id as never);

    expect(tenantA()).toMatchObject({ status: "suspended", suspensionReason: "billing:quota", suspendedBy: null });
    expect(tenantA()["suspendedAt"]).toBeInstanceOf(Date);
    expect(mdb.rows("TenantSettings")).toEqual([
      expect.objectContaining({ tenantId: fx.tenantA.id, key: "lifecycle_status", value: "SUSPENDED" }),
    ]);

    const rows = mdb.rows("AuditLog");
    expect(rows.map((r) => r["tenantId"]).sort()).toEqual([PLATFORM_TENANT_ID, fx.tenantA.id].sort());
    for (const row of rows) {
      expect(row).toMatchObject({
        actorType: "system",
        actorName: "system:usage-quota",
        userId: null,
        action: "UPDATE",
        resourceType: "Tenant",
        resourceId: fx.tenantA.id,
        changes: expect.objectContaining({
          operation: "BILLING_QUOTA_SUSPEND",
          metric: "api_calls",
          overage: 20,
          before: containing({ status: "active" }),
          after: containing({ status: "suspended", suspensionReason: "billing:quota" }),
        }) as unknown,
      });
    }

    const committed = mdb.committed();
    const tenantTx = committed.filter((w) => w.model === "Tenant").map((w) => w.tx);
    expect(tenantTx).toHaveLength(1);
    expect(tenantTx[0]).not.toBeNull();
    for (const w of committed.filter((c) => c.model === "AuditLog" || c.model === "TenantSettings")) {
      expect(w.tx).toBe(tenantTx[0]);
    }
  });

  it("a failed audit row leaves the tenant active (the suspension rolls back)", async () => {
    seed({ status: "active", plan: "free" });
    jest.spyOn(auditService, "logAction").mockRejectedValue(new Error("audit insert failed"));

    await expect(metered.enforceQuotas(fx.tenantA.id as never)).rejects.toThrow("audit insert failed");

    expect(tenantA()["status"]).toBe("active");
    expect(mdb.committed()).toEqual([]);
  });
});

describe("A-322 — a tenant not active is left as it is", () => {
  it("an operator's suspension keeps its reason and operator", async () => {
    seed({ status: "suspended", plan: "free", suspendedBy: OPERATOR, suspensionReason: "contract review" });

    await metered.enforceQuotas(fx.tenantA.id as never);

    expect(tenantA()).toMatchObject({ status: "suspended", suspendedBy: OPERATOR, suspensionReason: "contract review" });
    expect(mdb.writes()).toEqual([]);
  });

  it("an offboarded tenant stays offboarded", async () => {
    seed({ status: "offboarded", plan: "free" });

    await metered.enforceQuotas(fx.tenantA.id as never);

    expect(tenantA()["status"]).toBe("offboarded");
    expect(mdb.writes()).toEqual([]);
  });

  it("control: within quota, nothing happens", async () => {
    seed({ status: "active", plan: "free" });
    jest.spyOn(metered, "checkQuota").mockResolvedValue({ exceeded: false, usage: 1, limit: 100, percentage: 1, remaining: 99 });

    const result = await metered.enforceQuotas(fx.tenantA.id as never);

    expect(result).toEqual({ enforced: false, violations: [] });
    expect(tenantA()["status"]).toBe("active");
    expect(mdb.writes()).toEqual([]);
  });
});
