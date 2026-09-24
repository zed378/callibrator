const { Op, Transaction } = require("sequelize");
const { db } = require("../config");
const { Subscription, Invoice } = require("../models");
const { AppError } = require("../utils/appError.util");
const auditService = require("./audit.service");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
const transformRecord = (record) => {
  if (!record) return null;
  return record.toJSON ? record.toJSON() : { ...record };
};

const transformRecords = (rows) => (rows || []).map(transformRecord);

// ------------------------------------------------------------------
// GET CURRENT SUBSCRIPTION
// ------------------------------------------------------------------
exports.getSubscription = async (tenantId) => {
  try {
    let subscription = await Subscription.findOne({
      where: { tenantId },
    });

    // Auto-create a free/basic subscription if one doesn't exist
    if (!subscription) {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      subscription = await Subscription.create({
        tenantId,
        planId: "basic",
        status: "Active",
        billingCycle: "Monthly",
        currentPeriodStart: new Date(),
        currentPeriodEnd: thirtyDaysFromNow,
      });
    }

    return {
      success: true,
      status: 200,
      message: "Subscription retrieved successfully",
      data: transformRecord(subscription),
    };
  } catch (error) {
    throw {
      status: error.status || 500,
      message: error.message || "Failed to retrieve subscription",
    };
  }
};

// ------------------------------------------------------------------
// UPDATE SUBSCRIPTION PLAN
// ------------------------------------------------------------------

/** The fields PATCH /billing/subscription may change. */
const OVERRIDABLE_FIELDS = Object.freeze(["planId", "billingCycle", "status"]);

/**
 * A-225 — the subscription status transitions an operator may record by hand,
 * keyed by the current status. The shape follows the payment lifecycle the
 * Stripe webhooks drive (stripeWebhook.service): an active subscription falls
 * past due, a past-due one is settled, exhausted (unpaid) or cancelled; an
 * unpaid one is settled or cancelled; a cancelled one may be reactivated.
 * Skipping a stage (Active -> Unpaid) is not a payment event anyone recorded.
 */
const STATUS_TRANSITIONS = Object.freeze({
  Active: Object.freeze(["PastDue", "Canceled"]),
  PastDue: Object.freeze(["Active", "Unpaid", "Canceled"]),
  Unpaid: Object.freeze(["Active", "Canceled"]),
  Canceled: Object.freeze(["Active"]),
});

const PROVIDER_MANAGED =
  "This subscription is billed through Stripe: its plan, billing cycle and status follow the payments " +
  "and are set by Stripe's webhooks. Change the plan in Stripe (checkout or the customer portal); an " +
  "override here would contradict what is being charged, and the next webhook would overwrite it.";

/**
 * Change a subscription by hand — an operator override.
 *
 * A-225 — this set `status` and `planId` straight from the body: a caller
 * with billing update could mark an unpaid subscription Active, or move a
 * Stripe-billed tenant to another plan, with no payment and no record. Now:
 *  - a Stripe-billed subscription (`stripeSubscriptionId` set) refuses every
 *    change, 409: the provider is the source of truth, and its webhooks would
 *    overwrite the override anyway;
 *  - on a manually billed subscription, a status change must be a transition
 *    of STATUS_TRANSITIONS (else 409, the state explained) and must carry a
 *    `reason` (400 without one) — it records a payment event that happened
 *    outside the system;
 *  - the row is locked, and the change and ONE audit row (in the tenant's own
 *    trail, with before/after and the reason) commit together;
 *  - a field sent with its current value is not a change: the billing screen
 *    sends all three fields on every save, and an unchanged save writes
 *    nothing and no audit row.
 *
 * This does NOT change the tenant's own `status` (suspension) or `plan`
 * (feature gating): those have their own audited paths (tenant lifecycle,
 * tenant update), and the webhook's coupling of payment to suspension is for
 * Stripe-billed tenants only.
 *
 * @param {string} tenantId - the caller's tenant (never from the body)
 * @param {{planId?: string, billingCycle?: string, status?: string, reason?: string}} data - validated
 * @param {object} [actor] - auditActor(req)
 * @returns {Promise<object>} the envelope
 * @throws {{status: number, message: string}} 404 no subscription; 409
 *   provider-managed or an invalid transition; 400 a status change without a reason
 */
exports.updateSubscription = async (tenantId, data, actor = {}) => {
  try {
    const { subscription, changed } = await db.transaction(async (transaction) => {
      const locked = await Subscription.findOne({
        where: { tenantId },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });

      if (!locked) {
        throw new AppError(404, "Subscription not found for this tenant");
      }

      const changes = {};
      for (const field of OVERRIDABLE_FIELDS) {
        if (data[field] !== undefined && data[field] !== locked[field]) {
          changes[field] = data[field];
        }
      }
      if (Object.keys(changes).length === 0) {
        return { subscription: locked, changed: false };
      }

      if (locked.stripeSubscriptionId) {
        throw new AppError(409, PROVIDER_MANAGED);
      }
      if (changes.status) {
        const allowed = STATUS_TRANSITIONS[locked.status] || [];
        if (!allowed.includes(changes.status)) {
          throw new AppError(
            409,
            `This subscription is "${locked.status}" and cannot be set to "${changes.status}" by hand. ` +
              (allowed.length
                ? `From "${locked.status}" it can move to: ${allowed.join(", ")}.`
                : `No manual transition leaves "${locked.status}".`),
          );
        }
        if (!data.reason) {
          throw new AppError(
            400,
            "A status override records a payment event that happened outside the system: " +
              "send a `reason` (for example the invoice or bank reference).",
          );
        }
      }

      const before = Object.fromEntries(Object.keys(changes).map((field) => [field, locked[field]]));
      await locked.update(changes, { transaction });
      await auditService.logAction(
        {
          tenantId,
          userId: actor.userId,
          action: "UPDATE",
          resourceType: "Subscription",
          resourceId: locked.id,
          changes: {
            operation: "SUBSCRIPTION_OVERRIDE",
            before,
            after: changes,
            reason: data.reason || null,
          },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        },
        { transaction },
      );
      return { subscription: locked, changed: true };
    });

    return {
      success: true,
      status: 200,
      message: changed ? "Subscription updated successfully" : "Subscription unchanged",
      data: transformRecord(subscription),
    };
  } catch (error) {
    throw {
      status: error.status || 500,
      message: error.message || "Failed to update subscription",
    };
  }
};

exports.STATUS_TRANSITIONS = STATUS_TRANSITIONS;

// ------------------------------------------------------------------
// GET INVOICES
// ------------------------------------------------------------------
exports.fetchInvoices = async ({
  tenantId,
  page = 1,
  limit = DEFAULT_LIMIT,
  status,
}) => {
  try {
    const whereClause = { tenantId };

    if (status) {
      whereClause.status = status;
    }

    const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = (Number(page) - 1) * safeLimit;

    const { count, rows } = await Invoice.findAndCountAll({
      where: whereClause,
      limit: safeLimit,
      offset,
      order: [["createdAt", "DESC"]],
      include: [
        { model: Subscription, as: "subscription", attributes: ["id", "planId"] }
      ]
    });

    return {
      success: true,
      status: 200,
      message: "Fetch invoices successful",
      data: {
        rows: transformRecords(rows),
        count,
        meta: {
          total: count,
          page: Number(page),
          limit: safeLimit,
          totalPages: Math.ceil(count / safeLimit),
        },
      },
    };
  } catch (error) {
    throw {
      status: error.status || 500,
      message: error.message || "Failed to fetch invoices",
    };
  }
};
