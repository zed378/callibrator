/**
 * GDPR/CCPA validator tests
 *
 * P9-11 (ADR-093): the schemas are Zod, exercised through the shared
 * `validateInput` helper (the file's own `validate`, which threw an `Error`,
 * is gone; `validateInput` throws the plain 400 object).
 */
const { validateInput: validate } = require("../../validators/input");
const {
  requestErasure,
  updateConsent,
  rectifyData,
  restrictProcessing,
  rectifiedEmailSchema,
} = require("../../validators/gdpr.validator");

const REQUIRED_STRING = "Invalid input: expected string, received undefined";
const TOO_LONG = "Too big: expected string to have <=500 characters";

/** @returns the field errors `validate` threw (asserting the 400 shape), or undefined */
const errorsOf = (data, schema) => {
  try {
    validate(data, schema);
  } catch (error) {
    expect(error).toMatchObject({ status: 400, message: "Validation failed" });
    return error.errors;
  }
  return undefined;
};

describe("GDPR/CCPA Validators", () => {
  describe("requestErasure", () => {
    it("should validate correct erasure request", () => {
      const value = validate({ reason: "User requested account deletion", confirm: true }, requestErasure);

      expect(value.confirm).toBe(true);
    });

    it('accepts confirm as the text "true"', () => {
      expect(validate({ reason: "r", confirm: "true" }, requestErasure)).toEqual({ reason: "r", confirm: true });
    });

    it("should reject missing reason", () => {
      expect(errorsOf({ confirm: true }, requestErasure)).toEqual([{ field: "reason", message: REQUIRED_STRING }]);
    });

    it("should reject missing confirm", () => {
      expect(errorsOf({ reason: "User requested account deletion" }, requestErasure)).toEqual([
        { field: "confirm", message: "Invalid input: expected boolean, received undefined" },
      ]);
    });

    it("should reject confirm false", () => {
      expect(errorsOf({ reason: "User requested account deletion", confirm: false }, requestErasure)).toEqual([
        { field: "confirm", message: "confirm must be true" },
      ]);
    });

    it("should reject reason exceeding max length", () => {
      expect(errorsOf({ reason: "a".repeat(501), confirm: true }, requestErasure)).toEqual([
        { field: "reason", message: TOO_LONG },
      ]);
    });
  });

  describe("updateConsent", () => {
    it("should validate correct consent update", () => {
      const value = validate({ categories: ["analytics", "marketing"], consent: true }, updateConsent);

      expect(value.consent).toBe(true);
    });

    it("should validate with all categories", () => {
      expect(() =>
        validate({ categories: ["analytics", "marketing", "functional", "necessary"], consent: true }, updateConsent),
      ).not.toThrow();
    });

    it("should validate with single category", () => {
      expect(() => validate({ categories: ["analytics"], consent: false }, updateConsent)).not.toThrow();
    });

    it("should reject invalid category", () => {
      expect(errorsOf({ categories: ["invalid_category"], consent: true }, updateConsent)).toEqual([
        {
          field: "categories.0",
          message: 'Invalid option: expected one of "analytics"|"marketing"|"functional"|"necessary"',
        },
      ]);
    });

    it("should reject missing categories", () => {
      expect(errorsOf({ consent: true }, updateConsent)).toEqual([
        { field: "categories", message: "Invalid input: expected array, received undefined" },
      ]);
    });

    it("should reject missing consent", () => {
      expect(errorsOf({ categories: ["analytics"] }, updateConsent)).toEqual([
        { field: "consent", message: "Invalid input: expected boolean, received undefined" },
      ]);
    });

    it("should accept an empty categories array", () => {
      expect(() => validate({ categories: [], consent: true }, updateConsent)).not.toThrow(); // Empty array is allowed
    });
  });

  describe("rectifyData", () => {
    it("should validate correct rectification", () => {
      const value = validate({ field: "email", value: "newemail@example.com" }, rectifyData);

      expect(value.field).toBe("email");
    });

    it("should validate with numeric value", () => {
      expect(() => validate({ field: "age", value: 30 }, rectifyData)).not.toThrow();
    });

    it("should validate with boolean value", () => {
      expect(() => validate({ field: "subscribed", value: true }, rectifyData)).not.toThrow();
    });

    it("accepts a null value and the re-authentication fields", () => {
      expect(
        validate({ field: "phone", value: null, currentPassword: "pw", code: "123456", recoveryCode: "rc" }, rectifyData),
      ).toEqual({ field: "phone", value: null, currentPassword: "pw", code: "123456", recoveryCode: "rc" });
    });

    it("should reject missing field", () => {
      expect(errorsOf({ value: "newemail@example.com" }, rectifyData)).toEqual([
        { field: "field", message: REQUIRED_STRING },
      ]);
    });

    it("should reject missing value", () => {
      expect(errorsOf({ field: "email" }, rectifyData)).toEqual([{ field: "value", message: "value is required" }]);
    });

    it("should reject empty field", () => {
      expect(errorsOf({ field: "", value: "test" }, rectifyData)).toEqual([
        { field: "field", message: "Too small: expected string to have >=1 characters" },
      ]);
    });
  });

  describe("restrictProcessing", () => {
    it("should validate correct restriction request", () => {
      const value = validate({ reason: "Disputing accuracy of data" }, restrictProcessing);

      expect(value.reason).toBe("Disputing accuracy of data");
    });

    it("should reject missing reason", () => {
      expect(errorsOf({}, restrictProcessing)).toEqual([{ field: "reason", message: REQUIRED_STRING }]);
    });

    it("should reject empty reason", () => {
      expect(errorsOf({ reason: "" }, restrictProcessing)).toEqual([
        { field: "reason", message: "Too small: expected string to have >=1 characters" },
      ]);
    });

    it("should reject reason exceeding max length", () => {
      expect(errorsOf({ reason: "a".repeat(501) }, restrictProcessing)).toEqual([{ field: "reason", message: TOO_LONG }]);
    });
  });

  describe("rectifiedEmailSchema", () => {
    it("accepts an email address up to 255 characters", () => {
      expect(rectifiedEmailSchema.safeParse("new@example.com")).toEqual({ success: true, data: "new@example.com" });
    });

    it("refuses a malformed or over-long address", () => {
      expect(rectifiedEmailSchema.safeParse("not-an-email").error.issues[0].message).toBe("Invalid email address");
      // A 262-character address breaks both the RFC 5321 limits (64 before the
      // "@", 254 in all) and the 255 column cap; both are reported.
      expect(rectifiedEmailSchema.safeParse(`${"a".repeat(250)}@example.com`).error.issues.map((i) => i.message)).toEqual([
        "Invalid email address",
        "Too big: expected string to have <=255 characters",
      ]);
    });
  });
});
