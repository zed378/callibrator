# Task Conventions & Working Guidelines

How to work effectively in this project. Read this before starting any task.

---

## Branch & Commit Strategy

### Branch Naming

One branch per task, named with task ID:

```
feat/P1-02-rbac-system
feat/P2-01-warehouse-models
fix/P1-05-tenant-isolation-bug
docs/P1-11-api-documentation
```

Format: `{type}/{task-id}-{kebab-case-description}`

**Types:** `feat`, `fix`, `refactor`, `docs`, `chore`

**Task ID:** From `TASKS/README.md` (e.g., `P1-02`)

**Description:** Hyphenated, lowercase, 3-5 words

### Commit Messages

Commit subjects include task ID as join key:

```
P1-02: Implement RBAC system with role-permission assignments

P2-01: Add warehouse models and location hierarchy

P1-05: Fix tenant isolation query filters (bug fix)
```

Format: `{TASK_ID}: {concise description}`

**Guidelines:**
- First commit sets up the branch
- Logical commits group related changes
- One feature = one task = one branch = one PR

### Main Branch Protection

`main` stays clean and deployable:
- All development happens on feature branches
- PRs required for merge
- Automated CI checks before merge
- Task record created before merge

---

## Task Definition of Done

Every task must satisfy this checklist before merge:

### Code Quality
- [ ] Code written per spec in `docs/`
- [ ] Follows project conventions and style
- [ ] No console.log, debugger, or comments left behind
- [ ] Error handling covers edge cases
- [ ] Input validation on all endpoints

### Testing
- [ ] Unit tests written for new functions
- [ ] Integration tests for API endpoints
- [ ] Permission checks tested (RBAC, tenant isolation)
- [ ] All tests pass: `pnpm test`
- [ ] Test coverage > 80% for new code

### Type Safety
- [ ] TypeScript compiles without errors
- [ ] No `any` types used
- [ ] `pnpm typecheck` passes
- [ ] API contracts match implementation

### Linting & Formatting
- [ ] ESLint passes: `pnpm lint`
- [ ] Prettier formats code: `pnpm format`
- [ ] No unused variables or imports

### Build & Deployment
- [ ] `pnpm build` succeeds
- [ ] Docker builds successfully
- [ ] No breaking changes to API contracts
- [ ] Migrations tested on empty database

### Documentation
- [ ] `docs/` updated if architecture changes
- [ ] API spec (OpenAPI/Swagger) updated
- [ ] Inline code comments for complex logic
- [ ] README updated if new setup steps

### Compliance & Security
- [ ] RBAC checks enforced on new endpoints
- [ ] Tenant isolation verified (no cross-tenant leaks)
- [ ] Audit logging on data mutations
- [ ] Secrets not hardcoded or logged

### Memory & Tracking
- [ ] Task record created: `MEMORY/records/{TASK_ID}.md`
- [ ] MEMORY record documents:
  - What was implemented
  - Why it was done that way
  - Key decisions made
  - Any known limitations
- [ ] `MEMORY/PROGRESS.md` updated with completion
- [ ] `TASKS/PROGRESS.md` marked as "Completed"

### Git & PR
- [ ] Branch merged to main with squashed commits (optional)
- [ ] PR reviewed and approved
- [ ] No unresolved conversations
- [ ] Branch deleted after merge

---

## Task Record Template

Each completed task gets a record in `MEMORY/records/{TASK_ID}.md`:

```markdown
# Task Record: {TASK_ID} — {Title}

## What Was Implemented

Brief summary of what was built and why.

## Implementation Details

- **Files changed:** List key files
- **Database migrations:** Any schema changes
- **API endpoints:** New or modified endpoints
- **Dependencies added:** Any new npm packages

## Key Decisions

1. **Decision 1** — Why chosen, alternatives considered
2. **Decision 2** — Trade-offs and implications

## Testing

- Unit tests: X tests covering Y scenarios
- Integration tests: API endpoint validation
- Permission tests: RBAC and tenant isolation
- Manual testing: Steps to verify manually

## Known Limitations

- Limitation 1 and its impact
- Limitation 2 and mitigation plan

## Future Work

- Related tasks in next phase
- Performance optimization opportunities
- Feature extensions considered

## Review Notes

Comments from code review, approvals, or follow-ups.
```

---

## Parallel Work Strategy

Multiple tasks can run in parallel if they have no blocking dependencies:

### Phase 1 Parallelization
After P1-01 (Monorepo) and P1-02 (Database), these can run in parallel:
- P1-03 (OIDC Authentication)
- P1-04 (RBAC System)
- P1-05 (Tenant Context)
- P1-06 (Session Management)

### Phase 2 Parallelization
After P2-01 (Warehouse Models), these can run in parallel:
- P2-02 (Stock Tracking)
- P2-03 (Stock Opname)
- P2-04 (Warehouse UI)

**Key:** No two tasks modify the same files. Use different feature branches.

---

## Code Review Checklist

Reviewers must verify:

### Functionality
- [ ] Implements the spec correctly
- [ ] No obvious bugs
- [ ] Edge cases handled
- [ ] Error messages are clear

### Security & Compliance
- [ ] RBAC checks present
- [ ] Tenant isolation verified
- [ ] Audit logging in place
- [ ] No secrets in code

### Performance
- [ ] Database queries optimized
- [ ] No N+1 queries
- [ ] Reasonable pagination defaults
- [ ] Caching used appropriately

### Style & Maintainability
- [ ] Follows project conventions
- [ ] Code is readable and documented
- [ ] No technical debt introduced
- [ ] Tests are comprehensive

### Testing
- [ ] Test coverage adequate
- [ ] Happy path and edge cases tested
- [ ] Permission-based tests present
- [ ] Integration tests working

---

## Debugging & Troubleshooting

### Local Development

```bash
# Run everything
pnpm install      # Install dependencies
pnpm dev          # Start local dev (backend + frontend)

# Run individual checks
pnpm typecheck    # TypeScript validation
pnpm lint         # ESLint
pnpm test         # Jest tests
pnpm build        # Production build
```

### Database Issues

```bash
# Reset database to clean state
npm run db:reset  # (in backend)

# Run migrations
npm run migrate   # (in backend)

# Rollback last migration
npm run migrate:revert
```

### Viewing Logs

```bash
# Backend logs
docker logs -f hospital-calibrator-api

# Frontend dev server logs
pnpm dev          # Runs in terminal

# Database logs
docker logs -f hospital-calibrator-db
```

---

## Dependency Management

### Adding New Packages

```bash
# In root (affects all workspaces)
pnpm add lodash -w

# In specific workspace
pnpm add --filter backend lodash

# Dev dependency
pnpm add --filter backend @types/lodash -D
```

### Version Pinning

- Use exact versions (no `^` or `~`)
- Example: `"lodash": "4.17.21"` not `"^4.17.0"`
- Rationale: Reproducible builds, compliance audit trail

### Dependency Review

Before adding:
1. Check if package is necessary
2. Review package health (active maintenance, security issues)
3. Check for conflicts with existing packages
4. Document in task record why added

---

## Release Checklist

Before moving to next phase or releasing:

### All Blocking Tasks Complete
- [ ] P1-01 through P1-10 all in `main`
- [ ] No open PRs blocking phase start

### Testing Complete
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] Manual smoke tests passed
- [ ] Staging environment validated

### Documentation Complete
- [ ] All docs in `docs/` updated
- [ ] API spec (Swagger) current
- [ ] MEMORY records complete for all tasks
- [ ] README and setup guides current

### Compliance & Security
- [ ] No open security issues
- [ ] Audit logging verified
- [ ] RBAC and tenant isolation verified
- [ ] No hardcoded secrets

### Operational Readiness
- [ ] Docker images built and tagged
- [ ] Kubernetes manifests ready
- [ ] Monitoring alerts configured
- [ ] Runbooks reviewed

### Team Handoff
- [ ] Team trained on changes
- [ ] Support docs written
- [ ] On-call playbooks updated

---

## Common Patterns & Examples

### Adding a New API Endpoint

1. Define schema in `packages/schema`
2. Add Zod validation
3. Update OpenAPI spec
4. Implement endpoint in backend
5. Add permission check middleware
6. Add test with permission verification
7. Update frontend client
8. Add UI for endpoint

### Database Migration

1. Create migration file: `npm run migration:create`
2. Write up/down migrations
3. Add Sequelize model update
4. Test on empty database
5. Test on database with existing data
6. Document in task record

### Adding a New Role

1. Add role enum value
2. Create role seeding script
3. Assign default permissions
4. Add UI for role assignment
5. Test permission enforcement
6. Document in MEMORY

---

## When Things Go Wrong

### Merge Conflicts

```bash
# Update branch with main
git fetch origin
git rebase origin/main

# Resolve conflicts in editor
# Then continue
git rebase --continue
```

### Accidental Commits to Main

```bash
# Revert the commit
git revert <commit-hash>
git push

# Or if not pushed yet
git reset --soft HEAD~1
```

### Database Migration Failed

1. Stop all services
2. Restore from backup
3. Debug migration locally
4. Create new migration with fix
5. Retry on staging

### Test Suite Failing

```bash
# Run specific test file
pnpm test -- src/auth/auth.spec.ts

# Run with verbose output
pnpm test -- --verbose

# Clear test cache
pnpm test -- --clearCache
```

---

## Questions?

- Architecture decisions: See `MEMORY/DECISIONS.md`
- API contracts: See `docs/API/`
- Database schema: See `docs/DATABASE/`
- Running tasks: See `TASKS/PROGRESS.md`
- Project status: See `MEMORY/PROGRESS.md`
