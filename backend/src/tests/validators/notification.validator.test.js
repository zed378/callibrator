/**
 * Notification validator tests
 *
 * The notification module exposes only the shared validation helpers
 * (notification endpoints do not currently define payload schemas).
 */
const Joi = require("joi");
const { validate, formatErrors } = require("../../validators/notification.validator");

describe("Notification Validators", () => {
  const sampleSchema = Joi.object({ userId: Joi.string().uuid().required() });

  it("should return { error, value } from validate", () => {
    const { error, value } = validate(
      { userId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11" },
      sampleSchema,
    );
    expect(error).toBeUndefined();
    expect(value.userId).toBe("8c352a92-d6cf-4b71-b0db-6e69622d1b11");
  });

  it("should surface validation errors", () => {
    const { error } = validate({ userId: "bad" }, sampleSchema);
    expect(error).toBeDefined();
  });

  it("should format error details", () => {
    const { error } = validate({ userId: "bad" }, sampleSchema);
    const formatted = formatErrors(error.details);
    expect(Array.isArray(formatted)).toBe(true);
    expect(formatted[0]).toHaveProperty("field");
  });
});
