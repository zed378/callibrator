# 11 — Billing and Finance API

Base: `/api/v1/billing`, `/api/v1/finance`, `/api/v1/metered-billing`, `/api/v1/quota`. Module `HDC-BILL` (16).

Product model: [`../PLAN/09-BILLING-AND-PLANS.md`](../PLAN/09-BILLING-AND-PLANS.md).

---

## `/api/v1/billing` — 4 endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/subscription` | `finance` read | current subscription |
| PATCH | `/subscription` | `finance` write | change plan or cycle |
| GET | `/invoices` | `finance` read | invoice list |
| POST | `/webhook` | **signature** | Stripe events |

### `POST /webhook` — the raw-body path

The single most delicate endpoint in the system, for a mechanical reason: **Stripe signature verification needs the unparsed request body**, and the global JSON parser would otherwise consume it.

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

`req.rawBody` survives `globalSanitizer`, which rewrites `req.body`, `req.query` and `req.params` only.

Three consequences:

1. **Moving the mount without moving the prefix in that hook silently breaks verification.** The symptom is every webhook rejected, with nothing in the logs pointing at the parser.
2. **The handler must be idempotent.** Stripe retries. A duplicate `invoice.paid` that credits twice is a money bug, and no test asserting the happy path will catch it. Use an atomic Redis claim (`SET NX`), and release it on failure — see [`../ARCHITECTURE/07-QUEUE-WORKER-ARCHITECTURE.md`](../ARCHITECTURE/07-QUEUE-WORKER-ARCHITECTURE.md).
3. **It is not token-authenticated.** The signature is the authentication. An unverified webhook endpoint is an unauthenticated write path into billing state.

### Subscriptions and invoices

`subscriptions`: `planId` (the provider plan id, not the `tenants.plan` enum), `status` (`Active`, `PastDue`, `Canceled`, `Unpaid`), `billingCycle` (`Monthly`, `Annually`), `currentPeriodStart`, `currentPeriodEnd`, `stripeCustomerId`, `stripeSubscriptionId`.

`invoices`: `amountDue`, `amountPaid`, `currency`, `status` (`Draft`, `Open`, `Paid`, `Uncollectible`, `Void`), `invoiceUrl`, `stripeInvoiceId`.

Both mirror Stripe vocabularies deliberately, so reconciliation is a comparison rather than a translation.

**Casing trap:** `subscriptions.billingCycle` is `Monthly`/`Annually` while `tenants.billingCycle` is `monthly`/`yearly`. Two enums, two vocabularies, one idea. Mapping code must not assume a case transform is sufficient.

## `/api/v1/finance` — 6 endpoints

Asset finance — the **customer's** devices, not what the customer pays us.

| Method | Path | Purpose |
|---|---|---|
| GET | `/reports/depreciation` | depreciation report |
| GET | `/` | list finance records |
| POST | `/` | create |
| GET | `/:financeId` | one |
| PATCH | `/:financeId` | update |
| DELETE | `/:financeId` | soft delete |

`asset_finances`: `deviceId`, `purchasePrice`, `purchaseDate`, `salvageValue`, `usefulLifeYears`, `depreciationMethod` (`straight_line`, `declining_balance`), `vendorId`, `invoiceNumber`, `notes`.

Indexed on `device_id`, `tenant_id`, `purchase_date`.

This exists so "recalibrate or replace" is answerable with numbers: book value next to accumulated maintenance cost. Without both halves it is an opinion.

Note `/reports/depreciation` is declared **before** `/:financeId`. Route order matters — declared after, `depreciation` would be captured as a `financeId` and fail UUID validation.

## `/api/v1/metered-billing` — 8 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/usage` | current period usage |
| GET | `/history` | historical usage |
| POST | `/estimate` | estimate a cost |
| GET | `/plan` | plan and entitlements |
| GET | `/alerts` | usage alerts |
| POST | `/alerts` | create an alert |
| DELETE | `/alerts/:alertId` | delete |
| GET | `/analytics` | usage analytics |

`UsageMetrics` — note the **camelCase table name**, the only one in the schema. Columns `tenantId`, `metric`, `periodStart`, `count`, with a composite index on all three. Only matters in raw SQL, where PostgreSQL will require quoting.

`usage_alerts`: `metricName`, `threshold` (FLOAT), `comparison` (`gte`, `lte`, `eq`, `gt`, `lt`), `notificationChannels` (JSONB), `isEnabled`, `description`.

An alert is the tenant's early warning, **not** the platform enforcement mechanism. Enforcement is `plan_quotas` plus the quota middleware, and the two are independent so a customer can be warned at 80% without being blocked at 80%.

## `/api/v1/quota` — 1 endpoint

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | current quota state and headroom |

Backed by `plan_quotas` (`tenantId`, `metric`, `limit`, indexed as a pair) plus the hard tenant limits `tenants.limitSeats` and `tenants.limitStorageMb`.

### Enforcement is before the work

`enforceQuota.middleware.js` runs **ahead of the handler** (BR-15). A request that would exceed quota is rejected before any partial write.

Enforcing afterwards leaves the system in the state the quota exists to prevent and then has to unwind it — which is precisely where partial rollbacks go wrong.

### Plan and entitlement are separate

`tenants.plan` (`free`, `professional`, `business`, `enterprise`) is a label. It grants nothing by itself. Entitlement is `plan_quotas` rows and the two hard limits.

That separation is what makes "this enterprise customer negotiated 500 seats instead of the standard 200" a data change rather than a code change.

## Permissions

| Menu group | Write | Read |
|---|---|---|
| `finance` | `SUPERADMIN` | `HEALTHCARE ADMIN`, `CALIBRATOR ADMIN`, `ENGINEERING MANAGER` |
| `metered-billing` | `SUPERADMIN` | `HEALTHCARE ADMIN` |

Only the platform operator writes billing configuration. Tenants read their own.

## Configuration

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | provider API access |
| `STRIPE_WEBHOOK_SECRET` | signature verification |

**A live key in a staging environment passes every per-field check** — right shape, right length, valid string — and will charge a real card from a test. Only a cross-field rule comparing the key environment against `NODE_ENV` catches it.

The reverse is worse: a sandbox key in production makes every order look paid while no money arrives, and nothing errors. See [`../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md`](../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md).

## Frontend

`/dashboard/billing`, `/dashboard/finance`, `/dashboard/metered-billing`. Services: `billing.service.ts`, `finance.service.ts`, `meteredBilling.service.ts`, `quota.service.ts`.
