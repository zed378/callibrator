const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { validate } = require("../../middlewares/validation.middleware");
const billingValidator = require("../../validators/billing.validator");
const billingController = require("../../controllers/billing.controller");

/**
 * @swagger
 * /api/v1/billing/subscription:
 *   get:
 *     summary: Get current tenant subscription
 *     description: Retrieves the active billing subscription for the current tenant. Requires read access to Billing.
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription retrieved successfully
 */
router.get(
  "/subscription",
  auth,
  dynamicAccess("Billing", "read", { checkTenant: true }),
  billingController.getSubscription,
);

/**
 * @swagger
 * /api/v1/billing/subscription:
 *   patch:
 *     summary: Update tenant subscription
 *     description: Updates the current subscription plan. Typically used to upgrade/downgrade plans. Requires update access to Billing.
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               planId:
 *                 type: string
 *               billingCycle:
 *                 type: string
 *                 enum: [Monthly, Annually]
 *               status:
 *                 type: string
 *                 enum: [Active, PastDue, Canceled, Unpaid]
 *     responses:
 *       200:
 *         description: Subscription updated successfully
 *       404:
 *         description: Subscription not found
 */
router.patch(
  "/subscription",
  auth,
  dynamicAccess("Billing", "update", { checkTenant: true }),
  validate(billingValidator.updateSubscription),
  billingController.updateSubscription,
);

/**
 * @swagger
 * /api/v1/billing/invoices:
 *   get:
 *     summary: Get billing invoices
 *     description: Retrieves paginated invoice history for the tenant. Requires read access to Billing.
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Draft, Open, Paid, Uncollectible, Void]
 *     responses:
 *       200:
 *         description: Invoices retrieved successfully
 */
router.get(
  "/invoices",
  auth,
  dynamicAccess("Billing", "read", { checkTenant: true }),
  billingController.fetchInvoices,
);

/**
 * @swagger
 * /api/v1/billing/webhook:
 *   post:
 *     summary: Stripe billing webhook (signature-verified, no auth)
 *     description: >-
 *       Receives Stripe events (invoice.paid, invoice.payment_failed,
 *       customer.subscription.updated/deleted) and reconciles subscription,
 *       invoice, and tenant state. Requires the raw request body.
 *     tags: [Billing]
 *     responses:
 *       200: { description: Event received }
 *       400: { description: Signature verification failed }
 */
router.post("/webhook", billingController.handleStripeWebhook);

module.exports = router;
