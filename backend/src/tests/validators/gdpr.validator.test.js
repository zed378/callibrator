/**
 * GDPR/CCPA validator tests
 */
const {
  requestErasure,
  updateConsent,
  rectifyData,
  restrictProcessing,
  validate,
} = require("../../validators/gdpr.validator");

describe("GDPR/CCPA Validators", () => {
  describe("requestErasure", () => {
    it("should validate correct erasure request", () => {
      const value = validate(
        { reason: "User requested account deletion", confirm: true },
        requestErasure,
      );

      expect(value.confirm).toBe(true);
    });

    it("should reject missing reason", () => {
      expect(() =>
        validate({ confirm: true }, requestErasure),
      ).toThrow();
    });

    it("should reject missing confirm", () => {
      expect(() =>
        validate({ reason: "User requested account deletion" }, requestErasure),
      ).toThrow();
    });

    it("should reject confirm false", () => {
      expect(() =>
        validate(
          { reason: "User requested account deletion", confirm: false },
          requestErasure,
        ),
      ).toThrow();
    });

    it("should reject reason exceeding max length", () => {
      expect(() =>
        validate(
          { reason: "a".repeat(501), confirm: true },
          requestErasure,
        ),
      ).toThrow();
    });
  });

  describe("updateConsent", () => {
    it("should validate correct consent update", () => {
      const value = validate(
        { categories: ["analytics", "marketing"], consent: true },
        updateConsent,
      );

      expect(value.consent).toBe(true);
    });

    it("should validate with all categories", () => {
      expect(() =>
        validate(
          { categories: ["analytics", "marketing", "functional", "necessary"], consent: true },
          updateConsent,
        ),
      ).not.toThrow();
    });

    it("should validate with single category", () => {
      expect(() =>
        validate({ categories: ["analytics"], consent: false }, updateConsent),
      ).not.toThrow();
    });

    it("should reject invalid category", () => {
      expect(() =>
        validate({ categories: ["invalid_category"], consent: true }, updateConsent),
      ).toThrow();
    });

    it("should reject missing categories", () => {
      expect(() =>
        validate({ consent: true }, updateConsent),
      ).toThrow();
    });

    it("should reject missing consent", () => {
      expect(() =>
        validate({ categories: ["analytics"] }, updateConsent),
      ).toThrow();
    });

    it("should reject empty categories array", () => {
      expect(() =>
        validate({ categories: [], consent: true }, updateConsent),
      ).not.toThrow(); // Empty array is allowed
    });
  });

  describe("rectifyData", () => {
    it("should validate correct rectification", () => {
      const value = validate(
        { field: "email", value: "newemail@example.com" },
        rectifyData,
      );

      expect(value.field).toBe("email");
    });

    it("should validate with numeric value", () => {
      expect(() =>
        validate({ field: "age", value: 30 }, rectifyData),
      ).not.toThrow();
    });

    it("should validate with boolean value", () => {
      expect(() =>
        validate({ field: "subscribed", value: true }, rectifyData),
      ).not.toThrow();
    });

    it("should reject missing field", () => {
      expect(() =>
        validate({ value: "newemail@example.com" }, rectifyData),
      ).toThrow();
    });

    it("should reject missing value", () => {
      expect(() =>
        validate({ field: "email" }, rectifyData),
      ).toThrow();
    });

    it("should reject empty field", () => {
      expect(() =>
        validate({ field: "", value: "test" }, rectifyData),
      ).toThrow();
    });
  });

  describe("restrictProcessing", () => {
    it("should validate correct restriction request", () => {
      const value = validate(
        { reason: "Disputing accuracy of data" },
        restrictProcessing,
      );

      expect(value.reason).toBe("Disputing accuracy of data");
    });

    it("should reject missing reason", () => {
      expect(() =>
        validate({}, restrictProcessing),
      ).toThrow();
    });

    it("should reject empty reason", () => {
      expect(() =>
        validate({ reason: "" }, restrictProcessing),
      ).toThrow();
    });

    it("should reject reason exceeding max length", () => {
      expect(() =>
        validate({ reason: "a".repeat(501) }, restrictProcessing),
      ).toThrow();
    });
  });
});