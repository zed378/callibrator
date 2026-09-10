# Coding Context Summary - Callibrator Platform

> **Master reference file for AI agents and developers.** Contains complete project architecture, coding standards, and patterns for efficient future interactions.

---

## 1. Project Overview

**Callibrator** is a multi-tenant SaaS platform with:

- **Backend**: Node.js + Express v5 + PostgreSQL (ORM: Sequelize)
- **Frontend**: Next.js 16 + TypeScript + Tailwind CSS + Light/Dark mode
- **Authentication**: JWT-based with session management
- **RBAC**: Role-Based Access Control with granular permissions
- **ABAC**: Attribute-Based Access Control for dynamic table permissions
- **Menu System**: Three-tier hierarchical menu with per-role and per-user grants
- **Model Discovery**: Auto-detects and registers database models for dynamic permissions

---

## 2. Directory Structure

### Backend (`backend/`)

```
backend/
├── docs/
│   ├── CODING_STANDARDS.md       # Master coding standards guide
│   ├── CODING_CONTEXT.md         # This file - project context summary
│   ├── DOCUMENTATION.md          # Markdown documentation
│   ├── DOCUMENTATION.html        # Generated HTML documentation
│   ├── TABLE_PERMISSIONS.md      # Table permissions documentation
│   └── illustrations/            # SVG diagrams
├── scripts/                      # Utility scripts (HTML generation, SVG generation)
├── src/
│   ├── config/                   # Database, JWT, CORS, Redis, RabbitMQ config
│   │   └── index.js              # Main config export
│   ├── constants/                # Centralized constants
│   │   ├── index.js              # Main constants export
│   │   ├── appConstants.js       # Pagination, OTP, password settings
│   │   ├── roleConstants.js      # Role names, IDs, levels, hierarchy
│   │   └── permissionConstants.js # Permission naming conventions
│   ├── controllers/              # Request handlers (use asyncHandlerWithMapping)
│   │   ├── auth.controller.js
│   │   ├── menuGroup.controller.js
│   │   ├── migration.controller.js
│   │   ├── modelDiscovery.controller.js
│   │   ├── permission.controller.js
│   │   ├── roles.controller.js
│   │   ├── tablePermission.controller.js
│   │   ├── tenant.controller.js
│   │   ├── tenantBackup.controller.js
│   │   └── user.controller.js
│   ├── docs/                     # Swagger configuration
│   ├── middlewares/              # Express middlewares
│   │   ├── abac.js               # ABAC authorization
│   │   ├── accessLog.js          # Access logging
│   │   ├── activityLog.js        # Activity logging (logger instance)
│   │   ├── auth.js               # JWT authentication
│   │   ├── backup.js             # Backup middleware
│   │   ├── createFolder.js       # Folder creation
│   │   ├── dynamicAccess.js      # Dynamic authorization
│   │   ├── errorHandlers.js      # Global error handling
│   │   ├── globalSanitizer.js    # Input sanitization
│   │   ├── inputValidation.js    # Input validation
│   │   ├── modelDiscoveryCron.js # Model discovery cron job
│   │   ├── notFound.js           # 404 handler
│   │   ├── rbac.js               # RBAC authorization
│   │   ├── sessionCleanup.js     # Session cleanup scheduler
│   │   ├── tenantContext.js      # Tenant identification
│   │   ├── tenantScope.js        # Query tenant scoping
│   │   ├── tokenRateLimiter.js   # Token rate limiting
│   │   └── validation.js         # Validation middleware
│   ├── models/                   # Sequelize models (auto-loaded via index.js)
│   ├── routes/
│   │   ├── api/                  # Public API routes (Swagger docs live HERE)
│   │   │   ├── auth.js
│   │   │   ├── menuGroup.js
│   │   │   ├── modelDiscovery.js
│   │   │   ├── permission.js
│   │   │   ├── roles.js
│   │   │   ├── session.js
│   │   │   ├── tablePermission.js
│   │   │   ├── tenant.js
│   │   │   ├── tenantBackup.js
│   │   │   └── user.js
│   │   └── internal/             # Internal routes
│   ├── services/                 # Business logic layer
│   │   ├── auth.service.js
│   │   ├── email.service.js
│   │   ├── emailQueue.service.js
│   │   ├── menuGroupRole.service.js
│   │   ├── migration.service.js
│   │   ├── modelDiscovery.service.js
│   │   ├── permission.service.js
│   │   ├── permissionAssignment.service.js
│   │   ├── rateLimiter.service.js
│   │   ├── redis.service.js      # Redis caching, locking, queues
│   │   ├── roles.service.js
│   │   ├── session.service.js
│   │   ├── tablePermission.service.js
│   │   ├── tenant.service.js
│   │   ├── tenantAudit.service.js
│   │   ├── tenantBackup.service.js
│   │   ├── tenantFeature.service.js
│   │   ├── tenantOnboarding.service.js
│   │   ├── tenantUpload.service.js
│   │   ├── user.service.js
│   │   ├── userUpload.service.js
│   │   └── userMenuGrant.service.js
│   ├── templates/                # Email HTML templates (Mustache)
│   ├── tests/                    # Jest tests (100% coverage target)
│   │   ├── middleware/
│   │   ├── services/
│   │   ├── utils/
│   │   ├── validators/
│   │   └── test.utils.js         # Shared test helpers
│   ├── utils/                    # Utility functions
│   │   ├── constants.js          # Backward compatibility re-exports
│   │   ├── controllerWrapper.js  # asyncHandler, asyncHandlerWithMapping
│   │   ├── response.js           # success, error, login, paginated helpers
│   │   ├── seedMenuGroups.js     # Menu groups and items seeding
│   │   ├── seedPermissions.js    # Permission seeding utility
│   │   ├── seedTablePermissions.js # Table permissions seeding
│   │   ├── upload.js             # File upload utilities
│   │   └── userAvatar.js         # User avatar utilities
│   └── validators/               # Joi validation schemas (MUST exist for ALL endpoints)
│       ├── auth.validator.js
│       ├── menuGroup.validator.js
│       ├── tablePermission.validator.js
│       └── user.validator.js
├── .env                          # Environment variables
├── local.env                     # Local development env
├── docker-compose.yaml           # Docker services
├── Dockerfile                    # Container definition
├── jest.config.js                # Test configuration
├── package.json
├── swagger.json                  # Generated Swagger documentation
└── index.js                      # Application entry point
```

### Frontend (`frontend/`)

```
frontend/
├── src/
│   ├── app/                  # Next.js 16 App Router pages
│   │   ├── (auth)/           # Auth pages (login, register, etc.)
│   │   ├── (dashboard)/      # Dashboard pages
│   │   └── layout.tsx        # Root layout
│   ├── api/                  # API client (client.ts)
│   ├── components/           # UI components
│   │   ├── layouts/          # Dashboard layout, auth layout
│   │   └── ui/               # Base UI components
│   │       └── ThemeToggle.tsx   # Light/dark mode toggle
│   ├── constants/            # App constants
│   ├── contexts/             # React contexts
│   │   └── ThemeContext.tsx  # Theme context (light/dark)
│   ├── hooks/                # Custom hooks
│   │   ├── useTablePermissions.ts
│   │   └── useTenantBranding.ts
│   ├── stores/               # Zustand stores
│   │   ├── authStore.ts
│   │   ├── menuStore.ts
│   │   ├── permissionStore.ts
│   │   ├── roleStore.ts
│   │   ├── tenantStore.ts
│   │   └── userStore.ts
│   ├── types/                # TypeScript type definitions
│   └── utils/                # Utility functions
├── public/                   # Static assets
├── next.config.ts            # Next.js configuration
├── eslint.config.mjs
├── postcss.config.mjs
├── tsconfig.json
└── package.json
```

---

## 3. Backend Architecture Patterns

### Controller Pattern

- Use `asyncHandlerWithMapping` wrapper (NEVER raw async functions)
- Import from `../utils/controllerWrapper`
- Response via `success()`, `error()`, `badRequest()`, `login()` helpers
- Error mapping for HTTP status codes via second argument
- **NEVER include `@swagger` JSDoc comments** - Swagger docs belong in route files

```javascript
// CORRECT
const { asyncHandlerWithMapping } = require("../utils/controllerWrapper");
const { success } = require("../utils/response");
const {
  validateUserSchema,
  validate,
} = require("../validators/user.validator");

exports.getUsers = asyncHandlerWithMapping(
  async (req, res) => {
    const { error, value } = validate(req.query, validateUserSchema);
    if (error) throw { status: 400, message: error.details[0].message };
    const result = await userService.getAllUsers(value);
    success(res, result.data, result.meta, "Users fetched", 200);
  },
  {
    notFound: 404,
    unauthorized: 401,
  },
);
```

### Service Pattern

- Pure business logic, NO Express req/res objects
- Return objects: `{ data, message, status, meta }`
- Use transactions for multi-step operations
- Throw errors as: `{ status: code, message: "text" }`
- Use Redis for caching, locking, and queues

### Validation Pattern

- **ALL request bodies, queries, and params MUST have Joi validation schemas**
- Validators live in `backend/src/validators/` (e.g., `user.validator.js`, `menuGroup.validator.js`)
- Controllers **import schemas and the `validate` helper** from validators
- Never define validation inline in controllers
- Validators export: `schemaName`, `validate(body, schema)`, `formatErrors(details)`

```javascript
// backend/src/validators/user.validator.js
const Joi = require("joi");

const createUserSchema = Joi.object({
  username: Joi.string().min(3).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
});

const validate = (body, schema) => {
  return schema.validate(body, { abortEarly: false, stripUnknown: true });
};

const formatErrors = (details) => {
  return details.map((item) => ({
    field: item.path.join("."),
    message: item.message,
  }));
};

module.exports = { createUserSchema, validate, formatErrors };
```

### Swagger Documentation Pattern

**CRITICAL: Swagger documentation MUST be in route files, NOT controller files.**

```javascript
// backend/src/routes/api/user.js
const express = require("express");
const router = express.Router();
const { controller } = require("../../controllers/user.controller");
const { auth } = require("../../middlewares/auth");

/**
 * @swagger
 * /api/v1/users:
 *   get:
 *     summary: Get all users
 *     tags: [Users]
 *     security: [bearerAuth: []]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *     responses:
 *       200:
 *         description: Users fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: array }
 *                 meta: { type: object }
 */
router.get("/users", auth, controller.getAllUsers);

module.exports = router;
```

**Swagger Rules:**

- Use `/* ... */` for Swagger `@swagger` declarations
- Use `/** ... */` for `@summary`, `@description`, `@method`, `@route`, `@access`
- Controllers must NEVER contain `@swagger` JSDoc comments

### Model Pattern

- Sequelize ORM with associations defined in `associate()` methods
- Models in `backend/src/models/`
- `src/models/index.js` only imports, collects, and exports models
- Associations are called via loop in index.js: `models[key].associate(models)`
- Use `findOrCreate` pattern for seed data
- Use transactions for multi-step operations

### Seeder Pattern

- Main entry: `src/services/migration.service.js`
- Exports: `seedAll()`, `seedDefaultRoles()`, `seedPermissions()`, `seedUsers()`, etc.
- Individual seeders in `src/utils/seed*.js`
- Uses `logger` from activityLog middleware
- CLI wrapper: `backend/run-seed.js`

### Logging Pattern

- Use `logger` from `../middlewares/activityLog`
- **NEVER use `console.log` anywhere in backend**
- Log levels: info, error, warn, debug

### Caching Pattern

```javascript
const { get, set, del, delPattern } = require("../services/redis.service");

// Get from cache
const cachedData = await get(cacheKeys.userByEmail(email));

// Set to cache with TTL
await set(cacheKeys.userByEmail(email), data, 86400);

// Delete from cache
await del(cacheKeys.userByEmail(email));

// Delete pattern
await delPattern(`cache:user:*`);
```

### Distributed Lock Pattern

```javascript
const { acquireLock, releaseLock } = require("../services/redis.service");

const lockId = await acquireLock(`lock:key`, 5000); // 5s TTL
if (!lockId) throw { status: 429, message: "Operation in progress" };

try {
  // Critical section
} finally {
  await releaseLock(`lock:key`, lockId);
}
```

---

## 4. Permission System

### Permission Types

1. **Global**: `module:action` (e.g., `user:create`, `tenant:read`)
2. **Self**: `module:self:action` (e.g., `user:self:update`)
3. **Tenant**: `module:tenant:action` (e.g., `user:tenant:create`)

### Role Hierarchy

| Role         | Level | Auto Grants                             |
| ------------ | ----- | --------------------------------------- |
| SUPER_ADMIN  | 10    | All permissions implicitly (middleware) |
| TENANT_ADMIN | 2     | Tenant-scoped permissions               |
| USER         | 1     | Self permissions only                   |

### Menu System (Three-Tier)

```
Menu Groups (groups)
└── Menu Items (items within groups)
    └── Menu Group Roles (assign groups to roles)
        └── User Menu Grants (assign individual items to users)
```

- `menu_groups` - Top-level groupings (e.g., "Management", "Security")
- `menu_items` - Individual menu entries with `group_id`
- `menu_group_roles` - Assign groups to roles
- `menu_item_roles` - Assign individual items to roles
- `user_menu_grants` - Per-user grants with types: `menu-group`, `menu-item`, `block-group`, `block-item`
- **Important Note on Menu Flow**: Menu assignments (whether via roles or direct user grants) strictly govern **UI visibility** in the frontend dashboard sidebar. They **do not** block frontend route access. A user can still access a hidden route if they navigate to it directly (route access is protected by backend RBAC permissions instead). Unassigned items are simply hidden from the menu response.
- SUPER_ADMIN gets ALL menus automatically (no explicit grants needed)

### Grant Types

| Grant Type    | Behavior                                                          |
| ------------- | ----------------------------------------------------------------- |
| `menu-group`  | User can see the entire menu group and its active items           |
| `menu-item`   | User can see this specific menu item (shown as target in sidebar) |
| `block-group` | User cannot see this menu group (overrides grants)                |
| `block-item`  | User cannot see this menu item (overrides grants)                 |

### Model Discovery

- Auto-detects and registers database models/tables at startup
- `ModelDiscoveryService` scans all models via `src/services/modelDiscovery.service.js`
- Registered models stored in `Models` table
- Enables dynamic table permission system
- Cron-based re-discovery available via `modelDiscoveryCron.js`

### Table Permissions (Dynamic RBAC/ABAC)

- `table_permissions` - Model-level permissions (create, read, update, delete, export, import)
- `role_table_permissions` - Role-to-table-permission assignments
- `tenant_role_table_permissions` - Tenant role-to-table-permission assignments with ABAC rules
- Supports scope: `global`, `tenant`, `self`, `custom`
- Supports ABAC rules for attribute-based conditions

### Permission Constants

Located in `backend/src/constants/index.js`:

- `USER_PERMISSIONS` - User module permission names
- `TENANT_PERMISSIONS` - Tenant module permission names
- `ROLE_NAMES`, `ROLE_IDS`, `ROLE_LEVELS` - Role definitions
- `BUILTIN_ROLES` - Built-in role names

---

## 5. Frontend Architecture

### State Management

- **Zustand stores** in `frontend/src/stores/`
  - `authStore.ts` - Authentication state
  - `userStore.ts` - User profile
  - `menuStore.ts` - Menu data (respects per-user grants)
  - `roleStore.ts` - Role data
  - `permissionStore.ts` - Permission state
  - `tenantStore.ts` - Tenant data

### Theme System

- Context-based in `frontend/src/contexts/ThemeContext.tsx`
- Toggle via `ThemeToggle.tsx` component
- CSS variables in `frontend/src/app/globals.css`
- Dark mode class on `<html>` element
- Storage key: `hdc-theme-preference`
- Default theme: `dark`
- System preference detected via `prefers-color-scheme`

### API Client

- Centralized in `frontend/src/api/client.ts`
- Uses fetch with JWT token from auth store
- Tenant branding via `TenantBrandingProvider`

### Design System

- **Tailwind CSS** with custom design tokens
- **Colors**: Indigo (primary), Violet (secondary), Cyan (accent)
- **Fonts**: Inter (sans), JetBrains Mono (mono)
- **Effects**: Glassmorphism, gradients, animated backgrounds
- Components follow glass, card, button, input patterns from globals.css

### Hooks

- `useTablePermissions.ts` - Table-level permission checking
- `useTenantBranding.ts` - Tenant-specific branding

### Layouts

- Located in `frontend/src/components/layouts/`
- Dashboard layout with sidebar navigation
- Auth layout for login/registration pages

---

## 6. Coding Standards Checklist

### Backend

- [ ] No `console.log` anywhere (use `logger`)
- [ ] ALL endpoints have Joi validation in `src/validators/`
- [ ] Controllers use `asyncHandlerWithMapping`
- [ ] Services return `{ data, message, status }` objects
- [ ] Models use Sequelize patterns with `associate()` methods
- [ ] Seeder functions use logger
- [ ] Swagger docs in route files ONLY (not controllers)
- [ ] Error responses use `error()` helper
- [ ] Success responses use `success()` helper
- [ ] Constants imported from `src/constants/`
- [ ] Transactions for multi-step operations

### Frontend

- [ ] TypeScript strict mode
- [ ] Client components use "use client" directive
- [ ] Server components by default
- [ ] Theme context for light/dark mode
- [ ] Zustand for state management
- [ ] No console.log
- [ ] Tailwind classes for styling
- [ ] Custom design tokens from globals.css

### General

- [ ] Meaningful commit messages
- [ ] NO dead code
- [ ] NO hardcoded values (use constants/config)
- [ ] Tests for all business logic
- [ ] Documentation updated

---

## 7. API Endpoints Overview

### Auth

| Method | Endpoint                       | Description             |
| ------ | ------------------------------ | ----------------------- |
| POST   | `/api/v1/auth/register`        | Register new user       |
| POST   | `/api/v1/auth/activate`        | Activate account        |
| POST   | `/api/v1/auth/login`           | Login                   |
| POST   | `/api/v1/auth/send-otp`        | Send OTP                |
| POST   | `/api/v1/auth/reset-password`  | Reset password          |
| POST   | `/api/v1/auth/logout`          | Logout session          |
| POST   | `/api/v1/auth/logout-all`      | Logout all sessions     |
| GET    | `/api/v1/auth/verify`          | Verify session          |
| PATCH  | `/api/v1/auth/update-password` | Update password         |
| POST   | `/api/v1/auth/check-password`  | Check password validity |

### Users

| Method | Endpoint                       | Description                  |
| ------ | ------------------------------ | ---------------------------- |
| GET    | `/api/v1/users`                | List users (paginated)       |
| POST   | `/api/v1/users/detail`         | Get user by ID               |
| POST   | `/api/v1/users`                | Create user                  |
| PATCH  | `/api/v1/users`                | Edit user                    |
| DELETE | `/api/v1/users`                | Delete user                  |
| POST   | `/api/v1/users/role`           | Update user role             |
| POST   | `/api/v1/users/check-username` | Check username availability  |
| POST   | `/api/v1/users/avatar/:userId` | Upload avatar                |
| DELETE | `/api/v1/users/avatar/:userId` | Remove avatar                |
| GET    | `/api/v1/users/simple`         | Simple user list (dropdowns) |

### Tenants

| Method | Endpoint                         | Description      |
| ------ | -------------------------------- | ---------------- |
| GET    | `/api/v1/tenants`                | List tenants     |
| POST   | `/api/v1/tenants/detail`         | Get tenant by ID |
| POST   | `/api/v1/tenants`                | Create tenant    |
| PATCH  | `/api/v1/tenants`                | Update tenant    |
| DELETE | `/api/v1/tenants`                | Delete tenant    |
| POST   | `/api/v1/tenants/settings`       | Get settings     |
| PATCH  | `/api/v1/tenants/settings`       | Update settings  |
| POST   | `/api/v1/tenants/user-count`     | Get user count   |
| POST   | `/api/v1/tenants/logo/:tenantId` | Upload logo      |
| DELETE | `/api/v1/tenants/logo/:tenantId` | Remove logo      |

### Roles

| Method | Endpoint                        | Description            |
| ------ | ------------------------------- | ---------------------- |
| GET    | `/api/v1/roles`                 | List roles             |
| POST   | `/api/v1/roles/detail`          | Get role by ID         |
| POST   | `/api/v1/roles`                 | Create role            |
| PATCH  | `/api/v1/roles`                 | Update role            |
| DELETE | `/api/v1/roles`                 | Delete role            |
| GET    | `/api/v1/roles/:id/permissions` | Get role permissions   |
| PUT    | `/api/v1/roles/:id/permissions` | Assign permissions     |
| DELETE | `/api/v1/roles/:id/permissions` | Revoke all permissions |
| GET    | `/api/v1/roles/:id/users`       | Get role users         |

### Permissions

| Method | Endpoint                     | Description          |
| ------ | ---------------------------- | -------------------- |
| GET    | `/api/v1/permissions`        | List permissions     |
| POST   | `/api/v1/permissions/detail` | Get permission by ID |
| POST   | `/api/v1/permissions`        | Create permission    |
| PATCH  | `/api/v1/permissions`        | Update permission    |
| DELETE | `/api/v1/permissions`        | Delete permission    |

### Menu Groups

| Method | Endpoint                                      | Description                  |
| ------ | --------------------------------------------- | ---------------------------- |
| GET    | `/api/v1/menu-groups`                         | Get all menu groups          |
| GET    | `/api/v1/menu-groups/assignments`             | Get all role assignments     |
| GET    | `/api/v1/menu-groups/available/:roleId`       | Get available groups         |
| POST   | `/api/v1/menu-groups/assign`                  | Assign group to role         |
| POST   | `/api/v1/menu-groups/revoke`                  | Revoke group from role       |
| POST   | `/api/v1/menu-groups/bulk-assign`             | Bulk assign groups to role   |
| POST   | `/api/v1/menu-groups/my-menu`                 | Get user's personalized menu |
| POST   | `/api/v1/menu-groups/user-grants/grant-group` | Grant group to user          |
| POST   | `/api/v1/menu-groups/user-grants/block-group` | Block group from user        |
| GET    | `/api/v1/menu-groups/user-grants/:userId`     | Get user's grants            |

### Table Permissions

| Method | Endpoint                                                   | Description                 |
| ------ | ---------------------------------------------------------- | --------------------------- |
| GET    | `/api/v1/table-permissions/models`                         | Get all models              |
| POST   | `/api/v1/table-permissions/models`                         | Create model                |
| POST   | `/api/v1/table-permissions/models/detail`                  | Get model detail            |
| PATCH  | `/api/v1/table-permissions/models`                         | Update model                |
| DELETE | `/api/v1/table-permissions/models`                         | Delete model                |
| POST   | `/api/v1/table-permissions/permissions/detail`             | Get table permissions       |
| POST   | `/api/v1/table-permissions/permissions/upsert`             | Upsert table permissions    |
| POST   | `/api/v1/table-permissions/role-permissions/grant`         | Grant permission to role    |
| POST   | `/api/v1/table-permissions/role-permissions/revoke`        | Revoke permission from role |
| POST   | `/api/v1/table-permissions/tenant-role-permissions/grant`  | Grant to tenant role        |
| POST   | `/api/v1/table-permissions/tenant-role-permissions/revoke` | Revoke from tenant role     |
| POST   | `/api/v1/table-permissions/check`                          | Check permission            |

---

## 8. Database Models (Key Relationships)

```
User
├── belongsTo: Role
├── belongsTo: Tenant
├── hasMany: Session
├── hasMany: ActivityLog
├── hasMany: UserMenuGrant (as grantee)
└── hasMany: BackupRecord (as performedBy)

Role
├── belongsToMany: Permission (via RolePermission)
├── hasMany: MenuGroupRole
├── hasMany: RoleTablePermission
└── hasMany: TenantRole

TenantRole
├── belongsTo: Tenant
├── belongsTo: Role
└── hasMany: TenantRoleTablePermission

Permission
└── belongsToMany: Role (via RolePermission)

MenuGroup
├── hasMany: MenuItem
├── hasMany: MenuGroupRole
└── hasMany: UserMenuGrant (as groupId)

MenuItem
├── belongsTo: MenuGroup
├── hasMany: MenuItemRole
└── hasMany: UserMenuGrant (as itemId)

UserMenuGrant
├── belongsTo: User (as grantee)
├── belongsTo: MenuGroup (via groupId)
├── belongsTo: MenuItem (via itemId)
└── belongsTo: Role (via roleId)

Model
├── hasMany: TablePermission
└── hasMany: ModelDiscoveryLog

TablePermission
├── belongsTo: Model
├── hasMany: RoleTablePermission
└── hasMany: TenantRoleTablePermission

RoleTablePermission
├── belongsTo: Role
└── belongsTo: TablePermission

TenantRoleTablePermission
├── belongsTo: TenantRole
└── belongsTo: TablePermission

Session
└── belongsTo: User

Tenant
├── hasMany: User
├── hasMany: TenantRole
├── hasMany: BackupRecord
└── hasMany: TenantSetting
```

---

## 9. Environment Variables

### Backend (.env)

```
# App
PORT=3000
SECRET=generateRandomSecretKey
APP_STORAGE_PATH=/app

# CORS
CORS_ORIGIN=http://localhost:3000

# JWT
JWT_ACCESS_SECRET=generateRandomSecretKey
JWT_ACCESS_EXPIRED=1d
JWT_REFRESH_SECRET=generateRandomSecretKey
JWT_REFRESH_EXPIRED=7d

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=boilerplate
DB_USER=boilerplate
DB_PASS=supersecret
DB_DIALECT=postgres
DB_SSL=false

# Email
MAIL_HOST=mail.example.com
MAIL_PORT=465
MAIL_USER=user@example.com
MAIL_PASSWORD=password
MAIL_SECURE=true
MAIL_FROM="Webmaster <webmaster@example.com>"

# Redis
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379

# RabbitMQ
RABBITMQ_URL=amqp://localhost:5672
RABBITMQ_HOST=localhost
RABBITMQ_PORT=5672
RABBITMQ_USER=guest
RABBITMQ_PASS=guest
```

### Frontend (.env.local)

```
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3000
```

---

## 10. Testing

### Backend Tests (Jest)

- Location: `backend/src/tests/`
- Config: `backend/jest.config.js`
- Run: `npm test`
- Standards:
  - Test controllers, services, middlewares, utils, validators
  - Mock Sequelize models
  - Use test utils: `createMockReq`, `createMockRes`, `createMockModel`, etc.
  - 100% coverage target (current: 157 tests passing)

### Frontend Tests (Jest + React Testing Library)

- Location: `frontend/src/**/*.test.ts`
- Config: `frontend/jest.config.js`, `frontend/jest.setup.ts`
- Run: `npm test`
- Standards:
  - Test components, hooks, stores
  - Use React Testing Library
  - Mock API calls
  - 100% coverage target

---

## 11. Key Files Reference

| File                                             | Purpose                                 |
| ------------------------------------------------ | --------------------------------------- |
| `backend/docs/CODING_STANDARDS.md`               | Master coding standards guide           |
| `backend/docs/CODING_CONTEXT.md`                 | This file - project context summary     |
| `backend/src/app.js`                             | Express app configuration               |
| `backend/src/server.js`                          | Server entry point                      |
| `backend/src/utils/controllerWrapper.js`         | asyncHandler wrappers                   |
| `backend/src/utils/response.js`                  | Response helpers (success, error, etc.) |
| `backend/src/middlewares/activityLog.js`         | Logger instance                         |
| `backend/src/middlewares/auth.js`                | JWT authentication middleware           |
| `backend/src/constants/index.js`                 | Permission and role constants           |
| `backend/src/services/redis.service.js`          | Redis caching, locking, queues          |
| `backend/src/services/migration.service.js`      | Database seeding and migration          |
| `backend/src/services/modelDiscovery.service.js` | Model discovery service                 |
| `backend/src/services/menuGroupRole.service.js`  | Role-based menu operations              |
| `backend/src/services/userMenuGrant.service.js`  | User-level menu grants                  |
| `frontend/src/contexts/ThemeContext.tsx`         | Theme toggle context                    |
| `frontend/src/app/globals.css`                   | Design tokens and CSS variables         |
| `frontend/src/api/client.ts`                     | API client configuration                |

---

## 12. Common AI Agent Tasks

### Adding a New Endpoint

1. Create Joi validator in `backend/src/validators/` with schemas and `validate` helper export
2. Create service function in `backend/src/services/`
3. Create controller function in `backend/src/controllers/` using `asyncHandlerWithMapping`, importing validators
4. Add route in `backend/src/routes/api/` with Swagger documentation
5. Add frontend store hook
6. Add frontend page/component
7. Add tests for all layers

### Adding Permissions

1. Add to `USER_PERMISSIONS` or `TENANT_PERMISSIONS` in `backend/src/constants/index.js`
2. Add to `USER_MODULE_PERMISSIONS` or `TENANT_MODULE_PERMISSIONS` in `backend/src/utils/seedPermissions.js`
3. Run seeder to apply

### Adding Menu Items

1. Run `seedMenuGroups()` to seed base groups/items
2. Use API to manage via `menu_group_roles` and `user_menu_grants`

### Adding Table Permissions

1. Model Discovery auto-registers new models at startup
2. Use `/api/v1/table-permissions/models` endpoints to configure model permissions
3. Assign permissions to roles via `/api/v1/table-permissions/role-permissions/grant`
4. Assign permissions to tenant roles via `/api/v1/table-permissions/tenant-role-permissions/grant`

### Theme Changes

1. Update CSS variables in `frontend/src/app/globals.css`
2. Use Tailwind utility classes in components
3. ThemeContext handles toggle logic

---

_Last updated: 2026-06-11_
