/**
 * Role validator tests
 *
 * P9-11 (ADR-093): the module's own validate/formatErrors helpers are gone;
 * the schemas are exercised through the shared checkInput (validators/input).
 */
const {
  createRoleSchema,
  updateRoleSchema,
  createMenuSchema,
  updateMenuSchema,
  assignRoleSchema,
  assignPermissionSchema,
} = require("../../validators/roles.validator");
const { checkInput } = require("../../validators/input");

const UUID = "8c352a92-d6cf-4b71-b0db-6e69622d1b11";

describe("Role Validators", () => {
  describe("createRoleSchema", () => {
    it("should validate a valid role", () => {
      const result = checkInput({ name: "Calibrator", description: "Calibration role" }, createRoleSchema);
      expect(result).toEqual({ ok: true, value: { name: "Calibrator", description: "Calibration role" } });
    });

    it("should trim name", () => {
      expect(checkInput({ name: "  Calibrator  " }, createRoleSchema).value.name).toBe("Calibrator");
    });

    it("should accept an empty or null description", () => {
      expect(checkInput({ name: "Calibrator", description: "" }, createRoleSchema).ok).toBe(true);
      expect(checkInput({ name: "Calibrator", description: null }, createRoleSchema).ok).toBe(true);
    });

    it("should convert a numeric-string roleLevel", () => {
      expect(checkInput({ name: "Calibrator", roleLevel: "3" }, createRoleSchema).value.roleLevel).toBe(3);
    });

    it("should cap roleLevel at 8 (ADR-043)", () => {
      expect(checkInput({ name: "Calibrator", roleLevel: 9 }, createRoleSchema).errors).toEqual([
        { field: "roleLevel", message: "Too big: expected number to be <=8" },
      ]);
    });

    it("should refuse a non-integer roleLevel", () => {
      expect(checkInput({ name: "Calibrator", roleLevel: 1.5 }, createRoleSchema).errors).toEqual([
        { field: "roleLevel", message: "Invalid input: expected int, received number" },
      ]);
    });

    it("should reject a missing name", () => {
      expect(checkInput({}, createRoleSchema).errors).toEqual([
        { field: "name", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should reject a short name", () => {
      expect(checkInput({ name: "a" }, createRoleSchema).errors).toEqual([
        { field: "name", message: "Too small: expected string to have >=2 characters" },
      ]);
    });
  });

  describe("updateRoleSchema", () => {
    it("should validate a partial update", () => {
      expect(checkInput({ status: "inactive" }, updateRoleSchema)).toEqual({ ok: true, value: { status: "inactive" } });
    });

    it("should reject an invalid status", () => {
      expect(checkInput({ status: "bogus" }, updateRoleSchema).errors).toEqual([
        { field: "status", message: 'Invalid option: expected one of "active"|"inactive"|"deleted"' },
      ]);
    });
  });

  describe("createMenuSchema / updateMenuSchema", () => {
    it("should pass every key through (the bodies are undeclared)", () => {
      expect(checkInput({ name: "Menu", anything: 1 }, createMenuSchema).value).toEqual({ name: "Menu", anything: 1 });
      expect(checkInput({ name: "Menu", anything: 1 }, updateMenuSchema).value).toEqual({ name: "Menu", anything: 1 });
    });

    // 2026-10-11 (the live contract smoke): POST /roles/menus without a `name` reached
    // RolesService.createMenu's `data.name.trim()` and answered 500 ("Cannot read
    // properties of undefined (reading 'trim')"). The create declares its one required
    // field, so the same body is a 400 naming it, before the handler runs.
    it("a menu create requires a non-blank name of at most 255 characters (it 500'd without one)", () => {
      for (const body of [{}, { name: "   " }, { name: 7 }, { name: null }, { name: "x".repeat(256) }, { slug: "only-a-slug" }]) {
        const result = checkInput(body, createMenuSchema);
        expect({ body, ok: result.ok, fields: (result.errors || []).map((e) => e.field) }).toEqual({ body, ok: false, fields: ["name"] });
      }
      expect(checkInput({ name: "  Reports  ", icon: "chart" }, createMenuSchema).value).toEqual({ name: "Reports", icon: "chart" });
      // The update stays undeclared (it reads `name` only when given).
      expect(checkInput({}, updateMenuSchema).ok).toBe(true);
    });
  });

  describe("assignRoleSchema", () => {
    it("should validate userId and roleId", () => {
      expect(checkInput({ userId: UUID, roleId: UUID }, assignRoleSchema).ok).toBe(true);
    });

    it("should require both ids", () => {
      expect(checkInput({ userId: UUID }, assignRoleSchema).errors).toEqual([
        { field: "roleId", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should refuse a non-uuid id", () => {
      expect(checkInput({ userId: "bad", roleId: UUID }, assignRoleSchema).errors).toEqual([
        { field: "userId", message: "Invalid GUID" },
      ]);
    });
  });

  describe("assignPermissionSchema", () => {
    it("should validate menuGroupId and permissionType", () => {
      expect(checkInput({ menuGroupId: UUID, permissionType: "write" }, assignPermissionSchema).ok).toBe(true);
    });

    it("should reject an invalid permissionType", () => {
      expect(checkInput({ menuGroupId: UUID, permissionType: "admin" }, assignPermissionSchema).errors).toEqual([
        { field: "permissionType", message: 'Invalid option: expected one of "read"|"write"' },
      ]);
    });
  });

  describe("checkInput error shape", () => {
    it("should list every failing field as { field, message } (abortEarly off)", () => {
      const result = checkInput({ name: "a", status: "bogus" }, updateRoleSchema);
      expect(result.ok).toBe(false);
      expect(result.errors.map((e) => e.field)).toEqual(["name", "status"]);
    });
  });
});
