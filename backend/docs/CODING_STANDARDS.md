# Coding Standards & Guidelines

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Naming Conventions](#2-naming-conventions)
3. [File Structure](#3-file-structure)
4. [Controller Standards](#4-controller-standards)
5. [Service Standards](#5-service-standards)
6. [Route Standards](#6-route-standards)
7. [Validator Standards](#7-validator-standards)
8. [Utility Standards](#8-utility-standards)
9. [Middleware Standards](#9-middleware-standards)
10. [Model Standards](#10-model-standards)
11. [Error Handling](#11-error-handling)
12. [Response Format](#12-response-format)
13. [Permission Format](#13-permission-format)
14. [Database Standards](#14-database-standards)
15. [Caching Standards](#15-caching-standards)
16. [Message Queue Standards](#16-message-queue-standards)
17. [Documentation Standards](#17-documentation-standards)
18. [Constants Standards](#18-constants-standards)
19. [Migration & Seeding Standards](#19-migration--seeding-standards)
20. [Environment Variables](#20-environment-variables)
21. [Git & Deployment](#21-git--deployment)
22. [Unit Testing Standards](#22-unit-testing-standards)
23. [Model Discovery Standards](#23-model-discovery-standards)
24. [Menu Group & User Menu Grant Standards](#24-menu-group--user-menu-grant-standards)

---

## 1. Project Overview

### Technology Stack

| Component     | Technology         | Version |
| ------------- | ------------------ | ------- |
| Framework     | Express.js         | v5      |
| Runtime       | Node.js            | 18+     |
| Database      | PostgreSQL         | 14+     |
| ORM           | Sequelize          | 6.x     |
| Cache         | Redis (ioredis)    | 8.6     |
| Message Queue | RabbitMQ (amqplib) | 3.13    |
| Validation    | Joi                | 18.x    |
| Email         | Nodemailer         | 8.x     |
| Templates     | Mustache           | 4.x     |

### Project Structure

```
callibrator-be/
├── docs/
│   ├── DOCUMENTATION.md          # Markdown documentation
│   ├── DOCUMENTATION.html        # Generated HTML documentation
│   ├── CODING_STANDARDS.md       # This file
│   ├── TABLE_PERMISSIONS.md      # Table permissions documentation
│   └── illustrations/            # SVG diagrams
├── scripts/
│   ├── generate-html-doc.js      # HTML doc generator
│   ├── generate-coding-standards-html.js  # Coding standards HTML generator
│   ├── generate-mermaid-svg.js   # SVG generator
│   └── generate-pdf.js           # PDF generator
├── src/
│   ├── config/                   # Database & app configuration
│   │   ├── index.js              # Main config export
│   │   ├── connection.js         # DB connection setup
│   │   └── migrate.js            # Migration utilities
│   ├── constants/                # Centralized application constants
│   │   ├── index.js              # Main constants export
│   │   ├── appConstants.js       # App-wide constants (pagination, OTP, etc.)
│   │   ├── roleConstants.js      # Role-related constants
│   │   └── permissionConstants.js # Permission naming conventions
│   ├── controllers/              # Request handlers
│   │   ├── auth.controller.js
│   │   ├── calibrationDevices.controller.js
│   │   ├── calibrationRecords.controller.js
│   │   ├── certificate.controller.js
│   │   ├── menuGroup.controller.js
│   │   ├── migration.controller.js
│   │   ├── roles.controller.js
│   │   ├── session.controller.js
│   │   ├── sso.controller.js
│   │   ├── stock.controller.js
│   │   ├── tenant.controller.js
│   │   ├── tenantBackup.controller.js
│   │   ├── user.controller.js
│   │   └── warehouse.controller.js
│   ├── docs/                     # Swagger configuration
│   ├── middlewares/              # Express middlewares
│   │   ├── abac.middleware.js
│   │   ├── accessLog.middleware.js
│   │   ├── activityLog.middleware.js
│   │   ├── auth.middleware.js
│   │   ├── backup.middleware.js
│   │   ├── createFolder.middleware.js
│   │   ├── dynamicAccess.middleware.js
│   │   ├── errorHandlers.middleware.js
│   │   ├── globalSanitizer.middleware.js
│   │   ├── inputValidation.middleware.js
│   │   ├── modelDiscoveryCron.middleware.js
│   │   ├── notFound.middleware.js
│   │   ├── rbac.middleware.js
│   │   ├── sessionCleanup.middleware.js
│   │   ├── tenantContext.middleware.js
│   │   ├── tenantScope.middleware.js
│   │   ├── tokenRateLimiter.middleware.js
│   │   └── validation.middleware.js
│   ├── models/                   # Sequelize models
│   ├── routes/
│   │   ├── api/                  # Public API routes
│   │   └── internal/             # Internal routes
│   ├── services/                 # Business logic
│   │   ├── auth.service.js
│   │   ├── calibrationDevices.service.js
│   │   ├── calibrationRecords.service.js
│   │   ├── certificate.service.js
│   │   ├── email.service.js
│   │   ├── emailQueue.service.js
│   │   ├── migration.service.js
│   │   ├── rateLimiter.service.js
│   │   ├── redis.service.js
│   │   ├── roles.service.js
│   │   ├── session.service.js
│   │   ├── sso.service.js
│   │   ├── stock.service.js
│   │   ├── tenant.service.js
│   │   ├── tenantBackup.service.js
│   │   ├── tenantUpload.service.js
│   │   ├── user.service.js
│   │   └── warehouse.service.js
│   ├── templates/                # Email HTML templates
│   ├── tests/                    # Jest tests
│   ├── utils/                    # Utility functions
│   │   ├── constants.util.js          # Backward compatibility re-exports
│   │   ├── seedPermissions.util.js    # Permission seeding utility
│   │   └── seedTablePermissions.util.js # Table permissions seeding utility
│   └── validators/               # Joi validation schemas
├── .env                          # Environment variables
├── local.env                     # Local development env
├── docker-compose.yaml           # Docker services
├── Dockerfile                    # Container definition
├── package.json                  # Dependencies
└── index.js                      # Application entry point
```

---

## 2. Naming Conventions

### File Names

- **Service files**: `camelCase.service.js` (e.g., `auth.service.js`, `emailQueue.service.js`)
- **Controller files**: `camelCase.controller.js` (e.g., `auth.controller.js`)
- **Route files**: `camelCase.route.js` (e.g., `auth.route.js`, `tenant.route.js`)
- **Validator files**: `camelCase.validator.js` (e.g., `auth.validator.js`)
- **Middleware files**: `camelCase.middleware.js` (e.g., `auth.middleware.js`, `rbac.middleware.js`)
- **Utility files**: `camelCase.util.js` (e.g., `response.util.js`, `jwt.util.js`)
- **Model files**: `camelCase.model.js` (e.g., `user.model.js`, `calibrationDevice.model.js`)

### Function Names

- **Exported functions**: `camelCase` with descriptive verbs
  - `registerUser`, `loginUser`, `activateAccount`
  - `fetchTenants`, `createTenant`, `updateTenant`
  - `generateAccessToken`, `verifyAccessToken`
- **Internal/private functions**: `camelCase` with descriptive names
  - `validate`, `hashPassword`, `comparePassword`
  - `getRedisConnection`, `createChannel`

### Variable Names

- **Constants**: `UPPER_SNAKE_CASE`
  - `DEFAULT_PAGE`, `MAX_LIMIT`, `SUPER_ADMIN_ROLE_ID`
  - `OTP_LENGTH`, `PASSWORD_SALT_ROUNDS`
- **Enums/Objects**: `UPPER_SNAKE_CASE` keys
  - `ROLE_NAMES.SUPER_ADMIN`, `USER_STATUS.ACTIVE`
  - `USER_PERMISSIONS.CREATE`, `TENANT_PERMISSIONS.READ`
- **Variables**: `camelCase`
  - `existingUser`, `activationToken`, `rateLimitKey`
  - `lockId`, `transaction`, `cacheKeys`

### Class/Model Names

- **Models**: PascalCase (Sequelize model class)
  - `Users`, `Tenants`, `Sessions`, `Permissions`
- **Constants objects**: PascalCase
  - Not applicable (using plain objects)

### Permission Names

- **Format**: `module:action` or `module:self:action` or `module:tenant:action`
- **Global actions**: `user:create`, `tenant:read`, `permission:update`
- **Self actions**: `user:self:update`, `user:self:read`
- **Tenant actions**: `user:tenant:create`, `tenant:tenant:assign`
- **Backup actions**: `tenant:backup:create`, `tenant:backup:restore`

---

## 3. File Structure

### Service File Template

```javascript
// service_name.service.js
const { Model } = require("../models");
const { helperFunction } = require("../utils/helper.util");

// ==========================================
// VALIDATION HELPERS
// ==========================================

const validate = (data, schema) => {
  // Validation logic
};

// ==========================================
// FUNCTION NAME
// ==========================================

exports.functionName = async (input) => {
  // Validate input
  const data = validate(input, schema);

  let transaction;
  try {
    transaction = await db.transaction();

    // Business logic here

    await transaction.commit();

    return {
      success: true,
      status: 200,
      message: "Operation successful",
      data: result,
    };
  } catch (error) {
    if (transaction) await transaction.rollback();
    throw {
      status: error.status || 500,
      message: error.message,
    };
  }
};
```

### Controller File Template

```javascript
// controller_name.controller.js
const service = require("../services/service_name.service");
const { asyncHandlerWithMapping } = require("../utils/controllerWrapper.util");
const { success, badRequest, error } = require("../utils/response.util");

// ==========================================
// FUNCTION NAME
// ==========================================

exports.functionName = asyncHandlerWithMapping(
  async (req, res) => {
    const result = await service.functionName(req.body);
    success(res, result.data, result.message, result.status);
  },
  {
    // Error message patterns mapped to status codes
    "not found": 404,
    "invalid": 400,
  },
);
```

### Route File Template

**CRITICAL: Swagger documentation belongs in route files, NOT in controller files.** Controllers must remain clean of API documentation to keep concerns separated.

```javascript
// route_name.route.js
const express = require("express");
const router = express.Router();
const { controller } = require("../../controllers/controller_name");
const { auth } = require("../../middlewares/auth.middleware");

/* ------------------------------------------------------------------ */
/* RESOURCE MANAGEMENT                                                */
/* ------------------------------------------------------------------ */

/**
 * @swagger
 * /api/v1/resource:
 *   get:
 *     summary: Get all resources
 *     tags: [Resource]
 *     security: [bearerAuth: []]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Resources fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Resources fetched successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 meta:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 */
router.get("/resource", auth, controller.getAll);

/**
 * @swagger
 * /api/v1/resource:
 *   post:
 *     summary: Create a new resource
 *     tags: [Resource]
 *     security: [bearerAuth: []]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Resource created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 201
 *                 message:
 *                   type: string
 *                   example: "Resource created successfully"
 *                 data:
 *                   type: object
 */
router.post("/resource", auth, controller.create);

module.exports = router;
```

**Swagger Documentation Rules:**

- Use `/* ... */` block comments (NOT `/** ... */`) for Swagger `@swagger` declarations
- Use `/** ... */` JSDoc comments for `@summary`, `@description`, `@method`, `@route`, `@access`
- Swagger tag declarations (`tags:`, `components:`) go at the top of the file
- Each endpoint gets its own `@swagger` block with full OpenAPI 3.0 specification
- Controllers must NEVER contain `@swagger` JSDoc comments

### Validator File Template

```javascript
// validator_name.validator.js
const Joi = require("joi");

// ==========================================
// COMMON SCHEMAS
// ==========================================

const email = Joi.string()
  .trim()
  .lowercase()
  .email()
  .min(6)
  .max(255)
  .required();

// ==========================================
// SCHEMA DEFINITIONS
// ==========================================

exports.schemaName = Joi.object({
  fieldName: Joi.string().trim().min(2).max(100).required(),
  email,
});

// ==========================================
// VALIDATION HELPERS
// ==========================================

exports.validate = (body, schema) => {
  return schema.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });
};

exports.formatErrors = (details) => {
  return details.map((item) => ({
    field: item.path.join("."),
    message: item.message,
  }));
};
```

---

## 4. Controller Standards

### Import Order

1. Service imports
2. Controller wrapper imports
3. Response helper imports
4. Other utility imports

### Response Pattern

```javascript
// Success response
success(res, data, "Message", statusCode);

// Error thrown from service
throw { status: 404, message: "Resource not found" };
```

### Error Handling

- **Always** use `asyncHandler` or `asyncHandlerWithMapping` wrapper
- Services throw objects: `{ status: code, message: "text" }`
- Controllers call services and respond with `success()` or throw errors

### Request Data Access

- `req.body` - POST/PUT data
- `req.query` - Query parameters
- `req.params` - URL parameters
- `req.user` - Authenticated user (from middleware)
- `req.session` - Session data (from middleware)
- `req.headers.origin` - Origin header for multi-tenant URLs
- `req.headers.host` - Host header fallback
- `req.ip` - Client IP address
- `req.headers["user-agent"]` - User agent string

### Response Format

All API responses MUST follow this standardized format:

```javascript
{
  success: true,                    // boolean - first field
  status: 200,                      // integer - HTTP status code
  message: "Operation successful",  // string - descriptive message
  data: { ... },                    // any - the actual requested data (null for errors)
  meta: {                           // object - metadata with counts (optional)
    total: 100,                     // integer - total count of items
    page: 1,                        // integer - current page number
    limit: 20,                      // integer - items per page
    totalPages: 5,                  // integer - total number of pages
    customCounts: {                 // object - optional custom counts
      active: 50,
      inactive: 50
    }
  },
  token: "jwt_token_here",          // string - only for login/auth responses
  session: {                        // object - only for login/auth responses
    id: "uuid",
    createdAt: "2024-01-01T00:00:00Z",
    expiresAt: "2024-01-08T00:00:00Z"
  }
}
```

#### Response Field Descriptions

| Field               | Type     | Required | Description                                                     |
| ------------------- | -------- | -------- | --------------------------------------------------------------- |
| `success`           | boolean  | Yes      | `true` for success, `false` for error. Must be the first field. |
| `status`            | integer  | Yes      | HTTP status code (200, 201, 400, 401, 403, 404, 429, 500)       |
| `message`           | string   | Yes      | Human-readable descriptive message                              |
| `data`              | any/null | Yes      | The actual requested data. `null` for error responses.          |
| `meta`              | object   | No       | Metadata with pagination and counts. Omitted if not applicable. |
| `meta.total`        | integer  | No       | Total count of items (for paginated responses)                  |
| `meta.page`         | integer  | No       | Current page number                                             |
| `meta.limit`        | integer  | No       | Items per page                                                  |
| `meta.totalPages`   | integer  | No       | Total number of pages                                           |
| `meta.customCounts` | object   | No       | Additional custom counts (e.g., active, inactive, pending)      |
| `token`             | string   | No       | JWT access token (only for login/auth responses)                |
| `session`           | object   | No       | Session data (only for login/auth responses)                    |

#### Success Response Examples

**Single Resource:**

```json
{
  "success": true,
  "status": 200,
  "message": "Fetch user successful",
  "data": {
    "id": "uuid",
    "username": "johndoe",
    "email": "john@example.com"
  }
}
```

**Paginated List:**

```json
{
  "success": true,
  "status": 200,
  "message": "Fetch users successful",
  "data": [
    { "id": "uuid-1", "username": "user1" },
    { "id": "uuid-2", "username": "user2" }
  ],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "totalPages": 5
  }
}
```

**Login Response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Login successful",
  "data": {
    "id": "uuid",
    "username": "johndoe",
    "email": "john@example.com",
    "role": { "id": "uuid", "name": "admin" }
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "session": {
    "id": "session-uuid",
    "createdAt": "2024-01-01T00:00:00Z",
    "expiresAt": "2024-01-08T00:00:00Z"
  }
}
```

#### Error Response Example

```json
{
  "success": false,
  "status": 404,
  "message": "Resource not found",
  "data": null
}
```

#### Using Response Helpers

```javascript
const { success, error, login, paginated } = require("../utils/response.util");

// Success response
success(res, data, meta, "Message", statusCode, authData);

// Login response (includes token and session)
login(res, data, token, session);

// Paginated response
paginated(res, rows, count, "Message", statusCode, customCounts);

// Error response
error(res, "Error message", statusCode, details);
```

---

## 5. Service Standards

### Transaction Pattern

```javascript
let transaction;
try {
  transaction = await db.transaction();

  // Database operations with { transaction }

  await transaction.commit();

  return { success: true, status: 200, message: "..." };
} catch (error) {
  if (transaction) await transaction.rollback();
  throw { status: error.status || 500, message: error.message };
}
```

### Return Format

```javascript
{
  success: true,
  status: 200,
  message: "Operation successful",
  data: { ... }  // Optional
}
```

### Error Format

```javascript
throw {
  status: 400, // HTTP status code
  message: "Error description",
};
```

### Caching Pattern

```javascript
// Get from cache
const cachedData = await get(cacheKeys.resourceName(id));

// Set to cache
await set(cacheKeys.resourceName(id), data, ttlSeconds);

// Delete from cache
await del(cacheKeys.resourceName(id));

// Delete pattern
await delPattern(`cache:resourceName:*`);
```

### Distributed Lock Pattern

```javascript
// Acquire lock
const lockId = await acquireLock(`lock:key`, ttlMs);
if (!lockId) {
  throw { status: 429, message: "Operation in progress" };
}

try {
  // Critical section
} finally {
  await releaseLock(`lock:key`, lockId);
}
```

### Database Lock Pattern

```javascript
const record = await Model.findOne({
  where: { id },
  transaction,
  lock: transaction.LOCK.UPDATE, // SELECT FOR UPDATE
});
```

### Email Queue Pattern

```javascript
// Queue email asynchronously
queueEmail({
  email: user.email,
  firstName: user.firstName,
  data: "...",
}).catch((err) => {
  console.error("Failed to queue email:", err.message);
});
```

---

## 6. Route Standards

### Route Definition

- Use `express.Router()`
- Export router with `module.exports = router`
- Document with JSDoc comments
- Apply middleware in order: auth, rate limiter, controller

### Route Naming

- Use plural nouns: `/users`, `/tenants`, `/permissions`
- Use action verbs for operations: `/create`, `/edit`, `/delete`
- Use resource identifiers: `/:userId/avatar`

### Route Structure

```javascript
router.get("/all", auth, controller.getAll);
router.post("/detail", auth, controller.getDetail);
router.post("/create", auth, controller.create);
router.patch("/edit", auth, controller.edit);
router.delete("/delete", auth, controller.delete);
router.post("/:id/action", auth, controller.action);
```

---

## 7. Validator Standards

### Schema Organization

1. Common schemas (email, password, username, etc.)
2. Request-specific schemas
3. Validation helper functions

### Common Field Patterns

```javascript
// Email
const email = Joi.string()
  .trim()
  .lowercase()
  .email()
  .min(6)
  .max(255)
  .required();

// Password
const password = Joi.string()
  .min(8)
  .max(100)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/)
  .required();

// Username
const username = Joi.string()
  .trim()
  .lowercase()
  .alphanum()
  .min(3)
  .max(30)
  .required();
```

### Validation Helper

```javascript
exports.validate = (body, schema) => {
  return schema.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });
};

exports.formatErrors = (details) => {
  return details.map((item) => ({
    field: item.path.join("."),
    message: item.message,
  }));
};
```

---

## 8. Utility Standards

### File Organization

- One utility per file
- Descriptive file names: `password.util.js`, `jwt.util.js`, `otp.util.js`
- Export only the necessary functions

### Export Pattern

```javascript
const functionName = async (param) => {
  // Implementation
};

module.exports = {
  functionName,
};
```

### Common Utilities

- `password.util.js` - `hashPassword`, `comparePassword`
- `jwt.util.js` - `generateAccessToken`, `verifyAccessToken`
- `otp.util.js` - `generateOTP`, `hashOTP`
- `session.util.js` - `hashToken`
- `response.util.js` - `success`, `error`, `notFound`, `badRequest`

---

## 9. Middleware Standards

### Middleware Order

1. `globalSanitizer` - Input sanitization
2. `inputValidation` - Schema validation
3. `tenantContext` - Tenant identification
4. `tenantScope` - Query scoping
5. `auth` - Authentication
6. `rbac` / `dynamicAccess` - Authorization
7. `tokenRateLimiter` / `tokenRateLimiterService` - Rate limiting
8. `activityLog` - Activity logging

### Middleware Pattern

```javascript
const middlewareName = (req, res, next) => {
  // Middleware logic
  next();
};

module.exports = {
  middlewareName,
};
```

---

## 10. Model Standards

### Architectural Standard — Directory Structure and File Segregation

**Directory Structure:** All database models must be isolated within the `models/` directory.

**File Segregation:** Enforce a strict 1:1 ratio between models and files (e.g., `user.model.js`, `tenant.model.js`, `role.model.js`). Each model must reside in its own dedicated file. No composite or multi-model files are permitted.

**Central Aggregation:** An `index.js` file within the `models/` directory serves as the single entry point for all model access. This file aggregates all model definitions and their associations.

### Model Naming

- Use PascalCase for model class names
- Use `camelCase.model.js` for file names (e.g., `user.model.js`, `tenant.model.js`, `calibrationDevice.model.js`)
- Models auto-loaded dynamically via `src/models/index.js`

### Model Definition — Execution Protocol

Each individual model file must export a **function** or **class** that accepts the Sequelize connection instance (`db`) and `DataTypes`. The model is defined and returned by this function. This enables dynamic loading and centralized association mapping.

```javascript
// user.model.js
const { Sequelize, DataTypes } = require("sequelize");

/**
 * Define the Users model.
 * @param {Sequelize} db - The Sequelize instance
 * @param {typeof Sequelize} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
const defineModel = (db, DataTypes) => {
  const Users = db.define(
    "Users",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // ... other fields
    },
    {
      tableName: "users",
      timestamps: true,
      paranoid: true,
      underscored: true,
    },
  );

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  Users.associate = (models) => {
    Users.belongsTo(models.Roles, { foreignKey: "roleId", as: "role" });
    Users.belongsTo(models.Tenants, { foreignKey: "tenantId", as: "tenant" });
  };

  return Users;
};

module.exports = defineModel;
```

### Model Index — Dynamic Loading Pattern

The `models/index.js` file is **ONLY for dynamic aggregation**. It must dynamically read the directory contents, execute exported model definition functions, and map associations.

```javascript
// models/index.js
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes, Op } = require("sequelize");

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: process.env.DB_DIALECT || "postgres",
    // ... other options
  },
);

const db = {};

const modelFiles = fs
  .readdirSync(__dirname)
  .filter((file) => {
    return (
      file.indexOf(".") !== 0 && // ignore dotfiles
      file !== "index.js" && // ignore this file
      file.slice(-3) === ".js" // only .js files
    );
  })
  .map((file) => require(path.join(__dirname, file)));

modelFiles.forEach((defineModel) => {
  const model = defineModel(sequelize, DataTypes);
  db[model.name] = model;
});

// Association Mapping
Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// Global Export
db.sequelize = sequelize;
db.Sequelize = Sequelize;
db.Op = Op;

module.exports = db;
```

### Guidelines

1. **One model per file** - Each model has its own `.js` file in `models/`
2. **Export a definition function** - Models export a function that accepts `db` and `DataTypes`
3. **Dynamic directory loading** - `index.js` uses `fs.readdirSync` to discover model files
4. **Association via method** - Each model defines `associate(models)` method
5. **Global export** - `index.js` exports a single `db` object for dependency injection
6. **Use freezeTableName** - Prevent Sequelize from auto-pluralizing table names
7. **Define aliases** - Use `as` for all associations to avoid confusion
8. **No direct model imports** - All models must be accessed via the aggregated `db` object from `index.js`

### Legacy Pattern (Deprecated)

The following patterns are **deprecated** and must be migrated:

- Multi-model files (e.g., a single file exporting `Users`, `Tenants`, `Roles`)
- Direct model imports bypassing `index.js`
- Inline associations defined in `index.js` instead of per-model `associate` methods
- Exporting raw model instances instead of definition functions

---

```javascript
// user.model.js
const { Sequelize, DataTypes } = require("sequelize");
const { db } = require("../config");

const Users = db.define(
  "users",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },
    tenantId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    username: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
    },
    // ... other fields
  },
  {
    freezeTableName: true,
    timestamps: true,
  },
);

module.exports = {
  Users,
};
```

### Model Index Pattern

`src/models/index.js` is **ONLY for importing and exporting models**. It must NOT define associations directly. Instead, associations are defined in each model file's `associate` method.

```javascript
// src/models/index.js
const { Users } = require("./user.model");
const { Tenants } = require("./tenant.model");
const { Roles } = require("./role.model");
// ... other imports

// Collect models
const models = {
  Users,
  Tenants,
  Roles,
  // ... other models
};

// Run associations defined in each model
Object.keys(models).forEach((key) => {
  if (models[key].associate) {
    models[key].associate(models);
  }
});

module.exports = {
  ...models,
  Op: require("sequelize").Op,
  Sequelize: require("sequelize").Sequelize,
};
```

### Association Pattern

Define associations in each model file using the `associate` method pattern:

```javascript
// user.model.js - Associations section
Users.associate = (models) => {
  Users.belongsTo(models.Roles, {
    foreignKey: "roleId",
    as: "role",
  });

  Users.belongsTo(models.TenantRoles, {
    foreignKey: "tenantRoleId",
    as: "tenantRole",
  });

  Users.belongsTo(models.Tenants, {
    foreignKey: "tenantId",
    as: "tenant",
  });

  Users.belongsToMany(models.Permissions, {
    through: models.UserPermissions,
    foreignKey: "userId",
    otherKey: "permissionId",
    as: "permissions",
  });
};
```

### Guidelines

1. **Model index is import-only** - `src/models/index.js` only imports, collects, and exports models
2. **Associations in model files** - Each model defines its own associations via the `associate` method
3. **Auto-discovery pattern** - `index.js` iterates over all models and calls `associate()` if it exists
4. **Export as object** - Each model exports `{ ModelName }` not the raw model
5. **Use freezeTableName** - Prevent Sequelize from auto-pluralizing table names
6. **Define aliases** - Use `as` for all associations to avoid confusion

---

## 11. Error Handling

### Error Format

Services throw:

```javascript
throw {
  status: 400, // HTTP status code
  message: "Error description",
};
```

Controllers use:

```javascript
asyncHandlerWithMapping(
  async (req, res) => {
    // Service call
  },
  {
    // Error message patterns to status codes
    "not found": 404,
    "invalid": 400,
  },
);
```

### Common Status Codes

| Code | Meaning               | Usage               |
| ---- | --------------------- | ------------------- |
| 200  | OK                    | Success             |
| 201  | Created               | Resource created    |
| 400  | Bad Request           | Validation error    |
| 401  | Unauthorized          | Invalid credentials |
| 403  | Forbidden             | Access denied       |
| 404  | Not Found             | Resource not found  |
| 409  | Conflict              | Duplicate resource  |
| 429  | Too Many Requests     | Rate limit exceeded |
| 500  | Internal Server Error | Server error        |

---

## 12. Response Format

### Success Response

```json
{
  "success": true,
  "status": 200,
  "message": "Operation successful",
  "data": { ... }
}
```

### Error Response

```json
{
  "success": false,
  "status": 400,
  "message": "Validation failed",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email"
    }
  ]
}
```

---

## 13. Permission Format

### Permission String Format

```
module:action
module:self:action
module:tenant:action
```

### Examples

```javascript
// Global permissions
"user:create";
"user:read";
"user:update";
"user:delete";
"tenant:create";
"tenant:read";

// Self permissions
"user:self:update";
"user:self:read";
"tenant:self:update";

// Tenant permissions
"user:tenant:create";
"user:tenant:assign";
"tenant:tenant:read";

// Backup permissions
"tenant:backup:create";
"tenant:backup:read";
"tenant:backup:restore";
"tenant:backup:delete";
```

### Role Hierarchy

| Role         | Level | Access                  |
| ------------ | ----- | ----------------------- |
| SUPER_ADMIN  | 3     | Full system access      |
| TENANT_ADMIN | 2     | Tenant-level management |
| USER         | 1     | Self-only access        |

---

## 14. Database Standards

### Query Patterns

```javascript
// Find with lock
const record = await Model.findOne({
  where: { id },
  transaction,
  lock: transaction.LOCK.UPDATE,
});

// Find with include
const user = await Users.findOne({
  where: { id },
  include: [{ model: Tenant, as: "tenant" }],
});

// Pagination
const { rows, count } = await Model.findAndCountAll({
  limit: limit,
  offset: (page - 1) * limit,
  order: [["createdAt", "DESC"]],
});
```

### Index Guidelines

- Add indexes on frequently queried columns
- Add indexes on foreign keys
- Add unique indexes on email, username, code fields

---

## 15. Caching Standards

### Redis Cache Keys

Use `cacheKeys` helper from `redis.service.js`:

```javascript
cacheKeys.userByEmail(email); // cache:user:email:{email}
cacheKeys.userByUsername(username); // cache:user:username:{username}
cacheKeys.tenantById(id); // cache:tenant:id:{id}
cacheKeys.tenantByCode(code); // cache:tenant:code:{code}
cacheKeys.tenantSettings(id); // cache:tenant:settings:{id}
```

### TTL Guidelines

| Data Type       | TTL          | Reason             |
| --------------- | ------------ | ------------------ |
| User lookups    | 86400s (24h) | Rarely changes     |
| Tenant data     | 600s (10m)   | Moderate changes   |
| Tenant settings | 900s (15m)   | Infrequent changes |
| Rate limits     | 60s (1m)     | Short-term         |
| Session data    | 86400s (24h) | Session lifetime   |

### Cache Invalidation

- Delete cache on create/update/delete operations
- Use `delPattern()` for bulk invalidation
- Always invalidate list caches when individual items change

---

## 16. Message Queue Standards

### RabbitMQ Configuration

```javascript
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost:5672";
```

### Queue Pattern

```javascript
// Add job to queue
channel.sendToQueue(queueName, Buffer.from(JSON.stringify(jobData)), {
  persistent: true,
});

// Consume with manual acknowledgment
channel.consume(queueName, (msg) => {
  try {
    const job = JSON.parse(msg.content);
    processJob(job);
    channel.ack(msg);
  } catch (error) {
    channel.nack(msg, false, false); // Send to DLQ
  }
});
```

### Email Queue Jobs

```javascript
// Activation email
{
  type: "ACTIVATION",
  email: "user@example.com",
  firstName: "John",
  lastName: "Doe",
  activationLink: "https://...",
}

// OTP email
{
  type: "OTP",
  email: "user@example.com",
  firstName: "John",
  lastName: "Doe",
  otp: "123456",
}
```

---

## 17. Documentation Standards

### When to Generate Documentation

After **every** code change that affects:

1. **API endpoints** - Add/remove/modify routes
2. **Database schema** - Add/change models
3. **Environment variables** - Add/change .env entries
4. **Docker services** - Add/change docker-compose.yaml
5. **Dependencies** - Add/remove npm packages
6. **Architecture** - Change system design

### Generation Commands

```bash
# Generate SVG illustrations
node scripts/generate-mermaid-svg.js

# Generate HTML documentation
node scripts/generate-html-doc.js

# Generate PDF documentation (optional)
node scripts/generate-pdf.js
```

### Documentation Files

| File                       | Description            | Auto-generated |
| -------------------------- | ---------------------- | -------------- |
| `docs/DOCUMENTATION.md`    | Markdown documentation | Manual         |
| `docs/DOCUMENTATION.html`  | HTML documentation     | Yes            |
| `docs/illustrations/*.svg` | System diagrams        | Yes            |

### Illustration Files

| File                         | Description                |
| ---------------------------- | -------------------------- |
| `01-system-architecture.svg`            | System architecture                                |
| `02-authentication-flow.svg`            | Authentication flow                                |
| `03-rbac-abac.svg`                       | Authorization model                                |
| `04-database-schema.svg`                | Database ER diagram                                |
| `05-middleware-pipeline.svg`            | Middleware flow                                    |
| `06-api-endpoints.svg`                  | API endpoint reference                             |
| `07-multi-tenancy.svg`                  | Multi-tenancy architecture                         |
| `08-backup-logging.svg`                 | Backup & logging                                   |
| `09-security-layers.svg`                | Security layers                                    |
| `10-project-structure.svg`               | Project structure                                  |
| `11-docker-architecture.svg`            | Docker deployment                                  |
| `12-table-permissions-architecture.svg` | Table Permissions Architecture                     |
| `13-table-permissions-flow.svg`         | Table Permissions Flow                             |
| `14-table-permissions-erd.svg`          | Table Permissions ER Diagram                       |
| `15-menu-group-architecture.svg`        | Menu Group Architecture                            |
| `16-user-menu-resolution.svg`           | User Menu Resolution Flow                          |
| `21-calibration-lifecycle.svg`          | Calibration Device & Record Lifecycle              |
| `22-stock-transfer-flow.svg`            | Stock Transfer Sequence Flow                       |
| `23-certificate-lifecycle.svg`          | Certificate Lifecycle State Diagram                |

---

## 18. Constants Standards

### Constants Directory Structure

All application-wide constants must be centralized in the `src/constants/` directory. This ensures maintainability, consistency, and easy updates across the codebase.

```
src/constants/
├── index.js                      # Main export file
├── appConstants.js               # App-wide settings (pagination, OTP, password, etc.)
├── roleConstants.js              # Role names, IDs, levels, hierarchy
└── permissionConstants.js        # Permission naming conventions
```

### File Organization

| File                     | Purpose                                             |
| ------------------------ | --------------------------------------------------- |
| `index.js`               | Re-exports all constants from sub-modules           |
| `appConstants.js`        | Pagination, OTP, password, session, backup settings |
| `roleConstants.js`       | Role names, IDs, levels, built-in roles             |
| `permissionConstants.js` | Permission naming conventions (module:action)       |

### Constants File Template

```javascript
// appConstants.js
/**
 * Application Constants
 *
 * Centralized application-wide constants including pagination, OTP, password,
 * session, and backup settings.
 */

/**
 * Default pagination settings
 */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

/**
 * User status values
 */
const USER_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  SUSPENDED: "SUSPENDED",
};

/**
 * OTP settings
 */
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 5;

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  USER_STATUS,
  OTP_LENGTH,
  OTP_EXPIRY_MINUTES,
};
```

### Import Pattern

```javascript
// Import from centralized constants
const {
  ROLE_NAMES,
  ROLE_IDS,
  ROLE_LEVELS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  USER_PERMISSIONS,
  TENANT_PERMISSIONS,
  PASSWORD_SALT_ROUNDS,
} = require("../constants");

// Or destructured import
const { DEFAULT_PAGE, DEFAULT_LIMIT } = require("../constants");
```

### Backward Compatibility

For backward compatibility, `src/utils/constants.util.js` re-exports all constants from `src/constants/`:

```javascript
// src/utils/constants.util.js
const constants = require("../constants");

module.exports = {
  SUPER_ADMIN_ROLE_ID: constants.SUPER_ADMIN_ROLE_ID,
  ROLE_NAMES: constants.ROLE_NAMES,
  ROLE_IDS: constants.ROLE_IDS,
  // ... all other constants re-exported
};
```

### Guidelines

1. **Centralize all constants** - No hardcoded values in controllers, services, or middlewares
2. **Use descriptive names** - `DEFAULT_LIMIT` not `DL`, `OTP_EXPIRY_MINUTES` not `OE`
3. **Group related constants** - Use objects for related values (`USER_STATUS.ACTIVE`)
4. **Document constants** - Add JSDoc comments explaining purpose
5. **Environment overrides** - Allow env overrides for critical values (e.g., `SUPER_ADMIN_ROLE_ID`)
6. **Mark deprecated** - Use `@deprecated` JSDoc tag for legacy constants
7. **Sync with seed data** - Constants must match database seed values

### Role Constants

```javascript
// roleConstants.js
const ROLE_NAMES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  TENANT_ADMIN: "TENANT_ADMIN",
  USER: "USER",
};

const ROLE_IDS = {
  SUPER_ADMIN: "9be20605-cc6a-4d91-8246-9756b4a1754b",
  TENANT_ADMIN: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  USER: "f6e5d4c3-b2a1-4987-6543-210fedcba987",
};

const ROLE_LEVELS = {
  SUPER_ADMIN: 3,
  TENANT_ADMIN: 2,
  USER: 1,
};

const BUILTIN_ROLES = ["SUPER_ADMIN", "TENANT_ADMIN", "USER"];
```

### Permission Constants

```javascript
// permissionConstants.js
const USER_PERMISSIONS = {
  CREATE: "user:create",
  READ: "user:read",
  UPDATE: "user:update",
  DELETE: "user:delete",
  SELF_UPDATE: "user:self:update",
  SELF_READ: "user:self:read",
  TENANT_CREATE: "user:tenant:create",
  TENANT_READ: "user:tenant:read",
  TENANT_UPDATE: "user:tenant:update",
  TENANT_DELETE: "user:tenant:delete",
  TENANT_ASSIGN: "user:tenant:assign",
};
```

---

## 19. Migration & Seeding Standards

### Migration Service

All database migration and seeding operations must be handled through the migration service (`src/services/migration.service.js`). This consolidates all seeding logic and provides a single source of truth for database initialization.

### Service Structure

```javascript
// migration.service.js
const migrationService = require("../services/migration.service");

// Seed all data (roles, permissions, users)
const result = await migrationService.seedAll();

// Seed specific components
await migrationService.seedDefaultRoles(); // SUPER_ADMIN, TENANT_ADMIN, USER
await migrationService.seedApplicationRoles(); // Application-specific roles
await migrationService.seedPermissions(); // Permission records
await migrationService.seedRolesPermissions(); // Role-permission assignments
await migrationService.seedTablePermissions(); // Dynamic table permissions
await migrationService.seedUsers(); // Default system users

// Unseed operations
await migrationService.unseedAll();
await migrationService.unseedRoles(roleIds);
await migrationService.unseedUsers(emails);
```

### Controller Pattern

```javascript
// migration.controller.js
const migrationService = require("../services/migration.service");

exports.seeding = async (req, res) => {
  try {
    const result = await migrationService.seedAll();

    return res.status(200).send({
      success: true,
      status: 200,
      message: "Seeding success",
      data: result,
    });
  } catch (error) {
    return res.status(400).send({
      success: false,
      status: 400,
      message: error.message,
    });
  }
};
```

### Migration Config Pattern

```javascript
// migrate.js
const migrationService = require("../services/migration.service");

async function Up() {
  await db.sync({ alter: true });

  const seedResult = await migrationService.seedAll();
  console.log("Seed Results:", {
    roles: seedResult.roles,
    permissions: seedResult.permissions,
    rolesPermissions: seedResult.rolesPermissions,
    tablePermissions: seedResult.tablePermissions,
    users: seedResult.users,
  });
}
```

### Seeding Functions

Each seeding function follows a consistent pattern:

```javascript
/**
 * Seed default roles (SUPER_ADMIN, TENANT_ADMIN, USER)
 * @returns {Promise<Object>} Result of seeding operation
 */
async function seedDefaultRoles() {
  const result = {
    rolesCreated: 0,
    rolesUpdated: 0,
    errors: [],
  };

  try {
    for (const role of DEFAULT_ROLES) {
      try {
        const [roleInstance, created] = await Roles.findOrCreate({
          where: { id: role.id },
          defaults: role,
        });

        if (!created) {
          const changed = roleInstance.changed();
          if (changed.length > 0) {
            await roleInstance.update(role);
          }
          result.rolesUpdated++;
        } else {
          result.rolesCreated++;
        }
      } catch (error) {
        result.errors.push(`Error seeding role ${role.name}: ${error.message}`);
      }
    }
    return result;
  } catch (error) {
    result.errors.push(`Fatal error: ${error.message}`);
    return result;
  }
}
```

### Seeding Order

1. **Roles** - Default roles (SUPER_ADMIN, TENANT_ADMIN, USER) first
2. **Application Roles** - Application-specific roles (HEALTHCARE ADMIN, etc.)
3. **Permissions** - Permission records for all modules
4. **Role Permissions** - Assign permissions to roles
5. **Table Permissions** - Dynamic table-level permissions
6. **Users** - Default system users (last, as they reference roles)

### Guidelines

1. **Use findOrCreate** - All seeding operations must be idempotent
2. **Track results** - Return counts of created/updated/errored items
3. **Error isolation** - Individual seeding errors should not stop the entire process
4. **Use centralized constants** - Import from `../constants`, not inline values
5. **Separate concerns** - Each seeding function handles one type of data
6. **Console logging** - Use timestamped console.log for progress tracking
7. **Transaction safety** - Use transactions for related operations

---

## 20. Environment Variables

### Required Variables

```bash
# App
PORT=3000
SECRET=generateRandomSecretKey
APP_STORAGE_PATH=/app

# CORS
CORS_ORIGIN=http://localhost:3000,http:localhost

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

### Variable Naming

- Use `UPPER_SNAKE_CASE`
- Prefix with service name: `REDIS_HOST`, `RABBITMQ_URL`
- Use descriptive names: `JWT_ACCESS_EXPIRED`, `BACKUP_SCHEDULER`

---

## 21. Git & Deployment

### Diagrams & Illustrations

All architectural diagrams are located in `docs/illustrations/`:

| File | Description |
| --------------------------------------- | -------------------------------------------------- |
| `01-system-architecture.svg`            | System Architecture                                |
| `02-authentication-flow.svg`            | Authentication Flow                                |
| `03-rbac-abac.svg`                       | RBAC & ABAC Authorization                          |
| `04-database-schema.svg`                | Database Schema (ER Diagram)                       |
| `05-middleware-pipeline.svg`            | Middleware Pipeline                                |
| `06-api-endpoints.svg`                  | API Endpoints                                      |
| `07-multi-tenancy.svg`                  | Multi-Tenancy                                      |
| `08-backup-logging.svg`                 | Backup & Logging                                   |
| `09-security-layers.svg`                | Security Layers                                    |
| `10-project-structure.svg`               | Project Structure                                  |
| `11-docker-architecture.svg`            | Docker Architecture                                |
| `12-table-permissions-architecture.svg` | Table Permissions Architecture                     |
| `13-table-permissions-flow.svg`         | Table Permissions Flow                             |
| `14-table-permissions-erd.svg`          | Table Permissions ER Diagram                       |
| `15-menu-group-architecture.svg`        | Menu Group Architecture                            |
| `16-user-menu-resolution.svg`           | User Menu Resolution Flow                          |
| `21-calibration-lifecycle.svg`          | Calibration Device & Record Lifecycle              |
| `22-stock-transfer-flow.svg`            | Stock Transfer Sequence Flow                       |
| `23-certificate-lifecycle.svg`          | Certificate Lifecycle State Diagram                |

### Git Workflow

1. Create feature branch: `feature/add-email-queue`
2. Make changes and commit
3. Update documentation if API/schema changes
4. Push and create pull request

### Commit Message Format

```
type: subject

body (optional)
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

### Docker Deployment

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f backend

# Regenerate docs in container
docker exec -it backend node scripts/generate-html-doc.js
```

---

## 22. Unit Testing Standards

### Test Framework & Configuration

- **Framework**: Jest
- **Configuration**: `jest.config.js`
- **Test Directory**: `src/tests/`
- **Test File Pattern**: `*.test.js` or `*.spec.js`
- **Test Match**: `**/tests/**/*.test.js`, `**/tests/**/*.spec.js`

### Test Structure

```
src/tests/
├── test.utils.js              # Shared test helpers
├── utils/                     # Utility function tests
│   ├── appError.test.js
│   ├── controllerWrapper.test.js
│   ├── response.test.js
│   └── ...
├── services/                  # Service layer tests
│   ├── tenantAudit.service.test.js
│   ├── tenantContext.test.js
│   └── ...
├── validators/                # Validator tests
│   ├── auth.validator.test.js
│   └── ...
└── middleware/                # Middleware tests
```

### Test File Naming

- **Service tests**: `{service_name}.service.test.js`
- **Controller tests**: `{controller_name}.controller.test.js`
- **Middleware tests**: `{middleware_name}.test.js`
- **Utility tests**: `{utility_name}.test.js`
- **Validator tests**: `{validator_name}.validator.test.js`

### Test Organization

```javascript
/**
 * Tests for {module_name}
 */

// 1. Mock dependencies first
jest.mock("../../models", () => ({
  ModelName: mockModel,
}));

jest.mock("../../utils/helper.util", () => ({
  helperFunction: jest.fn(),
}));

// 2. Import mocked modules
const { mockedFunction } = require("../../services/service_name");

describe("Module Name", () => {
  // 3. Setup before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Function Name", () => {
    it("should {expected_behavior} when {condition}", async () => {
      // Arrange
      const input = { ... };

      // Act
      const result = await functionName(input);

      // Assert
      expect(result).toEqual(expectedOutput);
    });
  });
});
```

### Test Naming Conventions

- **Describe blocks**: Use module/service names
  - `describe("Tenant Audit Service")`
  - `describe("AppError")`
- **Nested describe blocks**: Use function names
  - `describe("createLog")`
  - `describe("toJSON")`
- **It blocks**: Use descriptive sentences
  - `it("should create an audit log entry")`
  - `it("should return error as JSON object without details in production")`
  - `it("should set status, message, isOperational, and details")`

### Mocking Standards

#### Mocking Models

```javascript
const mockModel = {
  findOne: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  destroy: jest.fn(),
  findAndCountAll: jest.fn(),
  count: jest.fn(),
};

jest.mock("../../models", () => ({
  ModelName: mockModel,
}));
```

#### Mocking Services

```javascript
jest.mock("../../services/other_service", () => ({
  otherFunction: jest.fn().mockResolvedValue({ success: true }),
}));
```

#### Mocking Request/Response

```javascript
const mockReq = {
  body: { fieldName: "value" },
  query: { page: "1" },
  params: { id: "123" },
  user: { id: "user-1", tenantId: "tenant-1" },
  ip: "127.0.0.1",
  headers: { "user-agent": "TestBrowser" },
};

const mockRes = {
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
  locals: {},
};
```

#### Mocking Transactions

```javascript
const mockTransaction = {
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
  toObject: jest.fn().mockReturnValue({}),
  LOCK: { UPDATE: "UPDATE" },
};
```

### Test Patterns

#### Testing Success Cases

```javascript
it("should return user data when found", async () => {
  const mockUser = { id: "1", email: "test@example.com" };
  Users.findOne.mockResolvedValue(mockUser);

  const result = await getUser("1");

  expect(Users.findOne).toHaveBeenCalledWith({ where: { id: "1" } });
  expect(result).toEqual(mockUser);
});
```

#### Testing Error Cases

```javascript
it("should throw NotFoundError when user not found", async () => {
  Users.findOne.mockResolvedValue(null);

  await expect(getUser("invalid-id")).rejects.toThrow("User not found");
  // Or
  await expect(getUser("invalid-id")).rejects.toEqual({
    status: 404,
    message: "User not found",
  });
});
```

#### Testing Conditional Logic

```javascript
it("should return error without details in production", () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const error = new AppError(400, "Bad request", true, { field: "email" });

  const json = error.toJSON();

  expect(json).toEqual({
    success: false,
    status: 400,
    message: "Bad request",
  });

  process.env.NODE_ENV = originalEnv;
});
```

#### Testing Async Operations

```javascript
it("should handle async operations correctly", async () => {
  const mockData = { id: "1", name: "test" };
  Model.create.mockResolvedValue(mockData);

  const result = await createResource(mockData);

  expect(result).toEqual(mockData);
  expect(Model.create).toHaveBeenCalledWith(mockData);
});
```

#### Testing Multiple Scenarios

```javascript
describe("logAuthEvent", () => {
  it("should log login success with INFO severity", async () => {
    // ...
  });

  it("should log login failed with WARNING severity", async () => {
    // ...
  });
});
```

### Test Utilities

Use shared helpers from `src/tests/test.utils.js`:

```javascript
const {
  createMockRes,
  createMockReq,
  createMockNext,
  createMockModel,
  createMockTransaction,
  wait,
  mockThrow,
  mockResolve,
  mockResolveThenThrow,
} = require("../test.utils");
```

### Coverage Requirements

- **Target**: 80% for branches, functions, lines, and statements
- **Ignored patterns**: `/node_modules/`, `/tests/`, config files
- **Run tests**: `npm test` or `npx jest`

### Best Practices

1. **Arrange-Act-Assert**: Structure tests in three clear phases

   ```javascript
   // Arrange - setup inputs and mocks
   // Act - execute the function
   // Assert - verify the results
   ```

2. **One assertion per concept**: Each `it` block should test one specific behavior

3. **Isolate tests**: Use `beforeEach` to clear mocks and reset state

4. **Mock external dependencies**: Never call real databases, APIs, or file systems in unit tests

5. **Test edge cases**: Test null, undefined, empty arrays, boundary values

6. **Clean up environment**: Restore `process.env` changes after tests

7. **Use meaningful data**: Test data should be realistic and descriptive

8. **Test documentation**: Include JSDoc comments for complex test scenarios

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npx jest src/tests/utils/appError.test.js

# Run with coverage
npx jest --coverage

# Watch mode
npx jest --watch
```

### Test Categories

| Category         | Location                 | Purpose                    |
| ---------------- | ------------------------ | -------------------------- |
| Unit Tests       | `src/tests/utils/`       | Test utility functions     |
| Service Tests    | `src/tests/services/`    | Test business logic        |
| Validator Tests  | `src/tests/validators/`  | Test Joi schemas           |
| Middleware Tests | `src/tests/middleware/`  | Test middleware functions  |
| Controller Tests | `src/tests/controllers/` | Test request/response flow |

---

## 23. Model Discovery Standards

### Overview

Model Discovery is a system that automatically detects and registers database models/tables at startup. It provides dynamic permission management by discovering all models and making them available for the table permission system.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Application Startup                     │
├─────────────────────────────────────────────────────────────┤
│  1. Models loaded from src/models/                          │
│  2. ModelDiscoveryService scans all models                   │
│  3. Registered models → Models table                         │
│  4. Table permissions auto-seeded                            │
└─────────────────────────────────────────────────────────────┘
```

### Model Discovery Service

**File**: `src/services/modelDiscovery.service.js`

```javascript
const modelDiscoveryService = require("../services/modelDiscovery.service");

// Discover and register all models
const result = await modelDiscoveryService.discoverAllModels();

// Get registered models
const models = await modelDiscoveryService.getAllModels();

// Get model by name
const model = await modelDiscoveryService.getModelByName("Users");

// Register single model
const registered = await modelDiscoveryService.registerModel({
  modelName: "Users",
  tableName: "users",
  module: "user",
  description: "User management",
});
```

### Controller Pattern

**File**: `src/controllers/modelDiscovery.controller.js`

```javascript
const {
  ModelDiscoveryController,
} = require("../controllers/modelDiscovery.controller");

// GET /api/v1/model-discovery/models
const { models } = await ModelDiscoveryController.getAllModels(req, res);

// POST /api/v1/model-discovery/discover
const discovered = await ModelDiscoveryController.discoverModels(req, res);
```

### Model Registration Attributes

When models are registered, they include:

| Attribute        | Description                | Example                                    |
| ---------------- | -------------------------- | ------------------------------------------ |
| `modelName`      | Sequelize model class name | `Users`, `Tenants`                         |
| `tableName`      | Actual database table name | `users`, `tenants`                         |
| `module`         | Logical grouping           | `user`, `tenant`                           |
| `attributeCount` | Number of columns          | `12`                                       |
| `attributes`     | List of column names       | `["id", "email", ...]`                     |
| `relationCount`  | Number of associations     | `5`                                        |
| `relations`      | List of relation details   | `[{ model: "Roles", type: "BELONGS_TO" }]` |

### Model Discovery Cron

**File**: `src/middlewares/modelDiscoveryCron.js`

Periodic re-discovery can be enabled for dynamic model registration:

```javascript
const modelDiscoveryCron = require("../middlewares/modelDiscoveryCron");

// Configuration
const CRON_EXPRESSION = "0 */5 * * *"; // Every 5 minutes
```

### Best Practices

1. **Model naming consistency**: Use PascalCase for model class names
2. **Module grouping**: Group related models by module name
3. **Relation definitions**: Ensure all `associate()` methods are defined
4. **Auto-seeding**: Table permissions are automatically seeded on startup
5. **SUPER_ADMIN bypass**: SUPER_ADMIN role bypasses all permission checks

## 24. Menu Group & User Menu Grant Standards

### Overview

The Menu Group system provides a unified, self-referencing hierarchical permission model for UI menu access:

1. **Menu Groups** (`menu_groups`): A self-referencing table containing both top-level navigation categories and individual sub-menu items (using the `parentId` field).
2. **Role Menu Permissions** (`role_menu_permissions`): Junction table mapping permissions (`read` or `write` access) on menu groups directly to roles.
3. **No Per-User Overrides**: Access is determined solely by the user's role. Per-user menu overrides/grants have been removed in favor of a clean, cached role permissions matrix.

### Database Schema

| Table                  | Description                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `menu_groups`          | Navigation groups and items containing labels, icons, slugs, sort orders, and parent-child links |
| `role_menu_permissions` | Maps roles to menu groups with a `permissionType` enum (`"read"` or `"write"`)                    |

### Permission Types

| Permission Type | Behavior                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `read`          | Role can view the menu group/item.                                                             |
| `write`         | Role can view the menu group/item and perform modifications (implicitly includes read access). |

### SUPER_ADMIN Behavior

The `SUPER_ADMIN` role bypasses all database check lookups:
- Automatically receives access to all active menu groups and sub-menu items.
- Built directly into the `dynamicAccess` middleware and controllers.

### Service Architecture

Menu permissions are handled within the `RolesService` layer:
- **`src/services/roles.service.js`**

**Key Functions**:
```javascript
// Get cached or database-resolved role permissions matrix for middleware check
const matrix = await RolesService.getRolePermissionsMatrix(roleId);
// Returns an object structure mapping names and slugs to allowed permission types:
// {
//   "Dashboard": ["read", "write"],
//   "users": ["read"]
// }
```

### Build User Menu Resolution Logic

The user's menu tree is resolved by:
1. Fetching all active parent groups with their child items ordered by `sortOrder`.
2. Filtering the hierarchy against the role's assigned permissions in `role_menu_permissions`.
3. Returning the deduplicated, structured menu list representing the user's authorized sidebar options.

### Controller Standards

**File**: `src/controllers/menuGroup.controller.js`

Controllers must use:
1. Joi schemas for input validation.
2. The `success()` response helper.
3. Proper async mapping via `asyncHandlerWithMapping`.

### Seeding Standards

**File**: `src/utils/seedMenuGroups.js`

Initial menu seeding is performed during migration or database initialization:
1. `seedMenuGroups()` - Creates the hierarchical parent and child menu groups.
2. `seedRoleMenuPermissions()` - Sets up role assignments in `role_menu_permissions` for default roles.

### API Endpoints

All routes are prefixed with `/api/v1/menu-groups`:

| Method | Route              | Access  | Description                                 |
| ------ | ------------------ | ------- | ------------------------------------------- |
| POST   | `/filter`          | Private | Get all menu groups (filters by role ID)    |
| POST   | `/get-assignments` | Private | Get active menu assignments for user's role |
| GET    | `/menu-groups`     | Admin   | Admin fetch of all menu groups              |
| GET    | `/roles`           | Admin   | Get all available roles                     |
| POST   | `/create`          | Admin   | Create a new menu group                     |
| POST   | `/update`          | Admin   | Update an existing menu group               |
| POST   | `/delete`          | Admin   | Delete a menu group                         |
| POST   | `/assign`          | Admin   | Assign a menu group to a role               |
| POST   | `/revoke`          | Admin   | Revoke a menu group from a role             |
| POST   | `/assign-item`     | Admin   | Assign a sub-menu item to a role            |
| POST   | `/revoke-item`     | Admin   | Revoke a sub-menu item from a role          |
| POST   | `/bulk-assign`     | Admin   | Bulk assign menu groups to a role           |
| POST   | `/bulk-revoke`     | Admin   | Bulk revoke menu groups from a role         |

### Best Practices

1. **Always Validate Inputs**: Use the validation schema utility inside controllers.
2. **SUPER_ADMIN Bypass**: Don't seed explicit role menu permissions for `SUPER_ADMIN`.
3. **Menu Group Slugs**: Always define unique, lowercase, URL-friendly slugs for menu routing mapping.
4. **Caching & Matrix**: Invalidate the cached role permission matrix in Redis when role-menu permissions change.

---

## Quick Reference

### Key Patterns

| Pattern         | Location                             | Example                                 |
| --------------- | ------------------------------------ | --------------------------------------- |
| Response helper | `src/utils/response.util.js`         | `success(res, data, message)`           |
| Error handler   | `src/utils/controllerWrapper.util.js`| `asyncHandlerWithMapping(fn, errorMap)` |
| Validation      | `src/validators/*.validator.js`      | `Joi.object({ ... })`                   |
| Caching         | `src/services/redis.service.js`      | `get()`, `set()`, `del()`               |
| Locking         | `src/services/redis.service.js`      | `acquireLock()`, `releaseLock()`        |
| Email queue     | `src/services/emailQueue.service.js` | `queueActivationEmail()`                |
| Constants       | `src/constants/`                     | `ROLE_NAMES`, `DEFAULT_LIMIT`           |
| Migration       | `src/services/migration.service.js`  | `seedAll()`, `unseedAll()`              |

### API Endpoints

| Method | Route                     | Access  | Description      |
| ------ | ------------------------- | ------- | ---------------- |
| POST   | `/api/v1/auth/register`   | Public  | Register user    |
| GET    | `/api/v1/auth/activation` | Public  | Activate account |
| POST   | `/api/v1/auth/login`      | Public  | Login            |
| POST   | `/api/v1/auth/send-otp`   | Public  | Send OTP         |
| POST   | `/api/v1/auth/logout`     | Private | Logout           |
| GET    | `/api/v1/users/all`       | Private | Get all users    |
| POST   | `/api/v1/tenants/all`     | Private | Get all tenants  |
| GET    | `/docs`                   | Public  | Swagger docs     |
| GET    | `/documentation`          | Public  | HTML docs        |

---

_Last updated: 2026-05-20_
