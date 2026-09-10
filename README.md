# Hospital Device Calibration Platform

Enterprise-grade multi-tenant SaaS platform for hospital device calibration, maintenance, and lifecycle management.

## Quick Start

### Prerequisites

- Node.js >= 20 LTS
- pnpm >= 9.0
- Docker and Docker Compose (for local development)
- PostgreSQL (via Docker)
- Redis (via Docker)

### Local Development

```bash
# Install dependencies (monorepo)
pnpm install

# Start local services (PostgreSQL, Redis)
docker-compose -f backend/docker-compose.yaml up -d

# Run migrations
pnpm db:migrate

# Start development servers
pnpm dev
```

Services will be available at:
- Backend API: http://localhost:3000
- Frontend: http://localhost:3001
- Swagger UI: http://localhost:3000/api-docs

### Running Tests

```bash
# Run all tests
pnpm test

# Run specific workspace tests
pnpm test --filter backend

# Run with coverage
pnpm test:coverage

# Watch mode
pnpm test -- --watch
```

### Building

```bash
# Build all packages
pnpm build

# Build specific workspace
pnpm build --filter frontend

# Type checking
pnpm typecheck

# Linting
pnpm lint

# Format code
pnpm format
```

## Project Structure

```
.
├── backend/                # Express.js REST API
│   ├── src/
│   │   ├── modules/       # Feature modules (auth, devices, calibration, etc.)
│   │   ├── middleware/    # Express middleware
│   │   ├── migrations/    # Database migrations
│   │   └── ...
│   ├── __tests__/         # Unit and integration tests
│   └── Dockerfile
│
├── frontend/              # Next.js web application
│   ├── src/
│   │   ├── app/          # Next.js app directory
│   │   ├── components/   # React components
│   │   └── ...
│   ├── __tests__/        # Tests
│   └── Dockerfile
│
├── packages/             # Shared code
│   ├── schema/          # Zod schemas and validation
│   ├── ui/              # Shared UI components
│   ├── api-client/      # Generated API client
│   └── config/          # Shared configurations
│
├── docs/                # Specifications and architecture
├── MEMORY/              # Project memory and decisions
├── TASKS/               # Task definitions and tracking
│
├── CLAUDE.md            # Operating instructions for AI agents
├── AGENTS.md            # Agent definitions and workflows
├── pnpm-workspace.yaml  # Workspace configuration
├── turbo.json          # Build cache configuration
└── README.md           # This file
```

## Documentation

- **Architecture & Specifications:** See `docs/` directory
- **Architectural Decisions:** `MEMORY/DECISIONS.md` (28 ADRs)
- **Project Progress:** `MEMORY/PROGRESS.md`
- **Task Execution:** `TASKS/README.md` and `TASKS/PROGRESS.md`
- **Working Conventions:** `TASKS/00-TASK-CONVENTIONS.md`
- **AI Agent Guide:** `CLAUDE.md`
- **Agent Definitions:** `AGENTS.md`

## Development Workflow

### One Task at a Time

1. Pick next task from `TASKS/PROGRESS.md`
2. Create feature branch: `git checkout -b feat/P1-02-task-name`
3. Implement per spec in `docs/`
4. Ensure all tests pass: `pnpm test`
5. Create PR with task ID in title: `P1-02: Task name`
6. Get code review and approval
7. Merge to main
8. Create task record in `MEMORY/records/`
9. Update `MEMORY/PROGRESS.md` and `TASKS/PROGRESS.md`

### Branch & Commit Convention

```
Branch: feat/P1-02-rbac-system
Commit: P1-02: Implement RBAC system with role-permission assignments
```

See `TASKS/00-TASK-CONVENTIONS.md` for complete guidelines.

## Core Technologies

| Layer | Technology | Version |
|-------|-----------|---------|
| Backend | Express.js | 5.x |
| Frontend | Next.js | 16.x |
| Database | PostgreSQL | 14+ |
| Cache | Redis | 7+ |
| ORM | Sequelize | 6.x |
| Validation | Zod | Latest |
| Testing | Jest | 30.x |
| Build | Turbo | 2.x |
| Package Manager | pnpm | 9.x |

## Compliance & Security

- **Multi-tenant isolation** with application-level tenant context
- **RBAC (Role-Based Access Control)** with 7 core roles
- **OIDC Authentication** with session management
- **Audit logging** on all data mutations (ISO 17025, KARS compliance)
- **Row-level security** with encrypted credentials

## Project Phases

### Phase 1: Foundation (Current)
- Multi-tenant setup, authentication, RBAC
- Database schema, migrations, audit logging
- Main dashboard and navigation
- API documentation

### Phase 2: Warehouse & Inventory
- Warehouse and location models
- Stock tracking and transfers
- Stock opname (inventory counting)
- Warehouse UI

### Phase 3: Calibration & Devices
- Device catalog
- Calibration scheduling and work orders
- Results recording and certificates
- Device health scoring

### Phase 4: Enterprise SSO & Advanced
- SAML integration
- Vault-based secrets management
- Advanced analytics
- Bulk operations

### Phase 5: Analytics & Data Lake
- Real-time dashboards
- Predictive maintenance models
- Data lake integration
- Advanced compliance reporting

## Getting Help

### Questions About

- **Architecture:** Read `CONTEXT.md` and `MEMORY/DECISIONS.md`
- **APIs:** Check `docs/API/` and OpenAPI spec at `/api-docs`
- **Database:** See `docs/DATABASE/` and ER diagram
- **Security:** Review `docs/SECURITY/`
- **Tasks:** Refer to `TASKS/README.md` and blocking dependencies

### Common Commands

```bash
# View logs
docker logs -f hospital-calibrator-api
docker logs -f hospital-calibrator-db

# Connect to database
pnpm db:psql

# Check migrations status
cd backend && npm run migrate:status

# Clear all build artifacts
pnpm clean

# Run linting with auto-fix
pnpm lint --fix
```

## Contributing

1. Read working conventions in `TASKS/00-TASK-CONVENTIONS.md`
2. Understand the current phase from `MEMORY/PROGRESS.md`
3. Pick a task and create feature branch
4. Implement with tests and documentation
5. Submit PR for code review
6. Merge when approved and all checks pass

## License

MIT

## Support

For issues, refer to:
- Architecture decisions: `MEMORY/DECISIONS.md`
- Technical blockers: `MEMORY/BLOCKERS.md`
- Project status: `MEMORY/PROGRESS.md`
