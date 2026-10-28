/**
 * SSO validator tests
 *
 * P9-11 (ADR-093): the module's own validate/formatErrors helpers are gone;
 * the schemas are exercised through the shared checkInput (validators/input),
 * which answers { ok: true, value } or { ok: false, errors: [{ field, message }] }.
 * The formatErrors cases now live with fieldErrors (session.validator.test.ts).
 */
import { ssoLoginSchema, ssoExchangeSchema, ssoSettingsSchema } from "../../validators/sso.validator";
import { checkInput } from "../../validators/input";

describe("SSO Validators", () => {
  describe("ssoLoginSchema", () => {
    it("should validate correct login data", () => {
      const result = checkInput({ tenantCode: "acme" }, ssoLoginSchema);

      expect(result).toEqual({ ok: true, value: { tenantCode: "acme" } });
    });

    it("should validate longer tenant code", () => {
      expect(checkInput({ tenantCode: "my-company-corporation" }, ssoLoginSchema).ok).toBe(true);
    });

    it("should reject tenant code too short", () => {
      const result = checkInput({ tenantCode: "a" }, ssoLoginSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "tenantCode", message: "Too small: expected string to have >=2 characters" },
        ]);
      }
    });

    it("should reject missing tenant code", () => {
      const result = checkInput({}, ssoLoginSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "tenantCode", message: "Invalid input: expected string, received undefined" },
        ]);
      }
    });

    it("should reject empty tenant code", () => {
      const result = checkInput({ tenantCode: "" }, ssoLoginSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "tenantCode", message: "Too small: expected string to have >=2 characters" },
        ]);
      }
    });

    it("should reject tenant code exceeding max length", () => {
      const result = checkInput({ tenantCode: "a".repeat(101) }, ssoLoginSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "tenantCode", message: "Too big: expected string to have <=100 characters" },
        ]);
      }
    });

    it("should handle whitespace trimming", () => {
      const result = checkInput({ tenantCode: "  acme  " }, ssoLoginSchema);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.tenantCode).toBe("acme");
      }
    });
  });

  describe("ssoExchangeSchema (A-60)", () => {
    it("should accept a 43-character base64url code", () => {
      const code = "Ab0_-".repeat(8) + "xyz";
      expect(checkInput({ code }, ssoExchangeSchema)).toEqual({ ok: true, value: { code } });
    });

    it("should reject a code of the wrong length", () => {
      const result = checkInput({ code: "A".repeat(42) }, ssoExchangeSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "code", message: "Too small: expected string to have exactly 43 characters" },
        ]);
      }
    });

    it("should reject a code outside the base64url alphabet", () => {
      const result = checkInput({ code: "!".repeat(43) }, ssoExchangeSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([{ field: "code", message: "Invalid SSO code" }]);
      }
    });

    it("should reject a missing code", () => {
      const result = checkInput({}, ssoExchangeSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "code", message: "Invalid input: expected string, received undefined" },
        ]);
      }
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

      const result = checkInput(data, ssoSettingsSchema);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(data);
      }
    });

    it("should validate with disabled SSO", () => {
      expect(checkInput({ sso_enabled: false }, ssoSettingsSchema)).toEqual({ ok: true, value: { sso_enabled: false } });
    });

    it("should convert a 'true' string to a boolean", () => {
      const result = checkInput({ sso_enabled: "true" }, ssoSettingsSchema);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sso_enabled).toBe(true);
      }
    });

    it("should trim the free-text fields", () => {
      const result = checkInput({ sso_enabled: true, sso_idp_entity_id: "  x  " }, ssoSettingsSchema);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sso_idp_entity_id).toBe("x");
      }
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

      expect(checkInput(data, ssoSettingsSchema).ok).toBe(true);
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

      expect(checkInput(data, ssoSettingsSchema).ok).toBe(true);
    });

    it("should reject missing sso_enabled", () => {
      const result = checkInput({ sso_idp_entry_point: "https://idp.example.com/sso" }, ssoSettingsSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "sso_enabled", message: "Invalid input: expected boolean, received undefined" },
        ]);
      }
    });

    it("should reject a non-boolean sso_enabled", () => {
      const result = checkInput({ sso_enabled: "yes" }, ssoSettingsSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "sso_enabled", message: "Invalid input: expected boolean, received string" },
        ]);
      }
    });

    it("should reject invalid URI for entry point", () => {
      const result = checkInput({ sso_enabled: true, sso_idp_entry_point: "not-a-uri" }, ssoSettingsSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([{ field: "sso_idp_entry_point", message: "Invalid URL" }]);
      }
    });

    it("should reject invalid URI for callback URL", () => {
      const result = checkInput({ sso_enabled: true, sso_sp_callback_url: "not-a-uri" }, ssoSettingsSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([{ field: "sso_sp_callback_url", message: "Invalid URL" }]);
      }
    });
  });
});
