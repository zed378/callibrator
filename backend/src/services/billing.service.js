const { Op } = require("sequelize");
const { db } = require("../config");
const { Subscription, Invoice } = require("../models");
const { AppError } = require("../utils/appError.util");
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
exports.updateSubscription = async (tenantId, data) => {
  try {
    const subscription = await Subscription.findOne({
      where: { tenantId },
    });

    if (!subscription) {
      throw new AppError(404, "Subscription not found for this tenant");
    }

    // Only allow updating specific fields to prevent bypassing payment logic
    const updatePayload = {};
    if (data.planId) updatePayload.planId = data.planId;
    if (data.billingCycle) updatePayload.billingCycle = data.billingCycle;
    
    // Status/dates usually updated via webhooks, but allowing here for internal overrides
    if (data.status) updatePayload.status = data.status;

    await subscription.update(updatePayload);

    return {
      success: true,
      status: 200,
      message: "Subscription updated successfully",
      data: transformRecord(subscription),
    };
  } catch (error) {
    throw {
      status: error.status || 500,
      message: error.message || "Failed to update subscription",
    };
  }
};

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
