# 00 — Security Requirements

Requirements are `S<n>`. Each names its **enforcement point of record** — the code that must never be removed. A requirement with no enforcement point is an aspiration.

**[`05-MULTI-TENANCY-SECURITY.md`](./05-MULTI-TENANCY-SECURITY.md) is mandatory reading for every engineer on this project.** Tenant isolation is the number-one control; everything else is secondary to it.

---

## Unwaivable

These cannot be waived by anyone, for any deadline.

| ID | Requirement | Enforcement point of record |
|---|---|---|
| **S1** | No cross-tenant read or write is possible on any endpoint | `backend/src/utils/tenantScope.util.js` — global Sequelize hooks |
| **S2** | An authenticated principal with no resolvable tenant sees **nothing**, not everything | the `deny` branch resolving to `NO_TENANT_UUID` |
| **S3** | Non-existent, soft-deleted and not-yours are indistinguishable — all **404** | route handlers; a 403 for "not yours" is an existence oracle |
| **S4** | Every mutation writes an audit row inside the same transaction | `auditLog.middleware.js`, `audit_logs` |
| **S5** | `audit_logs` has no delete path | the **absence** of one; ideally a database `REVOKE` |
| **S6** | No secret in the repository, in a log, or in an error response | secret scanning, log redaction, `errorHandlers.middleware.js` |

## Authentication

| ID | Requirement | Where |
|---|---|---|
| S7 | Passwords hashed with a modern adaptive function, never reversible | `users.password` |
| S8 | Failed logins counted; the account locks | `failedLoginAttempts`, `lockedUntil` |
| S9 | Auth endpoints rate-limited independently of the global limit | 20/15 min at Express; 5/15 min with lockout at Redis |
| S10 | OTP requests throttled separately and expire | 5/hour; `otpExpiredAt` |
| S11 | Sessions persisted, revocable individually and in bulk, bound to IP and user agent | `sessions`, `sessionSecurity.middleware.js` |
| S12 | Only the token **hash** is stored | `sessions.token_hash` |
| S13 | MFA (TOTP) and WebAuthn available | `users.mfaSecret`, `webauthn*` |
| S14 | WebAuthn sign count checked, not merely stored | `users.webauthnSignCount` |
| S15 | `/send-otp` returns the same response whether or not the address exists | account-existence oracle |

**Known gap:** MFA is available, not enforced — including for `SUPERADMIN`, which bypasses every permission check and every tenant predicate. Mandatory MFA at role level 10 is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md) and named as PR-3.

## Authorization

| ID | Requirement | Where |
|---|---|---|
| S16 | Every non-public route carries an explicit permission gate | `dynamicAccess`, `rbac`, `abac` |
| S17 | The client is never the enforcement point | every route enforces independently |
| S18 | Permission changes invalidate the cached menu tree immediately | TTL alone is a timed authorization bypass |
| S19 | Role level gates privileged operations, by number not by name | `ROLE_LEVELS` |
| S20 | Per-user overrides are attributable | `user_menu_permissions.grantedBy`, `.notes` |

## Input and Output

| ID | Requirement | Where |
|---|---|---|
| S21 | All input globally sanitised before any handler | `globalSanitizer.middleware.js` |
| S22 | Every endpoint has a Joi schema; a bad value never reaches the database | `validate(schema)` |
| S23 | Path UUIDs validated before use | `validateUuid.middleware.js` |
| S24 | Queries parameterised — Sequelize throughout; raw SQL bound | |
| S25 | User-supplied HTML sanitised on ingest and rendered under CSP | `posts.contentHtml` — the stored-XSS surface |
| S26 | The error mapper forwards **recognised error types only** | a raw pg error carries SQL; a raw Node error carries a file path |
| S27 | `details` on errors only outside production | `response.util.js` |

## Transport and Headers

| ID | Requirement | Where |
|---|---|---|
| S28 | HTTPS enforced in production | `FORCE_HTTPS`, nginx |
| S29 | CSP with `object-src 'none'` and `frame-ancestors 'none'` | helmet |
| S30 | CORS from an explicit allowlist; **wildcard never honoured** with credentials | `CORS_ORIGIN` |
| S31 | In production with no configured origins, CORS **rejects** | |
| S32 | HTTP parameter pollution blocked | `hpp` |
| S33 | Uploads served with `nosniff` and `Content-Disposition: inline` | static `/uploads` |

## Files and Storage

| ID | Requirement | Where |
|---|---|---|
| S34 | Uploads scanned when a scanner is configured; scanner error **rejects** by default | `VIRUS_SCAN_FAIL_OPEN=false` |
| S35 | Attachments served through signed, time-limited URLs | `ATTACHMENT_URL_SECRET` |
| S36 | Storage keys encode tenant identity and are built only in the storage service | key construction is an isolation control |
| S37 | Tenant-supplied S3 endpoints SSRF-checked | operator endpoints deliberately are not |
| S38 | Tenant-supplied webhook URLs validated | outbound request from our network position |

## Secrets

| ID | Requirement | Where |
|---|---|---|
| S39 | `CERT_SIGNING_SECRET`, `ENCRYPT_KEY`, `ATTACHMENT_URL_SECRET` required — the app **exits** without them | fail fast |
| S40 | Private keys and tenant storage credentials encrypted at rest | `ENCRYPT_KEY` |
| S41 | Secrets never returned by any endpoint | `tenant_keys.privateKey`, storage credentials, `api_keys` plaintext |
| S42 | Logs redact by key-name walk at any depth, not a fixed path list | a nested object under an innocuous key is where a secret hides |
| S43 | Provider key environment cross-checked against `NODE_ENV` | a live Stripe key passes every per-field check and charges a real card from a test |

## Compliance

| ID | Requirement | Where |
|---|---|---|
| S44 | Calibration records append-only | **currently convention, not constraint** — see below |
| S45 | Signatures record meaning, auth method and document hash | `e_signature_records` |
| S46 | Certificate verification public, unauthenticated, tamper-evident | `CERT_SIGNING_SECRET` |
| S47 | Erasure anonymises; it does not orphan evidence | GDPR versus Part 11 resolution |
| S48 | Purge respects legal hold | BR-16 |

**S44 is the widest gap between claim and mechanism.** `calibration_records` is `paranoid` and has `PUT`/`DELETE` routes. Contrast `audit_logs`, protected by having no delete path at all. Named in [`../PLAN/18-RISK-REGISTER.md`](../PLAN/18-RISK-REGISTER.md) as PR-2 and tracked.

## Fail-Open versus Fail-Closed

Every optional subsystem has made this choice. The safe answer is not always the convenient one.

| Subsystem | Default | Correct? |
|---|---|---|
| Tenant scoping with no context | **deny** | yes |
| Virus scanning on scanner error | **reject** | yes |
| CORS, production, no origins | **reject** | yes |
| CORS outside production | allow all | dev only |
| Rate limit outside production | 100,000/15 min | must never reach production |
| WebAuthn with Redis down | fail | yes |

**Watch for any change that flips one of these toward convenience.** The RLS policy that was removed had exactly that shape: `app.current_tenant = ''` matched every row.

## Testing These Requirements

An assertion that a control works is not evidence. See [`11-SECURITY-TESTING.md`](./11-SECURITY-TESTING.md).

Two rules that catch worthless tests:

- **Test database grants as the application role, not the owner.** As the owner the test passes whether the grant exists or not.
- **A test generated from the code it tests verifies consistency, never correctness.** A redaction test derived from the redaction key set cannot catch a key being deleted from that set.
