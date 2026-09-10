/**
 * Swagger Components
 *
 * Reusable component definitions for all API routes.
 * Imported by generateSwagger.js to build the central OpenAPI spec.
 *
 * To add a new component:
 *   1. Add to securitySchemes, schemas, parameters, etc. below
 *   2. Reference it in route files using $ref: '#/components/schemas/MySchema'
 */

module.exports = {
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
      PaginatedResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          status: { type: "integer", example: 200 },
          message: { type: "string" },
          data: { type: "array" },
          pagination: {
            type: "object",
            properties: {
              page: { type: "integer", example: 1 },
              limit: { type: "integer", example: 20 },
              total: { type: "integer", example: 100 },
              totalPages: { type: "integer", example: 5 },
            },
          },
        },
      },

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
          password: { type: "string", example: "123123" },
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
      User: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tenantId: { type: "string", format: "uuid" },
          username: { type: "string" },
          email: { type: "string", format: "email" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          phone: { type: "string" },
          avatarUrl: { type: "string", format: "uri" },
          isActive: { type: "boolean" },
          status: { type: "string", enum: ["active", "inactive", "suspended"] },
          role: { $ref: "#/components/schemas/Role" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
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
      Tenant: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          code: { type: "string", description: "Tenant code (e.g., ABC)" },
          subdomain: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string" },
          address: { type: "string" },
          domain: { type: "string" },
          plan: {
            type: "string",
            enum: ["free", "professional", "business", "enterprise"],
          },
          status: { type: "string", enum: ["active", "suspended", "deleted"] },
          trialEndsAt: { type: "string", format: "date-time" },
          settings: {
            type: "object",
            description: "JSON object for tenant-specific settings",
          },
          limitSeats: { type: "integer" },
          limitStorageMb: { type: "integer" },
          isDeleted: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
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
      TenantBackup: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tenantId: { type: "string", format: "uuid" },
          backupPath: { type: "string" },
          size: {
            type: "integer",
            format: "int64",
            description: "File size in bytes",
          },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "failed", "deleted"],
          },
          backupType: { type: "string", enum: ["full", "user_only"] },
          tag: { type: "string" },
          filePath: { type: "string" },
          fileSize: { type: "integer", format: "int64" },
          recordCount: { type: "integer" },
          errorMessage: { type: "string" },
          restoredAt: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time" },
          metadata: { type: "object" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },

      // ---------------------------------------------------------------
      // Warehouse Schemas
      // ---------------------------------------------------------------
      Warehouse: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tenantId: { type: "string", format: "uuid" },
          name: { type: "string" },
          code: { type: "string" },
          address: { type: "string" },
          description: { type: "string" },
          status: { type: "string", enum: ["active", "inactive"] },
          isDeleted: { type: "boolean" },
          locations: {
            type: "array",
            items: { $ref: "#/components/schemas/StorageLocation" },
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      WarehouseCreateRequest: {
        type: "object",
        required: ["name", "code"],
        properties: {
          name: { type: "string" },
          code: { type: "string" },
          address: { type: "string" },
          description: { type: "string" },
          status: {
            type: "string",
            enum: ["active", "inactive"],
            default: "active",
          },
        },
      },
      StorageLocation: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tenantId: { type: "string", format: "uuid" },
          warehouseId: { type: "string", format: "uuid" },
          name: { type: "string" },
          code: { type: "string" },
          description: { type: "string" },
          isActive: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      StorageLocationCreateRequest: {
        type: "object",
        required: ["warehouseId", "name", "code"],
        properties: {
          warehouseId: { type: "string", format: "uuid" },
          name: { type: "string" },
          code: { type: "string" },
          description: { type: "string" },
          isActive: { type: "boolean", default: true },
        },
      },

      // ---------------------------------------------------------------
      // Stock Schemas
      // ---------------------------------------------------------------
      Stock: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tenantId: { type: "string", format: "uuid" },
          warehouseId: { type: "string", format: "uuid" },
          locationId: { type: "string", format: "uuid", nullable: true },
          itemName: { type: "string" },
          sku: { type: "string" },
          serialNumber: { type: "string" },
          quantity: { type: "integer" },
          minQuantity: { type: "integer" },
          description: { type: "string" },
          isDeleted: { type: "boolean" },
          warehouse: { $ref: "#/components/schemas/Warehouse" },
          location: { $ref: "#/components/schemas/StorageLocation" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      StockCreateRequest: {
        type: "object",
        required: ["warehouseId", "itemName"],
        properties: {
          warehouseId: { type: "string", format: "uuid" },
          locationId: { type: "string", format: "uuid" },
          itemName: { type: "string" },
          sku: { type: "string" },
          serialNumber: { type: "string" },
          quantity: { type: "integer", default: 0 },
          minQuantity: { type: "integer", default: 0 },
          description: { type: "string" },
        },
      },
      StockAdjustment: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tenantId: { type: "string", format: "uuid" },
          warehouseId: { type: "string", format: "uuid" },
          locationId: { type: "string", format: "uuid", nullable: true },
          type: {
            type: "string",
            enum: ["addition", "subtraction", "write_off"],
          },
          quantity: { type: "integer" },
          reason: { type: "string" },
          adjustedBy: { type: "string", format: "uuid" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      StockAdjustmentCreateRequest: {
        type: "object",
        required: ["warehouseId", "type", "quantity"],
        properties: {
          warehouseId: { type: "string", format: "uuid" },
          locationId: { type: "string", format: "uuid" },
          type: {
            type: "string",
            enum: ["addition", "subtraction", "write_off"],
          },
          quantity: { type: "integer" },
          reason: { type: "string" },
        },
      },
      StockTransfer: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tenantId: { type: "string", format: "uuid" },
          fromWarehouseId: { type: "string", format: "uuid" },
          toWarehouseId: { type: "string", format: "uuid" },
          status: {
            type: "string",
            enum: ["pending", "in_transit", "completed", "cancelled"],
          },
          requestedBy: { type: "string", format: "uuid" },
          approvedBy: { type: "string", format: "uuid", nullable: true },
          itemName: { type: "string" },
          quantity: { type: "integer" },
          transferDate: { type: "string", format: "date-time" },
          notes: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      StockTransferCreateRequest: {
        type: "object",
        required: ["fromWarehouseId", "toWarehouseId", "itemName", "quantity"],
        properties: {
          fromWarehouseId: { type: "string", format: "uuid" },
          toWarehouseId: { type: "string", format: "uuid" },
          itemName: { type: "string" },
          quantity: { type: "integer" },
          notes: { type: "string" },
        },
      },
      StockOpname: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tenantId: { type: "string", format: "uuid" },
          warehouseId: { type: "string", format: "uuid" },
          status: {
            type: "string",
            enum: ["draft", "in_progress", "completed"],
          },
          scheduledAt: { type: "string", format: "date-time" },
          completedAt: { type: "string", format: "date-time" },
          performedBy: { type: "string", format: "uuid" },
          notes: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      StockOpnameCreateRequest: {
        type: "object",
        required: ["warehouseId", "scheduledAt"],
        properties: {
          warehouseId: { type: "string", format: "uuid" },
          scheduledAt: { type: "string", format: "date-time" },
          notes: { type: "string" },
        },
      },

      // ---------------------------------------------------------------
      // Calibration Device Schemas
      // ---------------------------------------------------------------
      CalibrationDevice: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tenantId: { type: "string", format: "uuid" },
          name: { type: "string" },
          type: { type: "string" },
          serialNumber: { type: "string" },
          manufacturer: { type: "string" },
          model: { type: "string" },
          specifications: { type: "string" },
          location: { type: "string" },
          status: {
            type: "string",
            enum: ["active", "inactive", "maintenance", "retired"],
          },
          calibrationDueDate: { type: "string", format: "date-time" },
          lastCalibrationAt: { type: "string", format: "date-time" },
          isDeleted: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      CalibrationDeviceCreateRequest: {
        type: "object",
        required: ["name", "type"],
        properties: {
          name: { type: "string" },
          type: { type: "string" },
          serialNumber: { type: "string" },
          manufacturer: { type: "string" },
          model: { type: "string" },
          specifications: { type: "string" },
          location: { type: "string" },
          status: {
            type: "string",
            enum: ["active", "inactive", "maintenance", "retired"],
            default: "active",
          },
          calibrationDueDate: { type: "string", format: "date-time" },
        },
      },

      // ---------------------------------------------------------------
      // Calibration Record Schemas
      // ---------------------------------------------------------------
      CalibrationRecord: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tenantId: { type: "string", format: "uuid" },
          deviceId: { type: "string", format: "uuid" },
          performedBy: { type: "string", format: "uuid" },
          performedAt: { type: "string", format: "date-time" },
          dueAt: { type: "string", format: "date-time" },
          method: { type: "string" },
          standard: { type: "string" },
          tolerance: { type: "string" },
          result: { type: "string", enum: ["pass", "fail", "pending"] },
          notes: { type: "string" },
          status: {
            type: "string",
            enum: ["scheduled", "in_progress", "completed", "cancelled"],
          },
          device: { $ref: "#/components/schemas/CalibrationDevice" },
          certificates: {
            type: "array",
            items: { $ref: "#/components/schemas/Certificate" },
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      CalibrationRecordCreateRequest: {
        type: "object",
        required: ["deviceId", "performedAt"],
        properties: {
          deviceId: { type: "string", format: "uuid" },
          performedAt: { type: "string", format: "date-time" },
          dueAt: { type: "string", format: "date-time" },
          method: { type: "string" },
          standard: { type: "string" },
          tolerance: { type: "string" },
          notes: { type: "string" },
        },
      },

      // ---------------------------------------------------------------
      // Certificate Schemas
      // ---------------------------------------------------------------
      Certificate: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          tenantId: { type: "string", format: "uuid" },
          calibrationRecordId: {
            type: "string",
            format: "uuid",
            nullable: true,
          },
          deviceId: { type: "string", format: "uuid" },
          certificateNumber: { type: "string" },
          type: {
            type: "string",
            enum: ["calibration", "maintenance", "verification"],
          },
          status: {
            type: "string",
            enum: [
              "draft",
              "pending_approval",
              "approved",
              "signed",
              "revoked",
            ],
          },
          calibratedBy: { type: "string", format: "uuid", nullable: true },
          approvedBy: { type: "string", format: "uuid", nullable: true },
          signedBy: { type: "string", format: "uuid", nullable: true },
          digitalSignature: { type: "string" },
          digitalSignatureKeyId: { type: "string" },
          signedAt: { type: "string", format: "date-time" },
          issueDate: { type: "string", format: "date-time" },
          validUntil: { type: "string", format: "date-time" },
          standard: {
            type: "string",
            description: "Applicable standard (e.g., ISO 17025, KARS, SNARS)",
          },
          summary: { type: "string" },
          conditions: { type: "string" },
          notes: { type: "string" },
          filePath: { type: "string" },
          fileSize: { type: "integer", format: "int64" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      CertificateCreateRequest: {
        type: "object",
        required: ["deviceId"],
        properties: {
          calibrationRecordId: { type: "string", format: "uuid" },
          deviceId: { type: "string", format: "uuid" },
          type: {
            type: "string",
            enum: ["calibration", "maintenance", "verification"],
          },
          standard: { type: "string" },
          summary: { type: "string" },
        },
      },

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
