/**
 * A-225 — PATCH /billing/subscription set `status` and `planId` straight from
 * the body: a caller holding billing update could mark an unpaid subscription
 * Active, or move a Stripe-billed tenant to another plan — no payment, and no
 * record that anyone had.
 *
 * billing.service#updateSubscription against the auditLedger (real audit ENUM,
 * NOT NULL columns, actor CHECK, real rollback) with `cls: false`, so a write
 * that forgets its transaction autocommits and the test sees it. The
 * Subscription row is an in-memory stand-in whose update() writes through the
 * ledger; the lock it is read under is asserted on the call.
 */
const { Transaction } = require("sequelize");
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, row: null, findOptions: null };

jest.mock("../../models", () => ({
  Subscription: {
    findOne: async (options) => {
      mockRef.findOptions = options;
      mockRef.ledger.write("subscriptions_read", { where: options.where }, { transaction: options.transaction });
      return mockRef.row;
    },
  },
  Invoice: {},
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

const billingService = require("../../services/billing.service");

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actor = { userId: "11111111-1111-4111-8111-111111111111", ipAddress: "192.0.2.1", userAgent: "ops" };

const subscription = (fields) => {
  const row = {
    id: "sub-1",
    tenantId: TENANT,
    planId: "basic",
    billingCycle: "Monthly",
    status: "Active",
    stripeSubscriptionId: null,
    ...fields,
  };
  row.update = async (values, options) => {
    mockRef.ledger.write("subscriptions", { id: row.id, ...values }, options);
    Object.assign(row, values);
    return row;
  };
  row.toJSON = () => {
    const { update, toJSON, ...plain } = row;
    return plain;
  };
  return row;
};

beforeEach(() => {
  mockRef.ledger = createLedger({ cls: false });
  mockRef.row = subscription();
  mockRef.findOptions = null;
});

const nothingWritten = () => {
  expect(mockRef.ledger.committed("subscriptions")).toEqual([]);
  expect(mockRef.ledger.auditRows()).toEqual([]);
};

describe("A-225 — a Stripe-billed subscription is the provider's", () => {
  it.each([
    [{ status: "Active", reason: "paid by bank transfer" }],
    [{ planId: "enterprise" }],
    [{ billingCycle: "Annually" }],
  ])("refuses %j with 409 and writes nothing", async (body) => {
    mockRef.row = subscription({ status: "PastDue", stripeSubscriptionId: "sub_stripe_1" });

    await expect(billingService.updateSubscription(TENANT, body, actor)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/billed through Stripe/),
    });
    nothingWritten();
    expect(mockRef.row.status).toBe("PastDue");
  });

  it("an unchanged save of a Stripe-billed subscription is not refused (the screen sends every field)", async () => {
    mockRef.row = subscription({ stripeSubscriptionId: "sub_stripe_1" });

    const result = await billingService.updateSubscription(
      TENANT,
      { planId: "basic", billingCycle: "Monthly", status: "Active" },
      actor,
    );

    expect(result).toMatchObject({ status: 200, message: "Subscription unchanged" });
    nothingWritten();
  });
});

describe("A-225 — a manual override on a manually billed subscription", () => {
  it("reads the row under FOR UPDATE, in the transaction that writes it", async () => {
    await billingService.updateSubscription(TENANT, { planId: "professional" }, actor);

    expect(mockRef.findOptions.lock).toBe(Transaction.LOCK.UPDATE);
    expect(mockRef.findOptions.where).toEqual({ tenantId: TENANT });
    expect(mockRef.ledger.committed("subscriptions_read")).toHaveLength(1);
  });

  it("a plan change commits with exactly one audit row, before and after", async () => {
    const result = await billingService.updateSubscription(TENANT, { planId: "professional" }, actor);

    expect(result).toMatchObject({ success: true, status: 200, message: "Subscription updated successfully" });
    expect(result.data.planId).toBe("professional");
    expect(mockRef.ledger.committed("subscriptions")).toEqual([
      expect.objectContaining({ id: "sub-1", planId: "professional" }),
    ]);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        tenantId: TENANT,
        userId: actor.userId,
        action: "UPDATE",
        resourceType: "Subscription",
        resourceId: "sub-1",
        ipAddress: "192.0.2.1",
        userAgent: "ops",
        changes: {
          operation: "SUBSCRIPTION_OVERRIDE",
          before: { planId: "basic" },
          after: { planId: "professional" },
          reason: null,
        },
      }),
    ]);
  });

  it("only the fields that change are written and recorded", async () => {
    await billingService.updateSubscription(
      TENANT,
      { planId: "basic", billingCycle: "Annually", status: "Active" },
      actor,
    );

    expect(mockRef.ledger.auditRows()[0].changes).toMatchObject({
      before: { billingCycle: "Monthly" },
      after: { billingCycle: "Annually" },
    });
  });

  it.each([
    ["Active", "PastDue"],
    ["Active", "Canceled"],
    ["PastDue", "Active"],
    ["PastDue", "Unpaid"],
    ["PastDue", "Canceled"],
    ["Unpaid", "Active"],
    ["Unpaid", "Canceled"],
    ["Canceled", "Active"],
  ])("%s -> %s with a reason is recorded, the reason in the audit row", async (from, to) => {
    mockRef.row = subscription({ status: from });

    await billingService.updateSubscription(TENANT, { status: to, reason: "invoice INV-2026-0042 paid by transfer" }, actor);

    expect(mockRef.row.status).toBe(to);
    expect(mockRef.ledger.auditRows()[0].changes).toEqual({
      operation: "SUBSCRIPTION_OVERRIDE",
      before: { status: from },
      after: { status: to },
      reason: "invoice INV-2026-0042 paid by transfer",
    });
  });

  it.each([
    ["Active", "Unpaid", /From "Active" it can move to: PastDue, Canceled/],
    ["Unpaid", "PastDue", /From "Unpaid" it can move to: Active, Canceled/],
    ["Canceled", "PastDue", /From "Canceled" it can move to: Active/],
  ])("%s -> %s is 409 with the state explained, nothing written", async (from, to, explained) => {
    mockRef.row = subscription({ status: from });

    await expect(
      billingService.updateSubscription(TENANT, { status: to, reason: "because" }, actor),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(explained) });
    nothingWritten();
  });

  it("a status stored outside the ENUM has no manual transition out of it", async () => {
    mockRef.row = subscription({ status: "Legacy" });

    await expect(
      billingService.updateSubscription(TENANT, { status: "Active", reason: "because" }, actor),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/No manual transition leaves "Legacy"/) });
  });

  it("a status change without a reason is 400, nothing written", async () => {
    mockRef.row = subscription({ status: "PastDue" });

    await expect(billingService.updateSubscription(TENANT, { status: "Active" }, actor)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/send a `reason`/),
    });
    nothingWritten();
  });

  it("a failing audit insert rolls the change back", async () => {
    mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

    await expect(billingService.updateSubscription(TENANT, { planId: "professional" }, actor)).rejects.toMatchObject({
      status: 500,
      message: "audit insert failed",
    });
    expect(mockRef.ledger.committed("subscriptions")).toEqual([]);
  });

  it("with no actor the override is refused, not committed unattributed (A-124)", async () => {
    await expect(billingService.updateSubscription(TENANT, { planId: "professional" })).rejects.toMatchObject({
      message: expect.stringMatching(/must name its actor/),
    });
    expect(mockRef.ledger.committed("subscriptions")).toEqual([]);
  });

  it("no subscription is 404", async () => {
    mockRef.row = null;
    await expect(billingService.updateSubscription(TENANT, { planId: "x" }, actor)).rejects.toEqual({
      status: 404,
      message: "Subscription not found for this tenant",
    });
  });

  it("an error with neither status nor message is a generic 500", async () => {
    mockRef.ledger.failNext("subscriptions_read", {});
    await expect(billingService.updateSubscription(TENANT, { planId: "x" }, actor)).rejects.toEqual({
      status: 500,
      message: "Failed to update subscription",
    });
  });
});
