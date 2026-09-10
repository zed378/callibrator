/**
 * Custom Domains validator tests
 */
const {
  addDomain,
  domainType,
  validate,
} = require("../../validators/customDomains.validator");

describe("Custom Domains Validators", () => {
  describe("addDomain", () => {
    it("should validate with default type and ssl", () => {
      const value = validate({ domain: "example.com" }, addDomain);

      expect(value.domain).toBe("example.com");
      expect(value.type).toBe("subdomain");
      expect(value.sslEnabled).toBe(true);
    });

    it("should validate with custom type", () => {
      const value = validate({ domain: "example.com", type: "custom" }, addDomain);

      expect(value.type).toBe("custom");
    });

    it("should validate with ssl disabled", () => {
      const value = validate({ domain: "example.com", sslEnabled: false }, addDomain);

      expect(value.sslEnabled).toBe(false);
    });

    it("should reject invalid domain", () => {
      expect(() => validate({ domain: "not a domain" }, addDomain)).toThrow();
    });

    it("should reject missing domain", () => {
      expect(() => validate({}, addDomain)).toThrow();
    });

    it("should reject invalid type", () => {
      expect(() => validate({ domain: "example.com", type: "invalid" }, addDomain)).toThrow();
    });
  });

  describe("domainType", () => {
    it("should validate valid domain type", () => {
      const value = validate({ type: "custom" }, domainType);

      expect(value.type).toBe("custom");
    });

    it("should validate subdomain type", () => {
      const value = validate({ type: "subdomain" }, domainType);

      expect(value.type).toBe("subdomain");
    });

    it("should validate vanity type", () => {
      const value = validate({ type: "vanity" }, domainType);

      expect(value.type).toBe("vanity");
    });

    it("should reject missing type", () => {
      expect(() => validate({}, domainType)).toThrow();
    });

    it("should reject invalid type", () => {
      expect(() => validate({ type: "invalid" }, domainType)).toThrow();
    });
  });
});
