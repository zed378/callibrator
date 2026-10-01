/**
 * Tenant Backup validator tests
 *
 * P9-11: the file's own validate()/formatErrors() are gone; the schemas are
 * checked through the shared checkInput (strip-unknown, every issue).
 */
const {
  createBackupSchema,
  restoreBackupSchema,
} = require("../../validators/tenantBackup.validator");
const { checkInput } = require("../../validators/input");

describe("Tenant Backup Validators", () => {
  describe("createBackupSchema", () => {
    it("should validate correct backup request", () => {
      const result = checkInput({ name: "Weekly Backup" }, createBackupSchema);

      expect(result.ok).toBe(true);
      expect(result.value).toEqual({ name: "Weekly Backup", backupType: "FULL", retentionDays: 90 });
    });

    it("should validate with custom backup type", () => {
      const result = checkInput({ name: "Partial Backup", backupType: "PARTIAL" }, createBackupSchema);

      expect(result.ok).toBe(true);
      expect(result.value.backupType).toBe("PARTIAL");
    });

    it("should validate with custom retention days", () => {
      const result = checkInput({ name: "Backup", retentionDays: 30 }, createBackupSchema);

      expect(result.ok).toBe(true);
      expect(result.value.retentionDays).toBe(30);
    });

    it("should convert a numeric-string retention and trim the text fields", () => {
      const result = checkInput(
        { name: "  Backup  ", retentionDays: "30", description: "   ", tag: " monthly " },
        createBackupSchema,
      );

      expect(result).toEqual({
        ok: true,
        value: { name: "Backup", description: "", backupType: "FULL", retentionDays: 30, tag: "monthly" },
      });
    });

    it("should validate with all fields", () => {
      const result = checkInput({
        name: "Full Backup",
        description: "Monthly full backup",
        backupType: "FULL",
        retentionDays: 90,
        tag: "monthly",
      }, createBackupSchema);

      expect(result.ok).toBe(true);
    });

    it("should accept null description and tag", () => {
      expect(checkInput({ name: "Backup", description: null, tag: null }, createBackupSchema).ok).toBe(true);
    });

    it("should reject name that is too short", () => {
      const result = checkInput({ name: "A" }, createBackupSchema);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        { field: "name", message: "Too small: expected string to have >=2 characters" },
      ]);
    });

    it("should reject name that is too long", () => {
      expect(checkInput({ name: "a".repeat(101) }, createBackupSchema).errors).toEqual([
        { field: "name", message: "Too big: expected string to have <=100 characters" },
      ]);
    });

    it("should reject missing name", () => {
      expect(checkInput({}, createBackupSchema).errors).toEqual([
        { field: "name", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should reject a missing body as a missing name (A-09)", () => {
      expect(checkInput(undefined, createBackupSchema).ok).toBe(false);
    });

    it("should reject invalid backup type", () => {
      expect(checkInput({ name: "Backup", backupType: "INVALID" }, createBackupSchema).errors).toEqual([
        { field: "backupType", message: 'Invalid option: expected one of "FULL"|"PARTIAL"|"USER_ONLY"' },
      ]);
    });

    it("should reject retention days below minimum", () => {
      expect(checkInput({ name: "Backup", retentionDays: 0 }, createBackupSchema).ok).toBe(false);
    });

    it("should reject retention days above maximum", () => {
      expect(checkInput({ name: "Backup", retentionDays: 366 }, createBackupSchema).ok).toBe(false);
    });

    it("should reject non-integer retention days", () => {
      expect(checkInput({ name: "Backup", retentionDays: 30.5 }, createBackupSchema).ok).toBe(false);
    });

    it("should reject description that is too long", () => {
      expect(checkInput({ name: "Backup", description: "a".repeat(501) }, createBackupSchema).ok).toBe(false);
    });

    it("should reject tag that is too long", () => {
      expect(checkInput({ name: "Backup", tag: "a".repeat(51) }, createBackupSchema).ok).toBe(false);
    });

    it("should report every failing field at once", () => {
      const result = checkInput({ name: "A", backupType: "X", retentionDays: 0 }, createBackupSchema);

      expect(result.errors.map((e) => e.field)).toEqual(["name", "backupType", "retentionDays"]);
    });

    it("should strip unknown fields", () => {
      expect(checkInput({ name: "Backup", tenantId: "x" }, createBackupSchema).value.tenantId).toBeUndefined();
    });
  });

  describe("restoreBackupSchema", () => {
    it("should validate with default mergeData", () => {
      const result = checkInput({}, restoreBackupSchema);

      expect(result).toEqual({ ok: true, value: { mergeData: false } });
    });

    it("should validate with mergeData true", () => {
      const result = checkInput({ mergeData: true }, restoreBackupSchema);

      expect(result.ok).toBe(true);
      expect(result.value.mergeData).toBe(true);
    });

    it("should convert the strings true and false", () => {
      expect(checkInput({ mergeData: "true" }, restoreBackupSchema).value.mergeData).toBe(true);
      expect(checkInput({ mergeData: "false" }, restoreBackupSchema).value.mergeData).toBe(false);
    });

    it("should reject non-boolean mergeData", () => {
      expect(checkInput({ mergeData: "yes" }, restoreBackupSchema)).toEqual({
        ok: false,
        errors: [{ field: "mergeData", message: "Invalid input: expected boolean, received string" }],
      });
    });
  });
});
