/**
 * MenuGroup validator tests
 */
const Joi = require("joi");
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
  validate,
  formatErrors,
} = require("../../validators/menuGroup.validator");

const UUID = "8c352a92-d6cf-4b71-b0db-6e69622d1b11";

describe("MenuGroup Validators", () => {
  describe("filterMenuGroupSchema", () => {
    it("should allow empty filter", () => {
      const { error, value } = validate({}, filterMenuGroupSchema);
      expect(error).toBeUndefined();
      expect(value).toEqual({});
    });

    it("should accept valid search and isActive", () => {
      const { error, value } = validate(
        { search: "settings", isActive: true },
        filterMenuGroupSchema,
      );
      expect(error).toBeUndefined();
      expect(value.search).toBe("settings");
      expect(value.isActive).toBe(true);
    });

    it("should allow null search and isActive", () => {
      const { error, value } = validate(
        { search: null, isActive: null },
        filterMenuGroupSchema,
      );
      expect(error).toBeUndefined();
      expect(value.search).toBeNull();
      expect(value.isActive).toBeNull();
    });
  });

  describe("getAssignmentsSchema", () => {
    it("should validate a uuid roleId", () => {
      const { error } = validate({ roleId: UUID }, getAssignmentsSchema);
      expect(error).toBeUndefined();
    });

    it("should require a valid uuid roleId", () => {
      const { error } = validate(
        { roleId: "not-a-uuid" },
        getAssignmentsSchema,
      );
      expect(error).toBeDefined();
    });

    it("should require roleId", () => {
      const { error } = validate({}, getAssignmentsSchema);
      expect(error).toBeDefined();
    });
  });

  describe("createMenuGroupSchema", () => {
    it("should validate a valid menu group", () => {
      const { error, value } = validate(
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
      expect(error).toBeUndefined();
      expect(value.name).toBe("Settings");
      expect(value.sortOrder).toBe(3);
      expect(value.isActive).toBe(false);
    });

    it("should apply defaults for sortOrder and isActive", () => {
      const { error, value } = validate(
        { name: "Settings" },
        createMenuGroupSchema,
      );
      expect(error).toBeUndefined();
      expect(value.sortOrder).toBe(0);
      expect(value.isActive).toBe(true);
    });

    it("should allow nullable slug and icon", () => {
      const { error, value } = validate(
        { name: "Settings", slug: null, icon: null },
        createMenuGroupSchema,
      );
      expect(error).toBeUndefined();
      expect(value.slug).toBeNull();
      expect(value.icon).toBeNull();
    });

    it("should require name", () => {
      const { error } = validate({}, createMenuGroupSchema);
      expect(error).toBeDefined();
    });

    it("should reject short name", () => {
      const { error } = validate({ name: "a" }, createMenuGroupSchema);
      expect(error).toBeDefined();
    });

    it("should reject negative sortOrder", () => {
      const { error } = validate(
        { name: "Settings", sortOrder: -1 },
        createMenuGroupSchema,
      );
      expect(error).toBeDefined();
    });

    it("should reject invalid parentId", () => {
      const { error } = validate(
        { name: "Settings", parentId: "bad" },
        createMenuGroupSchema,
      );
      expect(error).toBeDefined();
    });
  });

  describe("updateMenuGroupSchema", () => {
    it("should require id", () => {
      const { error } = validate({ name: "Settings" }, updateMenuGroupSchema);
      expect(error).toBeDefined();
    });

    it("should validate partial update with uuid id", () => {
      const { error, value } = validate(
        { id: UUID, name: "NewName", isActive: true },
        updateMenuGroupSchema,
      );
      expect(error).toBeUndefined();
      expect(value.id).toBe(UUID);
    });

    it("should reject invalid id", () => {
      const { error } = validate(
        { id: "bad", name: "NewName" },
        updateMenuGroupSchema,
      );
      expect(error).toBeDefined();
    });

    it("should reject invalid sortOrder", () => {
      const { error } = validate(
        { id: UUID, sortOrder: -5 },
        updateMenuGroupSchema,
      );
      expect(error).toBeDefined();
    });
  });

  describe("assignMenuGroupSchema", () => {
    it("should validate roleId and menuGroupId", () => {
      const { error } = validate(
        { roleId: UUID, menuGroupId: UUID, notes: "assigned" },
        assignMenuGroupSchema,
      );
      expect(error).toBeUndefined();
    });

    it("should allow null notes", () => {
      const { error } = validate(
        { roleId: UUID, menuGroupId: UUID, notes: null },
        assignMenuGroupSchema,
      );
      expect(error).toBeUndefined();
    });

    it("should reject missing menuGroupId", () => {
      const { error } = validate({ roleId: UUID }, assignMenuGroupSchema);
      expect(error).toBeDefined();
    });
  });

  describe("bulkAssignMenuGroupsSchema", () => {
    it("should validate array of menuGroupIds", () => {
      const { error } = validate(
        {
          roleId: UUID,
          menuGroupIds: [UUID, "9d463b03-e7d0-4c82-c1ec-7f7a33e2c222"],
        },
        bulkAssignMenuGroupsSchema,
      );
      expect(error).toBeUndefined();
    });

    it("should reject empty menuGroupIds array", () => {
      const { error } = validate(
        { roleId: UUID, menuGroupIds: [] },
        bulkAssignMenuGroupsSchema,
      );
      expect(error).toBeDefined();
    });

    it("should reject non-uuid menuGroupId", () => {
      const { error } = validate(
        { roleId: UUID, menuGroupIds: ["bad"] },
        bulkAssignMenuGroupsSchema,
      );
      expect(error).toBeDefined();
    });
  });

  describe("revokeMenuGroupSchema", () => {
    it("should validate roleId and menuGroupId", () => {
      const { error } = validate(
        { roleId: UUID, menuGroupId: UUID },
        revokeMenuGroupSchema,
      );
      expect(error).toBeUndefined();
    });

    it("should reject missing menuGroupId", () => {
      const { error } = validate({ roleId: UUID }, revokeMenuGroupSchema);
      expect(error).toBeDefined();
    });
  });

  describe("bulkRevokeMenuGroupsSchema", () => {
    it("should validate array of menuGroupIds", () => {
      const { error } = validate(
        { roleId: UUID, menuGroupIds: [UUID] },
        bulkRevokeMenuGroupsSchema,
      );
      expect(error).toBeUndefined();
    });

    it("should reject empty menuGroupIds array", () => {
      const { error } = validate(
        { roleId: UUID, menuGroupIds: [] },
        bulkRevokeMenuGroupsSchema,
      );
      expect(error).toBeDefined();
    });
  });

  describe("assignMenuItemSchema", () => {
    it("should validate roleId and menuItemId", () => {
      const { error } = validate(
        { roleId: UUID, menuItemId: UUID, notes: "ok" },
        assignMenuItemSchema,
      );
      expect(error).toBeUndefined();
    });

    it("should reject missing menuItemId", () => {
      const { error } = validate({ roleId: UUID }, assignMenuItemSchema);
      expect(error).toBeDefined();
    });
  });

  describe("revokeMenuItemSchema", () => {
    it("should validate roleId and menuItemId", () => {
      const { error } = validate(
        { roleId: UUID, menuItemId: UUID },
        revokeMenuItemSchema,
      );
      expect(error).toBeUndefined();
    });

    it("should reject missing menuItemId", () => {
      const { error } = validate({ roleId: UUID }, revokeMenuItemSchema);
      expect(error).toBeDefined();
    });
  });

  describe("formatErrors", () => {
    it("should format Joi error details", () => {
      const { error } = validate({ roleId: "bad" }, getAssignmentsSchema);
      const formatted = formatErrors(error.details);
      expect(Array.isArray(formatted)).toBe(true);
      expect(formatted[0].field).toBe("roleId");
      expect(typeof formatted[0].message).toBe("string");
    });
  });
});
