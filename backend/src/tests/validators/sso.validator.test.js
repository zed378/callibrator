/**
 * SSO validator tests
 */
const {
  ssoLoginSchema,
  ssoSettingsSchema,
  validate,
  formatErrors,
} = require("../../validators/sso.validator");

describe("SSO Validators", () => {
  describe("ssoLoginSchema", () => {
    it("should validate correct login data", () => {
      const data = {
        tenantCode: "acme",
      };

      const { error, value } = validate(data, ssoLoginSchema);

      expect(error).toBeUndefined();
      expect(value.tenantCode).toBe("acme");
    });

    it("should validate longer tenant code", () => {
      const data = {
        tenantCode: "my-company-corporation",
      };

      const { error } = validate(data, ssoLoginSchema);

      expect(error).toBeUndefined();
    });

    it("should reject tenant code too short", () => {
      const data = {
        tenantCode: "a",
      };

      const { error } = validate(data, ssoLoginSchema);

      expect(error).toBeDefined();
    });

    it("should reject missing tenant code", () => {
      const data = {};

      const { error } = validate(data, ssoLoginSchema);

      expect(error).toBeDefined();
    });

    it("should reject empty tenant code", () => {
      const data = {
        tenantCode: "",
      };

      const { error } = validate(data, ssoLoginSchema);

      expect(error).toBeDefined();
    });

    it("should reject tenant code exceeding max length", () => {
      const data = {
        tenantCode: "a".repeat(101),
      };

      const { error } = validate(data, ssoLoginSchema);

      expect(error).toBeDefined();
    });

    it("should handle whitespace trimming", () => {
      const data = {
        tenantCode: "  acme  ",
      };

      const { error, value } = validate(data, ssoLoginSchema);

      expect(error).toBeUndefined();
      expect(value.tenantCode).toBe("acme");
    });
  });

  describe("ssoSettingsSchema", () => {
    it("should validate with all fields", () => {
      const data = {
        sso_enabled: true,
        sso_idp_entry_point: "https://idp.example.com/sso",
        sso_idp_entity_id: "https://idp.example.com/metadata",
        sso_idp_cert: "-----BEGIN CERTIFICATE-----\nMIIB...",
        sso_sp_entity_id: "https://app.example.com/sso",
        sso_sp_callback_url: "https://app.example.com/auth/callback",
      };

      const { error, value } = validate(data, ssoSettingsSchema);

      expect(error).toBeUndefined();
      expect(value.sso_enabled).toBe(true);
    });

    it("should validate with disabled SSO", () => {
      const data = {
        sso_enabled: false,
      };

      const { error } = validate(data, ssoSettingsSchema);

      expect(error).toBeUndefined();
    });

    it("should validate with null optional fields", () => {
      const data = {
        sso_enabled: true,
        sso_idp_entry_point: null,
        sso_idp_entity_id: null,
        sso_idp_cert: null,
        sso_sp_entity_id: null,
        sso_sp_callback_url: null,
      };

      const { error } = validate(data, ssoSettingsSchema);

      expect(error).toBeUndefined();
    });

    it("should validate with empty string optional fields", () => {
      const data = {
        sso_enabled: true,
        sso_idp_entry_point: "",
        sso_idp_entity_id: "",
        sso_idp_cert: "",
        sso_sp_entity_id: "",
        sso_sp_callback_url: "",
      };

      const { error } = validate(data, ssoSettingsSchema);

      expect(error).toBeUndefined();
    });

    it("should reject missing sso_enabled", () => {
      const data = {
        sso_idp_entry_point: "https://idp.example.com/sso",
      };

      const { error } = validate(data, ssoSettingsSchema);

      expect(error).toBeDefined();
    });

    it("should reject invalid URI for entry point", () => {
      const data = {
        sso_enabled: true,
        sso_idp_entry_point: "not-a-uri",
      };

      const { error } = validate(data, ssoSettingsSchema);

      expect(error).toBeDefined();
    });

    it("should reject invalid URI for callback URL", () => {
      const data = {
        sso_enabled: true,
        sso_sp_callback_url: "not-a-uri",
      };

      const { error } = validate(data, ssoSettingsSchema);

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
