# Claude — Operating Instructions for AI Agents

This document defines how Claude (and other AI agents) should work within this project.

---

## Project Context

**Hospital Device Calibration Platform** — Enterprise SaaS for multi-tenant hospital device calibration, maintenance, and lifecycle management.

- **Repository:** Monorepo (backend, frontend, admin, shared packages)
- **Stack:** Express.js + Next.js + PostgreSQL + Redis + RabbitMQ
- **Scale:** Multi-tenant, compliance-focused (ISO 17025, KARS, SNARS)
- **Phases:** 5-phase rollout from foundation to data lake analytics

---

## Before You Start

1. **Read these documents in order:**
   - `CONTEXT.md` — Project PRD, architecture, ERD, deployment
   - `MEMORY/DECISIONS.md` — All 28 architectural decision records
   - `MEMORY/PROGRESS.md` — What's been built so far
   - `TASKS/README.md` — Task list and blocking dependencies
   - `TASKS/00-TASK-CONVENTIONS.md` — Working conventions

2. **Understand the current phase:**
   - Check `MEMORY/PROGRESS.md` for what's completed
   - Look at `TASKS/PROGRESS.md` for next tasks
   - Review blocking dependencies before starting

3. **Know the constraints:**
   - Every endpoint must enforce tenant isolation (ADR-001)
   - Every data mutation must be audit logged (ADR-009)
   - RBAC checks required on all routes (ADR-026)
   - No breaking changes to API contracts (ADR-019)

---

## Your Role

### When to Act

- **Implement tasks** from `TASKS/README.md` when explicitly assigned
- **Fix bugs** discovered during development or testing
- **Research & analyze** codebase when asked questions
- **Write documentation** in `docs/` when specs need updating
- **Create task records** in `MEMORY/records/` when tasks complete

### When NOT to Act

- **Don't start tasks** that aren't explicitly assigned or next in queue
- **Don't modify architecture** without updating `MEMORY/DECISIONS.md`
- **Don't skip testing** or compliance checks
- **Don't commit to main** directly — always PR and code review
- **Don't make breaking API changes** without team discussion

---

## Task Execution Workflow

### Step 1: Understand the Spec

Before coding:
1. Read the task description in `TASKS/README.md`
2. Find the spec documents it references in `docs/`
3. Review related ADRs in `MEMORY/DECISIONS.md`
4. Check for blocking dependencies
5. Ask clarifying questions if needed

### Step 2: Plan the Implementation

Create a plan:
- What files will be created/modified?
- What database changes are needed?
- What API endpoints are added/changed?
- What tests are required?
- What compliance checks must pass?

### Step 3: Implement

Follow the conventions:
- Branch: `git checkout -b feat/{TASK_ID}-{description}`
- Commits: Include task ID in subject line
- Code style: Follow existing patterns in codebase
- TypeScript: No `any` types, strict mode
- Testing: Unit + integration tests required
- Linting: Must pass `pnpm lint` and `pnpm typecheck`

### Step 4: Verify

Before PR:
- `pnpm test` passes
- `pnpm typecheck` passes
- `pnpm lint` passes
- `pnpm build` succeeds
- Docker builds: `docker build -f backend/Dockerfile .`
- Database migrations work on clean DB
- No console.log or debugging code left

### Step 5: Document

Create task record:
- Create: `MEMORY/records/{TASK_ID}.md`
- Document: What was built, why, key decisions
- Update: `MEMORY/PROGRESS.md` with completion status
- Update: `TASKS/PROGRESS.md` task status

### Step 6: Submit

Create pull request:
- Title: `{TASK_ID}: Brief description`
- Description: Link to spec documents, testing performed, blockers
- Tag: `@team` for review
- Wait for approval before merge

---

## Code Quality Standards

### TypeScript

```typescript
// ✅ Good
async function getUserById(userId: string): Promise<User> {
  const user = await User.findByPk(userId);
  if (!user) {
    throw new NotFoundError('User not found');
  }
  return user;
}

// ❌ Bad
async function getUserById(userId: any): Promise<any> {
  const user = await User.findByPk(userId);
  return user;
}
```

### Error Handling

```typescript
// ✅ Good — specific error with context
if (!user) {
  throw new NotFoundError(`User ${userId} not found`);
}

// ❌ Bad — generic error
if (!user) {
  throw new Error('error');
}
```

### Tenant Isolation

```typescript
// ✅ Good — tenant filter enforced
const devices = await Device.findAll({
  where: {
    tenantId: req.tenant.id,
  },
});

// ❌ Bad — no tenant filter (SECURITY BUG)
const devices = await Device.findAll();
```

### Audit Logging

```typescript
// ✅ Good — log before/after state
await AuditLog.create({
  tenantId: req.tenant.id,
  userId: req.user.id,
  action: 'USER_CREATED',
  before: null,
  after: { id: user.id, email: user.email },
  timestamp: new Date(),
});

// ❌ Bad — no audit trail
user.update({ email: newEmail });
```

### Testing

```typescript
// ✅ Good — tests permission, tenant, and data
describe('GET /devices/:id', () => {
  it('returns device for authorized user in same tenant', async () => {
    // ...
  });

  it('forbids device access for user in different tenant', async () => {
    // ...
  });

  it('returns 404 for non-existent device', async () => {
    // ...
  });
});

// ❌ Bad — only happy path
describe('GET /devices/:id', () => {
  it('returns device', async () => {
    // ...
  });
});
```

---

## Compliance Checklist

Every task must include:

### Security
- No hardcoded secrets
- Input validation on all endpoints
- SQL injection prevention (parameterized queries)
- XSS prevention (HTML escaping, CSP headers)
- CSRF tokens on state-changing operations

### RBAC & Tenant Isolation
- Permission checks on all routes
- Tenant filter on all queries
- Test: cross-tenant access blocked
- Test: permission checks enforced

### Audit & Compliance
- All mutations logged with before/after state
- User attribution on all changes
- Timestamps on all audit entries
- Audit logs immutable (no deletes)

### Data Integrity
- Foreign key constraints in place
- Cascading deletes configured correctly
- Transaction handling for atomic operations
- Concurrent update conflicts prevented

---

## File Organization

### Backend Structure

```
backend/
  src/
    modules/
      auth/              # OIDC, tokens, sessions
      users/             # User CRUD
      roles/             # Role management
      devices/           # Device catalog
      calibration/       # Calibration workflows
      warehouse/         # Inventory management
      maintenance/       # Maintenance tracking
      audit/             # Audit logging
    middleware/          # Auth, tenant, error handling
    services/            # Business logic
    repositories/        # Database queries
    schemas/             # Request/response validation
    config/              # Environment configuration
    utils/               # Helpers and utilities
```

### Frontend Structure

```
frontend/
  src/
    app/                 # Next.js app directory
      auth/              # Login/logout pages
      dashboard/         # Main dashboard
      devices/           # Device management
      calibration/       # Calibration workflows
      warehouse/         # Inventory management
      admin/             # Admin settings
    components/          # Reusable React components
    hooks/               # Custom React hooks
    services/            # API calls, business logic
    types/               # TypeScript types
    utils/               # Helpers
```

---

## Git Workflow

### Branch Naming

```
feat/P1-05-tenant-context
feat/P2-01-warehouse-models
fix/P1-05-tenant-isolation-bug
docs/P1-11-api-documentation
```

### Commit Messages

```
P1-05: Implement tenant context middleware

- Extract tenant from JWT claims
- Attach to request object
- Enforce in database queries
- Add IDOR tests
```

### Before PR

```bash
pnpm typecheck    # Type checking
pnpm lint --fix   # Linting
pnpm test         # Tests
pnpm build        # Build
git push -u origin feat/P1-05-tenant-context
```

---

## Common Patterns

### Adding an API Endpoint

1. Define schema in `packages/schema/` with Zod
2. Add validation middleware
3. Implement handler with permission check
4. Add audit log on mutation
5. Update OpenAPI spec
6. Write tests (happy path, permission, edge cases)
7. Generate client SDK

### Database Migration

1. Create migration: `npm run migration:create --name add_field`
2. Write up() migration
3. Write down() rollback
4. Test on empty database
5. Test on database with existing data
6. Document in task record

### Adding a New Role

1. Add to `RoleEnum` in `packages/schema`
2. Add permissions to `PERMISSIONS` catalog in `docs/RBAC/`
3. Create seeding script for default permissions
4. Add UI role selector
5. Test permission enforcement
6. Update `MEMORY/DECISIONS.md` if architectural change

---

## Debugging

### Backend Issues

```bash
docker logs -f hospital-calibrator-api    # View logs
npm run db:psql                           # Connect to database
npm run migrate -- --verbose              # Migration debug
cat .env                                  # Check environment
```

### Frontend Issues

```bash
rm -rf .next                              # Clear Next.js cache
npm run dev -- --debug                    # Verbose logging
```

### Database Issues

```bash
psql postgresql://user:pass@localhost/calibrator   # Direct connection
npm run migrate:status                              # Migration status
npm run migrate:revert                              # Rollback last migration
```

---

## Success Criteria

A task is complete when:

1. ✅ Code implements the spec
2. ✅ Tests pass (unit + integration)
3. ✅ Types pass (`pnpm typecheck`)
4. ✅ Linting passes (`pnpm lint`)
5. ✅ Build succeeds (`pnpm build`)
6. ✅ RBAC enforced (if applicable)
7. ✅ Tenant isolation verified
8. ✅ Audit logging in place
9. ✅ Documentation updated
10. ✅ Task record created
11. ✅ PR approved by reviewer
12. ✅ Merged to main

---

## Resources

- **Architecture:** `CONTEXT.md`
- **Decisions:** `MEMORY/DECISIONS.md`
- **Progress:** `MEMORY/PROGRESS.md` and `TASKS/PROGRESS.md`
- **Specifications:** `docs/` directory
- **Conventions:** `TASKS/00-TASK-CONVENTIONS.md`
- **Task List:** `TASKS/README.md`
