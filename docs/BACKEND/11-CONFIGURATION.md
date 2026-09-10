# 11 — Configuration

Every environment variable the backend reads. Source of truth: `backend/.env.example`, which documents shapes with no values.

Secrets treatment: [`../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md`](../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md).

---

## Required — the application exits without these

```
CERT_SIGNING_SECRET      HMAC for certificate QR verification
ENCRYPT_KEY              e-signature private keys and tenant storage credentials at rest
ATTACHMENT_URL_SECRET    HMAC for signed attachment download URLs
KMS_MASTER_KEY           wraps tenant storage credentials (64-char hex)
```

**`KMS_MASTER_KEY` was missing from this document until a deployment found it.**
`src/services/kms.service.js` throws at module load in production:

> KMS_MASTER_KEY must be set in production (64-char hex / 32-byte key).
> Refusing to start with the insecure development master key.

The failure is easy to misread: the container crash-loops, `docker logs` shows
**nothing**, and the error is written only to
`log/activity/exception/<date>.log` — because winston is already configured by
the time it throws. Anyone debugging a silent exit should read that file before
anything else.

Losing it has the same consequence as losing `ENCRYPT_KEY`: every wrapped
tenant storage credential becomes undecryptable. Back it up with the others.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Failing fast is correct.** Starting without a signing secret produces certificates that cannot be verified and attachment URLs that cannot be validated — failures that appear days later, in front of an auditor.

**These must be backed up separately from the database.** A restore that recovers the data and loses these keys produces a system that starts cleanly and is permanently broken. A backup strategy that captures the data and loses the keys has captured ciphertext.

## Database

| Variable | Default | Notes |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS` | — | |
| `DB_DIALECT` | `postgres` | **`mysql` is supported** (ADR-029) |
| `DB_SSL`, `DB_SSL_CA`, `DB_SSL_REJECT_UNAUTHORIZED` | | |
| `DB_POOL_MAX` | 10 dev / 20 prod | |
| `DB_POOL_MIN` | 2 | |
| `DB_POOL_ACQUIRE_TIMEOUT` | 30000 | matches the request timeout, on purpose |
| `DB_POOL_IDLE_TIMEOUT` | 10000 | |

The acquire timeout matching the 30-second request timeout means a request waiting for a connection fails at roughly the moment the request itself gives up, rather than acquiring a connection nobody is waiting for.

**pgvector is PostgreSQL-only.** On MySQL the AI/RAG module is unavailable rather than differently implemented.

## Application

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | **gates CORS, rate limits and error detail** |
| `HOST_URL` | | |
| `APP_STORAGE_PATH` | `./storage` | the writable root for `storagePath()` |
| `MAX_FILE_SIZE` | 10485760 | 10 MB |
| `FORCE_HTTPS` | | production only |
| `CORS_ORIGIN` | | comma-separated; **no wildcard** |
| `RATE_LIMIT_MAX` | 5000 prod / **100000 otherwise** | |
| `PUPPETEER_EXECUTABLE_PATH` | | required for PDFs in a compiled binary |

### `NODE_ENV` carries more weight than it looks

| Behaviour | production | otherwise |
|---|---|---|
| CORS with no configured origins | **reject** | allow all |
| Global rate limit | 5,000/15 min | **100,000/15 min** |
| Error `details` | omitted | included |

The rate-limit branch keys on `NODE_ENV` rather than an opt-in flag specifically so it cannot be left on by forgetting to unset something. The 100,000 figure exists because a full browser E2E run exhausts a production budget and fails for reasons unrelated to the code under test.

## JWT

| Variable | Notes |
|---|---|
| `JWT_ACCESS_SECRET` | |
| `JWT_ACCESS_EXPIRED` | e.g. `15m` |
| `JWT_REFRESH_SECRET` | **must differ from the access secret** |
| `JWT_REFRESH_EXPIRED` | e.g. `7d` |

If the two secrets are equal, an access token can be presented as a refresh token. The config should reject that rather than trusting whoever wrote the `.env`.

## Infrastructure

| Variable | Default |
|---|---|
| `REDIS_URL`, or `REDIS_HOST` + `REDIS_PORT` | `redis://localhost:6379` |
| `RABBITMQ_URL` | `amqp://localhost:5672` |
| `MQTT_HOST`, `MQTT_PORT` | embedded aedes broker |

Redis is **not optional**: it holds rate-limit counters, WebAuthn challenges and worker idempotency claims. An outage weakens brute-force protection and permits duplicate side effects.

## Object Storage

| Variable | Default | Notes |
|---|---|---|
| `STORAGE_DRIVER` | `local` | `local` \| `s3` \| `nfs` |
| `STORAGE_LOCAL_ROOT` | `<app storage>/storage` | |
| `STORAGE_NFS_ROOT` | | |
| `STORAGE_NFS_FSYNC` | **`true`** | an NFS client can ack a write still in its page cache |
| `STORAGE_S3_BUCKET`, `_REGION` | | |
| `STORAGE_S3_ENDPOINT` | | non-AWS; **operator endpoints are not SSRF-checked** |
| `STORAGE_S3_FORCE_PATH_STYLE` | **`true`** | MinIO and most non-AWS require it |
| `STORAGE_S3_PREFIX` | | shares one bucket across environments — **not an isolation boundary** |
| `STORAGE_S3_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY` | | **leave unset** to use the IAM role |

`local` is **incompatible with more than one backend replica** — replica A writes, replica B cannot serve.

## Email

`MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`.

Templates live in `src/templates` and are read from disk **next to the binary**. The Dockerfile copies them explicitly; omitting that produces an API that starts fine and fails on the first email.

## Certificates

| Variable | Notes |
|---|---|
| `CERT_SIGNING_SECRET` | **required**, effectively **not rotatable** |
| `CERT_VERIFY_BASE_URL` | the QR encodes `<this>/<certificateNumber>` |
| `PUPPETEER_EXECUTABLE_PATH` | fails at **first PDF**, not at startup, when wrong |

## Optional Subsystems

Each degrades rather than failing, so the platform runs with Postgres and nothing else.

### Virus scanning

| Variable | Default |
|---|---|
| `VIRUS_SCAN_PROVIDER` | `none` |
| `VIRUS_SCAN_FAIL_OPEN` | **`false`** — a scanner error **rejects** |
| `CLAMAV_ENABLED`, `CLAMAV_HOST`, `CLAMAV_PORT` | `clamav:3310` in compose |

Fail-closed is inconvenient and correct: the alternative silently disables scanning at the moment it is not working.

### WebAuthn

| Variable | Requirement |
|---|---|
| `WEBAUTHN_RP_ID` | the registrable domain — **no scheme, no port** |
| `WEBAUTHN_ORIGIN` | must match the browser origin **exactly** |

Both are exact-match by specification. A trailing slash or a missing port fails verification with an error that does not name the mismatch.

### Batch jobs

`BATCH_JOBS_INLINE=true` processes in-process with no broker — development only. `BATCH_PREFETCH` defaults to 5.

### Retention

`RETENTION_SCHEDULER` in cron format; `disabled` turns it off.

### AI / RAG

`OPENAI_API_KEY`, `OPENAI_BASE_URL`. **Per-tenant keys override these** — a data-residency control, not a billing convenience.

Unset means `/ai` and the GDPR export path return errors. That is an environment condition, not a code defect.

### Custom domains

| Variable | Notes |
|---|---|
| `CUSTOM_DOMAINS_ENABLED`, `TLS_AUTO_PROVISION` | |
| `ACME_DIRECTORY_URL` | **defaults to Let's Encrypt STAGING** |
| `ACME_ACCOUNT_EMAIL` | |

Forgetting to point `ACME_DIRECTORY_URL` at the production directory yields certificates no browser trusts, and the failure appears in a browser rather than in any log.

## Bootstrap and Seeding

**Seeding is not automatic on startup.** The database comes up with 72 tables and **zero rows** — no roles, no menu groups, no users — so there is no account to log in with, and `POST /auth/login` fails.

| Variable | Purpose |
|---|---|
| `ALLOW_SEEDING` | permits `GET /api/v1/migration/seeding` **without authentication** |
| `SEED_DEMO` | additionally permits `/migration/seed-demo` (~80 demo rows) |

The seeding route is gated by `superAdminOrBootstrap`: it normally requires a super-admin token, which cannot exist before the first seed. `ALLOW_SEEDING=true` breaks that chicken-and-egg.

```bash
# first boot only
ALLOW_SEEDING=true   → restart → GET /api/v1/migration/seeding → ALLOW_SEEDING=false → restart
```

A successful seed reports roles, menu groups with their permission count, and one user. The seeded super-admin is `sys` / `sys@mail.com`.

**Turn it off again immediately.** While set, it is an unauthenticated endpoint that writes to the database. Verify afterwards that the endpoint returns 401.

**`SEED_DEMO` must never be true in production** — a demo seeder against real data is a data-integrity incident.

## Reverse-Proxy Deployments

| Variable | Purpose |
|---|---|
| `BACKEND_INTERNAL_URL` | where the **Next.js server** reaches the backend |

Server-only, deliberately without a `NEXT_PUBLIC_` prefix so it is never inlined into the client bundle.

`NEXT_PUBLIC_API_BASE_URL` is read from **two places with different reachability needs**: server-side by the Next proxy routes in `app/api/v1/**`, and client-side by Socket.IO in `lib/socket.ts`. Behind a proxy those are not the same URL — a server-side hop to the public origin **re-enters the proxy that called it and loops**.

Set this whenever `/api/` is routed to Next.js rather than straight to the backend. See [`../DEVOPS/03-REVERSE-PROXY.md`](../DEVOPS/03-REVERSE-PROXY.md).

## Schedulers

`SESSION_CLEANUP_SCHEDULER`, `BACKUP_SCHEDULER`, `RETENTION_SCHEDULER` — node-cron format.

**Each runs once per replica.** Exactly one replica must run schedulers, or every backup and purge runs twice.

## Billing

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

**A live key with `NODE_ENV != production` passes every per-field check and will charge a real card from a test.** The reverse — a sandbox key in production — makes every order look paid while no money arrives, and nothing errors.

Only a **cross-field** rule comparing the key's environment marker against `NODE_ENV` catches either. Per-field validation is structurally incapable of it.

## Other

| Variable | Notes |
|---|---|
| `SUPER_ADMIN_ROLE_ID` | overrides the seeded default |
| `SEED_DEMO` | **must never be true in production** |
| `PGADMIN_EMAIL`, `PGADMIN_PASSWORD` | compose, development only |

## Rules

1. **Never commit a `.env`.** `.gitignore` covers `.env`, `*.pem`, `*.key`, `*.cert`.
2. `.env.example` documents every variable with **no values**.
3. Validate at startup and **exit** on a missing required secret — naming every missing variable at once, not one per restart.
4. Cross-field rules where per-field checks cannot help: provider key environment, JWT secrets being equal, ACME directory in production.
5. A new variable is documented in `.env.example` **and** here, in the same commit.
