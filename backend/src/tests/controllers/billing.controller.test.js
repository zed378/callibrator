/**
 * Tests for billing controller
 */

jest.mock("../../services/billing.service", () => ({
  getSubscription: jest.fn(),
  updateSubscription: jest.fn(),
  fetchInvoices: jest.fn(),
}));

jest.mock("../../services/stripeWebhook.service", () => ({
  constructEvent: jest.fn(),
  handleEvent: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const billingService = require("../../services/billing.service");
const stripeWebhookService = require("../../services/stripeWebhook.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const billingController = require("../../controllers/billing.controller");
const { success } = require("../../utils/response.util");

describe("billing Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    req = {
      query: {},
      params: {},
      body: {},
      user: {
        tenantId: "550e8400-e29b-41d4-a716-446655440001",
      },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("getSubscription", () => {
    it("should return the current subscription", async () => {
      billingService.getSubscription.mockResolvedValue({
        data: { id: "sub-1", planId: "basic", status: "Active" },
        message: "Subscription retrieved successfully",
        status: 200,
      });

      await billingController.getSubscription(req, res, next);

      expect(billingService.getSubscription).toHaveBeenCalledWith(
        "550e8400-e29b-41d4-a716-446655440001",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("updateSubscription", () => {
    it("should update the subscription", async () => {
      req.body = { planId: "professional", billingCycle: "Monthly" };
      billingService.updateSubscription.mockResolvedValue({
        data: { id: "sub-1", planId: "professional" },
        message: "Subscription updated",
        status: 200,
      });

      await billingController.updateSubscription(req, res, next);

      expect(billingService.updateSubscription).toHaveBeenCalledWith(
        "550e8400-e29b-41d4-a716-446655440001",
        { planId: "professional", billingCycle: "Monthly" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("fetchInvoices", () => {
    it("should return paginated invoices", async () => {
      req.query = { page: "1", limit: "10", status: "paid" };
      billingService.fetchInvoices.mockResolvedValue({
        data: {
          rows: [{ id: "inv-1", amount: 100, status: "paid" }],
          meta: { total: 1 },
        },
        message: "Invoices fetched",
        status: 200,
      });

      await billingController.fetchInvoices(req, res, next);

      expect(billingService.fetchInvoices).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "550e8400-e29b-41d4-a716-446655440001",
          page: "1",
          limit: "10",
          status: "paid",
        }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("should use defaults when no query params", async () => {
      req.query = {};
      billingService.fetchInvoices.mockResolvedValue({
        data: { rows: [], meta: { total: 0 } },
      });

      await billingController.fetchInvoices(req, res, next);

      expect(billingService.fetchInvoices).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "550e8400-e29b-41d4-a716-446655440001",
        }),
      );
    });
  });

  describe("handleStripeWebhook", () => {
    it("should process a valid Stripe webhook event", async () => {
      const mockEvent = {
        type: "invoice.payment_succeeded",
        data: { object: { id: "inv-1" } },
      };
      stripeWebhookService.constructEvent.mockReturnValue(mockEvent);
      stripeWebhookService.handleEvent.mockResolvedValue({
        message: "Webhook processed",
      });

      req.rawBody = JSON.stringify(mockEvent);
      req.headers = {
        "stripe-signature": "valid-signature",
      };
      req.body = mockEvent;

      await billingController.handleStripeWebhook(req, res, next);

      expect(stripeWebhookService.constructEvent).toHaveBeenCalledWith(
        JSON.stringify(mockEvent),
        "valid-signature",
      );
      expect(stripeWebhookService.handleEvent).toHaveBeenCalledWith(mockEvent);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("falls back to req.body when the raw-body middleware did not populate req.rawBody", async () => {
      const mockEvent = { type: "customer.subscription.updated", data: { object: { id: "sub-1" } } };
      stripeWebhookService.constructEvent.mockReturnValue(mockEvent);
      stripeWebhookService.handleEvent.mockResolvedValue({ message: "ok" });

      req.rawBody = undefined;
      req.body = mockEvent;
      req.headers = { "stripe-signature": "valid-signature" };

      await billingController.handleStripeWebhook(req, res, next);

      expect(stripeWebhookService.constructEvent).toHaveBeenCalledWith(
        mockEvent,
        "valid-signature",
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ received: true, type: "customer.subscription.updated" }),
      );
    });

    it("should return 400 on invalid signature", async () => {
      stripeWebhookService.constructEvent.mockImplementation(() => {
        throw new Error("Invalid signature");
      });

      req.rawBody = "{}";
      req.headers = {
        "stripe-signature": "invalid",
      };

      await billingController.handleStripeWebhook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should return 500 on webhook processing error", async () => {
      const mockEvent = {
        type: "invoice.payment_failed",
        data: { object: { id: "inv-1" } },
      };
      stripeWebhookService.constructEvent.mockReturnValue(mockEvent);
      stripeWebhookService.handleEvent.mockRejectedValue(
        new Error("Processing failed"),
      );

      req.rawBody = JSON.stringify(mockEvent);
      req.headers = {
        "stripe-signature": "valid-signature",
      };
      req.body = mockEvent;

      await billingController.handleStripeWebhook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(logger.error).toHaveBeenCalled();
    });

    it("should handle customer.subscription.created event", async () => {
      const mockEvent = {
        type: "customer.subscription.created",
        data: {
          object: {
            id: "sub-stripe-1",
            customer: "cus_123",
            status: "active",
            plan: "professional",
          },
        },
      };
      stripeWebhookService.constructEvent.mockReturnValue(mockEvent);
      stripeWebhookService.handleEvent.mockResolvedValue({
        message: "Subscription created",
      });

      req.rawBody = JSON.stringify(mockEvent);
      req.headers = {
        "stripe-signature": "valid-signature",
      };
      req.body = mockEvent;

      await billingController.handleStripeWebhook(req, res, next);

      expect(stripeWebhookService.handleEvent).toHaveBeenCalledWith(mockEvent);
    });

    it("should handle customer.subscription.updated event", async () => {
      const mockEvent = {
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub-stripe-1",
            customer: "cus_123",
            status: "active",
          },
        },
      };
      stripeWebhookService.constructEvent.mockReturnValue(mockEvent);
      stripeWebhookService.handleEvent.mockResolvedValue({
        message: "Subscription updated",
      });

      req.rawBody = JSON.stringify(mockEvent);
      req.headers = {
        "stripe-signature": "valid-signature",
      };
      req.body = mockEvent;

      await billingController.handleStripeWebhook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle invoice.payment_succeeded event", async () => {
      const mockEvent = {
        type: "invoice.payment_succeeded",
        data: {
          object: {
            id: "inv-1",
            customer: "cus_123",
            status: "paid",
            amountPaid: 1000,
          },
        },
      };
      stripeWebhookService.constructEvent.mockReturnValue(mockEvent);
      stripeWebhookService.handleEvent.mockResolvedValue({
        message: "Payment succeeded",
      });

      req.rawBody = JSON.stringify(mockEvent);
      req.headers = {
        "stripe-signature": "valid-signature",
      };
      req.body = mockEvent;

      await billingController.handleStripeWebhook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle invoice.payment_failed event", async () => {
      const mockEvent = {
        type: "invoice.payment_failed",
        data: {
          object: {
            id: "inv-1",
            customer: "cus_123",
            status: "failed",
          },
        },
      };
      stripeWebhookService.constructEvent.mockReturnValue(mockEvent);
      stripeWebhookService.handleEvent.mockResolvedValue({
        message: "Payment failed",
      });

      req.rawBody = JSON.stringify(mockEvent);
      req.headers = {
        "stripe-signature": "valid-signature",
      };
      req.body = mockEvent;

      await billingController.handleStripeWebhook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle customer.subscription.deleted event", async () => {
      const mockEvent = {
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub-stripe-1",
            customer: "cus_123",
            status: "canceled",
          },
        },
      };
      stripeWebhookService.constructEvent.mockReturnValue(mockEvent);
      stripeWebhookService.handleEvent.mockResolvedValue({
        message: "Subscription deleted",
      });

      req.rawBody = JSON.stringify(mockEvent);
      req.headers = {
        "stripe-signature": "valid-signature",
      };
      req.body = mockEvent;

      await billingController.handleStripeWebhook(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
