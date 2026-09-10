/**
 * OIDC validator tests
 */
const {
  oidcClientSchema,
  validate,
} = require("../../validators/oidc.validator");

describe("OIDC Validators", () => {
  describe("oidcClientSchema", () => {
    it("should validate correct OIDC client", () => {
      const value = validate(
        { name: "My App", redirectUris: ["https://myapp.com/callback"] },
        oidcClientSchema,
      );

      expect(value.name).toBe("My App");
    });

    it("should validate with default scopes", () => {
      const value = validate(
        { name: "My App", redirectUris: ["https://myapp.com/callback"] },
        oidcClientSchema,
      );

      expect(value.scopes).toEqual(["openid", "profile", "email"]);
    });

    it("should validate with default grant types", () => {
      const value = validate(
        { name: "My App", redirectUris: ["https://myapp.com/callback"] },
        oidcClientSchema,
      );

      expect(value.grantTypes).toEqual(["authorization_code"]);
    });

    it("should validate with custom scopes", () => {
      expect(() =>
        validate(
          { name: "My App", redirectUris: ["https://myapp.com/callback"], scopes: ["openid", "profile", "email", "address"] },
          oidcClientSchema,
        ),
      ).not.toThrow();
    });

    it("should validate with custom grant types", () => {
      expect(() =>
        validate(
          { name: "My App", redirectUris: ["https://myapp.com/callback"], grantTypes: ["authorization_code", "refresh_token"] },
          oidcClientSchema,
        ),
      ).not.toThrow();
    });

    it("should validate multiple redirect URIs", () => {
      expect(() =>
        validate(
          {
            name: "My App",
            redirectUris: [
              "https://myapp.com/callback",
              "https://myapp.com/auth/callback",
            ],
          },
          oidcClientSchema,
        ),
      ).not.toThrow();
    });

    it("should validate single redirect URI", () => {
      expect(() =>
        validate(
          { name: "My App", redirectUris: ["https://myapp.com/callback"] },
          oidcClientSchema,
        ),
      ).not.toThrow();
    });

    it("should reject missing name", () => {
      expect(() =>
        validate({ redirectUris: ["https://myapp.com/callback"] }, oidcClientSchema),
      ).toThrow();
    });

    it("should reject missing redirect URIs", () => {
      expect(() =>
        validate({ name: "My App" }, oidcClientSchema),
      ).toThrow();
    });

    it("should reject invalid URI in redirect URIs", () => {
      expect(() =>
        validate({ name: "My App", redirectUris: ["not-a-valid-uri"] }, oidcClientSchema),
      ).toThrow();
    });
  });
});
