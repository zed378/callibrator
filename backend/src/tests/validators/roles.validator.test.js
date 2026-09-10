/**
 * Role validator tests
 */
const {
  createRoleSchema,
  updateRoleSchema,
  assignRoleSchema,
  assignPermissionSchema,
  validate,
  formatErrors,
} = require("../../validators/roles.validator");

const UUID = "8c352a92-d6cf-4b71-b0db-6e69622d1b11";

describe("Role Validators", () => {
  describe("createRoleSchema", () => {
    it("should validate a valid role", () => {
      const { error, value } = validate(
        { name: "Calibrator", description: "Calibration role" },
        createRoleSchema,
      );
      expect(error).toBeUndefined();
      expect(value.name).toBe("Calibrator");
    });

    it("should trim name", () => {
      const { value } = validate({ name: "  Calibrator  " }, createRoleSchema);
      expect(value.name).toBe("Calibrator");
    });

    it("should reject a missing name", () => {
      const { error } = validate({}, createRoleSchema);
      expect(error).toBeDefined();
    });

    it("should reject a short name", () => {
      const { error } = validate({ name: "a" }, createRoleSchema);
      expect(error).toBeDefined();
    });
  });

  describe("updateRoleSchema", () => {
    it("should validate a partial update", () => {
      const { error, value } = validate(
        { status: "inactive" },
        updateRoleSchema,
      );
      expect(error).toBeUndefined();
      expect(value.status).toBe("inactive");
    });

    it("should reject an invalid status", () => {
      const { error } = validate({ status: "bogus" }, updateRoleSchema);
      expect(error).toBeDefined();
    });
  });

  describe("assignRoleSchema", () => {
    it("should validate userId and roleId", () => {
      const { error } = validate(
        { userId: UUID, roleId: UUID },
        assignRoleSchema,
      );
      expect(error).toBeUndefined();
    });

    it("should require both ids", () => {
      const { error } = validate({ userId: UUID }, assignRoleSchema);
      expect(error).toBeDefined();
    });
  });

  describe("assignPermissionSchema", () => {
    it("should validate menuGroupId and permissionType", () => {
      const { error } = validate(
        { menuGroupId: UUID, permissionType: "write" },
        assignPermissionSchema,
      );
      expect(error).toBeUndefined();
    });

    it("should reject an invalid permissionType", () => {
      const { error } = validate(
        { menuGroupId: UUID, permissionType: "admin" },
        assignPermissionSchema,
      );
      expect(error).toBeDefined();
    });
  });

  describe("formatErrors", () => {
    it("should format validation error details", () => {
      const { error } = validate({}, createRoleSchema);
      const formatted = formatErrors(error.details);
      expect(Array.isArray(formatted)).toBe(true);
      expect(formatted[0]).toHaveProperty("field");
      expect(formatted[0]).toHaveProperty("message");
    });

    it("should handle nested field paths", () => {
      const formatted = formatErrors([
        { path: ["name"], message: '"name" is not allowed to be empty' },
      ]);
      expect(formatted[0].field).toBe("name");
    });

    it("should return empty array for empty input", () => {
      const formatted = formatErrors([]);
      expect(formatted).toEqual([]);
    });
  });
});
