# Execution Plan

Central task board for 5-phase development roadmap. Each task names the documents it implements and how it is judged done.

## Task Organization

Tasks are organized by phase and priority:
- **Phase 1: Foundation** — Multi-tenant setup, auth, RBAC, base infrastructure
- **Phase 2: Warehouse** — Inventory management and stock tracking
- **Phase 3: Calibration** — Device catalog, work orders, results, certificates
- **Phase 4: Enterprise SSO** — SAML, vault integration, advanced features
- **Phase 5: Analytics** — Data lake, predictive maintenance, dashboards

## Task ID Format

`{Phase}{Priority}-{Sequence}`

Example: `P1-01` = Phase 1, Priority 0 (critical), Task 01

## Task Conventions

Read `00-TASK-CONVENTIONS.md` for complete working guidelines:
- One task per branch
- Branch naming: `feat/P1-02-rbac-system`
- Commit subjects: `P1-02: ...`
- Task records in `MEMORY/records/`
- Update `PROGRESS.md` when done

## Current Progress

See `PROGRESS.md` for live phase tracking and completion status.

## Task List by Phase

### Phase 1: Foundation (Current)

**Critical Path (Must Complete First)**

- [ ] **P1-01** Monorepo Setup
  - Backend and frontend consolidated
  - pnpm workspaces configured
  - Turbo build cache enabled
  - Root configuration files in place

- [ ] **P1-02** Database Schema & Migrations
  - PostgreSQL schema created
  - Sequelize models defined
  - Migration system working
  - Audit tables configured

- [ ] **P1-03** OIDC Authentication
  - Auth0 or Keycloak configured
  - Login/logout flows implemented
  - Token refresh working
  - Session middleware active

- [ ] **P1-04** RBAC System
  - User, Role, Permission tables created
  - Menu structure defined
  - Role-permission assignments working
  - Permission middleware enforced

- [ ] **P1-05** Tenant Context & Isolation
  - Tenant middleware implemented
  - Tenant ID injected into requests
  - Data queries filtered by tenant
  - Test: cross-tenant data leakage impossible

- [ ] **P1-06** Session Management & Redis
  - Redis configured for sessions
  - Refresh token rotation working
  - Session TTL enforced
  - Fallback to database working

- [ ] **P1-07** Audit Logging
  - Audit tables created for all entities
  - Before/after state logged
  - User attribution working
  - Audit queries working

- [ ] **P1-08** User Management Endpoints
  - User CRUD endpoints
  - Password hashing with bcrypt
  - Email verification working
  - User search and filtering

- [ ] **P1-09** Role & Permission Management
  - Role CRUD endpoints
  - Permission assignment endpoints
  - Bulk role assignment
  - Permission validation on queries

- [ ] **P1-10** Dashboard & Main Layout
  - Next.js app structure
  - Main dashboard page
  - Navigation menu system
  - Auth guard on routes

**Supporting Tasks**

- [ ] **P1-11** API Documentation (OpenAPI)
  - Swagger spec generated
  - Endpoint contracts documented
  - Client SDK generated
  - Documentation CI check

- [ ] **P1-12** Docker Setup
  - Dockerfile for backend
  - Dockerfile for frontend
  - docker-compose for local dev
  - .dockerignore configured

- [ ] **P1-13** CI/CD Pipeline
  - GitHub Actions workflows
  - Build and test on PR
  - Lint checks
  - Type checking

---

### Phase 2: Warehouse & Inventory

- [ ] **P2-01** Warehouse & Location Models
  - Warehouse CRUD
  - Location hierarchy (floor → section → bin → slot)
  - Barcode schema
  - Physical inventory tracking

- [ ] **P2-02** Stock Tracking & Transfers
  - Stock entity and queries
  - Transfer workflow
  - Stock reservation system
  - Transfer audit logging

- [ ] **P2-03** Stock Opname (Inventory Counting)
  - Stock opname workflow
  - Variance calculation
  - Adjustment processing
  - Historical tracking

- [ ] **P2-04** Warehouse UI
  - Warehouse list and detail views
  - Location tree viewer
  - Stock search and filtering
  - Transfer interface

- [ ] **P2-05** Inventory Reports
  - Stock level reports
  - Transfer history
  - Slow-moving inventory
  - Warehouse utilization

---

### Phase 3: Calibration & Devices

- [ ] **P3-01** Medical Device Catalog
  - Device CRUD
  - Category and model management
  - Vendor tracking
  - Document storage

- [ ] **P3-02** Calibration Scheduling
  - Schedule creation and management
  - Automatic work order generation
  - Scheduler algorithm
  - Timezone support

- [ ] **P3-03** Calibration Work Orders
  - Work order state machine
  - Task creation and assignment
  - Status transitions
  - Supervisor approval workflow

- [ ] **P3-04** Measurement Data Collection
  - Measurement form builder
  - Real-time data entry
  - Validation rules
  - Data integrity checks

- [ ] **P3-05** Calibration Results & Certificates
  - Result recording
  - Certificate generation with digital signatures
  - PDF export
  - Compliance validation

- [ ] **P3-06** Device Calibration Records
  - Immutable calibration history
  - Trend analysis
  - Device health score calculation
  - Historical filtering and search

- [ ] **P3-07** Calibration UI
  - Work order dashboard
  - Editor for measurements
  - Result review and approval
  - Certificate download

- [ ] **P3-08** Calibration Reports
  - Device compliance status
  - Overdue calibrations
  - Certificate archive
  - Trend analysis charts

---

### Phase 4: Enterprise SSO & Advanced Features

- [ ] **P4-01** SAML Integration
  - SAML provider configuration
  - Assertion parsing
  - User attribute mapping
  - SSO discovery

- [ ] **P4-02** Vault Integration
  - HashiCorp Vault setup
  - Secrets rotation
  - Access audit logging
  - K8s auth integration

- [ ] **P4-03** Advanced Analytics
  - Device lifetime analysis
  - Maintenance cost tracking
  - Calibration compliance trending
  - Custom report builder

- [ ] **P4-04** Bulk Operations
  - Bulk device import (CSV)
  - Bulk calibration scheduling
  - Batch certificate generation
  - Progress tracking

---

### Phase 5: Analytics & Data Lake

- [ ] **P5-01** Real-Time Dashboards
  - Live device status
  - Maintenance alerts
  - Compliance metrics
  - Performance metrics

- [ ] **P5-02** Predictive Maintenance Models
  - ML model for failure prediction
  - Risk scoring
  - Maintenance recommendations
  - Model retraining pipeline

- [ ] **P5-03** Data Lake Integration
  - ETL pipeline to data warehouse
  - Historical data sync
  - Real-time events stream
  - Compliance reporting integration

- [ ] **P5-04** Advanced Compliance Reporting
  - KARS compliance report
  - ISO 17025 audit trail
  - Data integrity verification
  - Export to regulatory bodies

---

## Blocking Dependencies

Tasks with blocking dependencies must complete in order:

```
P1-01 (Monorepo) → P1-02 (Database) → P1-03 (Auth) → [P1-04,05,06,07,08,09,10 in parallel]
                                                        ↓
                                                    P1-11,12,13
                                                        ↓
                                                    Phase 2 start
```

## Definition of Done (DoD) Checklist

Each task must satisfy:

- [ ] Code implemented and tested
- [ ] Tests pass locally (`pnpm test`)
- [ ] Type checking passes (`pnpm typecheck`)
- [ ] Linting passes (`pnpm lint`)
- [ ] Build succeeds (`pnpm build`)
- [ ] API contract updated (if applicable)
- [ ] Database migrations run cleanly
- [ ] Documentation updated in `docs/`
- [ ] MEMORY record created in `MEMORY/records/`
- [ ] PROGRESS.md updated with completion
- [ ] Branch merged to main with PR review

## Starting a New Task

1. Create feature branch: `git checkout -b feat/P1-02-rbac-system`
2. Update `PROGRESS.md` to mark task as "In Progress"
3. Implement the task per spec in `docs/`
4. Update `MEMORY/PROGRESS.md` section
5. Create task record in `MEMORY/records/{TASK_ID}.md`
6. Create PR and get review
7. Merge to main when DoD satisfied
8. Update `PROGRESS.md` to mark as "Completed"

## Quarterly Review

Review and update this task list:
- After each phase completion
- Quarterly during active development
- When scope changes
- Before each major release
