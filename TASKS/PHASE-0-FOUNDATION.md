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

**What shipped:** Express modular monolith · Sequelize · PostgreSQL (MySQL was claimed, never runnable — dropped by ADR-039) · Redis · RabbitMQ · Socket.IO · Next.js 16 · React 19 · Tailwind 4 · Zustand.

**⚠ Divergence — ADR-030.** The plan specified a **TypeScript** backend (ADR-002, ADR-013). The backend is **JavaScript, CommonJS**.

It originated from an Express boilerplate in JavaScript and reached 76 services, 56 controllers, 72 models and 342 test files before the question was revisited. At that point migration would have been a multi-month rewrite of working, tested, compliance-critical code, with the defect risk concentrated in exactly the paths that must not break. The type-safety argument lost on cost, not on merit.

**This divergence went unrecorded for months**, and `CLAUDE.md` continued instructing engineers and agents to write strict TypeScript with no `any`. That is PR-4, and it is the single largest lesson in this repository.

**Also divergent:** the platform was specified to run on **MySQL as well as PostgreSQL**, which drove ADR-029 and several schema decisions that look odd in isolation. **It never could** — `mysql2` was not a dependency — and ADR-039 (2026-09-21) made PostgreSQL the only engine.

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

**What shipped:** the composition root in `backend/index.js` — security headers, HPP, CORS, rate limiting, body parsing with the Stripe raw-body hook, a 30s timeout, request correlation, logging, static serving, global sanitisation, swagger, **56 router mounts**, health, and central error handling.

Fifty-six mounts, **54 route modules**: `oidc` is mounted twice on purpose — at `/api/v1/oidc` and at `/oidc`, because the discovery document advertises its endpoints at the host root — and `menu-groups` is mounted twice as well.

**The order is behaviour, not style.** Four dependencies are load-bearing and documented in `docs/BACKEND/04`.

---

### P0-05 — Local environment

| | |
|---|---|
| **Status** | ✅ DONE — **rebuilt 2026-09** as `deploy/compose/` |

**What shipped:** a compose stack with Postgres (pgvector), Redis, RabbitMQ, ClamAV, pgadmin and MinIO, plus `dev`, `staging`, `prod` and `vm` overlays over a base file that is **not deployable alone**.

**Two details that are not incidental:**

- **`pgvector/pgvector:pg18`, not `postgres:18-alpine`.** Plain Postgres lacks the `vector` extension and migration `0018` fails.
- **`depends_on` uses conditions, not bare names.** The backend runs `db.sync()` and migrations at boot; `service_started` on Postgres produces a crash loop that looks like a code fault. ClamAV is `service_started` deliberately — its first-run `freshclam` takes minutes and waiting for healthy would block the whole stack on an optional component.

---

### P0-06 — Migration tooling

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/DATABASE/13-MIGRATIONS.md` |

**What shipped:** Umzug, 18 migrations, `migrate` / `migrate:undo` / `migrate:status`.

**Migrations create the schema; nothing populates it.** A first boot yields 72 tables and **zero rows** — no roles, no menu groups, no user — so `POST /auth/login` returns a 500 that reads like a code fault. Seeding is a deliberate, gated step: `GET /api/v1/migration/seeding` needs a super-admin token that cannot exist yet, and `ALLOW_SEEDING=true` breaks that chicken-and-egg for one boot. **Found by deploying**, and documented afterwards in `deploy/README.md` and `docs/BACKEND/11`.

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

1. **RLS is PostgreSQL-only**, and the platform then had to run on MySQL. *(Dropped by ADR-039.)*
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

**The idempotency lesson — recorded, not implemented.** "Check then mark" is **racy**: two consumers can both pass the check before either marks. `SET NX` makes it one operation, and a failed attempt must release its claim. **⚠ Corrected 2026-09-21:** this card implied the worker does this. It does not — the only `SET NX` in the codebase is the registration lock, and no consumer deduplicates (see ENGINEERING/08).

**The SSRF asymmetry:** tenant-supplied S3 endpoints are checked; operator-configured ones deliberately are not, because `http://minio:9000` is a legitimate operator value.

---

### P0-17 — CI

| | |
|---|---|
| **Status** | ⚪ **DEFERRED, not done** |
| **Follow-up** | P7-01 |

**⚠ Divergence.** CI was deferred.

**⚠ Corrected 2026-09-21 — there is no `pre-push` hook.** The repository has no `.husky/`, no `lefthook`, no `simple-git-hooks`, no `core.hooksPath`, and `.git/hooks/` holds only git's samples. The IDOR enforcement script this card referred to does not exist either: `backend/scripts/` contains only documentation generators. The only gate runner is `make verify`, which a developer must remember to type — and which could not run on the Windows workstation where this repository is developed, because `make` is not installed there.

**So the recorded risk is not mitigated — it has fully materialised.** Deferring CI returned the zero-tolerance IDOR rule to being a sentence in a document, which is precisely what this card warned about, while claiming a mitigation that was never built. The first real deployment then found nine defects a clean-clone build would have caught four of.

---

### P0-18 / P0-19 — Secrets and the test harness

| | |
|---|---|
| **Status** | ✅ DONE — with a **currently failing** gate |

**What shipped:** **four** required secrets that make the application **exit** rather than start (`CERT_SIGNING_SECRET`, `ENCRYPT_KEY`, `ATTACHMENT_URL_SECRET`, `KMS_MASTER_KEY`), and a Jest harness reaching 342 test files against a 100% coverage gate.

**The fourth was found by deploying, not by reading.** `KMS_MASTER_KEY` was absent from `.env.example`, from `docs/BACKEND/11` and from `make secrets`, and its failure mode defeats the usual first move: the container crash-loops with **an empty `docker logs`**, because **in production the application writes nothing to stdout at all**: `activityLog.middleware.js` adds winston's Console transport only when `NODE_ENV !== "production"`, and winston's `exceptionHandlers` catch the throw and write it to `log/activity/exception/<date>.log` — a property of every production failure, not of this secret.

Fail-fast is only as good as the list of things it fails on. A required secret that no tooling generates and no document names is a **fail-fast that fires in production**, which is the one place it was designed to avoid.

**The cross-field lesson:** a **live provider key in staging passes every per-field check** — valid string, right shape, right length — and will charge a real card from a test. Only a rule comparing the key's environment against `NODE_ENV` catches it.

**⚠ Corrected 2026-09-21 — there is no secret scanner.** This card claimed one had run and flagged a JWT test fixture. No scanner, config or script for one exists in the repository.

**Follow-up:** the coverage gate now **passes** at 100% (verified 2026-09-11) — P6-01 done.

---

## Phase 0 — Retrospective

**What shipped:** everything above, and the whole platform stands on it.

**What diverged, and went unrecorded for months:**

| Planned | Actual | ADR |
|---|---|---|
| TypeScript backend | JavaScript, CommonJS | ADR-030 |
| PostgreSQL only | PostgreSQL **or** MySQL — reverted to PostgreSQL only | ADR-029, ADR-039 |
| Row Level Security | ORM-layer, deny-by-default | ADR-029 |
| Kubernetes-first | Compose-first | ADR-032 |
| CI in Phase 0 | deferred | — |

**What failed:** the record-keeping. Every technical decision above was sound and defensible; **none of them was written down at the time**, so `CLAUDE.md` and `TASKS/` went on describing a system that no longer existed.

That is PR-4, and it is why Part II of `DECISIONS.md` exists.

**What the first real deployment found (2026-09):** nine defects, none of which any test could have caught, because every one of them lives in the gap between the code and the thing that runs it.

| Found | Kind |
|---|---|
| `backend/.gitignore` excluded `src/services/storage/` | **an unanchored `storage/` pattern matched at any depth** — a clean clone crashed on `Cannot find module './storage'` while every working tree was fine |
| `KMS_MASTER_KEY` undocumented and ungenerated | a required secret nothing told you about |
| nginx routed `/api/` to the backend | **broke browser login** while the backend returned 200 |
| `HOSTNAME` unset for Next standalone | bound to the container ID; "connection refused" from a healthy process |
| the bun adapter always-on | `next build` failed on a missing `.nft.json` |
| `bun` absent from the builder | `npm install` exit 127 |
| `wget` absent from the backend image | its own HEALTHCHECK could not run |
| bind mounts owned by root | `EACCES: mkdir '/app/log/activity/'` against a UID-997 image |
| the database was never seeded | login 500 on an empty database |

The `.gitignore` one is the sharpest: **the repository was missing six committed source files and no local checkout could tell.** Tests passed, the app ran, and the fault appeared only where nobody had ever cloned it.

**What to watch:** any document making a claim with no file reference. That is the shape of the problem.
