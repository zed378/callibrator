# 07 — Cryptography and Secrets

---

## The Four Required Secrets

The application **exits rather than starting** without these:

| Variable | Protects | Loss consequence |
|---|---|---|
| `CERT_SIGNING_SECRET` | the HMAC `generateCertificatePdf` returns, the public-document capability links (`mintDocumentUrl`), and signed download URLs when `ATTACHMENT_URL_SECRET` is unset | short-lived links in flight stop validating. **No issued certificate depends on it** — the HMAC is neither stored, printed nor verified (A-241, 2026-09-24); public verification is the unkeyed integrity hash plus the database |
| `ENCRYPT_KEY` | **legacy only** since migration 0058 (P6-10): e-signature private keys written before it were AES-CBC under this key; 0058 re-wraps them as KMS envelopes | a legacy row restored from an old backup cannot be read. Required at startup only while a legacy row exists; the deploy templates still carry it |
| `ATTACHMENT_URL_SECRET` | HMAC for signed attachment download URLs | existing signed URLs stop validating |
| `KMS_MASTER_KEY` | wraps every tenant secret at rest — `tenant_settings` secret keys (SSO/OIDC/Stripe/storage/AI credentials), `webhooks.secret`, and since 0058 `tenant_keys.private_key` (`src/services/kms.service.js`) | **every wrapped value becomes undecryptable**. Rotatable since P6-10: see `KMS_MASTER_KEY_PREVIOUS` and [`13-KEY-ROTATION.md`](13-KEY-ROTATION.md) |

**Since P6-10 `ENCRYPT_KEY` is no longer checked at startup** (`eSignature.service.js` refused to load without it). Migration 0058 refuses instead, naming the rows, if a legacy signing key exists and no `ENCRYPT_KEY` opens it. Keep it configured and backed up until `npm run keys:rotate -- --dry-run` reports `converted from legacy 0` on the production database.

Generate each with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### The fourth one was found by deploying

`KMS_MASTER_KEY` was missing from this table, from `.env.example` and from `make secrets` until a production deployment hit it. It refuses the insecure development key in production:

> KMS_MASTER_KEY must be set in production (64-char hex / 32-byte key).
> Refusing to start with the insecure development master key.

That refusal is right. What was wrong is that **nothing named the variable**, and its failure mode defeats the obvious diagnosis: the container crash-loops with an **empty `docker logs`**, because **in production the application writes nothing to stdout at all**: `activityLog.middleware.js` adds winston's Console transport only when `NODE_ENV !== "production"`, and winston's `exceptionHandlers` catch the throw and write it to `log/activity/exception/<date>.log`.

A fail-fast list is a document as much as it is code. One is worth nothing without the other.

### Failing fast is the right behaviour

Starting without a signing secret produces certificates that cannot be verified and attachment URLs that cannot be validated — failures that appear far from their cause, days later, in front of an auditor.

An application that refuses to start names the problem at the moment it can still be fixed cheaply.

### These must be backed up separately from the database

**A restore that recovers the database and loses these keys is not a recovery.** It produces a system that starts cleanly and is permanently broken:

- every certificate fails verification,
- every encrypted private key and storage credential is unreadable.

`ATTACHMENT_URL_SECRET` is the one exception: rotating it invalidates outstanding signed URLs, which is an inconvenience rather than a permanent loss.

A backup strategy that captures the data and loses the keys has captured ciphertext. See [`../ARCHITECTURE/09-DISASTER-RECOVERY.md`](../ARCHITECTURE/09-DISASTER-RECOVERY.md), where the restore drill explicitly asserts that a pre-incident certificate still verifies — the check that catches this.

## Full Secret Inventory

| Variable | Kind |
|---|---|
| `JWT_ACCESS_SECRET` | token signing |
| `JWT_REFRESH_SECRET` | token signing — **must differ from the access secret** |
| `CERT_SIGNING_SECRET` | HMAC |
| `ENCRYPT_KEY` | symmetric encryption at rest |
| `ATTACHMENT_URL_SECRET` | HMAC |
| `DB_PASS` | database |
| `MAIL_PASSWORD` | SMTP |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | payments |
| `OPENAI_API_KEY` | LLM |
| `STORAGE_S3_SECRET_ACCESS_KEY` | object storage — **prefer unset** |
| `RABBITMQ_PASS`, `PGADMIN_PASSWORD` | infrastructure |
| per-tenant storage credentials | encrypted in the database |
| `tenant_keys.privateKey` | encrypted in the database |
| `api_keys.keyHash` | hash, not a secret |
| `webhooks.secret` | HMAC for outbound signatures |
| `calibration_devices.iotDeviceToken` | device credential |

### If the access and refresh JWT secrets are equal

An access token can be presented as a refresh token. The config should **reject** them being equal rather than trusting whoever wrote the `.env`.

### Prefer no S3 keys at all

Leaving `STORAGE_S3_ACCESS_KEY_ID` and `_SECRET_ACCESS_KEY` unset uses the ambient credential chain — an IAM role — which is strictly better than static keys in an environment file. Set them only where no ambient identity exists.

## The Cross-Field Rule That Per-Field Validation Cannot Replace

**A live Stripe key in a staging environment passes every per-field check.** Valid string, right shape, right length. And it will charge a real card from a test.

The reverse is worse: a sandbox key in production makes every order look paid while no money arrives, and **nothing errors**. Every log line is clean.

Only a rule comparing the key's environment marker against `NODE_ENV` catches either. Per-field validation is structurally incapable of it.

The same shape applies to `ACME_DIRECTORY_URL`, which **defaults to the Let's Encrypt staging directory**: a production deployment that forgets to change it gets certificates no browser trusts, and the failure appears in a browser rather than in any log.

## What Is Stored, and How

| Data | Storage |
|---|---|
| Passwords | hashed, adaptive function — never reversible |
| Session tokens | **hash only** (`sessions.token_hash`) |
| API keys | **hash only**, plus a display `keyPrefix`; plaintext returned once at creation |
| Tenant private keys | KMS envelope — AES-256-GCM, tenant id as AAD, `v2:<keyId>:…` (P6-10, migration 0058; was AES-CBC under `ENCRYPT_KEY`, unauthenticated) |
| Tenant storage credentials | KMS envelope, as above (`tenant_settings.storage_credentials`) — never `ENCRYPT_KEY`, whatever earlier versions of this table said |
| MFA secrets | stored; returned once at enrolment |
| OTP codes | stored with an expiry; must be **cleared on use** |
| Certificate signatures | detached, in `certificates.digitalSignature` |

An OTP that stays valid until expiry after being consumed is a replayable credential.

## Never Returned by Any Endpoint

```
users.password        users.mfaSecret        users.otpCode
users.webauthnPublicKey
tenant_keys.privateKey
tenant storage credentials
api_keys plaintext (after creation)
calibration_devices.iotDeviceToken   ← especially in a LIST response
```

The `iotDeviceToken` one is easy to miss: a device token in a device-register list is a credential leak to every user who can read the register.

These are excluded by `defaultScope`. A query that bypasses the scope must exclude them explicitly, and the exclusion should be asserted in tests rather than intended — this is the kind of leak that survives review, because the field is absent from the screen the developer is looking at.

## Log Redaction

Redaction must be a **key-name walk at any depth**, not a fixed path list. A nested object under an innocuous key is exactly where a secret hides, and a path list only covers the shapes someone thought of.

It must also scrub bearer tokens appearing as values under unremarkable key names.

### The self-verifying test problem

**A test generated from the code it tests verifies consistency, never correctness.**

A redaction test that iterates the same key set the redactor uses cannot catch a key being deleted from that set — both sides change together and the test stays green.

The fixes: an independently maintained list of things that must never appear, or a mutation check that deletes a key and confirms the right test fails.

## `audit_logs.changes` Is the Highest-Consequence Leak

The diff is written from model attributes. A careless implementation serialises a password hash, an MFA secret, an OTP code, a tenant private key or an S3 credential into a table that is **append-only and has no delete path**.

A secret in `audit_logs` is a permanent secret in a table designed to be undeletable. Redaction on the way in is the only control, because there is no way to clean it afterwards.

## Rotation

As-built since P6-10 / S-08 / S-26 (2026-09-24, ADR-PENDING-data). The procedure for each is [`13-KEY-ROTATION.md`](13-KEY-ROTATION.md).

| Secret | Rotatable | How, and the cost |
|---|---|---|
| `JWT_ACCESS_SECRET` (HS\*) / `JWT_PRIVATE_KEY` (RS\*, ES\*) | **yes, without logging anyone out** | new key current, old key in `JWT_ACCESS_SECRET_PREVIOUS` / `JWT_PUBLIC_KEY_PREVIOUS` for one access-token lifetime, then removed. Every token names its key (`kid` = fingerprint). The in-process "key registry" that claimed to rotate and expired after 30 days of uptime is deleted (S-26) |
| `JWT_REFRESH_SECRET` | yes | legacy JWT refresh tokens only; the refresh tokens the login flow issues are opaque and stored, so rotating it invalidates nothing in use |
| **`KMS_MASTER_KEY`** | **yes** | new key current, old key in `KMS_MASTER_KEY_PREVIOUS`, `npm run keys:rotate` until it reports zero, then drop the old key. Every envelope names its key (`v2:<keyId>:`); v1 envelopes (no id) are read by trying each key of the ring |
| **`ENCRYPT_KEY`** | **retired by re-encryption** | migration 0058 moves every signing key it protected into a KMS envelope; after that it is read only for a restored legacy row. `ENCRYPT_KEY_PREVIOUS` lets a restored row under an older value still be read |
| **`CERT_SIGNING_SECRET`** | **yes** | nothing persisted depends on it (A-241): rotating invalidates only links in flight (minutes). The certificate HMAC now names its key (`hmac-sha256:<keyId>`), so anything that starts storing it can verify against the key it was made with |
| API keys | yes | re-issue per key |
| OIDC client secrets | yes | `POST /clients/:clientId/rotate-secret` — rotation without re-registration is what makes it happen |
| Webhook secrets | yes | receiver must be updated |
| `tenant_keys` (e-signature key pairs) | yes | a new pair per tenant; old signatures keep their `keyId` and verify against the (soft-deleted) old public key |

**Rehearsed on PostgreSQL 16 against seeded data, not a copy of production** (`backend/src/tests/services/keyRotation.s08.live.test.js`). The P6-10 DoD asks for a rehearsal against a production copy; that is still owed, and the runbook says so.

## Where Secrets Live

| Environment | Mechanism |
|---|---|
| Development | `backend/.env`, git-ignored; `.env.example` documents the shape with no values |
| Compose | `env_file`, or the shell environment |
| Kubernetes | Secrets, optionally external via a secrets operator |

`.gitignore` covers `.env`, `*.pem`, `*.key`, `*.cert`. **There is no secret scanner.** An earlier version of this document described one running in a `pre-push` gate and flagging a JWT fixture; neither the scanner nor the hook exists. `.gitignore` is currently the only control, and it only helps with files named as expected. Adding gitleaks (or equivalent) to a real hook and to CI is recorded in `TASKS/BACKLOG.md`.
