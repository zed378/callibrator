/**
 * Audit validator tests
 *
 * The audit module exposes only the shared validation helpers (audit
 * endpoints are read-only and do not define payload schemas).
 */
const Joi = require("joi");
const { validate, formatErrors } = require("../../validators/audit.validator");

describe("Audit Validators", () => {
  const sampleSchema = Joi.object({ id: Joi.string().uuid().required() });

  it("should return { error, value } from validate", () => {
    const { error, value } = validate({ id: "8c352a92-d6cf-4b71-b0db-6e69622d1b11" }, sampleSchema);
    expect(error).toBeUndefined();
    expect(value.id).toBe("8c352a92-d6cf-4b71-b0db-6e69622d1b11");
  });

  it("should surface validation errors", () => {
    const { error } = validate({ id: "bad" }, sampleSchema);
    expect(error).toBeDefined();
  });

  it("should format error details", () => {
    const { error } = validate({ id: "bad" }, sampleSchema);
    const formatted = formatErrors(error.details);
    expect(Array.isArray(formatted)).toBe(true);
    expect(formatted[0]).toHaveProperty("field");
    expect(formatted[0]).toHaveProperty("message");
  });
});
