# 01 — Threat Model

STRIDE over the trust boundaries in [`02-TRUST-BOUNDARIES.md`](./02-TRUST-BOUNDARIES.md).

Threats are `T<n>`, rated by consequence rather than by likelihood alone — a low-likelihood total-compromise beats a high-likelihood nuisance.

---

## Assets, Ranked

| Asset | Why it matters |
|---|---|
| **Cross-tenant data** | one hospital seeing another ends the product |
| **Calibration records and certificates** | the evidence the product exists to produce |
| **`CERT_SIGNING_SECRET`** | loss makes every issued certificate unverifiable, permanently |
| **`ENCRYPT_KEY`** | loss makes every tenant private key and storage credential undecryptable |
| **`SUPERADMIN` credentials** | bypasses every permission check and every tenant predicate |
| **`audit_logs`** | the record of everything else |
| Personal data | GDPR exposure — users, not patients |
| API keys, device tokens, webhook secrets | machine credentials |

## Adversaries

| Adversary | Capability |
|---|---|
| Unauthenticated internet | reach the public endpoints |
| Authenticated tenant user | a valid token, one tenant, one role |
| Malicious tenant administrator | full write inside one tenant, can configure storage and webhooks |
| Compromised device | a valid `iotDeviceToken` |
| Insider with operator access | `SUPERADMIN` |
| Supply chain | a dependency, a base image |

The **malicious tenant administrator** is the most under-considered. They are trusted inside one tenant and can legitimately configure a storage bucket and a webhook URL — both of which point outward, from our network position.

---

## Spoofing

| ID | Threat | Control | Residual |
|---|---|---|---|
| T1 | Credential stuffing | lockout at 5 attempts, rate limits, MFA available | **MFA not enforced, including for `SUPERADMIN`** (PR-3) |
| T2 | Session token theft | hash-only storage, IP and UA binding, revocation | strict IP binding breaks mobile users; the balance is a product decision |
| T3 | Cloned WebAuthn authenticator | `webauthnSignCount` | must be **checked**, not merely stored |
| T4 | Account-existence enumeration via `/send-otp` | identical response either way | uniqueness violations still leak — see T5 |
| T5 | Tenant-membership oracle via `serialNumber` | — | **open**: the unique constraint is global, so a collision reveals another tenant holds that serial |
| T6 | Forged OIDC assertion | signature verification, per-tenant callbacks | IdP trust configuration is per tenant |
| T7 | Forged Stripe webhook | signature over the **raw body** | moving the mount without moving the raw-body URL prefix silently breaks verification |

## Tampering

| ID | Threat | Control | Residual |
|---|---|---|---|
| T8 | Editing a calibration record after the fact | append-only **convention** | **open** — `paranoid` model with `PUT`/`DELETE` routes (PR-2) |
| T9 | Deleting audit rows | no delete path anywhere | ideally a database `REVOKE`, tested as the application role |
| T10 | Forging a certificate | HMAC over the number, tenant-key signature | loss of `CERT_SIGNING_SECRET` is unrecoverable |
| T11 | Stored XSS via `posts.contentHtml` | sanitise on ingest, CSP on render | **the stored-XSS surface of the system** |
| T12 | Parameter pollution | `hpp` | |
| T13 | Direct quantity edit bypassing the movement ledger | — | **open**: `PATCH /stocks/:id` can change `quantity` with no reason recorded |

## Repudiation

| ID | Threat | Control |
|---|---|---|
| T14 | "I did not approve that" | `e_signature_records` with `meaning`, `authMethod`, `documentHash` |
| T15 | "That was not me" | `audit_logs` with actor, IP, user agent, in the action transaction |
| T16 | Operator action attributed to a customer | impersonation must be distinguishable in the trail — both transitions audited |

## Information Disclosure

| ID | Threat | Control | Residual |
|---|---|---|---|
| T17 | **Cross-tenant read** | deny-by-default ORM hooks | raw SQL, vector search, cache keys — [`05-MULTI-TENANCY-SECURITY.md`](./05-MULTI-TENANCY-SECURITY.md) |
| T18 | 403 versus 404 revealing existence | all cross-tenant failures return 404 | must hold on **every** route |
| T19 | RAG retrieval citing another tenant's documents | `document_chunks.tenantId` | **highest-risk instance** — similarity search does not scope itself |
| T20 | Secrets in `audit_logs.changes` | redaction by key-name walk at any depth | the table is undeletable, so a leak here is permanent |
| T21 | Raw database errors carrying SQL, or Node errors carrying file paths | the mapper forwards **recognised types only** | no care at the call site fixes an over-permissive mapper |
| T22 | `iotDeviceToken` in a device list response | must be excluded | a credential leak to everyone who can read the register |
| T23 | Internal ticket notes shown to the raiser | `ticket_comments.isInternal` | easy to forget in a list query |
| T24 | Pre-auth disclosure via `GET /tenants/public` | branding only | anything more on that endpoint is a leak |
| T25 | Attachment URL leaking into a chat log | HMAC-signed, time-limited | expiry bounds the damage |

## Denial of Service

| ID | Threat | Control | Residual |
|---|---|---|---|
| T26 | Request flooding | global limiter, 30s timeout, 10 MB bodies | **the non-production limit is 100,000/15 min and must never reach production** |
| T27 | Expensive report queries | batch jobs for large exports | reporting runs on the operational database (PR-10) |
| T28 | Upload exhaustion | quota enforced pre-handler | |
| T29 | IoT ingest flood | embedded broker shares the API process | a telemetry flood degrades the API |
| T30 | Redis loss disabling brute-force protection | Redis is a required dependency with a health check | **the outage window permits duplicates and unthrottled attempts** |
| T31 | Self-inflicted lockout via IP allowlist | — | **open**: no in-product recovery; confirm against the caller's address before applying |

T31 and the tenant-suspension trap (BR-3) are the same shape: an administrative action that removes the ability to reverse it.

## Elevation of Privilege

| ID | Threat | Control | Residual |
|---|---|---|---|
| T32 | Missing permission gate on a new route | `dynamicAccess` / `rbac` per route | nothing prevents omission — caught in review and tests |
| T33 | Role added without a `ROLE_LEVELS` entry | fails closed | **silently** — no error explains why every privileged gate fails |
| T34 | Stale cached menu tree after revocation | invalidate on change | TTL alone is a timed authorization bypass |
| T35 | `x-tenant-id` honoured for a non-super-admin | role-checked | ignored, not rejected — correct, so a probe learns nothing |
| T36 | `SUPERADMIN` compromise | audit, lockout, MFA available | **no second gate exists behind it** |
| T37 | Privilege via per-user override | `grantedBy` and `notes` | an override with neither is unexplainable at review |

## Server-Side Request Forgery

Its own section, because tenant administrators can legitimately supply outbound destinations.

| ID | Threat | Control |
|---|---|---|
| T38 | Tenant-supplied S3 endpoint pointing at an internal service or metadata address | **SSRF-checked** |
| T39 | Tenant-supplied webhook URL, same | validated |
| T40 | Custom-domain ACME callback | scoped to the challenge path |

**Operator-configured S3 endpoints are deliberately not checked** — `http://minio:9000` is the normal compose configuration. Any refactor that unifies the operator and tenant paths must keep the tenant side checked.

## Supply Chain

| ID | Threat | Control | Residual |
|---|---|---|---|
| T41 | Malicious dependency | lockfiles, audit | no automated advisory gate in CI yet |
| T42 | Compromised base image | pinned tags | `clamav/clamav:latest` and `dpage/pgadmin4:latest` are unpinned |
| T43 | Vendor concentration — Stripe, an OpenAI-compatible LLM | accepted (PR-8, PR-9) | provider swap is a schema change for Stripe |

## Top Five to Watch

1. **T17 / T19** — cross-tenant read, especially through vector retrieval and cache keys.
2. **T8** — the append-only guarantee is a convention with two endpoints that break it.
3. **T36** — super-admin compromise, with MFA not enforced.
4. **T20** — secrets reaching an undeletable table.
5. **T26** — the non-production rate limit leaking into production.
