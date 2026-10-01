/**
 * MenuGroup validator tests
 *
 * P9-11 (ADR-093): the module's own validate/formatErrors helpers are gone;
 * the schemas are exercised through the shared checkInput (validators/input),
 * which answers { ok: true, value } or { ok: false, errors: [{ field, message }] }.
 */
const {
  filterMenuGroupSchema,
  getAssignmentsSchema,
  createMenuGroupSchema,
  updateMenuGroupSchema,
  assignMenuGroupSchema,
  bulkAssignMenuGroupsSchema,
  revokeMenuGroupSchema,
  bulkRevokeMenuGroupsSchema,
  assignMenuItemSchema,
  revokeMenuItemSchema,
} = require("../../validators/menuGroup.validator");
const { checkInput } = require("../../validators/input");

const UUID = "8c352a92-d6cf-4b71-b0db-6e69622d1b11";
const REQUIRED = "Invalid input: expected string, received undefined";

describe("MenuGroup Validators", () => {
  describe("filterMenuGroupSchema", () => {
    it("should allow empty filter", () => {
      expect(checkInput({}, filterMenuGroupSchema)).toEqual({ ok: true, value: {} });
    });

    it("should accept valid search and isActive", () => {
      const result = checkInput({ search: "settings", isActive: true }, filterMenuGroupSchema);
      expect(result.value).toEqual({ search: "settings", isActive: true });
    });

    it("should allow null search and isActive", () => {
      const result = checkInput({ search: null, isActive: null }, filterMenuGroupSchema);
      expect(result.ok).toBe(true);
      expect(result.value.search).toBeNull();
      expect(result.value.isActive).toBeNull();
    });

    it("should convert a query-string boolean and allow an empty search", () => {
      expect(checkInput({ search: "", isActive: "false" }, filterMenuGroupSchema).value).toEqual({
        search: "",
        isActive: false,
      });
    });

    it("should reject a non-boolean isActive", () => {
      expect(checkInput({ isActive: "x" }, filterMenuGroupSchema).errors).toEqual([
        { field: "isActive", message: "Invalid input: expected boolean, received string" },
      ]);
    });
  });

  describe("getAssignmentsSchema", () => {
    it("should validate a uuid roleId", () => {
      expect(checkInput({ roleId: UUID }, getAssignmentsSchema).ok).toBe(true);
    });

    it("should require a valid uuid roleId", () => {
      expect(checkInput({ roleId: "not-a-uuid" }, getAssignmentsSchema).errors).toEqual([
        { field: "roleId", message: "Invalid GUID" },
      ]);
    });

    it("should require roleId", () => {
      expect(checkInput({}, getAssignmentsSchema).errors).toEqual([{ field: "roleId", message: REQUIRED }]);
    });
  });

  describe("createMenuGroupSchema", () => {
    it("should validate a valid menu group", () => {
      const result = checkInput(
        {
          name: "Settings",
          slug: "settings",
          icon: "gear",
          parentId: UUID,
          sortOrder: 3,
          isActive: false,
        },
        createMenuGroupSchema,
      );
      expect(result.ok).toBe(true);
      expect(result.value.name).toBe("Settings");
      expect(result.value.sortOrder).toBe(3);
      expect(result.value.isActive).toBe(false);
    });

    it("should apply defaults for sortOrder and isActive", () => {
      expect(checkInput({ name: "Settings" }, createMenuGroupSchema).value).toEqual({
        name: "Settings",
        sortOrder: 0,
        isActive: true,
      });
    });

    it("should convert numeric and boolean strings", () => {
      const result = checkInput({ name: "Settings", sortOrder: "2", isActive: "false" }, createMenuGroupSchema);
      expect(result.value).toMatchObject({ sortOrder: 2, isActive: false });
    });

    it("should allow nullable slug and icon", () => {
      const result = checkInput({ name: "Settings", slug: null, icon: null }, createMenuGroupSchema);
      expect(result.ok).toBe(true);
      expect(result.value.slug).toBeNull();
      expect(result.value.icon).toBeNull();
    });

    it("should allow an empty slug and icon", () => {
      expect(checkInput({ name: "Settings", slug: "", icon: "" }, createMenuGroupSchema).value).toMatchObject({
        slug: "",
        icon: "",
      });
    });

    it("should reject a one-character slug", () => {
      expect(checkInput({ name: "Settings", slug: "s" }, createMenuGroupSchema).errors).toEqual([
        { field: "slug", message: "Too small: expected string to have >=2 characters" },
      ]);
    });

    it("should reject an icon over 50 characters", () => {
      expect(checkInput({ name: "Settings", icon: "x".repeat(51) }, createMenuGroupSchema).errors).toEqual([
        { field: "icon", message: "Too big: expected string to have <=50 characters" },
      ]);
    });

    it("should require name", () => {
      expect(checkInput({}, createMenuGroupSchema).errors).toEqual([{ field: "name", message: REQUIRED }]);
    });

    it("should reject short name", () => {
      expect(checkInput({ name: "a" }, createMenuGroupSchema).errors).toEqual([
        { field: "name", message: "Too small: expected string to have >=2 characters" },
      ]);
    });

    it("should reject negative sortOrder", () => {
      expect(checkInput({ name: "Settings", sortOrder: -1 }, createMenuGroupSchema).errors).toEqual([
        { field: "sortOrder", message: "Too small: expected number to be >=0" },
      ]);
    });

    it("should reject a fractional sortOrder", () => {
      expect(checkInput({ name: "Settings", sortOrder: 1.5 }, createMenuGroupSchema).errors).toEqual([
        { field: "sortOrder", message: "Invalid input: expected int, received number" },
      ]);
    });

    it("should reject invalid parentId", () => {
      expect(checkInput({ name: "Settings", parentId: "bad" }, createMenuGroupSchema).errors).toEqual([
        { field: "parentId", message: "Invalid GUID" },
      ]);
    });
  });

  describe("updateMenuGroupSchema", () => {
    it("should require id", () => {
      expect(checkInput({ name: "Settings" }, updateMenuGroupSchema).errors).toEqual([{ field: "id", message: REQUIRED }]);
    });

    it("should validate partial update with uuid id", () => {
      const result = checkInput({ id: UUID, name: "NewName", isActive: true }, updateMenuGroupSchema);
      expect(result.ok).toBe(true);
      expect(result.value.id).toBe(UUID);
    });

    it("should convert a numeric-string sortOrder and allow an empty slug", () => {
      expect(checkInput({ id: UUID, slug: "", sortOrder: "4" }, updateMenuGroupSchema).value).toEqual({
        id: UUID,
        slug: "",
        sortOrder: 4,
      });
    });

    it("should reject invalid id", () => {
      expect(checkInput({ id: "bad", name: "NewName" }, updateMenuGroupSchema).errors).toEqual([
        { field: "id", message: "Invalid GUID" },
      ]);
    });

    it("should reject invalid sortOrder", () => {
      expect(checkInput({ id: UUID, sortOrder: -5 }, updateMenuGroupSchema).errors).toEqual([
        { field: "sortOrder", message: "Too small: expected number to be >=0" },
      ]);
    });
  });

  describe("assignMenuGroupSchema", () => {
    it("should validate roleId and menuGroupId", () => {
      expect(checkInput({ roleId: UUID, menuGroupId: UUID, notes: "assigned" }, assignMenuGroupSchema).ok).toBe(true);
    });

    it("should allow null notes", () => {
      expect(checkInput({ roleId: UUID, menuGroupId: UUID, notes: null }, assignMenuGroupSchema).ok).toBe(true);
    });

    it("should reject notes over 255 characters", () => {
      expect(
        checkInput({ roleId: UUID, menuGroupId: UUID, notes: "x".repeat(256) }, assignMenuGroupSchema).errors,
      ).toEqual([{ field: "notes", message: "Too big: expected string to have <=255 characters" }]);
    });

    it("should reject missing menuGroupId", () => {
      expect(checkInput({ roleId: UUID }, assignMenuGroupSchema).errors).toEqual([
        { field: "menuGroupId", message: REQUIRED },
      ]);
    });
  });

  describe("bulkAssignMenuGroupsSchema", () => {
    it("should validate array of menuGroupIds", () => {
      expect(
        checkInput(
          { roleId: UUID, menuGroupIds: [UUID, "9d463b03-e7d0-4c82-c1ec-7f7a33e2c222"] },
          bulkAssignMenuGroupsSchema,
        ).ok,
      ).toBe(true);
    });

    it("should reject empty menuGroupIds array", () => {
      expect(checkInput({ roleId: UUID, menuGroupIds: [] }, bulkAssignMenuGroupsSchema).errors).toEqual([
        { field: "menuGroupIds", message: "Too small: expected array to have >=1 items" },
      ]);
    });

    it("should reject non-uuid menuGroupId", () => {
      expect(checkInput({ roleId: UUID, menuGroupIds: ["bad"] }, bulkAssignMenuGroupsSchema).errors).toEqual([
        { field: "menuGroupIds.0", message: "Invalid GUID" },
      ]);
    });
  });

  describe("revokeMenuGroupSchema", () => {
    it("should validate roleId and menuGroupId", () => {
      expect(checkInput({ roleId: UUID, menuGroupId: UUID }, revokeMenuGroupSchema).ok).toBe(true);
    });

    it("should reject missing menuGroupId", () => {
      expect(checkInput({ roleId: UUID }, revokeMenuGroupSchema).errors).toEqual([
        { field: "menuGroupId", message: REQUIRED },
      ]);
    });
  });

  describe("bulkRevokeMenuGroupsSchema", () => {
    it("should validate array of menuGroupIds", () => {
      expect(checkInput({ roleId: UUID, menuGroupIds: [UUID] }, bulkRevokeMenuGroupsSchema).ok).toBe(true);
    });

    it("should reject empty menuGroupIds array", () => {
      expect(checkInput({ roleId: UUID, menuGroupIds: [] }, bulkRevokeMenuGroupsSchema).errors).toEqual([
        { field: "menuGroupIds", message: "Too small: expected array to have >=1 items" },
      ]);
    });
  });

  describe("assignMenuItemSchema", () => {
    it("should validate roleId and menuItemId", () => {
      expect(checkInput({ roleId: UUID, menuItemId: UUID, notes: "ok" }, assignMenuItemSchema).ok).toBe(true);
    });

    it("should reject missing menuItemId", () => {
      expect(checkInput({ roleId: UUID }, assignMenuItemSchema).errors).toEqual([
        { field: "menuItemId", message: REQUIRED },
      ]);
    });
  });

  describe("revokeMenuItemSchema", () => {
    it("should validate roleId and menuItemId", () => {
      expect(checkInput({ roleId: UUID, menuItemId: UUID }, revokeMenuItemSchema).ok).toBe(true);
    });

    it("should reject missing menuItemId", () => {
      expect(checkInput({ roleId: UUID }, revokeMenuItemSchema).errors).toEqual([
        { field: "menuItemId", message: REQUIRED },
      ]);
    });
  });

  describe("error shape", () => {
    it("should report a field error as { field, message } strings", () => {
      const result = checkInput({ roleId: "bad" }, getAssignmentsSchema);
      expect(result.ok).toBe(false);
      expect(result.errors[0].field).toBe("roleId");
      expect(typeof result.errors[0].message).toBe("string");
    });
  });
});
