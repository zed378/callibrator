/**
 * A-276 (ADR-094) — a billing event lifts only dunning's own suspension.
 *
 * Before: `invoice.paid` and a subscription update to Active set the tenant
 * `active` unconditionally, and repeated failure set it `suspended`, with no
 * audit row: a payment lifted a suspension the platform operator imposed and
 * re-activated an offboarded tenant. Now dunning marks its suspension
 * (reason `billing:dunning`, no `suspended_by`), a payment lifts only that
 * one, and every decision is recorded under PLATFORM and the tenant by
 * `system:billing-webhook`, naming the Stripe event, in the same transaction
 * as the tenant write.
 *
 * REAL stripeWebhook service, audit service, models (fixtures/memoryDb).
 * The webhook runs with no principal, so the tenant hooks skip, as live.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { TwoTenantWorld } from "../fixtures/routeClient";
import type { Row } from "../fixtures/memoryDb";

/** An asymmetric matcher, typed so it can sit inside an object literal. */
const containing = (fields: Record<string, unknown>): unknown =>
  expect.objectContaining(fields) as unknown;

jest.mock("../../config", () => ({
  db: jest
    .requireActual<typeof MemoryDbModule>("../fixtures/memoryDb")
    .memoryDb().sequelize,
}));

const mdb = jest
  .requireActual<typeof MemoryDbModule>("../fixtures/memoryDb")
  .memoryDb();
const { twoTenants, seedTenants } = jest.requireActual<typeof RouteClient>(
  "../fixtures/routeClient",
);
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a CommonJS service, loaded after the mocks
const stripeWebhook = require("../../services/stripeWebhook.service") as {
  handleEvent: (event: object) => Promise<Record<string, unknown>>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS constants
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant") as {
  PLATFORM_TENANT_ID: string;
};

const OPERATOR = "0a000000-0000-4000-8000-0000000000aa";
const SUB_ID = "5b000000-0000-4000-8000-000000000001";

let fx: TwoTenantWorld;

const tenantA = (): Row =>
  mdb.rows("Tenant").find((t) => t["id"] === fx.tenantA.id) ?? {};

const seed = (tenant: Record<string, unknown>, subStatus = "PastDue"): void => {
  seedTenants(mdb, fx, [], { a: tenant });
  mdb.seed("Subscription", {
    id: SUB_ID,
    tenantId: fx.tenantA.id,
    planId: "professional",
    status: subStatus,
    billingCycle: "monthly",
    stripeSubscriptionId: "sub_stripe_1",
    stripeCustomerId: "cus_1",
  });
};

const paid = (eventId = "evt_paid"): Promise<Record<string, unknown>> =>
  stripeWebhook.handleEvent({
    id: eventId,
    type: "invoice.paid",
    data: {
      object: {
        id: "in_1",
        subscription: "sub_stripe_1",
        amount_paid: 5000,
        currency: "usd",
      },
    },
  });

const failed = (): Promise<Record<string, unknown>> =>
  stripeWebhook.handleEvent({
    id: "evt_failed",
    type: "invoice.payment_failed",
    data: {
      object: { id: "in_2", subscription: "sub_stripe_1", attempt_count: 3 },
    },
  });

/** Committed audit rows, and whether each shares its transaction with a Tenant write. */
const decisions = (): { rows: Row[]; withTenantWrite: boolean } => {
  const committed = mdb.committed();
  const tenantTx = new Set(
    committed.filter((w) => w.model === "Tenant").map((w) => w.tx),
  );
  const auditTx = committed
    .filter((w) => w.model === "AuditLog")
    .map((w) => w.tx);
  return {
    rows: mdb.rows("AuditLog"),
    withTenantWrite: auditTx.every((tx) => tx !== null && tenantTx.has(tx)),
  };
};

beforeEach(() => {
  mdb.reset();
  fx = twoTenants();
});

describe("A-276 — a payment never lifts the operator's suspension", () => {
  it("invoice.paid leaves an operator-suspended tenant suspended, and records that the payment arrived", async () => {
    seed({
      status: "suspended",
      suspendedBy: OPERATOR,
      suspensionReason: "contract review",
    });

    const result = await paid();

    expect(result["tenant"]).toBe("kept");
    expect(tenantA()).toMatchObject({
      status: "suspended",
      suspendedBy: OPERATOR,
      suspensionReason: "contract review",
    });
    expect(mdb.rows("AuditLog")).toEqual([
      expect.objectContaining({
        tenantId: PLATFORM_TENANT_ID,
        actorName: "system:billing-webhook",
      }),
      expect.objectContaining({
        tenantId: fx.tenantA.id,
        actorType: "system",
        actorName: "system:billing-webhook",
        userId: null,
        action: "UPDATE",
        resourceType: "Tenant",
        resourceId: fx.tenantA.id,
        changes: containing({
          operation: "BILLING_PAYMENT_STATUS_KEPT",
          stripeEventId: "evt_paid",
        }),
      }),
    ]);
  });

  it("invoice.paid does not re-activate an offboarded tenant", async () => {
    seed({ status: "deleted", offboardedAt: new Date() });

    await paid();

    expect(tenantA()["status"]).toBe("deleted");
  });

  it("a subscription update to Active does not lift an operator suspension either", async () => {
    seed({
      status: "suspended",
      suspendedBy: OPERATOR,
      suspensionReason: "billing:dunning",
    });

    await stripeWebhook.handleEvent({
      id: "evt_sub",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_stripe_1", status: "active" } },
    });

    // The operator typed dunning's reason, but named themselves: still theirs.
    expect(tenantA()).toMatchObject({
      status: "suspended",
      suspendedBy: OPERATOR,
    });
  });
});

describe("A-276 — dunning suspends, and a payment lifts, dunning's own suspension", () => {
  it("repeated failure suspends an active tenant with dunning's mark, audited in the tenant write's transaction", async () => {
    seed({ status: "active" });

    const result = await failed();

    expect(result["suspended"]).toBe(true);
    expect(tenantA()).toMatchObject({
      status: "suspended",
      suspensionReason: "billing:dunning",
      suspendedBy: null,
    });
    const { rows, withTenantWrite } = decisions();
    expect(
      rows.map((r) => [
        r["tenantId"],
        (r["changes"] as Record<string, unknown>)["operation"],
      ]),
    ).toEqual([
      [PLATFORM_TENANT_ID, "BILLING_DUNNING_SUSPEND"],
      [fx.tenantA.id, "BILLING_DUNNING_SUSPEND"],
    ]);
    expect(withTenantWrite).toBe(true);
    expect(mdb.rows("TenantSettings")).toEqual([
      expect.objectContaining({
        tenantId: fx.tenantA.id,
        key: "lifecycle_status",
        value: "SUSPENDED",
      }),
    ]);
  });

  it("dunning does not relabel an operator's suspension as its own", async () => {
    seed({
      status: "suspended",
      suspendedBy: OPERATOR,
      suspensionReason: "contract review",
    });

    const result = await failed();

    expect(result["suspended"]).toBe(false);
    expect(tenantA()).toMatchObject({
      suspendedBy: OPERATOR,
      suspensionReason: "contract review",
    });
    expect(mdb.rows("AuditLog")).toEqual([]);
  });

  it("the payment that follows lifts dunning's suspension, audited in the same transaction", async () => {
    seed({ status: "active" });
    await failed();

    const result = await paid("evt_paid_after");

    expect(result["tenant"]).toBe("lifted");
    expect(tenantA()).toMatchObject({
      status: "active",
      suspensionReason: null,
      suspendedBy: null,
    });
    const { rows, withTenantWrite } = decisions();
    expect(
      rows.map((r) => (r["changes"] as Record<string, unknown>)["operation"]),
    ).toEqual([
      "BILLING_DUNNING_SUSPEND",
      "BILLING_DUNNING_SUSPEND",
      "BILLING_DUNNING_LIFTED",
      "BILLING_DUNNING_LIFTED",
    ]);
    expect(withTenantWrite).toBe(true);
  });

  it("a payment for an active tenant changes nothing and records nothing", async () => {
    seed({ status: "active" }, "Active");

    const result = await paid();

    expect(result["tenant"]).toBe("active");
    expect(mdb.rows("AuditLog")).toEqual([]);
  });
});
