/**
 * A-305 (ADR-100) — a Stripe plan change is audited.
 *
 * Before: `customer.subscription.updated` and `.deleted` wrote `tenants.plan`
 * (which drives feature gating) with a bare `Tenant.update` — no transaction
 * and no audit row, so nothing recorded that a tenant's plan changed, from
 * what, or on which Stripe event. Now the change is written in a transaction
 * with two rows (PLATFORM and the tenant, the A-165 rule, as A-276 does for
 * dunning), actor `system:billing-webhook`, naming the Stripe event id and the
 * plan before and after. An unchanged plan writes nothing.
 *
 * REAL stripeWebhook service, audit service, models (fixtures/memoryDb).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { TwoTenantWorld } from "../fixtures/routeClient";
import type { Row } from "../fixtures/memoryDb";

const containing = (fields: Record<string, unknown>): unknown => expect.objectContaining(fields) as unknown;

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a CommonJS service, loaded after the mocks
const stripeWebhook = require("../../services/stripeWebhook.service") as {
  handleEvent: (event: object) => Promise<Record<string, unknown>>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS constants
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant") as { PLATFORM_TENANT_ID: string };

const SUB_ID = "5b000000-0000-4000-8000-000000000002";

let fx: TwoTenantWorld;

const tenantA = (): Row => mdb.rows("Tenant").find((t) => t["id"] === fx.tenantA.id) ?? {};

beforeEach(() => {
  mdb.reset();
  fx = twoTenants();
  seedTenants(mdb, fx, [], { a: { status: "active", plan: "professional" } });
  mdb.seed("Subscription", {
    id: SUB_ID,
    tenantId: fx.tenantA.id,
    planId: "professional",
    status: "PastDue",
    billingCycle: "monthly",
    stripeSubscriptionId: "sub_stripe_2",
    stripeCustomerId: "cus_2",
  });
});

const updated = (plan: string, eventId = "evt_plan"): Promise<Record<string, unknown>> =>
  stripeWebhook.handleEvent({
    id: eventId,
    type: "customer.subscription.updated",
    data: { object: { id: "sub_stripe_2", customer: "cus_2", status: "past_due", metadata: { plan } } },
  });

/** The committed audit rows, and whether each shares its transaction with a Tenant write. */
const planRows = (): { rows: Row[]; withTenantWrite: boolean } => {
  const committed = mdb.committed();
  const tenantTx = new Set(committed.filter((w) => w.model === "Tenant").map((w) => w.tx));
  const auditTx = committed.filter((w) => w.model === "AuditLog").map((w) => w.tx);
  return {
    rows: mdb.rows("AuditLog"),
    withTenantWrite: auditTx.length > 0 && auditTx.every((tx) => tx !== null && tenantTx.has(tx)),
  };
};

const byWebhook = (tenantId: string, eventId: string, before: string, after: string): unknown =>
  containing({
    tenantId,
    userId: null,
    actorType: "system",
    actorName: "system:billing-webhook",
    action: "UPDATE",
    resourceType: "Tenant",
    resourceId: fx.tenantA.id,
    changes: containing({
      operation: "BILLING_PLAN_CHANGE",
      stripeEventId: eventId,
      before: { plan: before },
      after: { plan: after },
    }),
  });

describe("A-305 — a Stripe plan change is audited under PLATFORM and the tenant", () => {
  it("customer.subscription.updated to another plan: the plan changes, with two rows in its transaction", async () => {
    await updated("enterprise", "evt_upgrade");

    expect(tenantA()).toMatchObject({ plan: "enterprise" });
    const { rows, withTenantWrite } = planRows();
    expect(rows).toEqual([
      byWebhook(PLATFORM_TENANT_ID, "evt_upgrade", "professional", "enterprise"),
      byWebhook(fx.tenantA.id, "evt_upgrade", "professional", "enterprise"),
    ]);
    expect(withTenantWrite).toBe(true);
  });

  it("customer.subscription.deleted: the downgrade to free is recorded the same way", async () => {
    await stripeWebhook.handleEvent({
      id: "evt_cancel",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_stripe_2", customer: "cus_2" } },
    });

    expect(tenantA()).toMatchObject({ plan: "free" });
    expect(planRows().rows).toEqual([
      byWebhook(PLATFORM_TENANT_ID, "evt_cancel", "professional", "free"),
      byWebhook(fx.tenantA.id, "evt_cancel", "professional", "free"),
    ]);
  });

  it("the same plan again writes nothing and records nothing", async () => {
    await updated("professional");

    expect(tenantA()).toMatchObject({ plan: "professional" });
    expect(mdb.rows("AuditLog")).toEqual([]);
  });

  it("a plan that is not a tenant plan changes nothing and records nothing", async () => {
    await updated("platinum-deluxe");

    expect(tenantA()).toMatchObject({ plan: "professional" });
    expect(mdb.rows("AuditLog")).toEqual([]);
  });
});
