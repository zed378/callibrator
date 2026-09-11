# Callibrator

**Hospital Device Calibration Platform** — multi-tenant SaaS for medical-device calibration, maintenance and lifecycle management.

Built for two sides of the same transaction: **healthcare facilities** that own devices and must prove they are calibrated, and **calibration providers** that perform the work and issue the certificates.

Compliance targets: ISO 17025 · FDA 21 CFR Part 11 · ISO 13485 · GDPR · KARS · SNARS.

---

## The Idea

A hospital that cannot prove a defibrillator was calibrated within its interval has, for audit purposes, an uncalibrated defibrillator. **The evidence is the compliance.**

Callibrator makes that evidence a by-product of doing the work: every device has an interval, every calibration produces an append-only record naming who performed it, every certificate is signed and **publicly verifiable without a login**, and every mutation is audit-logged.

## Quick Start

```bash
make env          # create deploy/compose/.env
make secrets      # generate the four REQUIRED secrets
make dev          # bring the stack up
make help         # every target
```

Requires Docker with the compose plugin, Node 20+, pnpm, and `make`.

The application **exits** without `CERT_SIGNING_SECRET`, `ENCRYPT_KEY` and `ATTACHMENT_URL_SECRET`. That is deliberate — starting without them produces certificates that cannot be verified, and the failure would appear days later in front of an auditor.

## Layout

```
docs/          135 as-built documents across 10 categories
MEMORY/        decisions, change records, specs, templates
TASKS/         the execution board
deploy/        compose stacks and Helm charts
backend/       Express · JavaScript · CommonJS
frontend/      Next.js 16 · React 19 · TypeScript
Makefile       development, gates, deployment
```

## The Stack, Accurately

| | |
|---|---|
| Backend | Express, **JavaScript, CommonJS** — *not TypeScript* (ADR-030) |
| ORM | Sequelize |
| Database | PostgreSQL **or MySQL** (ADR-029) |
| Frontend | Next.js 16 · React 19 · TypeScript · Tailwind 4 · Zustand |
| Realtime | Socket.IO both ends (ADR-031) |
| Infrastructure | Redis · RabbitMQ · embedded MQTT (aedes) · ClamAV · pgvector |
| Distribution | both halves compile to **standalone binaries** — no runtime in the production images |

## Scale

| | |
|---|---|
| Backend modules | 33 |
| Mounted route modules | 53 |
| Models | 72 |
| Services / controllers / validators | 76 / 56 / 37 |
| Backend test files | 342 |
| Live E2E specs | 53 |
| Frontend API services (each with a contract test) | 51 |
| Dashboard surfaces | ~60 |
| ADRs | 37 |

## Where to Start Reading

| You are | Read |
|---|---|
| New to the project | [`docs/PLAN/00-PROJECT-OVERVIEW.md`](docs/PLAN/00-PROJECT-OVERVIEW.md) |
| **An engineer, any discipline** | [`docs/SECURITY/05-MULTI-TENANCY-SECURITY.md`](docs/SECURITY/05-MULTI-TENANCY-SECURITY.md) — **mandatory** |
| Working on the backend | [`docs/BACKEND/00-BACKEND-STANDARDS.md`](docs/BACKEND/00-BACKEND-STANDARDS.md) |
| Working on the frontend | [`docs/FRONTEND/00-FRONTEND-STANDARDS.md`](docs/FRONTEND/00-FRONTEND-STANDARDS.md) |
| Deploying | [`deploy/README.md`](deploy/README.md) |
| An AI agent | [`CLAUDE.md`](CLAUDE.md), then [`AGENTS.md`](AGENTS.md) |
| Wondering why something is the way it is | [`MEMORY/DECISIONS.md`](MEMORY/DECISIONS.md) — **Part II first** |

## Documentation

`docs/` describes the system **as it is actually built**. Every document names the source files it derives from, so you can check it rather than trust it.

| | | |
|---|---|---|
| [`PLAN/`](docs/PLAN/00-PROJECT-OVERVIEW.md) | 19 | product, business rules, roles, compliance, risks |
| [`ARCHITECTURE/`](docs/ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md) | 10 | system design |
| [`API/`](docs/API/00-API-STANDARDS.md) | 14 | the contract across 53 route modules |
| [`DATABASE/`](docs/DATABASE/00-DATA-MODEL.md) | 14 | 72 models by domain |
| [`SECURITY/`](docs/SECURITY/00-SECURITY-REQUIREMENTS.md) | 13 | threat model through incident response |
| [`UI-UX/`](docs/UI-UX/00-DESIGN-DIRECTION.md) | 20 | experience design and the design system |
| [`FRONTEND/`](docs/FRONTEND/00-FRONTEND-STANDARDS.md) | 12 | frontend architecture |
| [`BACKEND/`](docs/BACKEND/00-BACKEND-STANDARDS.md) | 12 | backend architecture and the 33-module reference |
| [`DEVOPS/`](docs/DEVOPS/00-ENVIRONMENTS.md) | 12 | environments, deployment, observability |
| [`TESTING/`](docs/TESTING/00-TEST-STRATEGY.md) | 8 | the strategy and every suite enforcing it |

## Commands

```bash
make dev              # local stack, hot reload
make verify           # lint · typecheck · test · build
make test-e2e         # 53 live specs against a running server
make migrate          # then: make migrate-verify — the log is not evidence
make deploy ENV=prod TAG=<sha>
```

`make verify` does **not** cover the live or browser suites. A green `verify` is not a green release.

## Current State, Stated Honestly

Phases 0–5 are shipped. Two gates are failing, and a status page that hides them is not a status page.

| | |
|---|---|
| Backend unit coverage gate (100%) | 🟢 **passing** (2026-09-11) — 289 suites, 5735 tests |
| Live E2E in one uninterrupted run | 🔴 **never achieved** — verified fix by fix — [P6-02](TASKS/PHASE-6-CORRECTNESS-AND-COMPLIANCE.md) |
| `calibration_records` append-only | 🟡 a **convention**, not a database constraint — [P6-03](TASKS/PHASE-6-CORRECTNESS-AND-COMPLIANCE.md) |
| Helm charts | 🟡 **render**; no cluster has been reachable |
| CI pipeline | ⚪ deferred — gates run in `pre-push` and `make verify` |

Full board: [`TASKS/PROGRESS.md`](TASKS/PROGRESS.md). Everything unverified is listed in [`TASKS/BACKLOG.md`](TASKS/BACKLOG.md) § Unverified Claims.

## The Rules That Matter Most

**Tenant isolation is deny-by-default.** Global Sequelize hooks inject the predicate; you do not opt in. A principal with no resolvable tenant sees **nothing**.

**Cross-tenant returns 404, never 403.** A 403 confirms the resource exists.

**Every route needs a permission gate** — and nothing in the build enforces that yet.

**Name the test.** An assertion that a test passed is not evidence. "IDOR tested, all good" with no test named is worse than silence, because it stops anyone looking again.

## Contributing

One task, one branch, one PR. `main` stays deployable.

```
feat/P6-04-route-permission-guard
```

**Nothing is `DONE` without its record in `MEMORY/records/`.** Conventions: [`TASKS/00-TASK-CONVENTIONS.md`](TASKS/00-TASK-CONVENTIONS.md).

## A Note on This Repository's History

The previous `CLAUDE.md` instructed engineers and agents to write **strict TypeScript with no `any`** — for a backend that is JavaScript. The task board listed foundation work as TODO that had shipped months earlier.

An instruction document that disagrees with the code produces confidently wrong work, **and the confidence is the dangerous part**.

That is recorded as PR-4, and it is why `docs/` is now as-built, why Part II of `DECISIONS.md` exists, and why every document here names the file it derives from.
