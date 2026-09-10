# Phase 0 — Foundation

**Status: ✅ DONE**, with three recorded divergences from the original plan.

This phase is written **retrospectively**. It was executed before `TASKS/` was used as intended, so the cards below reconstruct what was actually built from the code, the migration sequence and the audit report — not from a plan that was followed.

Where the plan and the build differ, the divergence is named and pointed at its ADR.

---

### P0-01 — Stack decision

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md` · `docs/ARCHITECTURE/01-APPLICATION-ARCHITECTURE.md` |

**What shipped:** Express modular monolith · Sequelize · PostgreSQL **or** MySQL · Redis · RabbitMQ · Socket.IO · Next.js 16 · React 19 · Tailwind 4 · Zustand.

**⚠ Divergence — ADR-030.** The plan specified a **TypeScript** backend (ADR-002, ADR-013). The backend is **JavaScript, CommonJS**.

It originated from an Express boilerplate in JavaScript and reached 76 services, 56 controllers, 72 models and 342 test files before the question was revisited. At that point migration would have been a multi-month rewrite of working, tested, compliance-critical code, with the defect risk concentrated in exactly the paths that must not break. The type-safety argument lost on cost, not on merit.

**This divergence went unrecorded for months**, and `CLAUDE.md` continued instructing engineers and agents to write strict TypeScript with no `any`. That is PR-4, and it is the single largest lesson in this repository.

**Also divergent:** the platform must run on **MySQL as well as PostgreSQL**, which is the constraint that drove ADR-029 and several schema decisions that look odd in isolation.

---

### P0-02 / P0-03 — Repository scaffolding and conventions

| | |
|---|---|
| **Status** | ✅ DONE — restructured 2026-09-10 |
| **Record** | [`2026-09-10-monorepo-restructure-and-as-built-docs.md`](../MEMORY/records/2026-09-10-monorepo-restructure-and-as-built-docs.md) |

**What shipped:** pnpm workspaces, Turbo task graph, Prettier, ESLint, EditorConfig, `.gitignore`.

**Known inconsistency:** the root declares workspaces in **two** places — an npm-style `workspaces` array in `package.json` and `pnpm-workspace.yaml`. `packages/*` matches nothing, because a CommonJS JavaScript backend and a TypeScript frontend share no code. The glob is aspirational.

**Restructured in 2026-09** into the documented layout: `docs/` (135 as-built documents), `MEMORY/`, `TASKS/`, `deploy/`, and a Makefile.

---

### P0-04 — Backend service skeleton

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/ARCHITECTURE/03-BACKEND-ARCHITECTURE.md` · `docs/BACKEND/04-MIDDLEWARE-PIPELINE.md` |

**What shipped:** the composition root in `backend/index.js` — security headers, HPP, CORS, rate limiting, body parsing with the Stripe raw-body hook, a 30s timeout, request correlation, logging, static serving, global sanitisation, swagger, 53 mounted routers, health, and central error handling.

**The order is behaviour, not style.** Four dependencies are load-bearing and documented in `docs/BACKEND/04`.

---

### P0-05 — Local environment

| | |
|---|---|
| **Status** | ✅ DONE — **rebuilt 2026-09** as `deploy/compose/` |

**What shipped:** a compose stack with Postgres (pgvector), Redis, RabbitMQ, ClamAV, pgadmin and MinIO.

**Two details that are not incidental:**

- **`pgvector/pgvector:pg17`, not `postgres:17-alpine`.** Plain Postgres lacks the `vector` extension and migration `0018` fails.
- **`depends_on` uses conditions, not bare names.** The backend runs `db.sync()` and migrations at boot; `service_started` on Postgres produces a crash loop that looks like a code fault. ClamAV is `service_started` deliberately — its first-run `freshclam` takes minutes and waiting for healthy would block the whole stack on an optional component.

---

### P0-06 — Migration tooling

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/DATABASE/13-MIGRATIONS.md` |

**What shipped:** Umzug, 18 migrations, `migrate` / `migrate:undo` / `migrate:status`.

**Two traps found and documented:**

- **The Umzug context IS the QueryInterface.** `context.sequelize.getQueryInterface()` throws.
- **A blanket `try/catch` marks a migration applied while doing nothing.** Umzug records success, the column never appears, and the failure surfaces weeks later.

**Follow-up:** post-migration column verification is **not built** — P6-05.

---

### P0-07 to P0-10 — The schema

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/DATABASE/00-DATA-MODEL.md` through `12-PLATFORM-TABLES.md` |

**What shipped:** 72 models across tenancy, identity, RBAC, warehouse, device, calibration, certificate, quality, workflow, commercial, platform, content, AI and Kanban.

**Three inconsistencies that are load-bearing rather than sloppy**, each of which has caused or can cause a defect:

| | Consequence |
|---|---|
| `sessions` uses **snake_case attributes** | `Session.destroy({ where: { tenantId } })` fails — this broke the nightly retention purge |
| `UsageMetrics` is the one camelCase **table name** | needs quoting in raw SQL on PostgreSQL |
| `tenants.billingCycle` is `monthly`/`yearly`; `subscriptions.billingCycle` is `Monthly`/`Annually` | a case transform is not enough to map between them |

**Known gap:** `calibration_devices.serialNumber` is **globally unique**, not per tenant — a weak cross-tenant oracle. P6-06.

---

### P0-11 — Tenant-scoped data layer

| | |
|---|---|
| **Status** | ✅ DONE — **mechanism changed twice** |
| **Spec refs** | `docs/BACKEND/05-TENANT-SCOPING.md` · `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` |

**The most important control in the system.**

**⚠ Divergence — ADR-029.** The plan specified PostgreSQL **Row Level Security** (ADR-001, ADR-018). Migration `0012` added it; migration `0015` removed it. Both are kept, because squashing them would erase the evidence that RLS was tried.

Removed for three reasons:

1. **RLS is PostgreSQL-only**, and the platform must also run on MySQL.
2. **The policy carried a fail-open branch** — `app.current_tenant = ''` matched **every row**.
3. It cost two round-trips and a wrapping transaction per authenticated request.

Isolation now lives in global Sequelize hooks reading an `AsyncLocalStorage` context, **deny-by-default**. An authenticated principal with no resolvable tenant matches `NO_TENANT_UUID` and sees nothing.

**The rule that came out of it:** an isolation mechanism whose "no context" branch **permits** rather than denies is not an isolation mechanism.

---

### P0-12 / P0-13 — Logging, envelope, errors, health

| | |
|---|---|
| **Status** | ✅ DONE |

**What shipped:** `accessLog`, `activityLog`, request correlation via `X-Request-Id`, the response envelope (`success`, `status`, `message`, `data`, `meta`), central error mapping, and `GET /health` returning **503** when `db.authenticate()` fails.

**The envelope was later violated** by three endpoints returning rows inside `data` — QMS, CAPA and SOP — and three frontend screens rendered empty for weeks with no error anywhere. Fixed in the 2026-07 audit.

**The error mapper forwards recognised types only.** A raw `pg` message carries SQL; a raw Node message carries a file path. No care at the call site fixes an over-permissive mapper.

---

### P0-14 — Audit and status writers

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/DATABASE/10-AUDIT-LOGS.md` |

**What shipped:** `audit_logs` with actor, resource, before/after `changes`, IP and user agent, written **inside the transaction of the action it describes**.

**The table has no `paranoid` flag and no delete path anywhere. The absence is the control.**

**Follow-up:** the protection is architectural, not a database grant. `REVOKE UPDATE, DELETE` — and testing it **as the application role**, not the owner — is outstanding.

---

### P0-15 / P0-16 — Queue, workers, object storage

| | |
|---|---|
| **Status** | ✅ DONE |

**What shipped:** RabbitMQ with a worker, `BATCH_JOBS_INLINE` for development, and pluggable object storage (`local` | `s3` | `nfs`, global and per tenant, credentials encrypted at rest), MinIO-verified.

**The idempotency lesson:** "check then mark" is **racy** — two consumers can both pass the check before either marks, which credits a payment twice. `SET NX` makes it one operation, and **a failed attempt must release its claim** or "retry three times" becomes "try once, no-op twice" with logs identical to three successes.

**The SSRF asymmetry:** tenant-supplied S3 endpoints are checked; operator-configured ones deliberately are not, because `http://minio:9000` is a legitimate operator value.

---

### P0-17 — CI

| | |
|---|---|
| **Status** | ⚪ **DEFERRED, not done** |
| **Follow-up** | P7-01 |

**⚠ Divergence.** CI was deferred; the gates run in `pre-push` and `make verify`.

**The recorded risk is real:** skipping CI would have silently returned the zero-tolerance IDOR rule to being a sentence in a document — **its enforcement script had no caller other than a pipeline that did not exist.** Moving it into `pre-push` is the mitigation; the residual gap is that a hook can be bypassed with `--no-verify` and a pipeline cannot.

---

### P0-18 / P0-19 — Secrets and the test harness

| | |
|---|---|
| **Status** | ✅ DONE — with a **currently failing** gate |

**What shipped:** three required secrets that make the application **exit** rather than start (`CERT_SIGNING_SECRET`, `ENCRYPT_KEY`, `ATTACHMENT_URL_SECRET`), and a Jest harness reaching 342 test files against a 100% coverage gate.

**The cross-field lesson:** a **live provider key in staging passes every per-field check** — valid string, right shape, right length — and will charge a real card from a test. Only a rule comparing the key's environment against `NODE_ENV` catches it.

**The secret scanner works:** on its first run it flagged the project's own JWT test fixture.

**Follow-up:** the coverage gate is **currently failing** — P6-01.

---

## Phase 0 — Retrospective

**What shipped:** everything above, and the whole platform stands on it.

**What diverged, and went unrecorded for months:**

| Planned | Actual | ADR |
|---|---|---|
| TypeScript backend | JavaScript, CommonJS | ADR-030 |
| PostgreSQL only | PostgreSQL **or** MySQL | ADR-029 |
| Row Level Security | ORM-layer, deny-by-default | ADR-029 |
| Kubernetes-first | Compose-first | ADR-032 |
| CI in Phase 0 | deferred | — |

**What failed:** the record-keeping. Every technical decision above was sound and defensible; **none of them was written down at the time**, so `CLAUDE.md` and `TASKS/` went on describing a system that no longer existed.

That is PR-4, and it is why Part II of `DECISIONS.md` exists.

**What to watch:** any document making a claim with no file reference. That is the shape of the problem.
