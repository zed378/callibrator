const billingService = require("../services/billing.service");
const stripeWebhookService = require("../services/stripeWebhook.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const { logger } = require("../middlewares/activityLog.middleware");

exports.getSubscription = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;

  const result = await billingService.getSubscription(tenantId);
  success(res, result.data, null, result.message, result.status);
});

exports.updateSubscription = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const data = req.body;

  const result = await billingService.updateSubscription(tenantId, data);
  success(res, result.data, null, result.message, result.status);
});

exports.fetchInvoices = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { page, limit, status } = req.query;

  const result = await billingService.fetchInvoices({
    tenantId,
    page,
    limit,
    status,
  });

  success(res, result.data.rows, result.data.meta, result.message, result.status);
});

// POST /api/v1/billing/webhook — Stripe calls this (no auth). Requires the raw
// request body (wired in index.js before the JSON body parser).
exports.handleStripeWebhook = async (req, res) => {
  let event;
  try {
    event = stripeWebhookService.constructEvent(
      req.rawBody || req.body,
      req.headers["stripe-signature"],
    );
  } catch (err) {
    logger.warn(`Stripe webhook verification failed: ${err.message}`);
    return res
      .status(400)
      .json({ success: false, message: `Webhook Error: ${err.message}` });
  }

  try {
    const result = await stripeWebhookService.handleEvent(event);
    return res.status(200).json({ received: true, type: event.type, ...result });
  } catch (err) {
    // Non-2xx makes Stripe retry, which is the desired behaviour on a
    // transient processing failure.
    logger.error(`Stripe webhook processing error: ${err.message}`);
    return res.status(500).json({ received: true, error: err.message });
  }
};
