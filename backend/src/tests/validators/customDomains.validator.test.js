/**
 * Custom Domains validator tests
 *
 * P9-11 (ADR-093): the schemas are Zod, exercised through the shared
 * `validateInput` helper (the file's own `validate` is gone).
 */
const { validateInput } = require("../../validators/input");
const { addDomain, domainType } = require("../../validators/customDomains.validator");

const TYPE_OPTION = 'Invalid option: expected one of "subdomain"|"custom"|"vanity"';

/** @returns the field errors `validateInput` threw, or undefined */
const errorsOf = (data, schema) => {
  try {
    validateInput(data, schema);
  } catch (error) {
    expect(error).toMatchObject({ status: 400, message: "Validation failed" });
    return error.errors;
  }
  return undefined;
};

describe("Custom Domains Validators", () => {
  describe("addDomain", () => {
    it("should validate with default type and ssl", () => {
      const value = validateInput({ domain: "example.com" }, addDomain);

      expect(value).toEqual({ domain: "example.com", type: "subdomain", sslEnabled: true });
    });

    it("should validate with custom type", () => {
      const value = validateInput({ domain: "example.com", type: "custom" }, addDomain);

      expect(value.type).toBe("custom");
    });

    it("should validate with ssl disabled", () => {
      const value = validateInput({ domain: "example.com", sslEnabled: false }, addDomain);

      expect(value.sslEnabled).toBe(false);
    });

    it("converts sslEnabled from text and strips unknown keys", () => {
      expect(validateInput({ domain: "example.com", sslEnabled: "false", tenantId: "t" }, addDomain)).toEqual({
        domain: "example.com",
        type: "subdomain",
        sslEnabled: false,
      });
    });

    it("should reject invalid domain", () => {
      expect(errorsOf({ domain: "not a domain" }, addDomain)).toEqual([
        { field: "domain", message: "Must be a valid hostname" },
      ]);
    });

    it.each(["sub.example.com", "localhost", "192.168.1.1", "::1"])("accepts the hostname or IP address %s", (domain) => {
      expect(validateInput({ domain }, addDomain).domain).toBe(domain);
    });

    it.each(["123", "2026-09-29", 123])("refuses %j: neither an IP address nor a name ending in a label that starts with a letter", (domain) => {
      expect(errorsOf({ domain }, addDomain)).toEqual([{ field: "domain", message: "Must be a valid hostname" }]);
    });

    it("should reject missing domain", () => {
      expect(errorsOf({}, addDomain)).toEqual([{ field: "domain", message: "Domain is required" }]);
    });

    it("should reject invalid type", () => {
      expect(errorsOf({ domain: "example.com", type: "invalid" }, addDomain)).toEqual([
        { field: "type", message: TYPE_OPTION },
      ]);
    });
  });

  describe("domainType", () => {
    it("should validate valid domain type", () => {
      expect(validateInput({ type: "custom" }, domainType).type).toBe("custom");
    });

    it("should validate subdomain type", () => {
      expect(validateInput({ type: "subdomain" }, domainType).type).toBe("subdomain");
    });

    it("should validate vanity type", () => {
      expect(validateInput({ type: "vanity" }, domainType).type).toBe("vanity");
    });

    it("should reject missing type", () => {
      expect(errorsOf({}, domainType)).toEqual([{ field: "type", message: TYPE_OPTION }]);
    });

    it("should reject invalid type", () => {
      expect(errorsOf({ type: "invalid" }, domainType)).toEqual([{ field: "type", message: TYPE_OPTION }]);
    });
  });
});
