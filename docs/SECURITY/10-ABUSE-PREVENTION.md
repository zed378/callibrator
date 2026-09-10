# 10 — Abuse Prevention

Defences against a caller who is authenticated and entitled to be here, but is using the system in a way it was not meant to be used.

Distinct from [`08-API-SECURITY.md`](./08-API-SECURITY.md), which defends the edge against outsiders.

---

## Credential Abuse

| Vector | Control |
|---|---|
| Credential stuffing | Redis counter: 5 attempts / 15 min, then lockout |
| Password spraying | the counter is per account **and** per source |
| OTP flooding | 3 / 15 min with lockout; 5 / hour at Express |
| Reset-token brute force | 5 / 5 min |
| Account enumeration | uniform responses on login and `/send-otp` |

### Lockout is itself an abuse vector

An attacker who knows an email address can keep that user locked out indefinitely by failing logins on purpose.

Counting per source as well as per account is what prevents a single actor locking many accounts. A counter keyed only on the account hands an attacker a cheap denial tool aimed at named people — which, in a hospital, can mean the person who needs to sign a calibration before a device goes back into service.

## Resource Abuse

| Vector | Control | Residual |
|---|---|---|
| Request flooding | global limiter, 30s timeout, 10 MB bodies | **the non-production limit is 100,000/15 min and must never reach production** |
| Storage exhaustion | `tenants.limitStorageMb`, checked **before** the write | |
| Seat abuse | `tenants.limitSeats`, same | |
| Expensive reports | large exports run as batch jobs | reporting still runs on the operational database (PR-10) |
| Batch job flooding | `plan_quotas`, `BATCH_PREFETCH` | a tenant can still queue many jobs |
| IoT ingest flooding | device token required, `iotEnabled` gate | **the MQTT broker is embedded in the API process — a telemetry flood degrades the API** |
| Vector search cost | per-tenant LLM keys | a tenant on the platform key spends platform budget |

Quota is enforced ahead of the handler (BR-15), so a rejected request never performs a partial write and never leaves a half-uploaded object.

## Outbound Abuse

The platform makes requests from its own network position to addresses a **tenant administrator** chose. That administrator is trusted inside their tenant and is not trusted to name our internal hosts.

| Vector | Control |
|---|---|
| Webhook URL pointing at an internal service or `169.254.169.254` | destination validation |
| S3 endpoint, same | **SSRF-checked for tenant-supplied endpoints** |
| Webhook used as a traffic amplifier | delivery retry bounded, terminal `exhausted` state |
| Email relay abuse | notifications are system-generated, not free-form user sends |

**Operator-configured S3 endpoints are deliberately not checked** — `http://minio:9000` is the normal compose configuration. Any refactor that unifies the operator and tenant paths must keep the tenant side checked.

## Content Abuse

| Vector | Control | Residual |
|---|---|---|
| Stored XSS via `posts.contentHtml` | sanitise on ingest, CSP on render | the API CSP allows `'unsafe-inline'` for swagger; that reasoning does not transfer to the pages rendering user HTML |
| Malicious upload | ClamAV when configured, **fail-closed** on scanner error | `VIRUS_SCAN_PROVIDER` defaults to `none` |
| Upload served as active content | `nosniff` + `Content-Disposition: inline` | |
| Free-text fields in tickets and notifications | sanitised on ingest | |

## Privilege Abuse

The insider cases, which are the ones a permission model exists for.

| Vector | Control | Residual |
|---|---|---|
| Tenant admin escalating a user beyond their role | per-user overrides carry `grantedBy` and `notes` | an override with neither is unexplainable at review |
| Editing a calibration record after the fact | append-only **convention** | **open** — `paranoid` model with `PUT`/`DELETE` routes (PR-2) |
| Changing stock quantity with no explanation | movement ledger tables | **open** — `PATCH /stocks/:id` can change `quantity` directly |
| Deleting evidence | `audit_logs` has no delete path | ideally a database `REVOKE`, tested as the **application role** |
| Operator impersonating a user | audited both ways | must be **distinguishable** in the trail from the user acting themselves |
| Super-admin acting inside a tenant | audited | no second gate exists behind level 10 |

Three of these are open, and all three are in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md). They are listed here rather than omitted because an abuse-prevention document that only lists solved problems is a marketing document.

## Self-Inflicted Lockouts

Two administrative actions remove the ability to reverse themselves. They are the same shape and both need a confirmation step against current state.

### Tenant suspension

Suspending a tenant blocks every request from its users (BR-3). Suspending the **default** tenant blocks the super-admin who lives in it, including the request that would un-suspend it. Recovery requires a direct database update.

Any script or test that suspends must create a **disposable** tenant first — a rule learned by doing it, and recovering by hand.

### IP allowlist

`PUT /api/v1/network-security/ip-allowlist` can exclude the caller. There is no in-product recovery.

The mitigation is to validate the new allowlist against the caller's current address **before** applying it, and refuse a list that would lock them out. Not currently implemented (T31).

## Scheduled-Job Abuse

Not malicious, but the same consequence.

**A cron job installed in every replica runs once per replica.** Two backend replicas means every scheduled backup runs twice, every retention purge runs twice, every calibration sweep notifies twice.

Two mitigations; the system relies on the second:

1. Leader election by Redis lease.
2. Deployment discipline — exactly one replica runs schedulers.

The Helm chart **refuses to render** a configuration with more than one cron-enabled replica, which turns a silent double-run into a deployment failure. See [`../DEVOPS/09-KUBERNETES.md`](../DEVOPS/09-KUBERNETES.md).

A lease is not consensus. It bounds duplication; **idempotency** is what makes the remaining duplication harmless.

## Duplicate-Delivery Abuse

Not an attacker — the message broker.

RabbitMQ redelivers on nack and on connection loss. Stripe retries webhooks. Both are correct behaviour, and both produce duplicate side effects unless the consumer is idempotent.

**"Check then mark" is racy.** Two consumers can both pass the check before either marks — the result is a payment credited twice or an email sent twice, with nothing in the logs looking abnormal.

```js
const claimed = await redis.set(key, "1", "NX", "EX", ttl);
if (!claimed) return;
try { await doWork(); }
catch (e) { await redis.del(key); throw e; }   // RELEASE, or the retry does nothing
```

The release is not optional. Without it, "retry three times" becomes "try once, no-op twice" — and the logs of that are identical to three successful attempts, which is why it survives review.

### The Redis outage window

Redis holds the idempotency claims. An outage window is a window in which duplicate emails, duplicate webhook deliveries and duplicate job side effects were possible.

**Redis coming back is not the end of that incident.** The window needs reviewing, not assuming.

## Monitoring for Abuse

| Signal | Suggests |
|---|---|
| Lockout rate rising | credential stuffing |
| 429 rate rising on one tenant | scripted misuse, or a broken integration |
| `audit_logs` `EXPORT` volume rising | data exfiltration |
| Storage growth outpacing device growth | upload abuse |
| Webhook delivery failures to one destination | a receiver being used as a relay, or simply down |
| `PROCESSING` batch jobs not terminating | worker crash or a poison message |
| Login `ipAddress` values from unexpected geography | account compromise |

See [`../DEVOPS/07-ALERTING.md`](../DEVOPS/07-ALERTING.md).
