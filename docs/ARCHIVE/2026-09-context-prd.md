# CONTEXT.md

Project context, architecture overview, and key specifications for the Hospital Device Calibration Platform.

---

## Project Overview

**Hospital Device Calibration Platform** is an enterprise-grade multi-tenant SaaS for hospital device calibration, maintenance, and lifecycle management.

### Problem Statement

Hospitals manage hundreds of medical devices requiring regular calibration for accuracy and compliance. Current processes are fragmented:
- Manual scheduling and tracking
- Paper-based records
- No centralized compliance audit trail
- Limited device health visibility
- Disconnected maintenance workflows

### Solution

A unified platform enabling:
- Automated calibration scheduling
- Digital work orders and results
- Compliance-ready audit trails (ISO 17025, KARS, SNARS)
- Device health scoring and predictive maintenance
- Multi-location warehouse and inventory management

---

## Stack & Technologies

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Backend** | Express.js | 5.x | REST API server |
| **Frontend** | Next.js | 16.x | Web application |
| **Database** | PostgreSQL | 14+ | Primary data store |
| **Cache** | Redis | 7+ | Sessions and real-time data |
| **Message Queue** | RabbitMQ | 3.x | Async processing |
| **ORM** | Sequelize | 6.x | Database abstraction |
| **Validation** | Zod | Latest | Schema validation |
| **Testing** | Jest | 30.x | Unit and integration tests |
| **Build** | Turbo | 2.x | Monorepo build orchestration |
| **Package Manager** | pnpm | 9.x | Workspace management |
| **Auth** | OIDC | - | Authentication provider |
| **Storage** | S3/R2 | - | File uploads and archives |

---

## Core Architecture

### Multi-Tenant Model

- **Logical Isolation:** Single database, tenant_id on all tables
- **Separate Redis Namespaces:** `tenant:{tenantId}:*` key prefix
- **Application-Level Enforcement:** Every query filters by tenant_id
- **Session Binding:** Sessions tied to specific tenant

### Authentication & Authorization

- **OIDC Provider:** Auth0, Keycloak, or similar
- **Token-Based:** JWT with 15-min access token, 7-day refresh token
- **Session Management:** Tokens cached in Redis with automatic refresh
- **RBAC:** 7 core roles (Admin, Manager, Technician, Supervisor, Reviewer, Auditor, Viewer)
- **Fine-Grained Permissions:** 50+ permission types across modules

### Data Integrity

- **Immutable Audit Trail:** All mutations logged with before/after state
- **Transactional Consistency:** Database transactions for atomic operations
- **Foreign Key Constraints:** Relational integrity enforced at DB level
- **Soft Deletes:** Logical deletion preserves audit history

---

## Compliance Requirements

### Standards

- **ISO 17025** — Laboratory accreditation and management of testing competency
- **KARS** — Indonesian lab accreditation (Komite Akreditasi Laboratorium)
- **SNARS** — National metrology system requirements

### Audit Trail Requirements

1. **Complete Traceability:** Every data change logged with user, timestamp, before/after
2. **Immutability:** Audit logs cannot be deleted or modified
3. **Retention:** 7-year minimum retention for compliance
4. **Accessibility:** Queryable reports for regulatory inspections
5. **Performance:** Audit queries <2 seconds for compliance audits

### Device Lifecycle

1. **Registration:** Device added to catalog with spec sheet
2. **Calibration Schedule:** Automated schedule creation based on device type
3. **Work Order:** Digital work order created before calibration
4. **Measurement:** Technician records measurement data
5. **Results:** Supervisor reviews and approves results
6. **Certificate:** Digital certificate with RSA-2048 signature generated
7. **Archive:** Certificate stored indefinitely for regulatory review

---

## Role-Based Access Control (RBAC)

### Seven Core Roles

| Role | Scope | Permissions |
|------|-------|-------------|
| **Admin** | Organization | All operations, user management, configuration |
| **Manager** | Department | Scheduling, budget, reports, user oversight |
| **Technician** | Operational | Perform calibrations, record measurements, view devices |
| **Supervisor** | Quality | Review results, approve certificates, quality checks |
| **Reviewer** | Compliance | Audit trail access, compliance reports, no mutations |
| **Auditor** | External | Read-only compliance data for regulatory audits |
| **Viewer** | Limited | Dashboard only, no sensitive data access |

### Permission Types

- `device.*` — Device catalog operations
- `calibration.*` — Calibration workflow operations
- `warehouse.*` — Inventory management
- `maintenance.*` — Maintenance tracking
- `audit.*` — Audit trail access
- `user.*` — User management
- `role.*` — Role management
- `report.*` — Report generation
- `admin.*` — System configuration

---

## Data Model

### Key Entities

**Tenants**
- Organization boundary
- Billing and usage tracking
- Configuration and preferences

**Users**
- Email-based identity
- OIDC provider link
- Role assignments

**Devices**
- Medical equipment catalog
- Device specifications (model, manufacturer, serial)
- Current location and custody chain
- Calibration frequency and schedule

**Calibration Records** (Immutable)
- Work order with state machine
- Measurement data collected
- Results and approval status
- Digital certificate with signature

**Warehouses & Locations**
- Hierarchical structure: Floor → Section → Bin → Slot
- Stock levels per location
- Transfer audit trail

**Maintenance Records**
- Service events and parts used
- Costs and technician assignments
- Warranty claims and correlation

**Audit Logs**
- Every mutation: user, timestamp, before/after state
- System operations and error events
- Access logs for sensitive operations

---

## Phase Breakdown

### Phase 1: Foundation (Months 1-2)
- Multi-tenant infrastructure
- OIDC authentication and session management
- RBAC system with 7 core roles
- User and role management
- Database schema and migrations
- Main dashboard and navigation
- API documentation

### Phase 2: Warehouse & Inventory (Months 3-4)
- Warehouse model with location hierarchy
- Stock tracking and transfers
- Stock opname (physical inventory counting)
- Transfer audit trail
- Inventory reporting

### Phase 3: Calibration & Devices (Months 5-7)
- Device catalog
- Calibration scheduling (automated)
- Work order state machine
- Measurement data collection
- Results recording and approval
- Digital certificate generation with signatures
- Device health scoring
- Calibration history and trend analysis

### Phase 4: Enterprise & Analytics (Months 8-9)
- SAML integration for enterprise SSO
- Vault-based secrets management
- Advanced analytics dashboards
- Bulk operations (import, export)
- Scheduled reports
- Data export to regulatory bodies

### Phase 5: Predictive Maintenance (Months 10-12)
- Real-time dashboards
- ML model for failure prediction
- Predictive maintenance scoring
- Data lake integration
- Advanced compliance reporting
- Mobile app (optional)

---

## File Organization

```
backend/
  src/
    modules/
      auth/           # OIDC, tokens, sessions
      users/          # User management
      roles/          # Role and permission management
      devices/        # Device catalog
      calibration/    # Work orders, results, certificates
      warehouse/      # Inventory, locations, transfers
      maintenance/    # Service records
      audit/          # Audit logging
    middleware/       # Auth, tenant, error handling
    migrations/       # Database migrations
    repositories/     # Data access layer
    services/         # Business logic
    schemas/          # Validation schemas
    config/           # Environment configuration
    utils/            # Utilities and helpers

frontend/
  src/
    app/              # Next.js app directory
      auth/           # Login/logout
      dashboard/      # Main dashboard
      devices/        # Device management
      calibration/    # Calibration workflows
      warehouse/      # Inventory management
      admin/          # Admin settings
      reports/        # Reporting
    components/       # React components
    hooks/            # Custom hooks
    services/         # API client calls
    types/            # TypeScript types
    utils/            # Utilities

packages/
  schema/             # Zod schemas (shared)
  ui/                 # UI components and design tokens
  api-client/         # Generated TypeScript client
  config/             # ESLint, Prettier, TypeScript
```

---

## Development Workflow

### One Task Per Branch

1. Create branch: `git checkout -b feat/P1-02-rbac-system`
2. Implement feature per specification
3. Write tests (unit + integration)
4. Ensure all checks pass: typecheck, lint, test, build
5. Create PR with task ID in title
6. Get code review and approval
7. Merge to main
8. Create task record in `MEMORY/records/`
9. Update progress in `MEMORY/PROGRESS.md`

### Commit Convention

```
P1-02: Implement RBAC system with role-permission assignments

- Add Role and Permission models
- Implement role-permission association
- Add permission middleware
- Add 100+ tests for RBAC
- Update API documentation
```

### Code Quality Standards

- TypeScript: Strict mode, no `any` types
- Testing: Minimum 80% coverage for new code
- Linting: ESLint + Prettier must pass
- Security: RBAC, tenant isolation, input validation verified
- Performance: No N+1 queries, appropriate caching

---

## Key Decisions (ADRs)

See `MEMORY/DECISIONS.md` for complete list. Highlights:

- **ADR-001:** Multi-tenant with logical isolation
- **ADR-002:** Express.js + Sequelize
- **ADR-003:** PostgreSQL + Redis
- **ADR-004:** Kubernetes deployment
- **ADR-005:** OIDC authentication
- **ADR-006:** RabbitMQ for async processing
- **ADR-007:** Next.js with SSR
- **ADR-009:** Row-level audit logging
- **ADR-016:** Immutable calibration records
- **ADR-026:** Three-tier RBAC model

---

## Compliance Checklist

Every feature must include:

- [ ] Input validation on all user inputs
- [ ] RBAC permission checks on all endpoints
- [ ] Tenant isolation verified (no cross-tenant leaks)
- [ ] Audit logging on all data mutations
- [ ] Error handling with proper HTTP status codes
- [ ] API documentation in OpenAPI spec
- [ ] Tests covering happy path, permissions, and edge cases
- [ ] No hardcoded secrets or credentials
- [ ] Performance acceptable (<200ms p95)
- [ ] Security review completed

---

## Getting Started

1. Read `CLAUDE.md` for operating instructions
2. Review `AGENTS.md` for role definitions
3. Check `MEMORY/DECISIONS.md` for architectural context
4. Look at `TASKS/README.md` for task list
5. Start with next task in `TASKS/PROGRESS.md`

See root `README.md` for quick start and local setup.
