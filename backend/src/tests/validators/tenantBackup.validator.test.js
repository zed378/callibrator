/**
 * Tenant Backup validator tests
 */
const {
  createBackupSchema,
  restoreBackupSchema,
  validate,
  formatErrors,
} = require("../../validators/tenantBackup.validator");

describe("Tenant Backup Validators", () => {
  describe("createBackupSchema", () => {
    it("should validate correct backup request", () => {
      const { error, value } = validate({ name: "Weekly Backup" }, createBackupSchema);

      expect(error).toBeUndefined();
      expect(value.name).toBe("Weekly Backup");
      expect(value.backupType).toBe("FULL");
      expect(value.retentionDays).toBe(90);
    });

    it("should validate with custom backup type", () => {
      const { error, value } = validate({ name: "Partial Backup", backupType: "PARTIAL" }, createBackupSchema);

      expect(error).toBeUndefined();
      expect(value.backupType).toBe("PARTIAL");
    });

    it("should validate with custom retention days", () => {
      const { error, value } = validate({ name: "Backup", retentionDays: 30 }, createBackupSchema);

      expect(error).toBeUndefined();
      expect(value.retentionDays).toBe(30);
    });

    it("should validate with all fields", () => {
      const { error } = validate({
        name: "Full Backup",
        description: "Monthly full backup",
        backupType: "FULL",
        retentionDays: 90,
        tag: "monthly",
      }, createBackupSchema);

      expect(error).toBeUndefined();
    });

    it("should reject name that is too short", () => {
      const { error } = validate({ name: "A" }, createBackupSchema);

      expect(error).toBeDefined();
      expect(error.details[0].path).toContain("name");
    });

    it("should reject name that is too long", () => {
      const { error } = validate({ name: "a".repeat(101) }, createBackupSchema);

      expect(error).toBeDefined();
    });

    it("should reject missing name", () => {
      const { error } = validate({}, createBackupSchema);

      expect(error).toBeDefined();
    });

    it("should reject invalid backup type", () => {
      const { error } = validate({ name: "Backup", backupType: "INVALID" }, createBackupSchema);

      expect(error).toBeDefined();
    });

    it("should reject retention days below minimum", () => {
      const { error } = validate({ name: "Backup", retentionDays: 0 }, createBackupSchema);

      expect(error).toBeDefined();
    });

    it("should reject retention days above maximum", () => {
      const { error } = validate({ name: "Backup", retentionDays: 366 }, createBackupSchema);

      expect(error).toBeDefined();
    });

    it("should reject non-integer retention days", () => {
      const { error } = validate({ name: "Backup", retentionDays: 30.5 }, createBackupSchema);

      expect(error).toBeDefined();
    });

    it("should reject description that is too long", () => {
      const { error } = validate({ name: "Backup", description: "a".repeat(501) }, createBackupSchema);

      expect(error).toBeDefined();
    });

    it("should reject tag that is too long", () => {
      const { error } = validate({ name: "Backup", tag: "a".repeat(51) }, createBackupSchema);

      expect(error).toBeDefined();
    });
  });

  describe("restoreBackupSchema", () => {
    it("should validate with default mergeData", () => {
      const { error, value } = validate({}, restoreBackupSchema);

      expect(error).toBeUndefined();
      expect(value.mergeData).toBe(false);
    });

    it("should validate with mergeData true", () => {
      const { error, value } = validate({ mergeData: true }, restoreBackupSchema);

      expect(error).toBeUndefined();
      expect(value.mergeData).toBe(true);
    });

    it("should reject non-boolean mergeData", () => {
      const { error } = validate({ mergeData: "yes" }, restoreBackupSchema);

      expect(error).toBeDefined();
    });
  });

  describe("formatErrors", () => {
    it("should format error details correctly", () => {
      const details = [
        { path: ["name"], message: "name is required" },
        { path: ["backupType"], message: "backupType must be one of [FULL, PARTIAL, USER_ONLY]" },
      ];

      const result = formatErrors(details);

      expect(result).toEqual([
        { field: "name", message: "name is required" },
        { field: "backupType", message: "backupType must be one of [FULL, PARTIAL, USER_ONLY]" },
      ]);
    });

    it("should handle nested field paths", () => {
      const details = [{ path: ["backup", "name"], message: "Name is required" }];

      const result = formatErrors(details);

      expect(result).toEqual([
        { field: "backup.name", message: "Name is required" },
      ]);
    });

    it("should return empty array for empty input", () => {
      const result = formatErrors([]);

      expect(result).toEqual([]);
    });
  });
});
