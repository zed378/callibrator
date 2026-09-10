# 11 — Billing Tables

`subscriptions` · `invoices` · `plan_quotas` · `UsageMetrics` · `usage_alerts`

Note: `asset_finances` is **not** here. It is the customer device finance and lives in [`06-DEVICE-TABLES.md`](./06-DEVICE-TABLES.md). Two different meanings of "finance" in one schema.

---

## `subscriptions`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | |
| `planId` | `STRING` | the **provider** plan identifier, not the `tenants.plan` enum |
| `status` | ENUM | `Active`, `PastDue`, `Canceled`, `Unpaid` |
| `billingCycle` | ENUM | **`Monthly`, `Annually`** |
| `currentPeriodStart`, `currentPeriodEnd` | `DATE` | the window metering is attributed to |
| `stripeCustomerId`, `stripeSubscriptionId` | `STRING` | provider linkage |

### The casing trap

| Table | Column | Values |
|---|---|---|
| `tenants` | `billingCycle` | `monthly`, `yearly` |
| `subscriptions` | `billingCycle` | `Monthly`, `Annually` |

Two enums, two vocabularies, one idea. The casing differs **and** the word differs (`yearly` versus `Annually`), so a case transform is not sufficient to map between them.

Any code that maps must map explicitly. Recorded as PR-13.

### `planId` versus `tenants.plan`

`tenants.plan` is a product label (`free`, `professional`, `business`, `enterprise`) and grants nothing on its own. `subscriptions.planId` is what Stripe knows.

Keeping them separate is what allows a plan label to be renamed without touching the provider, and a provider plan to be swapped without renaming the product.

## `invoices`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | |
| `subscriptionId` | `UUID` | |
| `amountDue`, `amountPaid` | `DECIMAL` | |
| `currency` | `STRING` | |
| `status` | ENUM | `Draft`, `Open`, `Paid`, `Uncollectible`, `Void` |
| `invoiceUrl` | `STRING` | the provider-hosted invoice |
| `stripeInvoiceId` | `STRING` | migration `0002` |

`DECIMAL` for money, never `FLOAT`. Binary floating point cannot represent common decimal fractions exactly, and an invoice total that is off by a cent is a reconciliation problem that compounds.

Statuses mirror Stripe deliberately, so reconciliation is a **comparison** rather than a translation. A local vocabulary would require a mapping table that drifts the moment the provider adds a state.

`amountDue` and `amountPaid` are separate because partial payment is a real state that a single `amount` column cannot express.

## `plan_quotas`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | |
| `metric` | `STRING` | |
| `limit` | `INTEGER` | |

Composite index on `(tenant_id, metric)` — this is checked on the hot path by `enforceQuota.middleware.js`, so the index is not optional.

### Plan and entitlement are separate on purpose

`tenants.plan` is a label. Entitlement is these rows plus the two hard columns `tenants.limitSeats` and `tenants.limitStorageMb`.

That separation is what makes "this enterprise customer negotiated 500 seats instead of the standard 200" a **data change rather than a code change**. Encoding entitlement in the plan enum would make every negotiated exception a deployment.

### Enforced before the work

Quota is checked ahead of the handler (BR-15), so a rejected request never performs a partial write. Enforcing afterwards leaves the system in the state the quota exists to prevent and then has to unwind it, which is precisely where partial rollbacks go wrong.

## `UsageMetrics`

**The one camelCase table name in the schema.**

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `metric` | `STRING` | |
| `periodStart` | `DATE` | indexed |
| `count` | `INTEGER` | |

Composite index on `(tenantId, metric, periodStart)` — note the index field names are camelCase too, matching the attribute names rather than the usual snake_case columns.

Only matters in raw SQL, where PostgreSQL will require quoting:

```sql
SELECT * FROM "UsageMetrics" WHERE "tenantId" = $1;
```

Recorded as PR-15. Renaming it is a migration with no functional benefit, so it stays and is documented.

### Metering window

`periodStart` aligns to the subscription period (`currentPeriodStart`), not to a calendar month. A customer billed on the 14th meters from the 14th, and a calendar-month rollup would bill them for a window they were not subscribed for.

## `usage_alerts`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `metricName` | `STRING` | indexed |
| `threshold` | `FLOAT` | |
| `comparison` | ENUM | `gte`, `lte`, `eq`, `gt`, `lt` |
| `notificationChannels` | `JSONB` | |
| `isEnabled` | `BOOLEAN` | |
| `description` | `STRING` | |

### An alert is not enforcement

`usage_alerts` is the **tenant's own early warning**. `plan_quotas` plus the quota middleware is the **platform's enforcement**. They are independent.

That independence is the feature: a customer can be warned at 80% without being blocked at 80%, and a customer can be blocked at 100% whether or not they set up an alert.

Merging them would mean either warning nobody who has not configured it, or blocking everyone at their warning threshold. Both are wrong.

`lte` and `lt` exist because some metrics are alarming when they fall — available storage headroom, for instance.

## The Webhook and Idempotency

Billing state is mutated by Stripe webhooks, not only by user action. Two properties follow, and both are schema-relevant:

1. **Webhook handling must be idempotent.** Stripe retries. A duplicate `invoice.paid` that credits twice is a money bug that no happy-path test will catch. Use an atomic Redis claim (`SET NX`) and release it on failure.
2. **The signature is the authentication.** `POST /api/v1/billing/webhook` is not token-authenticated. An unverified webhook endpoint is an unauthenticated write path into billing state.

Signature verification needs the **unparsed body**, which is why the global JSON parser carries a `verify` hook stashing raw bytes on `req.rawBody` for that URL prefix only. Moving the mount without moving the prefix silently breaks verification, with nothing in the logs pointing at the parser.

## Environment Traps

**A live Stripe key in staging passes every per-field check** — right shape, right length, valid string — and will charge a real card from a test. Only a cross-field rule comparing the key environment against `NODE_ENV` catches it.

The reverse is worse: a sandbox key in production makes every order look paid while no money arrives, and **nothing errors**. See [`../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md`](../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md).
