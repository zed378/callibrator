jest.mock("../../models", () => ({
  Subscription: { findOne: jest.fn() },
  Invoice: { findOrCreate: jest.fn() },
  Tenant: { update: jest.fn() },
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const stripeWebhook = require("../../services/stripeWebhook.service");
const { Subscription, Invoice, Tenant } = require("../../models");

describe("stripeWebhook.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Invoice.findOrCreate.mockResolvedValue([{}, true]);
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
      const r = await stripeWebhook.handleEvent({
        type: "invoice.paid",
        data: { object: { id: "in1", subscription: "s", amount_paid: 5000, currency: "usd" } },
      });
      expect(r.handled).toBe(true);
      expect(sub.update).toHaveBeenCalledWith({ status: "Active" });
      expect(Tenant.update).toHaveBeenCalledWith({ status: "active" }, expect.anything());
    });

    it("repeated payment_failure (already PastDue) suspends the tenant", async () => {
      const sub = { id: "sub1", tenantId: "t1", status: "PastDue", update: jest.fn() };
      Subscription.findOne.mockResolvedValue(sub);
      const r = await stripeWebhook.handleEvent({
        type: "invoice.payment_failed",
        data: { object: { id: "in2", subscription: "s", attempt_count: 1 } },
      });
      expect(r.suspended).toBe(true);
      expect(Tenant.update).toHaveBeenCalledWith({ status: "suspended" }, expect.anything());
    });

    it("subscription.updated maps status + plan and updates tenant plan", async () => {
      const sub = { id: "sub1", tenantId: "t1", status: "Active", planId: "professional", update: jest.fn() };
      Subscription.findOne.mockResolvedValue(sub);
      const r = await stripeWebhook.handleEvent({
        type: "customer.subscription.updated",
        data: { object: { id: "s", status: "active", metadata: { plan: "business" } } },
      });
      expect(r.status).toBe("Active");
      expect(sub.update).toHaveBeenCalledWith(expect.objectContaining({ planId: "business" }));
      expect(Tenant.update).toHaveBeenCalledWith({ plan: "business" }, expect.anything());
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
