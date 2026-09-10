/**
 * Session validator tests
 */
const {
  revokeSessionSchema,
  revokeAllSessionsSchema,
  validate,
  formatErrors,
} = require("../../validators/session.validator");

describe("Session Validators", () => {
  describe("revokeSessionSchema", () => {
    it("should validate with default reason", () => {
      const { error, value } = validate({}, revokeSessionSchema);

      expect(error).toBeUndefined();
      expect(value.reason).toBe("MANUAL_REVOKE");
    });

    it("should validate with custom reason", () => {
      const { error } = validate(
        { reason: "Suspicious activity detected" },
        revokeSessionSchema,
      );

      expect(error).toBeUndefined();
    });

    it("should reject reason exceeding max length", () => {
      const { error } = validate(
        { reason: "a".repeat(256) },
        revokeSessionSchema,
      );

      expect(error).toBeDefined();
    });
  });

  describe("revokeAllSessionsSchema", () => {
    it("should validate with default reason", () => {
      const { error, value } = validate({}, revokeAllSessionsSchema);

      expect(error).toBeUndefined();
      expect(value.reason).toBe("ADMIN_REVOKE_ALL");
    });

    it("should validate with custom reason", () => {
      const { error } = validate(
        { reason: "Security breach detected" },
        revokeAllSessionsSchema,
      );

      expect(error).toBeUndefined();
    });

    it("should reject reason exceeding max length", () => {
      const { error } = validate(
        { reason: "a".repeat(256) },
        revokeAllSessionsSchema,
      );

      expect(error).toBeDefined();
    });
  });

  describe("formatErrors", () => {
    it("should format error details correctly", () => {
      const details = [
        { path: ["tenantId"], message: "tenantId is required" },
        { path: ["email"], message: "Invalid email" },
      ];

      const result = formatErrors(details);

      expect(result).toEqual([
        { field: "tenantId", message: "tenantId is required" },
        { field: "email", message: "Invalid email" },
      ]);
    });

    it("should handle nested field paths", () => {
      const details = [{ path: ["user", "name"], message: "Name is required" }];

      const result = formatErrors(details);

      expect(result).toEqual([
        { field: "user.name", message: "Name is required" },
      ]);
    });

    it("should return empty array for empty input", () => {
      const result = formatErrors([]);

      expect(result).toEqual([]);
    });
  });
});
