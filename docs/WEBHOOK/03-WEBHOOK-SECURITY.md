# 03 — Webhook Security

The signing scheme precisely enough to verify from this page alone, the secret's lifecycle, who may repoint a webhook, and what it means that this is the one place hospital data leaves the tenant on the platform's initiative.

Source: `backend/src/services/webhook.service.js`, `backend/src/routes/api/webhooks.route.js`, `backend/src/models/webhook.model.js`, `backend/src/utils/ssrf.util.js`, `backend/src/middlewares/auth.middleware.js`, `backend/src/middlewares/rbac.middleware.js`.

---

## A Webhook Is An Outbound Channel Out Of The Tenant

Everywhere else in this platform, data moves because someone asked for it: a request arrives with a credential, the tenant predicate is applied, a response goes back to the caller. The control is *who is asking*.

A webhook inverts that. The platform originates the request. It chooses to send, on its own schedule, to an address a tenant admin typed into a form, carrying device and calibration data, from inside the platform's own network position. Nobody authenticates to receive it. The URL **is** the authorization.

Two consequences follow, and both belong in a threat model before a line of webhook code is reviewed.

**1. The URL is a data-exfiltration primitive.** Anyone who can create or edit a webhook can redirect a tenant's calibration events to a host they control. Not read them from the database — have them pushed, nightly, signed, in JSON, with no further access. The control on exfiltration is therefore not the response envelope or the tenant hooks; it is *who may write to `webhooks.url`*.

**2. The URL is an SSRF primitive.** The outbound request originates inside the deployment. `http://169.254.169.254/latest/meta-data/`, `http://minio:9000`, `http://postgres:5432` are all addresses the platform can reach and the internet cannot. Destination validation is not a hardening nicety here; it is the boundary.

**3. What leaves the hospital's boundary leaves it in the clear to whoever owns that host.** The payload is device identity — `deviceId`, `name`, `serialNumber`, `nextCalibrationDate`, `workOrderId` ([`01-EVENT-CATALOG.md`](./01-EVENT-CATALOG.md)). No patient data, no user identity. That is a fact about today's two events, not a property of the mechanism: the mechanism will send whatever a future `emitEvent` payload contains, to a third-party host, over a transport the tenant chose. Every new event's payload is a data-export decision, and under GDPR and the hospital's own data-sharing rules it is the tenant's decision to have made knowingly. There is no per-event consent, no field redaction and no data-processing-agreement gate in the code — the only control is that the tenant admin registered the URL.

## Who May Manage A Webhook

**As-built, 2026-09-23 — every route on `webhooks.route.js` is gated:**

```js
const webhookAdmin = [auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])];
```

Applied to all seven: `POST /`, `GET /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`, `GET /:id/deliveries`, `POST /:id/test`. `POST /` additionally carries `requireFeature("webhooks")`, which returns **402** on a plan without the feature (`professional` and above, per `quota.service.js`).

Each of the three parts is doing distinct work:

| Middleware | Without it |
|---|---|
| `auth` | anonymous management |
| `denyApiKey` | a scoped API key could register a webhook and widen its own reach into a standing export channel — a privilege escalation from "read some endpoints" to "receive everything, forever" |
| `rbac([TENANT_ADMIN])` | any role with a token could repoint the tenant's webhook |

`TENANT_ADMIN` is a **logical tier**, not a seeded role — `ROLE_LEVELS.TENANT_ADMIN = 8` in `roleConstants.js`. `rbac` defaults to `allowHigher: true`, so the gate means "role level ≥ 8", and `SUPER_ADMIN` bypasses it outright (`rbac.middleware.js`, step 3).

### The history, because this document is as-built

**Before 2026-09-23 every one of these routes carried `auth` alone.** Any authenticated principal in the tenant — the lowest-privileged room user, or any API key — could `PATCH /api/v1/webhooks/:id` and point the tenant's webhook at a host it controlled, then read the tenant's device events off it indefinitely. Recorded as [A-02](../../TASKS/AUDIT-2026-09-REMEDIATION.md); fixed in commit `e326ae5`.

The guard is asserted by `backend/src/tests/routes/routeGuards.a02.test.js`, which checks each of the seven routes for `auth`, `denyApiKey` and `__roles === [TENANT_ADMIN]`, and then sweeps the router for any route left on `auth` alone. That sweep is the part that matters: it fails on a route added later without a gate, which is how the original defect got in.

### Cross-tenant reads return 404

`loadOwned` (`webhook.service.js:87`) does `Webhook.findOne({ where: { id, tenantId } })` and throws `AppError(404, "Webhook not found")`. A webhook id belonging to another tenant is indistinguishable from one that never existed — correct, and the rule stated in `CLAUDE.md`.

> **As-built, 2026-09-23: no test asserts it.** There is no two-tenant test on any `/webhooks/:id` route. `webhooks.route.test.js` asserts only that the module exports a router with routes on valid HTTP methods. `tests/e2e/modules/webhooks.e2e.test.js` logs in as the seeded `SUPER_ADMIN` and walks the happy path — a principal that bypasses `rbac` and, being super-admin, is scoped by neither the hooks nor a second tenant. The behaviour above is read out of the service, not demonstrated by a suite.

## The Signature

### What the sender does

`webhook.service.js:28`:

```js
const sign = (secret, body) =>
  crypto.createHmac("sha256", secret).update(body).digest("hex");
```

and `webhook.service.js:145`:

```js
const body = JSON.stringify({ id, event, createdAt, data });
const signature = sign(webhook.secret, body);
// header: "X-Webhook-Signature": `sha256=${signature}`
```

Stated exactly:

| | |
|---|---|
| **Algorithm** | HMAC-SHA-256 |
| **Key** | the UTF-8 bytes of `webhooks.secret` **as stored** — the string itself, *not* hex-decoded. The default is a 48-character lowercase hex string (`crypto.randomBytes(24).toString("hex")`), and the key is those 48 ASCII bytes, not the 24 bytes they encode. Decoding it first produces a different, wrong signature. |
| **Signed bytes** | the **entire raw HTTP request body**, UTF-8, exactly as transmitted — the output of `JSON.stringify({ id, event, createdAt, data })`. Nothing is prepended, appended, or interposed: no timestamp, no delivery id, no version prefix, no newline, no separator. |
| **Encoding** | lowercase hex, 64 characters, from `.digest("hex")` |
| **Header** | `X-Webhook-Signature: sha256=<64 hex chars>` — the literal prefix `sha256=` then the digest |

### The full request

`POST` to the registered URL, with exactly these headers set by this code:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Webhook-Event` | the event name, e.g. `device.overdue` |
| `X-Webhook-Id` | the **webhook** id (`webhooks.id`) — which subscription this is |
| `X-Webhook-Delivery` | the **delivery** id (`webhook_deliveries.id`) — stable across every retry of this delivery |
| `X-Webhook-Signature` | `sha256=<hex>` |

Any other header on the wire (`user-agent`, `accept`, `accept-encoding`) comes from the Node runtime's `fetch`, is not configured by this code, and is **not documented here because it has not been observed against a live receiver.** Do not build a receiver that depends on one.

There is **no** timestamp header and **no** version header.

### Verifying — Node

```js
const crypto = require("crypto");

// express: app.post("/hook", express.raw({ type: "application/json" }), handler)
// The signature covers the RAW bytes. Re-serializing a parsed object will not
// reproduce them — key order, spacing and number formatting all differ.
function verify(rawBody, header, secret) {
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)   // secret as the stored string
    .update(rawBody)                // Buffer or UTF-8 string, the raw body
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

### Verifying — Python

```python
import hmac, hashlib

def verify(raw_body: bytes, header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, header or "")
```

Compare in constant time. A byte-by-byte `==` on a hex digest is a timing oracle that lets an attacker recover a valid signature one nibble at a time.

### What the signature does not give you

**It is not replay protection.** The body contains no timestamp the receiver can bound, the headers contain none, and none is signed. A captured request is valid forever, to anyone who can reach the receiver. This is [A-10](../../TASKS/AUDIT-2026-09-REMEDIATION.md), whose Definition of Done includes "a signed timestamp header, and receivers told to reject stale ones" — **open as of 2026-09-23**.

**What you do have is a stable delivery id.** `X-Webhook-Delivery`, and the identical `id` inside the signed body, are the `webhook_deliveries` primary key, and are byte-identical across every retry attempt of the same delivery. That makes the receiver's side of the contract tractable today:

> **Receivers: deduplicate on the delivery id, and treat it as an idempotency key, not as freshness.** Two POSTs with the same `id` are the same event — process once. A POST with an `id` you have never seen is *not* thereby recent; it only means you have not processed it. Until a signed timestamp exists, the receiver's own defences against replay are (a) HTTPS to a host only the platform's egress can reach, and (b) a bounded dedup window that is at least as long as the retry window, and preferably much longer.

**It is not transport security.** The URL validator accepts `http:` as well as `https:` (`ssrf.util.js#assertSafeUrl`). A receiver registered over plain HTTP puts the payload, and every header including the signature, on the wire in the clear. Nothing in the platform warns about this. Register `https:` URLs.

**It does not authenticate the receiver to the platform.** There is no mTLS, no pinning, no allowlist. Whatever DNS resolves to at the moment of dispatch gets the POST.

## The Secret

| | |
|---|---|
| Column | `webhooks.secret`, `STRING(128)`, `allowNull: false` |
| Default | `crypto.randomBytes(24).toString("hex")` — 48 hex characters, 192 bits of entropy |
| At rest | **plaintext.** Not encrypted with `KMS_MASTER_KEY`; the model registers no `SENSITIVE_KEYS` handling, unlike tenant storage credentials (`tenantSettings.model.js`). Anyone with a database read, or a database backup, has every tenant's signing key. |
| Returned | **once**, from `POST /api/v1/webhooks`, in `{ ...publicWebhook(webhook), secret }` (`webhook.service.js:65`). `publicWebhook` omits it everywhere else, so `GET /`, `GET /:id` and `PATCH /:id` never expose it. |
| Rotation | **there is none.** `updateWebhook` patches only `url`, `events`, `description`, `isActive` (`webhook.service.js:100`). A leaked secret can be replaced only by deleting the webhook and registering a new one — which means a new webhook id and a gap. |

### The secret can be chosen by the caller

`createWebhook` accepts `secret` in its options object, and the controller spreads the request body into it:

```js
// webhook.controller.js
webhookService.createWebhook(req.user.tenantId, { ...req.body, createdBy: req.user.id });
// webhook.service.js:61
...(secret ? { secret } : {}),
```

There is no validator on the route — `webhooks.route.js` mounts no `validate(schema)` on any endpoint — so `{"url": "...", "events": ["*"], "secret": "a"}` creates a webhook whose signatures are forgeable by anyone who guesses one character. Nothing rejects it, nothing warns, and the secret is never shown again so nobody notices.

This is deliberate-looking (it allows a receiver to bring a pre-shared secret) but unguarded. **A caller-supplied secret must be at least 32 bytes of random data.** Until a validator enforces a minimum length, omit `secret` and let the platform generate it.

The other consequence of the missing validator is that `url`, `events`, `description` and `isActive` reach the service unvalidated too; the service's own checks (`url` required, `events` a non-empty array, `assertSafeUrl`) are the only ones that run.

### Changing the URL does not change the secret

`PATCH /:id` with a new `url` keeps the existing secret. The new host receives deliveries signed with a key the old host already holds. Where a receiver is being migrated between vendors, delete and re-register rather than patch.

## SSRF

Two layers, both in `backend/src/utils/ssrf.util.js`, both wired into the webhook path.

**Layer 1 — at registration and at update.** `assertSafeUrl(url)` runs in `createWebhook` (`webhook.service.js:51`) and again in `updateWebhook` whenever `url` is present in the patch (`webhook.service.js:107`). Synchronous, and it rejects with **400**:

- any scheme but `http:` or `https:`
- embedded credentials (`https://user:pass@host/`)
- `localhost`, `*.localhost`, `*.local`
- a literal IP in a blocked range

**Layer 2 — immediately before every dispatch.** `assertResolvedHostIsPublic(webhook.url)` runs at the top of `attemptDelivery` (`webhook.service.js:158`), on **every attempt**, including every retry. It re-runs `assertSafeUrl`, then `dns.lookup(host, { all: true })` and rejects if **any** resolved address is blocked.

Layer 2 exists because layer 1 cannot be sufficient: a hostname that resolved publicly at registration can be repointed at `10.0.0.5` an hour later, and DNS rebinding makes that an attack rather than an accident. Running it per-attempt rather than per-delivery is the right call and should survive any refactor.

Blocked ranges (`BLOCKED_IPV4`, `isBlockedIpv6`): `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, **`169.254/16`** (cloud metadata), `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4`, `240/4`; and `::1`, `::`, `fc00::/7`, `fe80::/10`, `ff00::/8`, plus IPv4-mapped forms. Anything that is not a valid IP is blocked defensively.

A DNS failure is also a 400 — so a receiver whose DNS is down produces `lastError: "URL host could not be resolved"` rather than a timeout.

### The gap: redirects are followed, and not re-checked

`attemptDelivery` calls `fetch` without setting `redirect`, so the runtime default — **follow** — applies. `assertResolvedHostIsPublic` validates the *registered* URL. It does not run again on a redirect target.

A registered host that passes both layers can answer `302 Location: http://169.254.169.254/latest/meta-data/` and the platform will follow it, from inside the deployment, with the tenant's payload and signature attached. Neither SSRF layer sees the second request.

The fix is one option on the `fetch` call — `redirect: "manual"` (or `"error"`) — and treating a 3xx as a delivery failure, which is also the more honest contract: a webhook endpoint that redirects is misconfigured. **Not fixed as of 2026-09-23; no finding id yet.**

### The stale comment on the model

`webhook.model.js`, on the `url` validator:

> `NOTE: outbound webhook URLs are attacker-influenced — SSRF hardening (blocking internal/link-local targets) is a recommended follow-on.`

That comment predates `ssrf.util.js` and is wrong today: the hardening exists, in the service, on both paths. The model's own `isHttpUrl` validator is genuinely permissive — it accepts `http://127.0.0.1/` — but nothing reaches the model without going through `createWebhook` or `updateWebhook` first. Reading the model alone will mislead you; reading the service will not.

## The Delivery Log Is Tenant Data

`webhook_deliveries` stores the full `payload` JSONB of every delivery, indefinitely. There is no retention policy on the table and no redaction. `GET /api/v1/webhooks/:id/deliveries` returns the raw rows — `payload`, `lastError`, `responseStatus` — to any tenant admin, scoped by `loadOwned` and by `where: { tenantId, webhookId: id }`.

That is the right audience for it. It also means every future event payload is retained in the platform's own database as well as sent, and any field added to an event payload is added to this table too.

`lastError` is the receiver's error message, stored as free text. It is a string from a third-party host, written to a `TEXT` column and rendered in the dashboard (`DeliveriesPanel.tsx`) — untrusted input on a trusted page, worth checking on any change to how it is displayed.

## Checklist For A Change To This Module

- [ ] the route still carries `auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])`, and `routeGuards.a02.test.js` still sweeps for a route on `auth` alone
- [ ] `assertSafeUrl` on every path that writes `webhooks.url`; `assertResolvedHostIsPublic` on every path that dispatches
- [ ] the explicit `where: { tenantId }` in `emitEvent` is intact — on the cron path the hooks add nothing (see [`01-EVENT-CATALOG.md`](./01-EVENT-CATALOG.md) § Tenant Scoping)
- [ ] the secret is not in any response but the 201 from `POST /`
- [ ] a cross-tenant `:id` returns 404, not 403 — and, unlike today, a test says so
- [ ] the signed bytes did not change. Any change to the body shape breaks every existing receiver's signature check silently, with no error on the sending side

## Related

| For | Read |
|---|---|
| what is in the payload that leaves | [`01-EVENT-CATALOG.md`](./01-EVENT-CATALOG.md) |
| how many times it is sent, and what survives a restart | [`04-WEBHOOK-RETRY.md`](./04-WEBHOOK-RETRY.md) |
| the endpoints, and the SSRF note on tenant storage endpoints | [`../API/13-INTEGRATION-API.md`](../API/13-INTEGRATION-API.md) |
| the isolation model | [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) |
| the keyboard-level rules | [`../ENGINEERING/13-SECURITY-CODING-RULES.md`](../ENGINEERING/13-SECURITY-CODING-RULES.md) |
| the findings | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-02, A-10 |
