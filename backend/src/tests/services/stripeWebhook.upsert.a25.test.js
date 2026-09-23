/**
 * A-25 — `upsertInvoice` never updated.
 *
 * `Invoice.findOrCreate` with the status in `defaults` only ever INSERTS, so
 * Stripe's normal dunning sequence — `invoice.payment_failed` then
 * `invoice.paid` — left the row `Open` with `amountPaid: 0` forever while the
 * subscription went `Active`. Billing state diverged from Stripe silently.
 *
 * These tests do not assert on calls to a mock ORM. `Invoice` is backed by a
 * tiny in-memory store so each test can assert on the ROW that ends up stored:
 * how many there are, and what it holds. A test that only asserted
 * `Invoice.update` was called would pass against a `findOrCreate` that wrote
 * the wrong thing.
 */

jest.mock("../../models", () => ({
  Subscription: { findOne: jest.fn() },
  Invoice: { findOne: jest.fn(), create: jest.fn() },
  Tenant: { update: jest.fn() },
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const stripeWebhook = require("../../services/stripeWebhook.service");
const { Subscription, Invoice, Tenant } = require("../../models");

/** An in-memory stand-in for the `invoices` table. */
const makeStore = () => {
  const rows = [];

  Invoice.findOne.mockImplementation(async ({ where }) => {
    return (
      rows.find((r) => r.stripeInvoiceId === where.stripeInvoiceId) || null
    );
  });

  Invoice.create.mockImplementation(async (values) => {
    const row = {
      ...values,
      update: jest.fn(async (patch) => {
        Object.assign(row, patch);
        return row;
      }),
    };
    rows.push(row);
    return row;
  });

  return rows;
};

const sub = () => ({
  id: "sub1",
  tenantId: "t1",
  status: "Active",
  update: jest.fn(),
});

const paymentFailed = (over = {}) => ({
  type: "invoice.payment_failed",
  data: {
    object: {
      id: "in_1",
      subscription: "sub_x",
      amount_due: 5000,
      amount_paid: 0,
      currency: "usd",
      hosted_invoice_url: "https://stripe.test/i/1",
      ...over,
    },
  },
});

const invoicePaid = (over = {}) => ({
  type: "invoice.paid",
  data: {
    object: {
      id: "in_1",
      subscription: "sub_x",
      amount_due: 5000,
      amount_paid: 5000,
      currency: "usd",
      hosted_invoice_url: "https://stripe.test/i/1",
      ...over,
    },
  },
});

describe("stripeWebhook upsertInvoice (A-25)", () => {
  let rows;

  beforeEach(() => {
    jest.clearAllMocks();
    rows = makeStore();
    Subscription.findOne.mockResolvedValue(sub());
    Tenant.update.mockResolvedValue([1]);
  });

  it("an invoice that failed and was then paid ends up Paid, with ONE row", async () => {
    await stripeWebhook.handleEvent(paymentFailed());
    await stripeWebhook.handleEvent(invoicePaid());

    expect(rows).toHaveLength(1);
    expect(Invoice.create).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({
      stripeInvoiceId: "in_1",
      status: "Paid",
      amountDue: 50,
      amountPaid: 50,
      currency: "USD",
    });
  });

  it("a late payment_failed does not downgrade a Paid invoice or erase amountPaid", async () => {
    await stripeWebhook.handleEvent(invoicePaid());
    // Stripe does not guarantee ordering: the failed attempt arrives second,
    // carrying amount_paid: 0.
    await stripeWebhook.handleEvent(paymentFailed());

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("Paid");
    expect(rows[0].amountPaid).toBe(50);
  });

  it("a duplicated invoice.paid updates in place instead of inserting a second row", async () => {
    await stripeWebhook.handleEvent(invoicePaid());
    await stripeWebhook.handleEvent(invoicePaid());

    expect(rows).toHaveLength(1);
    expect(Invoice.create).toHaveBeenCalledTimes(1);
    expect(rows[0].update).toHaveBeenCalledTimes(1);
    expect(rows[0].status).toBe("Paid");
  });

  it("refreshes amounts and currency on an existing Open invoice", async () => {
    await stripeWebhook.handleEvent(paymentFailed());
    await stripeWebhook.handleEvent(
      paymentFailed({ amount_due: 7500, currency: "eur" }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "Open",
      amountDue: 75,
      currency: "EUR",
    });
  });

  it("keeps the stored hosted invoice url when a later event omits it", async () => {
    await stripeWebhook.handleEvent(paymentFailed());
    await stripeWebhook.handleEvent(invoicePaid({ hosted_invoice_url: null }));

    expect(rows[0].invoiceUrl).toBe("https://stripe.test/i/1");
  });

  it("does not lower amountPaid when a DECIMAL comes back from pg as a string", async () => {
    // Sequelize DECIMAL is read as a string; comparing it unconverted would
    // make "50.00" > 0 a string comparison and the rule accidental.
    rows.push({
      stripeInvoiceId: "in_1",
      status: "Open",
      amountPaid: "50.00",
      amountDue: "50.00",
      invoiceUrl: null,
      update: jest.fn(function (patch) {
        Object.assign(this, patch);
      }),
    });

    await stripeWebhook.handleEvent(paymentFailed());

    expect(Invoice.create).not.toHaveBeenCalled();
    expect(rows[0].amountPaid).toBe(50);
  });

  it("treats a missing stored amountPaid as zero", async () => {
    rows.push({
      stripeInvoiceId: "in_1",
      status: "Open",
      amountDue: 50,
      invoiceUrl: null,
      update: jest.fn(function (patch) {
        Object.assign(this, patch);
      }),
    });

    await stripeWebhook.handleEvent(invoicePaid());

    expect(rows[0].amountPaid).toBe(50);
    expect(rows[0].status).toBe("Paid");
  });

  it("inserts a new row with the subscription's tenant when none exists", async () => {
    await stripeWebhook.handleEvent(invoicePaid());

    expect(Invoice.create).toHaveBeenCalledWith({
      tenantId: "t1",
      subscriptionId: "sub1",
      amountDue: 50,
      amountPaid: 50,
      currency: "USD",
      status: "Paid",
      invoiceUrl: "https://stripe.test/i/1",
      stripeInvoiceId: "in_1",
    });
  });
});
