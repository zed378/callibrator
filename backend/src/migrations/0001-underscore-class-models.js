/**
 * Standardize the 6 class-based models to snake_case columns, matching
 * `underscored: true` and the rest of the schema (which is snake_case).
 *
 * Idempotent + reversible: a column is renamed only when the source column
 * exists and the target does not — so this is a no-op on a fresh database that
 * was created directly from the (now underscored) models, and safe to re-run.
 * All six tables were empty when this was authored, so no data is at risk;
 * `RENAME COLUMN` preserves data, FK constraints, and indexes regardless.
 */
const MAPPINGS = {
  vendors: {
    tenantId: "tenant_id",
    contactPerson: "contact_person",
    createdAt: "created_at",
    updatedAt: "updated_at",
    deletedAt: "deleted_at",
  },
  maintenance_work_orders: {
    tenantId: "tenant_id",
    deviceId: "device_id",
    vendorId: "vendor_id",
    assignedTo: "assigned_to",
    createdAt: "created_at",
    updatedAt: "updated_at",
    deletedAt: "deleted_at",
  },
  notifications: {
    tenantId: "tenant_id",
    userId: "user_id",
    isRead: "is_read",
    actionUrl: "action_url",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  subscriptions: {
    tenantId: "tenant_id",
    planId: "plan_id",
    billingCycle: "billing_cycle",
    currentPeriodStart: "current_period_start",
    currentPeriodEnd: "current_period_end",
    stripeCustomerId: "stripe_customer_id",
    stripeSubscriptionId: "stripe_subscription_id",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  invoices: {
    tenantId: "tenant_id",
    subscriptionId: "subscription_id",
    amountDue: "amount_due",
    amountPaid: "amount_paid",
    invoiceUrl: "invoice_url",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  audit_logs: {
    tenantId: "tenant_id",
    userId: "user_id",
    resourceType: "resource_type",
    resourceId: "resource_id",
    ipAddress: "ip_address",
    userAgent: "user_agent",
    createdAt: "created_at",
  },
};

async function rename(context, direction) {
  for (const [table, mapping] of Object.entries(MAPPINGS)) {
    let desc;
    try {
      desc = await context.describeTable(table);
    } catch {
      continue; // table not created yet — nothing to rename
    }
    for (const [camel, snake] of Object.entries(mapping)) {
      const [from, to] = direction === "up" ? [camel, snake] : [snake, camel];
      if (desc[from] && !desc[to]) {
        await context.renameColumn(table, from, to);
      }
    }
  }
}

module.exports = {
  up: async ({ context }) => rename(context, "up"),
  down: async ({ context }) => rename(context, "down"),
};
