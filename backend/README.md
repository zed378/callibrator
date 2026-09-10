# Callibrator Backend

A production-ready Express.js API with PostgreSQL, JWT authentication, RBAC, multi-tenancy, and Redis-based caching/queuing. Built for scalable SaaS applications with hospital device calibration management.

## Features

| Category              | Feature                                                       |
| --------------------- | ------------------------------------------------------------- |
| **Framework**         | Express.js v5, Node.js 18+                                    |
| **Database**          | PostgreSQL 14+ via Sequelize ORM                              |
| **Auth**              | JWT access (15m) + refresh (7d) tokens with rotation          |
| **Authorization**     | Dynamic RBAC with Role-Permission Matrix (O(1) cached lookup) |
| **Multi-Tenancy**     | Full isolation with feature flags per tenant                  |
| **Caching**           | Redis — RBAC permission matrix, tenant data, session cache    |
| **Rate Limiting**     | Token bucket (Redis-backed)                                   |
| **Queue**             | RabbitMQ — async email with DLQ, retry, exponential backoff   |
| **Distributed Locks** | Redis Lua scripts — race condition prevention                 |
| **Security**          | Helmet, CORS, HPP, XSS sanitizer, input validation (Joi)      |
| **Logging**           | Winston with daily rotating file logs                         |
| **API Docs**          | Swagger/OpenAPI (auto-generated)                              |
| **Backups**           | Per-tenant PostgreSQL dump with restore                       |
| **File Uploads**      | Multer — tenant logos, user avatars                           |
| **Audit**             | Tenant activity tracking via `TenantAuditLog`                 |
| **Sessions**          | Multi-device session management with auto-cleanup cron        |
| **Calibration**       | Device tracking, records, and digital certificate lifecycle   |
| **Stock**             | Warehouse inventory with transfers, adjustments, opname       |
| **Vendor**            | Third-party calibration labs and supplier CMMS integrations   |
| **Maintenance**       | Work orders and repairs for calibration equipment             |
| **Billing**           | Subscription plans and tenant-level invoices                  |
| **Notifications**     | System and user-specific alerts and unread counts             |
| **Audit**             | Immutable FDA 21 CFR Part 11 compliant audit logs             |
| **Kanban**            | Tenant-scoped project tracker — boards, columns, cards, sprints, realtime (`/api/v1/kanban`) |

## API Response Format

All endpoints return JSON:

**Success:**

```json
{ "success": true, "status": 200, "message": "Operation successful", "data": { ... } }
```

**Error:**

```json
{ "success": false, "status": 404, "message": "Resource not found" }
```

**Paginated:**

```json
{ "success": true, "status": 200, "message": "Success", "data": [...], "meta": { "total": 100, "page": 1, "limit": 20, "totalPages": 5 } }
```

## API Endpoints

### Authentication

| Method | Endpoint                            | Access  |
| ------ | ----------------------------------- | ------- |
| POST   | `/api/v1/auth/register`             | Public  |
| GET    | `/api/v1/auth/activation?token=xxx` | Public  |
| POST   | `/api/v1/auth/login`                | Public  |
| POST   | `/api/v1/auth/send-otp`             | Public  |
| POST   | `/api/v1/auth/reset-password`       | Public  |
| POST   | `/api/v1/auth/logout`               | Private |
| POST   | `/api/v1/auth/logout-all`           | Private |
| POST   | `/api/v1/auth/refresh`              | Private |
| GET    | `/api/v1/auth/verify`               | Private |
| POST   | `/api/v1/auth/just-update-password` | Private |
| GET    | `/api/v1/auth/pass-is-valid`        | Private |

### Users

| Method | Endpoint                       | Permission          |
| ------ | ------------------------------ | ------------------- |
| GET    | `/api/v1/users/all`            | User:read           |
| POST   | `/api/v1/users/detail`         | User:read           |
| POST   | `/api/v1/users/create`         | User:create         |
| PUT    | `/api/v1/users/edit`           | User:update         |
| DELETE | `/api/v1/users/delete`         | User:delete         |
| POST   | `/api/v1/users/role-update`    | User:role-update    |
| GET    | `/api/v1/users/username-check` | User:username-check |
| PUT    | `/api/v1/users/:id/avatar`     | User:avatar         |

### Roles

| Method | Endpoint                  | Permission  |
| ------ | ------------------------- | ----------- |
| GET    | `/api/v1/roles`           | Role:read   |
| GET    | `/api/v1/roles/all`       | Role:read   |
| POST   | `/api/v1/roles/detail`    | Role:read   |
| POST   | `/api/v1/roles/create`    | Role:create |
| PATCH  | `/api/v1/roles/edit`      | Role:update |
| DELETE | `/api/v1/roles/delete`    | Role:delete |
| GET    | `/api/v1/roles/:id/users` | Role:users  |

### Tenants

| Method | Endpoint                          | Permission            |
| ------ | --------------------------------- | --------------------- |
| GET    | `/api/v1/tenants/all`             | Tenant:read           |
| POST   | `/api/v1/tenants/detail`          | Tenant:read           |
| POST   | `/api/v1/tenants/create`          | Tenant:create         |
| PATCH  | `/api/v1/tenants/edit`            | Tenant:update         |
| DELETE | `/api/v1/tenants/delete`          | Tenant:delete         |
| POST   | `/api/v1/tenants/:id/upload-logo` | -                     |
| GET    | `/api/v1/tenants/:id/features`    | Tenant:feature        |
| PATCH  | `/api/v1/tenants/:id/features`    | Tenant:feature-update |

### Tenant Backups

| Method | Endpoint                                   | Permission    |
| ------ | ------------------------------------------ | ------------- |
| GET    | `/api/v1/tenants/:id/backups`              | Tenant:backup |
| GET    | `/api/v1/tenants/:id/backups/:id`          | Tenant:backup |
| GET    | `/api/v1/tenants/:id/backups/:id/download` | Tenant:backup |
| POST   | `/api/v1/tenants/:id/backups/:id/restore`  | Tenant:backup |
| GET    | `/api/v1/tenants/:id/backups/stats`        | Tenant:backup |

### Sessions

| Method | Endpoint                                   | Permission     |
| ------ | ------------------------------------------ | -------------- |
| GET    | `/api/v1/sessions/stats`                   | Session:read   |
| GET    | `/api/v1/sessions`                         | Session:read   |
| GET    | `/api/v1/sessions/:id`                     | Session:read   |
| POST   | `/api/v1/sessions/:id/revoke`              | Session:revoke |
| POST   | `/api/v1/sessions/user/:userId/revoke-all` | Session:revoke |

### Calibration Devices

| Method | Endpoint                          | Permission               |
| ------ | --------------------------------- | ------------------------ |
| GET    | `/api/v1/calibration-devices`     | CalibrationDevice:read   |
| POST   | `/api/v1/calibration-devices`     | CalibrationDevice:create |
| GET    | `/api/v1/calibration-devices/:id` | CalibrationDevice:read   |
| PUT    | `/api/v1/calibration-devices/:id` | CalibrationDevice:update |
| DELETE | `/api/v1/calibration-devices/:id` | CalibrationDevice:delete |

### Calibration Records

| Method | Endpoint                          | Permission               |
| ------ | --------------------------------- | ------------------------ |
| GET    | `/api/v1/calibration-records`     | CalibrationRecord:read   |
| POST   | `/api/v1/calibration-records`     | CalibrationRecord:create |
| GET    | `/api/v1/calibration-records/:id` | CalibrationRecord:read   |
| PUT    | `/api/v1/calibration-records/:id` | CalibrationRecord:update |
| DELETE | `/api/v1/calibration-records/:id` | CalibrationRecord:delete |

### Certificates

| Method | Endpoint                           | Permission          |
| ------ | ---------------------------------- | ------------------- |
| GET    | `/api/v1/certificates`             | Certificate:read    |
| POST   | `/api/v1/certificates`             | Certificate:create  |
| GET    | `/api/v1/certificates/:id`         | Certificate:read    |
| PUT    | `/api/v1/certificates/:id`         | Certificate:update  |
| DELETE | `/api/v1/certificates/:id`         | Certificate:delete  |
| POST   | `/api/v1/certificates/:id/approve` | Certificate:approve |
| POST   | `/api/v1/certificates/:id/sign`    | Certificate:sign    |
| POST   | `/api/v1/certificates/:id/revoke`  | Certificate:revoke  |
| GET    | `/api/v1/certificates/stats`       | Certificate:read    |

### Stock & Warehouse

| Method | Endpoint              | Permission       |
| ------ | --------------------- | ---------------- |
| GET    | `/api/v1/stock/*`     | Stock:read       |
| POST   | `/api/v1/stock/*`     | Stock:create     |
| GET    | `/api/v1/warehouse/*` | Warehouse:read   |
| POST   | `/api/v1/warehouse/*` | Warehouse:create |

### Additional Modules

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| GET    | `/api/v1/vendors` | Fetch vendors (Calibration Labs, Suppliers) |
| GET    | `/api/v1/maintenance` | Fetch CMMS work orders |
| GET    | `/api/v1/notifications` | Fetch system notifications |
| GET    | `/api/v1/billing/subscription` | Fetch active billing plan |
| POST   | `/api/v1/billing/webhook` | Stripe subscription lifecycle webhook |
| GET    | `/api/v1/audit` | Fetch immutable FDA CFR Part 11 audit logs |
| GET    | `/api/v1/api-keys` | Manage scoped API keys |
| GET    | `/api/v1/kanban/projects` | Tenant-scoped Kanban project tracker (boards, sprints, cards) |
| WSS    | `/` | Socket.io Real-time connection via JWT handshake |

### Health Checks

| Endpoint  | Description           |
| --------- | --------------------- |
| `/`       | API status            |
| `/health` | Database connectivity |
| `/ready`  | Readiness probe       |
| `/live`   | Liveness probe        |

### Documentation

| Endpoint         | Description        |
| ---------------- | ------------------ |
| `/docs`          | Swagger UI         |
| `/documentation` | HTML documentation |

### Internal (Development Only)

| Method  | Endpoint                       | Description            |
| ------- | ------------------------------ | ---------------------- |
| GET     | `/api/v1/migration/up`         | Run migrations         |
| GET     | `/api/v1/migration/seeding`    | Seed data              |
| Console | `node src/scripts/reset-db.js` | Drop + recreate + seed |

## Project Structure

```
backend/
├── src/
│   ├── config/          # Database & app config
│   ├── constants/       # Centralized constants
│   ├── controllers/     # Request handlers
│   ├── docs/            # Swagger configuration
│   ├── middlewares/     # Express middlewares
│   ├── models/          # Sequelize models
│   ├── routes/          # API route definitions
│   ├── services/        # Business logic
│   ├── templates/       # Email HTML templates
│   ├── tests/           # Jest tests
│   ├── utils/           # Utility functions
│   └── validators/      # Joi validation schemas
├── docs/                # Markdown documentation
├── uploads/             # Uploaded files
├── Dockerfile
├── docker-compose.yaml
├── package.json
└── index.js
```

## Getting Started

### Prerequisites

- **Node.js** 18+
- **PostgreSQL** 14+
- **Redis** 7+
- **RabbitMQ** 3.13+ (for email queue)

### Quick Start

```bash
git clone https://github.com/zed378/callibrator-be.git
cd callibrator-be
npm install
cp .env.example .env
# Edit .env to set required values (JWT secrets, etc.)
npm run dev
```

### Environment Variables

| Variable             | Description          | Default                  |
| -------------------- | -------------------- | ------------------------ |
| `NODE_ENV`           | Environment          | `development`            |
| `PORT`               | Server port          | `3000`                   |
| `DB_HOST`            | Database host        | `localhost`              |
| `DB_PORT`            | Database port        | `5432`                   |
| `DB_NAME`            | Database name        | `callibrator`            |
| `DB_USER`            | Database user        | `callibrator`            |
| `DB_PASS`            | Database password    | -                        |
| `DB_DIALECT`         | PostgreSQL/MySQL     | `postgres`               |
| `DB_SSL`             | Enable SSL           | `false`                  |
| `REDIS_URL`          | Redis connection     | `redis://localhost:6379` |
| `JWT_ACCESS_SECRET`  | Access token secret  | **required**             |
| `JWT_REFRESH_SECRET` | Refresh token secret | **required**             |

### Docker Compose

```yaml
version: "3.8"
services:
  postgres:
    image: postgres:17-alpine
    ports:
      - "5432:5432"
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
  rabbitmq:
    image: rabbitmq:3.13-management
    ports:
      - "5672:5672"
      - "15672:15672"
```

### Scripts

| Command                    | Description                       |
| -------------------------- | --------------------------------- |
| `npm run dev`              | Development server (nodemon)      |
| `npm start`                | Production server                 |
| `npm test`                 | Jest test suite                   |
| `npm run swagger:generate` | Generate swagger.json             |
| `npm run build`            | Package executable (Bun compiler) |

## Authentication Flow

1. **Authentication**: Users authenticate and receive a short-lived access token (15m) and a secure refresh token (7d).
2. **Request Context**: Every API request includes `Authorization: Bearer <token>`.
3. **Middleware Chain**: The authentication middleware validates the JWT, loads user state, and enforces session validity.
4. **Authorization (RBAC)**: The `dynamicAccess` or `rbac` middleware enforces boundary rules. Dynamic RBAC constructs a permission matrix that is heavily cached in Redis for O(1) route verification without N+1 query bottlenecks. Menu assignments DO NOT block route access; they strictly govern UI visibility in the frontend dashboard.
5. **Tenant Isolation**: The multi-tenant architecture strictly enforces data isolation by bounding queries to the authenticated user's `tenant_id`.

## License

MIT
