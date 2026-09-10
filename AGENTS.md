# AGENTS.md

Agent definitions and specialized workflows for this project.

---

## Overview

This document defines specialized agents and how they operate within the Hospital Device Calibration Platform monorepo.

---

## Agent: Backend Engineer

**Scope:** Express.js API, database, migrations, server-side logic

**Capabilities:**
- Implement REST endpoints with RBAC and tenant isolation
- Write Sequelize models and migrations
- Design database schemas following compliance requirements
- Create audit logging mechanisms
- Build background workers and queues
- Write integration and unit tests for backend

**Files They Own:**
- `backend/src/` — Source code
- `backend/__tests__/` — Test files
- `backend/src/migrations/` — Database migrations
- `backend/docker-compose.yaml` — Local dev database

**Rules:**
- Every endpoint must have permission checks
- Every query must filter by tenant_id
- Every mutation must be audit logged
- No breaking API changes without discussion
- Tests must cover happy path, edge cases, and permissions

**Blocked By:**
- P1-02: Database schema and migrations not ready

**Unlocks:**
- P1-03 through P1-10: All subsequent backend work

---

## Agent: Frontend Engineer

**Scope:** Next.js app, React components, client-side logic

**Capabilities:**
- Build React components and pages
- Implement state management and hooks
- Create forms with validation
- Build dashboards and UI flows
- Write integration tests for UI
- Handle authentication UI and redirects

**Files They Own:**
- `frontend/src/` — Source code
- `frontend/src/app/` — Next.js app directory
- `frontend/src/components/` — React components
- `frontend/__tests__/` — Test files

**Rules:**
- All API calls must use typed client from `packages/api-client`
- Protected routes must check authentication
- Forms must validate using schemas from `packages/schema`
- No direct API calls (use generated client)
- Tests must cover user flows and error states

**Blocked By:**
- P1-03: Backend API endpoints not ready
- P1-10: Main dashboard layout specification

**Unlocks:**
- Phase 2 and 3: Feature UI implementation

---

## Agent: DevOps Engineer

**Scope:** Docker, Kubernetes, CI/CD, infrastructure

**Capabilities:**
- Create and maintain Dockerfiles
- Write Kubernetes manifests
- Set up CI/CD pipelines (GitHub Actions)
- Configure container registries
- Set up monitoring and logging
- Build and deployment automation

**Files They Own:**
- `backend/Dockerfile` — Backend container image
- `frontend/Dockerfile` — Frontend container image
- `deploy/` — Kubernetes manifests and scripts
- `.github/workflows/` — CI/CD pipelines
- `.github/actions/` — Custom actions

**Rules:**
- All secrets passed via environment variables
- Container images scanned for vulnerabilities
- Database migrations run before app start
- Health checks defined for all services
- No hardcoded credentials in manifests

**Blocked By:**
- P1-12: Docker setup task

**Unlocks:**
- P1-13: CI/CD pipeline setup
- Phase 2+: Staging and production deployment

---

## Agent: Database Architect

**Scope:** Schema design, migrations, data integrity

**Capabilities:**
- Design relational schemas
- Create Sequelize models
- Write reversible migrations
- Optimize queries and indexes
- Design audit logging schema
- Performance tuning and capacity planning

**Files They Own:**
- `backend/src/models/` — Sequelize models
- `backend/src/migrations/` — Migration files
- `docs/DATABASE/` — Schema documentation

**Rules:**
- All schemas documented in `docs/DATABASE/`
- Migrations must be reversible
- Foreign key constraints required
- Indexes created for frequently-queried columns
- Audit tables for all mutable entities
- No raw SQL (use ORM)

**Blocked By:**
- None (start with P1-02)

**Unlocks:**
- P1-01: Backend and frontend initialization

---

## Agent: Security Specialist

**Scope:** Authentication, authorization, compliance, audit

**Capabilities:**
- Design OIDC flows and session management
- Implement RBAC systems
- Create audit logging and compliance reports
- Design security controls and policies
- Perform security reviews
- Create incident response procedures

**Files They Own:**
- `backend/src/modules/auth/` — Authentication logic
- `backend/src/modules/roles/` — RBAC logic
- `backend/src/modules/audit/` — Audit logging
- `docs/SECURITY/` — Security specifications
- `MEMORY/DECISIONS.md` — Security-related ADRs

**Rules:**
- All security decisions documented in ADRs
- Every endpoint must enforce permissions
- Every data mutation must be logged
- No secrets in code or logs
- Regular security audits (quarterly)
- IDOR test coverage mandatory

**Blocked By:**
- None (parallel with database architect)

**Unlocks:**
- P1-03 through P1-07: Auth and RBAC implementation

---

## Agent: QA & Testing

**Scope:** Test strategy, test automation, quality assurance

**Capabilities:**
- Design test strategies and coverage
- Write unit, integration, and end-to-end tests
- Set up test infrastructure (Jest, Cypress)
- Test permission enforcement and tenant isolation
- Performance testing and benchmarking
- Create test data and fixtures

**Files They Own:**
- `backend/__tests__/` — Backend tests
- `frontend/__tests__/` — Frontend tests
- `e2e/` — End-to-end tests
- `scripts/test-*.js` — Test utilities

**Rules:**
- Minimum 80% code coverage for new code
- Every endpoint must have permission tests
- Every public flow must have e2e test
- Tests must be deterministic (no flakiness)
- Performance baseline tests required
- CI/CD blocks merge on test failure

**Blocked By:**
- P1-01: Base setup complete
- P1-02: Database ready
- P1-03: API endpoints ready

**Unlocks:**
- Continuous validation of all phases

---

## Agent: Documentation Writer

**Scope:** Specifications, API docs, guides

**Capabilities:**
- Write architectural specifications
- Create API documentation (OpenAPI/Swagger)
- Write operational guides and runbooks
- Create user documentation
- Maintain README files
- Document decisions and trade-offs

**Files They Own:**
- `docs/` — All specifications
- `MEMORY/DECISIONS.md` — ADRs
- `MEMORY/PROGRESS.md` — Progress tracking
- `TASKS/` — Task definitions and status
- `README.md` files in each package

**Rules:**
- Specs are source of truth before implementation
- API docs auto-generated from OpenAPI spec
- Every decision has an ADR
- Every task has a MEMORY record
- Documentation updated before code merge
- Links between related documents maintained

**Blocked By:**
- None (can start immediately)

**Unlocks:**
- Implementation guidance for all teams

---

## Agent: Technical Lead / Architect

**Scope:** Overall design, decisions, coordination

**Capabilities:**
- Make architectural decisions
- Review technical designs
- Approve PRs and merges
- Resolve cross-team conflicts
- Manage scope and priorities
- Maintain MEMORY and documentation

**Responsibilities:**
- Maintain `MEMORY/DECISIONS.md` with approved ADRs
- Update `MEMORY/PROGRESS.md` as phases complete
- Review and approve all PRs before merge
- Ensure compliance with established patterns
- Manage task prioritization and dependencies
- Escalate blockers and risks

**Files They Own:**
- `MEMORY/` — All memory documents
- `TASKS/PROGRESS.md` — Phase status
- `CONTEXT.md` — Project context
- `CLAUDE.md` — This file

**Rules:**
- One task at a time per team member
- No task starts without PR and review
- Main branch always deployable
- Breaking changes discussed with team first
- Monthly architecture reviews

**Decision Authority:**
- ADR approval
- Scope changes
- Priority adjustments
- Risk escalation

---

## Workflow: Task Assignment

### When a Task is Ready to Start

1. **Lead** marks in `TASKS/PROGRESS.md` as "In Progress"
2. **Lead** assigns to appropriate agent/person
3. **Agent** creates feature branch: `feat/P1-02-...`
4. **Agent** updates `MEMORY/PROGRESS.md`
5. **Agent** implements the task per spec
6. **Agent** creates task record in `MEMORY/records/`
7. **Agent** creates PR with documentation
8. **Lead** reviews and approves
9. **Agent** merges to main
10. **Lead** marks in `TASKS/PROGRESS.md` as "Completed"

---

## Workflow: Handling Blockers

### When a Task is Blocked

1. **Agent** documents blocker in PR comment
2. **Agent** updates `MEMORY/BLOCKERS.md`
3. **Lead** reviews and assigns to blocking task owner
4. **Blocking task** prioritized and moved to next sprint
5. **Blocked task** marked "Waiting" in task board
6. **Agent** can work on different task in parallel

### Blocker Escalation

- **Technical blocker:** Escalate to Technical Lead
- **Resource blocker:** Escalate to Project Manager
- **Dependency blocker:** Track in `MEMORY/BLOCKERS.md`

---

## Workflow: Code Review

### Reviewer Checklist

- [ ] Implements spec from `docs/`
- [ ] No obvious bugs or logic errors
- [ ] Tenant isolation verified (no cross-tenant data access)
- [ ] Permission checks present (ADR-026)
- [ ] Audit logging in place (ADR-009)
- [ ] Error handling covers edge cases
- [ ] Tests cover happy path, permissions, and edge cases
- [ ] No hardcoded secrets or credentials
- [ ] Follows project code style and patterns
- [ ] Database changes: migrations are reversible
- [ ] Type checking passes
- [ ] Linting passes
- [ ] Build succeeds
- [ ] Task record complete

### Approval Process

- Reviewer approves: "Looks good, approved for merge"
- Author merges: "Merging to main"
- Lead updates board: Move to "Completed"

---

## Workflow: Release

### Before Releasing a Phase

- [ ] All phase tasks completed and merged
- [ ] All tests passing (unit, integration, e2e)
- [ ] All documentation updated
- [ ] No open security issues
- [ ] Compliance audit completed
- [ ] Performance benchmarks met
- [ ] Team trained on new features
- [ ] Runbooks reviewed and tested
- [ ] Docker images tagged with version
- [ ] Kubernetes manifests validated

### Release Steps

1. Create release branch: `release/v1.0.0`
2. Update version numbers
3. Create release notes in `MEMORY/RELEASES/`
4. Tag commit: `git tag v1.0.0`
5. Push tag: `git push origin v1.0.0`
6. Build and push Docker images
7. Deploy to staging for final validation
8. Deploy to production
9. Monitor for errors and rollback if needed

---

## Cross-Team Coordination

### Daily Standup Topics

- What was completed yesterday
- What's being worked on today
- Any blockers or risks
- Any cross-team dependencies

### Weekly Planning

- Review `MEMORY/PROGRESS.md` and `TASKS/PROGRESS.md`
- Prioritize next tasks
- Identify and plan blockers
- Capacity planning for next sprint

### Monthly Architecture Review

- Review new ADRs
- Discuss technical debt
- Plan Phase N+1 work
- Compliance and security review

---

## Common Tasks by Agent

### Backend Engineer

- **P1-03:** OIDC Authentication
- **P1-04:** RBAC System
- **P1-05:** Tenant Context & Isolation
- **P1-06:** Session Management & Redis
- **P1-07:** Audit Logging
- **P1-08:** User Management Endpoints
- **P1-09:** Role & Permission Management

### Frontend Engineer

- **P1-10:** Dashboard & Main Layout
- **P2-04:** Warehouse UI
- **P3-07:** Calibration UI
- **Phase 5:** Real-time dashboards

### DevOps Engineer

- **P1-12:** Docker Setup
- **P1-13:** CI/CD Pipeline
- **Deploy:** Kubernetes manifests and deployment

### Database Architect

- **P1-02:** Database Schema & Migrations
- **Phase 2-5:** Schema extensions and optimization

### Security Specialist

- **P1-03:** OIDC Authentication design
- **P1-04:** RBAC design and implementation
- **P1-05:** Tenant isolation verification
- **P1-07:** Audit logging design

### QA & Testing

- **P1-01:** Test infrastructure setup
- **Continuous:** Test coverage for all features
- **Phase 5:** Performance testing and optimization

### Documentation Writer

- **P1-01:** Initial documentation structure
- **Continuous:** Spec updates during implementation
- **Phase completion:** Release notes and guides

### Technical Lead

- **Continuous:** ADR approval and architecture decisions
- **Weekly:** Planning and prioritization
- **Phase completion:** Release approval and deployment

---

## Escalation Path

```
Individual Agent
    ↓
Team Lead (for cross-team issues)
    ↓
Technical Lead (for architectural decisions)
    ↓
Project Manager (for resource/timeline issues)
```

---

## Communication Channels

- **Daily:** Slack #development channel
- **Weekly:** Architecture sync meeting
- **Code Review:** GitHub PR comments
- **Decisions:** `MEMORY/DECISIONS.md` ADRs
- **Progress:** `MEMORY/PROGRESS.md` and `TASKS/PROGRESS.md`
- **Issues:** `MEMORY/BLOCKERS.md`

---

## Questions?

Refer to:
- `CLAUDE.md` — How to work in this codebase
- `TASKS/00-TASK-CONVENTIONS.md` — Task conventions and guidelines
- `MEMORY/DECISIONS.md` — Architectural decisions with rationale
- `CONTEXT.md` — Project architecture and specifications
