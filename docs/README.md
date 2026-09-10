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
ARCHITECTURE/  10 files — high-level system design
API/           14 files — the complete API contract across 53 route modules
DATABASE/      14 files — the 72-model schema, grouped by domain
SECURITY/      13 files — threat model through incident response
                          (SECURITY/05 is mandatory reading — tenant isolation is
                          the number-one control in this system)
UI-UX/         20 files — experience design & the design system
FRONTEND/      12 files — frontend architecture & standards
BACKEND/       12 files — backend architecture, standards, and the module reference
DEVOPS/        12 files — environments, CI/CD, deployment, observability
TESTING/        8 files — the test strategy and every suite that enforces it
ARCHIVE/        — superseded documents, kept for provenance, never authoritative
```

## What This Documents

| Dimension | Reality |
|---|---|
| Backend | Express.js (**JavaScript, CommonJS** — not TypeScript) + Sequelize ORM |
| Database | PostgreSQL **or** MySQL — engine-agnostic by design (see ADR-029) |
| Frontend | Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Zustand |
| Realtime | Socket.IO both ends (see ADR-031) |
| Infrastructure | Redis · RabbitMQ · MQTT (aedes) · ClamAV · pgvector |
| Modules | 33 functional backend modules, 53 mounted route modules |
| Scale of code | 72 models · 76 services · 56 controllers · 37 validators · 21 middlewares |
| Compliance | ISO 17025 · FDA 21 CFR Part 11 · ISO 13485 · GDPR · KARS · SNARS |

## Rules for These Documents

1. **Ground every claim in code.** A sentence that cannot be traced to a file is a guess, and guesses in reference material get copied into implementations.
2. **Name the file.** Link to `backend/src/...` or `frontend/src/...` when stating behaviour. A reader must be able to check you.
3. **Record contradictions rather than smoothing them.** Where the code does something surprising (see `API/00-API-STANDARDS.md` § Known Mount Aliases), say so plainly — the surprise is the useful part.
4. **Amend, do not rewrite.** A `docs/` change is an event; it means reality taught the specification something. Record it.
