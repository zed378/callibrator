# 07 — Cryptography and Secrets

---

## The Three Required Secrets

The application **exits rather than starting** without these:

| Variable | Protects | Loss consequence |
|---|---|---|
| `CERT_SIGNING_SECRET` | HMAC for certificate QR verification | **every issued certificate fails public verification, permanently** — the old key cannot be re-derived |
| `ENCRYPT_KEY` | e-signature private keys and tenant storage credentials at rest | **every stored private key and credential becomes undecryptable** |
| `ATTACHMENT_URL_SECRET` | HMAC for signed attachment download URLs | existing signed URLs stop validating |

Generate each with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Failing fast is the right behaviour

Starting without a signing secret produces certificates that cannot be verified and attachment URLs that cannot be validated — failures that appear far from their cause, days later, in front of an auditor.

An application that refuses to start names the problem at the moment it can still be fixed cheaply.

### These must be backed up separately from the database

**A restore that recovers the database and loses these keys is not a recovery.** It produces a system that starts cleanly and is permanently broken:

- every certificate fails verification,
- every encrypted private key and storage credential is unreadable.

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
| Tenant private keys | encrypted with `ENCRYPT_KEY` |
| Tenant storage credentials | encrypted with `ENCRYPT_KEY` |
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

| Secret | Rotatable | Cost |
|---|---|---|
| `JWT_ACCESS_SECRET` | yes | all sessions invalidated |
| `JWT_REFRESH_SECRET` | yes | all refresh tokens invalidated |
| API keys | yes | re-issue per key |
| OIDC client secrets | yes | `POST /clients/:clientId/rotate-secret` — rotation without re-registration is what makes it happen |
| Webhook secrets | yes | receiver must be updated |
| `tenant_keys` | yes | old certificates keep their old key id |
| **`CERT_SIGNING_SECRET`** | **effectively no** | rotating breaks verification of every certificate issued under the old key |
| **`ENCRYPT_KEY`** | **only with re-encryption** | requires decrypting and re-encrypting every wrapped value |

The last two are the ones to think about before an incident rather than during one. There is no rotation procedure for them today; designing one is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

## Where Secrets Live

| Environment | Mechanism |
|---|---|
| Development | `backend/.env`, git-ignored; `.env.example` documents the shape with no values |
| Compose | `env_file`, or the shell environment |
| Kubernetes | Secrets, optionally external via a secrets operator |

`.gitignore` covers `.env`, `*.pem`, `*.key`, `*.cert`. A secret scanner in the pre-push gate is the mechanical backstop — and on its first run it flagged the project's own JWT test fixture, which is the kind of finding that proves the scanner works.
