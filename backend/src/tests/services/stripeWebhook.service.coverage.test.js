/**
 * Branch/line coverage tests for stripeWebhook.service.js
 *
 * Complements stripeWebhook.service.test.js — targets constructEvent (signed +
 * production + dev-bypass), findSubscription fallbacks, the dunning branches,
 * subscription.updated period/plan patches, subscription.deleted and the
 * unhandled-event default.
 */

const mockStripeConstructEvent = jest.fn();
const mockStripeFactory = jest.fn(() => ({
  webhooks: { constructEvent: mockStripeConstructEvent },
}));

jest.mock("stripe", () => mockStripeFactory);
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
const { logger } = require("../../middlewares/activityLog.middleware");

// WEBHOOK_SECRET / NODE_ENV are read at module load, so these tests re-require
// the service inside an isolated module registry with the env they need.
const loadWith = (env) => {
  const saved = {
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  };
  let mod;
  try {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    jest.isolateModules(() => {
      mod = require("../../services/stripeWebhook.service");
    });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
  return mod;
};

describe("stripeWebhook.service (coverage)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Invoice.findOrCreate.mockResolvedValue([{}, true]);
    Tenant.update.mockResolvedValue([1]);
  });

  // ================================================================
  describe("constructEvent", () => {
    it("verifies the signature via the Stripe SDK when a signing secret is set", () => {
      const svc = loadWith({ STRIPE_WEBHOOK_SECRET: "whsec_test" });
      const parsed = { type: "invoice.paid", data: { object: {} } };
      mockStripeConstructEvent.mockReturnValue(parsed);

      const raw = Buffer.from("{}");
      const result = svc.constructEvent(raw, "t=1,v1=abc");

      expect(result).toBe(parsed);
      expect(mockStripeConstructEvent).toHaveBeenCalledWith(
        raw,
        "t=1,v1=abc",
        "whsec_test",
      );
    });

    it("instantiates the Stripe client only once (caches it across calls)", () => {
      const svc = loadWith({ STRIPE_WEBHOOK_SECRET: "whsec_test" });
      mockStripeConstructEvent.mockReturnValue({ type: "x" });

      svc.constructEvent(Buffer.from("{}"), "sig");
      svc.constructEvent(Buffer.from("{}"), "sig");

      expect(mockStripeConstructEvent).toHaveBeenCalledTimes(2);
      expect(mockStripeFactory).toHaveBeenCalledTimes(1);
    });

    it("throws in production when no signing secret is configured", () => {
      // WEBHOOK_SECRET is captured at module load; NODE_ENV is read at call time.
      const svc = loadWith({ STRIPE_WEBHOOK_SECRET: undefined });
      const savedNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      try {
        expect(() => svc.constructEvent(Buffer.from("{}"), "sig")).toThrow(
          "STRIPE_WEBHOOK_SECRET is not configured",
        );
      } finally {
        process.env.NODE_ENV = savedNodeEnv;
      }

      expect(mockStripeFactory).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("accepts an unverified string body off-production and warns", () => {
      const svc = loadWith({
        STRIPE_WEBHOOK_SECRET: undefined,
        NODE_ENV: "test",
      });

      const event = svc.constructEvent(
        JSON.stringify({ type: "invoice.paid", data: { object: { id: "in1" } } }),
        "sig",
      );

      expect(event.type).toBe("invoice.paid");
      expect(event.data.object.id).toBe("in1");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("STRIPE_WEBHOOK_SECRET not set"),
      );
    });
  });

  // ================================================================
  describe("findSubscription fallbacks", () => {
    it("falls back to the customer lookup when the subscription id misses", async () => {
      const sub = { id: "sub1", tenantId: "t1", status: "Active", update: jest.fn() };
      Subscription.findOne
        .mockResolvedValueOnce(null) // by stripeSubscriptionId
        .mockResolvedValueOnce(sub); // by stripeCustomerId

      const r = await stripeWebhook.handleEvent({
        type: "invoice.paid",
        data: { object: { id: "in1", subscription: "sub_x", customer: "cus_1" } },
      });

      expect(r).toEqual({ handled: true, subscriptionId: "sub1" });
      expect(Subscription.findOne).toHaveBeenNthCalledWith(1, {
        where: { stripeSubscriptionId: "sub_x" },
      });
      expect(Subscription.findOne).toHaveBeenNthCalledWith(2, {
        where: { stripeCustomerId: "cus_1" },
      });
    });

    it("does not query at all when neither subscription nor customer id is present", async () => {
      const r = await stripeWebhook.handleEvent({
        type: "invoice.paid",
        data: { object: { id: "in1" } },
      });

      expect(r).toEqual({ handled: false, reason: "subscription not found" });
      expect(Subscription.findOne).not.toHaveBeenCalled();
    });

    it("treats a missing event.data as an empty object", async () => {
      const r = await stripeWebhook.handleEvent({ type: "invoice.paid" });

      expect(r).toEqual({ handled: false, reason: "subscription not found" });
      expect(Subscription.findOne).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  describe("invoice.paid", () => {
    it("defaults amount/currency/url when Stripe omits them", async () => {
      const sub = { id: "sub1", tenantId: "t1", status: "Active", update: jest.fn() };
      Subscription.findOne.mockResolvedValue(sub);

      await stripeWebhook.handleEvent({
        type: "invoice.payment_succeeded",
        data: { object: { id: "in_bare", subscription: "sub_x" } },
      });

      expect(Invoice.findOrCreate).toHaveBeenCalledWith({
        where: { stripeInvoiceId: "in_bare" },
        defaults: {
          tenantId: "t1",
          subscriptionId: "sub1",
          amountDue: 0,
          amountPaid: 0,
          currency: "USD",
          status: "Paid",
          invoiceUrl: null,
          stripeInvoiceId: "in_bare",
        },
      });
    });

    it("converts Stripe minor units to major and keeps the hosted invoice url", async () => {
      const sub = { id: "sub1", tenantId: "t1", status: "PastDue", update: jest.fn() };
      Subscription.findOne.mockResolvedValue(sub);

      await stripeWebhook.handleEvent({
        type: "invoice.paid",
        data: {
          object: {
            id: "in1",
            subscription: "sub_x",
            amount_due: 12345,
            amount_paid: 12345,
            currency: "eur",
            hosted_invoice_url: "https://stripe.test/i/1",
          },
        },
      });

      expect(Invoice.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          defaults: expect.objectContaining({
            amountDue: 123.45,
            amountPaid: 123.45,
            currency: "EUR",
            invoiceUrl: "https://stripe.test/i/1",
          }),
        }),
      );
    });

    it("skips the tenant update when the subscription has no tenant", async () => {
      const sub = { id: "sub1", tenantId: null, status: "Active", update: jest.fn() };
      Subscription.findOne.mockResolvedValue(sub);

      const r = await stripeWebhook.handleEvent({
        type: "invoice.paid",
        data: { object: { id: "in1", subscription: "sub_x" } },
      });

      expect(r.handled).toBe(true);
      expect(Tenant.update).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  describe("invoice.payment_failed", () => {
    it("suspends after 3 attempts even when not already past due", async () => {
      const sub = { id: "sub1", tenantId: "t1", status: "Active", update: jest.fn() };
      Subscription.findOne.mockResolvedValue(sub);

      const r = await stripeWebhook.handleEvent({
        type: "invoice.payment_failed",
        data: { object: { id: "in3", subscription: "sub_x", attempt_count: 3 } },
      });

      expect(r).toEqual({ handled: true, subscriptionId: "sub1", suspended: true });
      expect(sub.update).toHaveBeenCalledWith({ status: "PastDue" });
      expect(Tenant.update).toHaveBeenCalledWith(
        { status: "suspended" },
        { where: { id: "t1" } },
      );
    });

    it("does not suspend on a first failure with a low attempt count", async () => {
      const sub = { id: "sub1", tenantId: "t1", status: "Active", update: jest.fn() };
      Subscription.findOne.mockResolvedValue(sub);

      const r = await stripeWebhook.handleEvent({
        type: "invoice.payment_failed",
        data: { object: { id: "in4", subscription: "sub_x", attempt_count: 1 } },
      });

      expect(r).toEqual({ handled: true, subscriptionId: "sub1", suspended: false });
      expect(Tenant.update).not.toHaveBeenCalled();
      expect(Invoice.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          defaults: expect.objectContaining({ status: "Open" }),
        }),
      );
    });

    it("does not suspend when attempt_count is absent and the sub was not past due", async () => {
      const sub = { id: "sub1", tenantId: "t1", status: "Active", update: jest.fn() };
      Subscription.findOne.mockResolvedValue(sub);

      const r = await stripeWebhook.handleEvent({
        type: "invoice.payment_failed",
        data: { object: { id: "in5", subscription: "sub_x" } },
      });

      expect(r.suspended).toBe(false);
      expect(Tenant.update).not.toHaveBeenCalled();
    });

    it("returns handled:false when the subscription is missing", async () => {
      Subscription.findOne.mockResolvedValue(null);

      const r = await stripeWebhook.handleEvent({
        type: "invoice.payment_failed",
        data: { object: { id: "in6", subscription: "nope" } },
      });

      expect(r).toEqual({ handled: false, reason: "subscription not found" });
      expect(Invoice.findOrCreate).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  describe("customer.subscription.updated", () => {
    it("patches the billing period and reads the plan from the price nickname", async () => {
      const sub = { id: "sub1", tenantId: "t1", status: "Active", update: jest.fn() };
      Subscription.findOne.mockResolvedValue(sub);

      const start = 1767225600; // 2026-01-01T00:00:00Z
      const end = 1769904000;
      const r = await stripeWebhook.handleEvent({
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_x",
            status: "trialing",
            current_period_start: start,
            current_period_end: end,
            items: { data: [{ price: { nickname: "enterprise" } }] },
          },
        },
      });

      expect(r.status).toBe("Active");
      expect(sub.update).toHaveBeenCalledWith({
        status: "Active",
        currentPeriodStart: new Date(start * 1000),
        currentPeriodEnd: new Date(end * 1000),
        planId: "enterprise",
      });
      expect(Tenant.update).toHaveBeenCalledWith(
        { plan: "enterprise" },
        { where: { id: "t1" } },
      );
    });

    it("keeps the existing status when Stripe sends an unmapped status", async () => {
      const sub = { id: "sub1", tenantId: "t1", status: "PastDue", update: jest.fn() };
      Subscription.findOne.mockResolvedValue(sub);

      const r = await stripeWebhook.handleEvent({
        type: "customer.subscription.updated",
        data: { object: { id: "sub_x", status: "paused" } },
      });

      expect(r.status).toBe("PastDue");
      expect(sub.update).toHaveBeenCalledWith({ status: "PastDue" });
      // no plan resolved → tenant plan untouched, and status !== Active → no un-suspend
      expect(Tenant.update).not.toHaveBeenCalled();
    });

    it("maps canceled/unpaid statuses and ignores a plan outside the allowed list", async () => {
      const sub = { id: "sub1", tenantId: "t1", status: "Active", update: jest.fn() };
      Subscription.findOne.mockResolvedValue(sub);

      const r = await stripeWebhook.handleEvent({
        type: "customer.subscription.updated",
        data: { object: { id: "sub_x", status: "unpaid", metadata: { plan: "gold" } } },
      });

      expect(r.status).toBe("Unpaid");
      expect(sub.update).toHaveBeenCalledWith({ status: "Unpaid", planId: "gold" });
      expect(Tenant.update).not.toHaveBeenCalled();
    });

    it("ignores an items array with no usable price nickname", async () => {
      const sub = { id: "sub1", tenantId: "t1", status: "Active", update: jest.fn() };
      Subscription.findOne.mockResolvedValue(sub);

      await stripeWebhook.handleEvent({
        type: "customer.subscription.updated",
        data: { object: { id: "sub_x", status: "active", items: { data: [] } } },
      });

      expect(sub.update).toHaveBeenCalledWith({ status: "Active" });
      expect(Tenant.update).toHaveBeenCalledWith(
        { status: "active" },
        { where: { id: "t1" } },
      );
    });

    it("returns handled:false when the subscription is missing", async () => {
      Subscription.findOne.mockResolvedValue(null);

      const r = await stripeWebhook.handleEvent({
        type: "customer.subscription.updated",
        data: { object: { id: "sub_x" } },
      });

      expect(r).toEqual({ handled: false, reason: "subscription not found" });
    });
  });

  // ================================================================
  describe("customer.subscription.deleted", () => {
    it("cancels the subscription and downgrades the tenant to free", async () => {
      const sub = { id: "sub1", tenantId: "t1", status: "Active", update: jest.fn() };
      Subscription.findOne.mockResolvedValue(sub);

      const r = await stripeWebhook.handleEvent({
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_x", customer: "cus_1" } },
      });

      expect(r).toEqual({ handled: true, subscriptionId: "sub1" });
      expect(sub.update).toHaveBeenCalledWith({ status: "Canceled" });
      expect(Tenant.update).toHaveBeenCalledWith(
        { plan: "free" },
        { where: { id: "t1" } },
      );
    });

    it("returns handled:false when the subscription is missing", async () => {
      Subscription.findOne.mockResolvedValue(null);

      const r = await stripeWebhook.handleEvent({
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_x" } },
      });

      expect(r).toEqual({ handled: false, reason: "subscription not found" });
      expect(Tenant.update).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  describe("unhandled events", () => {
    it("reports the event type back as unhandled", async () => {
      const r = await stripeWebhook.handleEvent({
        type: "customer.created",
        data: { object: { id: "cus_1" } },
      });

      expect(r).toEqual({
        handled: false,
        reason: "unhandled event type: customer.created",
      });
      expect(Subscription.findOne).not.toHaveBeenCalled();
    });
  });
});
