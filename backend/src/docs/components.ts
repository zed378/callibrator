/**
 * Swagger Components
 *
 * Reusable component definitions for all API routes.
 * Imported by generateSwagger.js to build the central OpenAPI spec.
 *
 * To add a new component:
 *   1. Add to securitySchemes, schemas, parameters, etc. below
 *   2. Reference it in route files using $ref: '#/components/schemas/MySchema'
 *
 * P9-24 (ADR-087 Am. 28): converted from components.js with the data verbatim; `export =` keeps
 * the object `require()` returned. Read by scripts/openapi/build.ts, which merges it into the
 * code-first document (openapi.json, byte-identical across the conversion).
 */

const componentsDoc = {
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      // ---------------------------------------------------------------
      // Generic Response Wrappers
      // ---------------------------------------------------------------
      SuccessResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          status: { type: "integer", example: 200 },
          message: { type: "string", example: "Success" },
          data: { type: "object" },
        },
      },
      ErrorResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          status: { type: "integer", example: 400 },
          message: { type: "string", example: "Error message" },
          errors: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      // P9-18: `PaginatedResponse` is gone. No operation referenced it, and it
      // documented a `pagination` object the house envelope has never had
      // (rows in `data`, pagination in a top-level `meta`; see `envelope.ts`).

      // ---------------------------------------------------------------
      // Auth Schemas
      // ---------------------------------------------------------------
      RegisterRequest: {
        type: "object",
        required: ["firstName", "lastName", "username", "email", "password"],
        properties: {
          firstName: { type: "string", example: "John" },
          lastName: { type: "string", example: "Doe" },
          username: { type: "string", example: "johndoe" },
          email: {
            type: "string",
            format: "email",
            example: "user@example.com",
          },
          password: { type: "string", minLength: 6, example: "Secret123" },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["user", "password"],
        properties: {
          user: {
            type: "string",
            description: "Username or email",
            example: "sys",
          },
          password: { type: "string", example: "Your-Password-1" },
        },
      },
      SendOtpRequest: {
        type: "object",
        required: ["email"],
        properties: {
          email: {
            type: "string",
            format: "email",
            example: "user@example.com",
          },
        },
      },
      ResetPasswordRequest: {
        type: "object",
        required: ["email", "otp", "password"],
        properties: {
          email: { type: "string", format: "email" },
          otp: { type: "string" },
          password: { type: "string", minLength: 6 },
        },
      },

      // ---------------------------------------------------------------
      // User Schemas
      // ---------------------------------------------------------------
      // P9-21: `User` is documented code-first (routes/api/user.openapi.ts); JSDoc that $refs it resolves there.
      UserCreateRequest: {
        type: "object",
        required: [
          "username",
          "firstName",
          "lastName",
          "email",
          "password",
          "roleId",
        ],
        properties: {
          username: {
            type: "string",
            description: "Username (alphanumeric, 3-30 chars)",
          },
          firstName: { type: "string", description: "User's first name" },
          lastName: { type: "string", description: "User's last name" },
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8 },
          roleId: { type: "string", format: "uuid" },
          phone: { type: "string" },
          status: {
            type: "string",
            enum: ["active", "inactive", "suspended"],
            default: "active",
          },
        },
      },
      UserUpdateRequest: {
        type: "object",
        properties: {
          username: { type: "string" },
          email: { type: "string", format: "email" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          phone: { type: "string" },
          status: { type: "string", enum: ["active", "inactive", "suspended"] },
          roleId: { type: "string", format: "uuid" },
        },
      },

      // ---------------------------------------------------------------
      // Role Schemas
      // ---------------------------------------------------------------
      Role: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tenantId: { type: "string", format: "uuid" },
          name: {
            type: "string",
            description: "Internal role name (e.g., admin, manager)",
          },
          nameToShow: {
            type: "string",
            description: "Display name (e.g., Administrator)",
          },
          description: { type: "string" },
          isSystem: {
            type: "boolean",
            description: "System roles cannot be deleted",
          },
          status: { type: "string", enum: ["active", "inactive"] },
          sortOrder: { type: "integer" },
          roleLevel: { type: "integer", description: "Hierarchical level" },
          permissions: {
            type: "array",
            items: { $ref: "#/components/schemas/Permission" },
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      RoleCreateRequest: {
        type: "object",
        required: ["name", "nameToShow"],
        properties: {
          name: { type: "string" },
          nameToShow: { type: "string" },
          description: { type: "string" },
          isSystem: { type: "boolean", default: false },
          status: {
            type: "string",
            enum: ["active", "inactive"],
            default: "active",
          },
          sortOrder: { type: "integer", default: 0 },
          roleLevel: { type: "integer" },
          permissionIds: {
            type: "array",
            items: { type: "string", format: "uuid" },
          },
        },
      },

      // ---------------------------------------------------------------
      // Permission Schemas
      // ---------------------------------------------------------------
      Permission: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: {
            type: "string",
            description: "Permission name (e.g., user:read)",
          },
          module: { type: "string", description: "Module name (e.g., user)" },
          action: {
            type: "string",
            description: "Action name (e.g., read, write, update, delete)",
          },
          description: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },

      // ---------------------------------------------------------------
      // Menu Schemas
      // ---------------------------------------------------------------
      MenuGroup: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tenantId: { type: "string", format: "uuid" },
          parentId: { type: "string", format: "uuid", nullable: true },
          name: { type: "string" },
          icon: { type: "string" },
          sortOrder: { type: "integer" },
          isActive: { type: "boolean" },
          children: {
            type: "array",
            items: { $ref: "#/components/schemas/MenuGroup" },
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },

      // ---------------------------------------------------------------
      // Tenant Schemas
      // ---------------------------------------------------------------
      // P9-21: `Tenant` is documented code-first (docs/openapi/tenantSchemas.ts).
      TenantCreateRequest: {
        type: "object",
        required: ["name", "code"],
        properties: {
          name: { type: "string" },
          code: { type: "string" },
          subdomain: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string" },
          address: { type: "string" },
          domain: { type: "string" },
          plan: {
            type: "string",
            enum: ["free", "professional", "business", "enterprise"],
          },
          limitSeats: { type: "integer" },
          limitStorageMb: { type: "integer" },
          settings: { type: "object" },
        },
      },
      TenantSettings: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tenantId: { type: "string", format: "uuid" },
          key: { type: "string" },
          value: { type: "object", description: "JSON value for the setting" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      // P9-21: `TenantBackup` is documented code-first (routes/api/tenantBackup.openapi.ts).

      // ---------------------------------------------------------------
      // Warehouse Schemas: code-first since P9-21 (warehouse.openapi.ts,
      // @callibrator/contracts/warehouse). `Warehouse` and `StorageLocation`
      // are defined there; the JSDoc copies (and the unused *CreateRequest
      // shapes) were removed, because the builder refuses a component defined
      // twice, differently.
      // ---------------------------------------------------------------

      // ---------------------------------------------------------------
      // Stock Schemas: code-first since P9-21 (stock.openapi.ts,
      // @callibrator/contracts/stock). The JSDoc copies of Stock,
      // StockAdjustment, StockTransfer, StockOpname and their *CreateRequest
      // shapes were removed: the builder refuses a component defined twice,
      // and the request shapes are the validators' own schemas now.
      // ---------------------------------------------------------------

      // ---------------------------------------------------------------
      // User Permission Schemas
      // ---------------------------------------------------------------
      UserPermission: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          userId: { type: "string", format: "uuid" },
          permissionId: { type: "string", format: "uuid" },
          user: { $ref: "#/components/schemas/User" },
          permission: { $ref: "#/components/schemas/Permission" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      UserPermissionCreateRequest: {
        type: "object",
        required: ["userId", "permissionId"],
        properties: {
          userId: { type: "string", format: "uuid" },
          permissionId: { type: "string", format: "uuid" },
        },
      },

      // ---------------------------------------------------------------
      // Role Menu Permission Schemas
      // ---------------------------------------------------------------
      RoleMenuPermission: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          roleId: { type: "string", format: "uuid" },
          menuGroupId: { type: "string", format: "uuid" },
          canCreate: { type: "boolean" },
          canRead: { type: "boolean" },
          canUpdate: { type: "boolean" },
          canDelete: { type: "boolean" },
          role: { $ref: "#/components/schemas/Role" },
          menuGroup: { $ref: "#/components/schemas/MenuGroup" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      RoleMenuPermissionCreateRequest: {
        type: "object",
        required: ["roleId", "menuGroupId"],
        properties: {
          roleId: { type: "string", format: "uuid" },
          menuGroupId: { type: "string", format: "uuid" },
          canCreate: { type: "boolean", default: false },
          canRead: { type: "boolean", default: false },
          canUpdate: { type: "boolean", default: false },
          canDelete: { type: "boolean", default: false },
        },
      },
    },
  },
};

export = componentsDoc;
