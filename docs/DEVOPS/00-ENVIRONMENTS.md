# 00 — Environments

Deployment artefacts: [`../../deploy/`](../../deploy/README.md). Makefile targets: [`11-MAKEFILE-REFERENCE.md`](./11-MAKEFILE-REFERENCE.md).

---

## The Four

| Environment | Runs on | Data | Purpose |
|---|---|---|---|
| **local** | compose + `dev` overlay | seeded demo | development |
| **test** | compose, ephemeral | fixtures | CI and E2E |
| **staging** | compose + `staging` overlay | anonymised | pre-release |
| **production** | compose + `prod` overlay, or Helm | real | live |

## What Changes Between Them

`NODE_ENV` carries more weight here than it looks.

| Behaviour | production | otherwise |
|---|---|---|
| CORS with no configured origins | **reject** | allow all |
| Global rate limit | 5,000 / 15 min | **100,000 / 15 min** |
| Error `details` in responses | omitted | included |
| DB pool max | 20 | 10 |

The rate-limit branch keys on `NODE_ENV` rather than an opt-in flag **specifically so it cannot be left on** by forgetting to unset something. The 100,000 figure exists because a full browser E2E run — 71 tests, each page load fanning out to several API calls — exhausts a production budget and then fails for reasons unrelated to the code under test.

## Local

```bash
make dev
```

Brings up Postgres (pgvector), Redis, RabbitMQ, ClamAV, MinIO, pgadmin, and runs both applications with hot reload.

| Convenience | Setting |
|---|---|
| No broker needed | `BATCH_JOBS_INLINE=true` |
| No scanner needed | `VIRUS_SCAN_PROVIDER=none` |
| Local disk storage | `STORAGE_DRIVER=local` |
| Demo data | `SEED_DEMO=true` |

The four required secrets are still required — the application exits without `CERT_SIGNING_SECRET`, `ENCRYPT_KEY`, `ATTACHMENT_URL_SECRET` and `KMS_MASTER_KEY`. Use throwaway values locally; never the production ones.

### Windows: the `EACCES` trap

`npm run dev` failing with `EACCES` on port 3000 is **not** a port-in-use problem. It is the WinNAT reserved port range.

```bash
net stop winnat && net start winnat    # elevated
# or
npx next dev -p 4000
```

Hunting for the process holding port 3000 will not find one.

## Test

Ephemeral. Database created, migrated, exercised, destroyed.

Two rules learned by breaking things:

**Never suspend the default tenant.** Create a disposable one. Suspending the default suspends the super-admin living in it and 403s every subsequent request; recovery is a direct database update.

**Watch the rate limiter.** Repeated verification runs have exhausted even the non-production budget.

`SEED_DEMO=true` is available and useful — defect #15, the certificate list returning zero rows, was **only visible once there was data**.

## Staging

As close to production as the budget allows: same images, same overlay shape, real external services in **sandbox** mode.

### The cross-field secret rule

**A live Stripe key in staging passes every per-field check** — valid string, right shape, right length — and will charge a real card from a test.

The reverse is worse: a sandbox key in production makes every order look paid while no money arrives, and **nothing errors**.

Only a rule comparing the key's environment marker against `NODE_ENV` catches either.

The same shape applies to `ACME_DIRECTORY_URL`, which **defaults to the Let's Encrypt staging directory**. A production deployment that forgets to change it gets certificates no browser trusts, and the failure appears in a browser rather than in any log.

### Data

Anonymised, never a straight copy. A staging environment holding real personal data is a production environment with weaker controls.

## Production

Compose on a single host by default (ADR-032), or Helm where a Kubernetes estate already exists.

| Setting | Value |
|---|---|
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | explicit, comma-separated — **never a wildcard** |
| `FORCE_HTTPS` | `true` |
| `SEED_DEMO` | **unset** |
| `BATCH_JOBS_INLINE` | **unset** |
| `RATE_LIMIT_MAX` | default or deliberate |
| `ACME_DIRECTORY_URL` | the **production** directory |
| `STORAGE_DRIVER` | `s3` or `nfs` if more than one replica |
| Database ports | **not published** |

### Single host, single failure domain

The default deployment is one machine (PR-12). Helm charts exist as the escape route, written while it was still cheap — but their honest status is that **the manifests render; they are not known to be accepted by a cluster**, because no cluster has been reachable to validate against.

That distinction should not be smoothed over in a status report.

## Horizontal Scaling Prerequisites

Three, all hard, all in order:

| # | Prerequisite | Why |
|---|---|---|
| 1 | Object storage off local disk | replica A writes, replica B cannot serve |
| 2 | **Exactly one replica running schedulers** | otherwise every backup and purge runs twice |
| 3 | Socket.IO Redis adapter | otherwise a notification reaches only one replica's clients |

Add migrations to that list: the backend runs them at boot, and two replicas starting together will both attempt them.

None is difficult. They simply have to happen **before** replica count goes above one, not after somebody notices duplicated backups.

The Helm chart guards prerequisite 2 by **refusing to render** a configuration with more than one cron-enabled replica.

## Secrets Per Environment

| Environment | Mechanism |
|---|---|
| local | `backend/.env`, git-ignored |
| test | ephemeral, generated |
| staging, production | compose `env_file`, or Kubernetes Secrets |

**`CERT_SIGNING_SECRET` and `ENCRYPT_KEY` must be backed up separately from the database.** A restore that recovers the data and loses them produces a system that starts cleanly and is permanently broken — every certificate fails verification, every wrapped credential is undecryptable.

Neither is practically rotatable ([`../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md`](../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md)).

## Frontend Variables Are Baked In

`NEXT_PUBLIC_*` values are **inlined at build time**, not read at runtime.

- A different API URL means a **different build**.
- A tenant-pinned build (`NEXT_PUBLIC_TENANT_ID`) is a **separate image**.
- Setting them in the container environment does nothing.

Anything genuinely runtime-configurable must come from the API.

## Promotion

```
local → test → staging → production
```

The same **image** moves through, with configuration supplied per environment. An image rebuilt for production is an image nobody tested — except the frontend, where `NEXT_PUBLIC_*` forces a rebuild per environment by design.

Before promoting to production:

- [ ] migrations apply to a clean database **and** to a copy of production data
- [ ] migration results verified by inspecting columns, not by trusting the log
- [ ] `NODE_ENV=production` and the settings above confirmed
- [ ] provider keys match the environment
- [ ] `ACME_DIRECTORY_URL` points at production
- [ ] `SEED_DEMO` unset
- [ ] rollback rehearsed, not assumed
