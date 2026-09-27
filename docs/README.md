# Product Documentation — Callibrator (Hospital Device Calibration Platform)

This is the reference documentation for **Callibrator**, an enterprise multi-tenant SaaS for hospital medical-device calibration, maintenance, quality management and device lifecycle.

**These documents describe the system as it is actually built.** Every fact here — endpoint, table, column, enum value, config key, middleware order — was read out of `backend/src/` and `frontend/src/` rather than out of a plan. Where the shipped behaviour differs from what was once intended, the document says so and points at the ADR in [`../MEMORY/DECISIONS.md`](../MEMORY/DECISIONS.md) that records the change.

The **execution plan** built from these documents lives in [`../TASKS/`](../TASKS/README.md). The record of what was built and why lives in [`../MEMORY/`](../MEMORY/README.md). `docs/` is reference material: it is amended deliberately, through the deviation protocol in [`../TASKS/00-TASK-CONVENTIONS.md`](../TASKS/00-TASK-CONVENTIONS.md), never edited as a side effect of implementation.

## Recommended Reading Order

```
1.  PLAN/00-PROJECT-OVERVIEW.md          → start here for the big-picture context
2.  PLAN/01-PRODUCT-REQUIREMENTS.md
3.  PLAN/02-BUSINESS-RULES.md
4.  PLAN/03-USER-ROLES.md                → the RBAC model everything else assumes
5.  PLAN/06-DEVICE-LIFECYCLE.md          → the core domain object
6.  PLAN/07-CALIBRATION-PROGRAM.md       → the reason the product exists
7.  ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md
8.  SECURITY/05-MULTI-TENANCY-SECURITY.md → MANDATORY for every engineer, no exceptions
9.  DATABASE/00-DATA-MODEL.md → 13-MIGRATIONS.md
10. API/00-API-STANDARDS.md → 13-INTEGRATION-API.md
11. BACKEND/10-MODULE-REFERENCE.md       → the 33-module deep reference
12. UI-UX/, FRONTEND/, DEVOPS/, TESTING/ as needed per work phase
```

## Folder Structure

```
PLAN/          19 files — product vision, requirements, business rules, roadmap
ARCHITECTURE/  12 files — high-level system design & Dual-Backend specification
API/           15 files — complete API contract & backend interoperability contract
DATABASE/      14 files — the 72-model schema, grouped by domain
SECURITY/      13 files — threat model through incident response
                          (SECURITY/05 is mandatory reading — tenant isolation is
                          the number-one control in this system)
UI-UX/         20 files — experience design & the design system
FRONTEND/      14 files — frontend architecture, multi-frontend & shared components
BACKEND/       13 files — backend architecture, standards, module reference & Go porting spec
ENGINEERING/   17 files — how code is written here: JS, TS & Go coding standards
DEVOPS/        12 files — environments, CI/CD, deployment, observability
TESTING/        8 files — the test strategy and every suite that enforces it
DEVELOPER/      3 files — integrator-facing: authentication, IoT ingest, SCIM
OBSERVABILITY/  2 files — what this system actually logs, and where it goes
STORAGE/        1 file  — pluggable object storage, per tenant
ARCHIVE/        9 files — superseded documents, kept for provenance, never authoritative
```

The last four categories are new as of 2026-09-23 and are **incomplete**: several
documents elsewhere link to files in them that have not been written yet
(`MULTI-TENANCY/`, `SEARCH/`, `WEBHOOK/` do not exist at all). Those links are broken today.
The files that do exist are as-built and name their source.

## What This Documents

| Dimension | Reality |
|---|---|
| Backend Architecture | **Dual-Backend Target Architecture (ADR-089)** — TypeScript backend (`backend/src/`) existing reference implementation; future Go backend engine (`backend-go/`) planned for Phase 999 |
| Backend Runtime | Express.js + Sequelize — **JavaScript/CommonJS today, strict TypeScript is the target for Phase 9** (ADR-038; plan in `TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`) |
| Database | PostgreSQL 18 + pgvector, only (ADR-039 for the engine, ADR-041 for the version — the deployment still runs 17.11 until the upgrade runbook is carried out). The engine-agnostic premise of ADR-029 was dropped; its tenant-isolation mechanism stands |
| Frontend Architecture | **Multi-Frontend & Shared Component Architecture** — Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Zustand · Root-level `shared/` area |
| Realtime | Socket.IO both ends (see ADR-031) |
| Infrastructure | Redis · RabbitMQ · MQTT (client, external broker) · ClamAV · pgvector |
| Modules | 33 functional backend modules, 53 mounted route modules |
| Scale of code | 72 models · 76 services · 56 controllers · 37 validators · 21 middlewares |
| Compliance | ISO 17025 · FDA 21 CFR Part 11 · ISO 13485 · GDPR · KARS · SNARS |

## Rules for These Documents

1. **Ground every claim in code.** A sentence that cannot be traced to a file is a guess, and guesses in reference material get copied into implementations.
2. **Name the file.** Link to `backend/src/...` or `frontend/src/...` when stating behaviour. A reader must be able to check you.
3. **Record contradictions rather than smoothing them.** Where the code does something surprising (see `API/00-API-STANDARDS.md` § Known Mount Aliases), say so plainly — the surprise is the useful part.
4. **Amend, do not rewrite.** A `docs/` change is an event; it means reality taught the specification something. Record it.
