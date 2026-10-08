# Phase 999 — Go Migration & Dual-Backend Implementation Backlog

---

## 1. Executive Overview

**Phase 999** is the official implementation container for porting Callibrator to Go and establishing the **dual-backend architecture**.

> **ROADMAPPING RULE**: Phase 999 work MUST NOT begin until:
> 1. Phase 9 (Backend TypeScript Migration) is 100% complete and verified.
> 2. Upstream PHP Feature Adoption — **Phases 12 … 31** ([index](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md)) — is complete according to the platform roadmap (its exit card is P31-04).
> 3. **The backend-agnostic contract group — Phases 32 … 34** — is done (exit card P34-09): `contracts/`, the conformance suite, plain-SQL migrations, JWKS, `/meta`, the gateway (ADR-136, added 2026-10-08).

> **RE-PLANNED 2026-10-08 (owner decision, ADR-136; amends ADR-089):** Go is built **module by module against `contracts/`**, behind the gateway, on the shared database, and each module is **done only at 100% of the conformance suite** (`docs/CONTRACT/06`, `07`). It is no longer a full port proved by a byte-parity diff against the TypeScript backend. Consequences for the table below (rows annotated, not deleted, so their history stays readable):
> - **P999-01** formalises against `contracts/` (no `shared/` contract types — ADR-134 superseded the root `shared/`).
> - **P999-09** validation is **generated** from `contracts/` (the Go generator chosen there), not hand-matched to Zod; the named rules pass `contracts/vectors/`.
> - **P999-07** verifies tokens through the **JWKS** (P34-02); Go becomes an issuer only when the `auth` module moves.
> - **P999-15/16**: the proof is the **conformance suite per module**; the parity diff stays a diagnostic where the contract is silent.
> - **P999-17**: the schema comes from the plain-SQL migrations (P34-01); Go runs the same runner and never creates schema itself.
> - **P999-18, P999-19 — superseded**: there is no per-backend frontend adapter and no shared UI (ADR-134); clients are generated from `contracts/` and hide unimplemented modules through `/meta`.
> - **P999-20** is the gateway of P34-04 (routing per module), not a separate proxy design.
> - **Realtime**: Go emits through the Socket.IO Redis-adapter format first and owns the socket server last (`docs/CONTRACT/05` § 6).
> - **Order of modules**: `docs/CONTRACT/07` § 8. The Go backend-for-mobile modules: [`PHASE-1000-MOBILE-BACKEND-GO.md`](./PHASE-1000-MOBILE-BACKEND-GO.md).

All tasks in this phase are currently **Planned**. No Go implementation code, directory creation, or source code modifications have been performed in earlier phases.

---

## 2. Phase 999 Task Breakdown

| Task ID | Work Package Title | Status | Primary Dependencies | Description & DoD Summary |
|---|---|---|---|---|
| **P999-01** | Architecture Foundation & Contract Alignment | `Planned` | Phase 9, Upstream Adoption | Formalize dual-backend specifications, verify contract parity tooling, ~~finalize `shared/` contract types~~ — **re-scoped (ADR-136):** align with `contracts/` (no root `shared/`, ADR-134). |
| **P999-02** | Go Project Bootstrap & Toolchain Setup | `Planned` | P999-01 | Initialize `backend-go/` module, standard folder hierarchy (`cmd/`, `internal/`, `pkg/`), Makefile, `golangci-lint` configuration. |
| **P999-03** | Domain Entity & Value Object Porting | `Planned` | P999-02 | Port core domain entities (`Device`, `CalibrationRecord`, `Certificate`, `Tenant`, `User`) into Go `internal/domain/entity`. |
| **P999-04** | Application & Service Layer Migration | `Planned` | P999-03 | Implement core use cases and domain services (`DeviceService`, `CalibrationService`, `TenantService`) in Go. |
| **P999-05** | Data Access & Repository Layer Implementation | `Planned` | P999-03 | Implement SQL repositories (`pgx` / `sqlc` or GORM) with mandatory `tenant_id` WHERE predicates and PG18 compatibility. |
| **P999-06** | Transport & HTTP Router Setup | `Planned` | P999-04 | Setup HTTP router (`net/http` / Chi), request handlers, and middleware pipeline matching standard platform response envelopes. |
| **P999-07** | Authentication Subsystem Porting | `Planned` | P999-06 | Implement JWT validation, session lookup parity (Redis / DB), and revocable session checks in Go transport handlers. |
| **P999-08** | Authorization & Gate Enforcement | `Planned` | P999-07 | Port RBAC/ABAC permission evaluation, tenant isolation context propagation, and two-tenant 404 security gates. |
| **P999-09** | Validation Layer Porting | `Planned` | P999-06 | Implement struct tag and DTO validation rules matching Zod validation schemas from the TypeScript reference. |
| **P999-10** | Error Handling & HTTP Translation Middleware | `Planned` | P999-06 | Build domain error translation middleware to map Go sentinel errors to canonical platform error JSON envelopes. |
| **P999-11** | External Services Integration (S3/NFS, ClamAV) | `Planned` | P999-05 | Implement multi-driver object storage abstraction and ClamAV virus scanning integration in Go. |
| **P999-12** | Background Jobs & Scheduled Tasks Porting | `Planned` | P999-05 | Port Redis/RabbitMQ background workers, scheduled compliance jobs, and webhooks durable outbox dispatcher. |
| **P999-13** | Configuration Subsystem Porting | `Planned` | P999-02 | Implement typed environment configuration loading (`envconfig` / `viper`) with validation and default fallback rules. |
| **P999-14** | Observability & Structured Logging Setup | `Planned` | P999-02 | Integrate structured `log/slog` logging with `requestId` and `tenantId` context, Prometheus metrics, and `/health` probes. |
| **P999-15** | Unit & Integration Test Suite Construction | `Planned` | P999-04, P999-05 | Build unit and integration test suites using Go `testing` and `testify`, ensuring 100% tenant isolation assertions. |
| **P999-16** | API Parity & Contract Compatibility Verification | `Planned` | P999-06, P999-15 | Execute contract test suite against running Go backend binary, asserting exact HTTP code and JSON envelope parity with TS backend. |
| **P999-17** | Data Compatibility & Schema Migration Alignment | `Planned` | P999-05 | Verify shared PostgreSQL 18 schema compatibility, migration integrity, and index alignment across both backends. |
| **P999-18** | Frontend Go API Adapter Implementation | ~~`Planned`~~ **Superseded (ADR-134, ADR-136)** | P999-06 | Build `frontend/src/services/api-go.ts` adapter implementing `ICalibrationAPIClient` interface for Go backend integration. |
| **P999-19** | Shared Component Refactoring & Extraction | ~~`Planned`~~ **Superseded (ADR-134, ADR-136)** | P999-18 | Extract frontend presentational controls into `shared/components/` and `shared/utilities/`, ensuring 100% backend-agnostic behavior. |
| **P999-20** | Dual-Backend Integration & Proxy Routing Setup | `Planned` | ~~P999-18~~ P34-04 (the gateway), P999-06 | **Re-scoped (ADR-136):** route modules through the P34-04 gateway — was: configure reverse proxy (nginx / Caddy) to support dynamic path routing between TypeScript and Go backend engines. |
| **P999-21** | As-Built Documentation & Module Reference | `Planned` | P999-20 | Update `docs/BACKEND/`, `docs/API/`, and module reference documents to describe shipped Go backend modules as-built. |
| **P999-22** | Deployment & Runtime Containerization | `Planned` | P999-20 | Create multi-stage Dockerfile for Go backend binary, update Docker Compose and Helm deployment manifests. |
| **P999-23** | Performance & Benchmark Verification | `Planned` | P999-20 | Conduct load testing (k6/autocannon) comparing memory usage, p95 latency, and throughput between TS and Go backends. |
| **P999-24** | Security Audit & Penetration Verification | `Planned` | P999-20 | Execute AppSec security scan, tenant isolation verification (two-tenant IDOR suite), and key rotation rehearsal on Go engine. |
| **P999-25** | Deprecation & Transition Phase Close-Out | `Planned` | P999-21, P999-24 | Finalize dual-backend operational runbook, record transition completion in `MEMORY/`, and update platform status boards. |

---

## 3. Dependency Graph Visualization

```text
               Architecture & Bootstrap
                 (P999-01 ──▶ P999-02)
                          │
         ┌────────────────┴────────────────┐
         ▼                                 ▼
   Domain Entities                 Config & Logging
     (P999-03)                   (P999-13, P999-14)
         │                                 │
   ┌─────┴───────────────┐                 │
   ▼                     ▼                 │
Services            Repositories           │
(P999-04)            (P999-05)             │
   │                     │                 │
   └──────────┬──────────┘                 │
              ▼                            │
      HTTP & Transport ◄───────────────────┘
     (P999-06 ──▶ P999-07, P999-08, P999-09, P999-10)
              │
   ┌──────────┼──────────────────┐
   ▼          ▼                  ▼
 Workers   Storage            Testing
(P999-12) (P999-11)          (P999-15)
   │          │                  │
   └──────────┴────────┬─────────┘
                       ▼
              API Parity & Contract
                    (P999-16)
                       │
       ┌───────────────┴───────────────┐
       ▼                               ▼
 Frontend Adapter             Data & Proxy Routing
   (P999-18)                       (P999-17, P999-20)
       │                               │
       └───────────────┬───────────────┘
                       ▼
            Shared Component Extract
                    (P999-19)
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
 Deployment      Performance        Security
 (P999-22)        (P999-23)        (P999-24)
       │               │               │
       └───────────────┴───────┬───────┘
                               ▼
                        Close-Out / Docs
                           (P999-25)
```

---

## 4. Execution Policy Rules

1. **Definition of Done**: A Phase 999 task is NOT marked `DONE` until:
   - Implementation is complete and verified by named unit/integration tests.
   - ~~Parity assertions pass against the reference backend.~~ **Re-scoped (ADR-136):** the module scores **100% in the conformance suite** on the current contract version (`docs/CONTRACT/06` § 4), with Node also at 100% on it (Q-C2); a parity diff against Node is a diagnostic only.
   - Cross-tenant 404 security assertions pass.
   - A change record is written in `MEMORY/records/` and indexed in `MEMORY/MEMORY-INDEX.md`.
2. **Strict No-Deletion Rule**: The TypeScript backend MUST NOT be deleted or broken while completing Phase 999 tasks.
