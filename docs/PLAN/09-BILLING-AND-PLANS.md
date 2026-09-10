# 09 — Billing and Plans

Modules: `HDC-BILL` (16). Routes: `/billing`, `/finance`, `/metered-billing`, `/quota`.

---

## Plans

`tenants.plan` is an ENUM: `free`, `professional`, `business`, `enterprise`. `tenants.billingCycle` is `monthly` or `yearly`.

The plan name alone grants nothing. Entitlement is expressed through two independent mechanisms:

| Mechanism | Table | Enforced by |
|---|---|---|
| Hard tenant limits | `tenants.limitSeats`, `tenants.limitStorageMb` | `enforceQuota.middleware.js` |
| Per-metric quotas | `plan_quotas` (`tenantId`, `metric`, `limit`) | `enforceQuota.middleware.js` |

Keeping plan and entitlement separate is what makes "this enterprise customer negotiated 500 seats instead of the standard 200" a data change rather than a code change.

## Subscriptions

`subscriptions` mirrors the Stripe subscription rather than replacing it.

| Column | Notes |
|---|---|
| `planId` | `STRING` — the provider plan identifier, not the `tenants.plan` enum |
| `status` | `Active`, `PastDue`, `Canceled`, `Unpaid` |
| `billingCycle` | `Monthly`, `Annually` |
| `currentPeriodStart` / `currentPeriodEnd` | the window metering is attributed to |
| `stripeCustomerId`, `stripeSubscriptionId` | provider linkage |

Note the casing difference: `subscriptions.billingCycle` is `Monthly`/`Annually` while `tenants.billingCycle` is `monthly`/`yearly`. These are two enums with two vocabularies for the same idea. It is a real inconsistency; any code mapping between them must not assume a case transform is sufficient.

## Invoices

`invoices` carries `amountDue`, `amountPaid`, `currency`, `invoiceUrl`, `stripeInvoiceId`, and a status ENUM of `Draft`, `Open`, `Paid`, `Uncollectible`, `Void` — mirroring Stripe invoice states deliberately, so reconciliation is a comparison rather than a translation.

`stripeInvoiceId` was added by migration `0002-add-stripe-invoice-id`.

## The Webhook

`POST /api/v1/billing/webhook` is the single most delicate endpoint in the system, for a mechanical reason: **Stripe signature verification needs the unparsed request body**, and the global JSON parser would otherwise have consumed it.

The parser therefore carries a `verify` hook that stashes raw bytes on `req.rawBody`, and only for URLs starting with `/api/v1/billing/webhook`:

```js
express.json({
  limit: "10mb",
  verify: (req, res, buf) => {
    if (req.originalUrl && req.originalUrl.startsWith("/api/v1/billing/webhook")) {
      req.rawBody = buf;
    }
  },
})
```

`req.rawBody` survives the downstream `globalSanitizer`, which rewrites `req.body`, `req.query` and `req.params` but not `rawBody`.

**Consequences to respect:**

- Changing the webhook mount path without changing the prefix in that hook silently breaks signature verification. The symptom is every webhook rejected, with nothing in the logs pointing at the parser.
- Webhook handling must be idempotent. Stripe retries, and a duplicate `invoice.paid` that credits twice is a money bug that no test asserting "the happy path works" will catch.

## Metered Billing

`UsageMetrics` records `(tenantId, metric, periodStart, count)` with a composite index on all three. Note the table name is camelCase `UsageMetrics` — an inconsistency with every other snake_case table name, and one to remember when writing raw SQL.

`usage_alerts` lets a tenant set a threshold on a metric with a comparison operator (`gte`, `lte`, `eq`, `gt`, `lt`), a set of `notificationChannels` (JSONB), and an enable flag. When a metric crosses the threshold the alert fires through the notification module.

The alert is the tenant's own early warning, not the platform's enforcement mechanism. Enforcement is `plan_quotas` plus the quota middleware; the two are independent so a customer can be warned at 80% without being blocked at 80%.

## Quota Enforcement

`enforceQuota.middleware.js` runs **before** the handler (BR-15). A request that would exceed quota is rejected before any partial write occurs.

Enforcing after the fact would leave the system in the state the quota exists to prevent, and then have to unwind it — which is exactly the situation where partial rollbacks go wrong.

## Asset Finance

Distinct from platform billing: `asset_finances` is about the *customer's* devices, not about what the customer pays *us*.

| Column | Purpose |
|---|---|
| `purchasePrice`, `purchaseDate` | acquisition |
| `salvageValue`, `usefulLifeYears` | depreciation inputs |
| `depreciationMethod` | `straight_line` or `declining_balance` |
| `vendorId`, `invoiceNumber` | provenance |

This is what makes "recalibrate or replace" answerable with numbers rather than opinions, by putting book value next to accumulated maintenance cost.

Served under `/finance`, surfaced at `/dashboard/finance`.

## Frontend Surfaces

| Route | Shows |
|---|---|
| `/dashboard/billing` | subscription state, invoices, plan |
| `/dashboard/metered-billing` | usage metrics and alert configuration |
| `/dashboard/finance` | asset finance and depreciation |

## Configuration

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | provider API access |
| `STRIPE_WEBHOOK_SECRET` | signature verification for the raw-body path |

A live key present in a staging environment passes every per-field validity check — right shape, right length, valid string — and will charge a real card from a test. Only a cross-field rule that compares the key environment against `NODE_ENV` catches it. See [`../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md`](../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md).
