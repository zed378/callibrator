/**
 * OIDC validator tests
 *
 * P9-11 (ADR-093): the module's own validate() is gone; the schema is
 * exercised through the shared validateInput, which returns the parsed value
 * or throws { status: 400, message: "Validation failed", errors: [{ field, message }] }.
 */
const { oidcClientSchema } = require("../../validators/oidc.validator");
const { validateInput } = require("../../validators/input");

const validate = (data) => validateInput(data, oidcClientSchema);

/**
 * @param {unknown} data - the input
 * @returns {object} the thrown validation failure
 */
const failure = (data) => {
  try {
    validate(data);
  } catch (error) {
    return error;
  }
  throw new Error("expected a validation failure");
};

describe("OIDC Validators", () => {
  describe("oidcClientSchema", () => {
    it("should validate correct OIDC client", () => {
      const value = validate({ name: "My App", redirectUris: ["https://myapp.com/callback"] });

      expect(value.name).toBe("My App");
    });

    it("should validate with default scopes", () => {
      const value = validate({ name: "My App", redirectUris: ["https://myapp.com/callback"] });

      expect(value.scopes).toEqual(["openid", "profile", "email"]);
    });

    it("should validate with default grant types", () => {
      const value = validate({ name: "My App", redirectUris: ["https://myapp.com/callback"] });

      expect(value.grantTypes).toEqual(["authorization_code"]);
    });

    it("should validate with custom scopes", () => {
      const value = validate({
        name: "My App",
        redirectUris: ["https://myapp.com/callback"],
        scopes: ["openid", "profile", "email", "address"],
      });
      expect(value.scopes).toEqual(["openid", "profile", "email", "address"]);
    });

    it("should validate with custom grant types", () => {
      const value = validate({
        name: "My App",
        redirectUris: ["https://myapp.com/callback"],
        grantTypes: ["authorization_code", "refresh_token"],
      });
      expect(value.grantTypes).toEqual(["authorization_code", "refresh_token"]);
    });

    it("should validate multiple redirect URIs", () => {
      expect(() =>
        validate({
          name: "My App",
          redirectUris: ["https://myapp.com/callback", "https://myapp.com/auth/callback"],
        }),
      ).not.toThrow();
    });

    it("should validate single redirect URI", () => {
      expect(() => validate({ name: "My App", redirectUris: ["https://myapp.com/callback"] })).not.toThrow();
    });

    it("should strip unknown keys", () => {
      const value = validate({ name: "My App", redirectUris: ["https://myapp.com/callback"], secret: "x" });
      expect(value).not.toHaveProperty("secret");
    });

    it("should reject missing name", () => {
      expect(failure({ redirectUris: ["https://myapp.com/callback"] })).toEqual({
        status: 400,
        message: "Validation failed",
        errors: [{ field: "name", message: "Invalid input: expected string, received undefined" }],
      });
    });

    it("should reject missing redirect URIs", () => {
      expect(failure({ name: "My App" }).errors).toEqual([
        { field: "redirectUris", message: "Invalid input: expected array, received undefined" },
      ]);
    });

    it("should reject invalid URI in redirect URIs", () => {
      expect(failure({ name: "My App", redirectUris: ["not-a-valid-uri"] }).errors).toEqual([
        { field: "redirectUris.0", message: "Invalid URL" },
      ]);
    });

    it("should reject an empty scope entry", () => {
      expect(failure({ name: "My App", redirectUris: [], scopes: [""] }).errors).toEqual([
        { field: "scopes.0", message: "Too small: expected string to have >=1 characters" },
      ]);
    });
  });
});
