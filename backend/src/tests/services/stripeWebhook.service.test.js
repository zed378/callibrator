jest.mock("../../models", () => ({
  Subscription: { findOne: jest.fn() },
  Invoice: { findOne: jest.fn(), create: jest.fn() },
  // A-276 (ADR-094): status decisions read the tenant and save it in a
  // transaction with their audit rows. No tenant row unless a test sets one.
  Tenant: { update: jest.fn(), findByPk: jest.fn().mockResolvedValue(null) },
  TenantSettings: { upsert: jest.fn() },
}));
jest.mock("../../config", () => ({ db: { transaction: jest.fn(async (cb) => cb("tx")) } }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));

/** A tenant row as the webhook reads it, whose save() records nothing. */
const tenantRow = (values) => ({ id: "t1", status: "active", suspensionReason: null, suspendedBy: null, save: jest.fn(), ...values });
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const stripeWebhook = require("../../services/stripeWebhook.service");
const { Subscription, Invoice, Tenant } = require("../../models");

describe("stripeWebhook.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Invoice.findOne.mockResolvedValue(null);
    Invoice.create.mockResolvedValue({});
  });

  describe("constructEvent (dev bypass, no signing secret)", () => {
    it("parses the raw JSON body outside production", () => {
      const buf = Buffer.from(JSON.stringify({ type: "x", data: { object: {} } }));
      expect(stripeWebhook.constructEvent(buf, "sig").type).toBe("x");
    });
  });

  describe("handleEvent", () => {
    it("invoice.paid → subscription Active, tenant active, invoice recorded", async () => {
      const sub = { id: "sub1", tenantId: "t1", status: "PastDue", update: jest.fn() };
      Subscription.findOne.mockResolvedValue(sub);
      const tenant = tenantRow({ status: "suspended", suspensionReason: "billing:dunning" });
      Tenant.findByPk.mockResolvedValueOnce(tenant);
      const r = await stripeWebhook.handleEvent({
        type: "invoice.paid",
        data: { object: { id: "in1", subscription: "s", amount_paid: 5000, currency: "usd" } },
      });
      expect(r.handled).toBe(true);
      expect(sub.update).toHaveBeenCalledWith({ status: "Active" });
      expect(tenant.status).toBe("active");
      expect(tenant.save).toHaveBeenCalledWith({ transaction: "tx" });
    });

    it("repeated payment_failure (already PastDue) suspends the tenant", async () => {
      const sub = { id: "sub1", tenantId: "t1", status: "PastDue", update: jest.fn() };
      Subscription.findOne.mockResolvedValue(sub);
      const tenant = tenantRow();
      Tenant.findByPk.mockResolvedValueOnce(tenant);
      const r = await stripeWebhook.handleEvent({
        type: "invoice.payment_failed",
        data: { object: { id: "in2", subscription: "s", attempt_count: 1 } },
      });
      expect(r.suspended).toBe(true);
      expect(tenant).toMatchObject({ status: "suspended", suspensionReason: "billing:dunning", suspendedBy: null });
    });

    it("subscription.updated maps status + plan and updates tenant plan", async () => {
      const sub = { id: "sub1", tenantId: "t1", status: "Active", planId: "professional", update: jest.fn() };
      Subscription.findOne.mockResolvedValue(sub);
      // A-305: the plan is written on the locked row, in a transaction, audited.
      const tenant = { id: "t1", status: "active", plan: "professional", save: jest.fn() };
      Tenant.findByPk.mockResolvedValueOnce(tenant);
      const r = await stripeWebhook.handleEvent({
        type: "customer.subscription.updated",
        data: { object: { id: "s", status: "active", metadata: { plan: "business" } } },
      });
      expect(r.status).toBe("Active");
      expect(sub.update).toHaveBeenCalledWith(expect.objectContaining({ planId: "business" }));
      expect(tenant.plan).toBe("business");
      expect(tenant.save).toHaveBeenCalledWith({ transaction: "tx" });
    });

    it("returns handled:false when the subscription is not found", async () => {
      Subscription.findOne.mockResolvedValue(null);
      const r = await stripeWebhook.handleEvent({
        type: "invoice.paid",
        data: { object: { id: "in", subscription: "nope" } },
      });
      expect(r.handled).toBe(false);
    });
  });
});
