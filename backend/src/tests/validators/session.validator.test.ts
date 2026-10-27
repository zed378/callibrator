/**
 * Session validator tests
 *
 * P9-11 (ADR-093): the module's own validate/formatErrors helpers are gone;
 * the schemas are exercised through the shared checkInput, and the error
 * formatting through fieldErrors (validators/input).
 */
import { z } from "zod";
import { revokeSessionSchema, revokeAllSessionsSchema } from "../../validators/session.validator";
import { checkInput, fieldErrors } from "../../validators/input";

describe("Session Validators", () => {
  describe("revokeSessionSchema", () => {
    it("should validate with default reason", () => {
      expect(checkInput({}, revokeSessionSchema)).toEqual({ ok: true, value: { reason: "MANUAL_REVOKE" } });
    });

    it("should apply the default for an absent body", () => {
      const result = checkInput(undefined, revokeSessionSchema);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ reason: "MANUAL_REVOKE" });
      }
    });

    it("should validate with custom reason", () => {
      const result = checkInput({ reason: "Suspicious activity detected" }, revokeSessionSchema);

      expect(result).toEqual({ ok: true, value: { reason: "Suspicious activity detected" } });
    });

    it("should trim the reason", () => {
      const result = checkInput({ reason: "  spaced  " }, revokeSessionSchema);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.reason).toBe("spaced");
      }
    });

    it("should reject a blank reason", () => {
      const result = checkInput({ reason: "   " }, revokeSessionSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "reason", message: "Too small: expected string to have >=1 characters" },
        ]);
      }
    });

    it("should reject reason exceeding max length", () => {
      const result = checkInput({ reason: "a".repeat(256) }, revokeSessionSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "reason", message: "Too big: expected string to have <=255 characters" },
        ]);
      }
    });
  });

  describe("revokeAllSessionsSchema", () => {
    it("should validate with default reason", () => {
      expect(checkInput({}, revokeAllSessionsSchema)).toEqual({ ok: true, value: { reason: "ADMIN_REVOKE_ALL" } });
    });

    it("should validate with custom reason", () => {
      expect(checkInput({ reason: "Security breach detected" }, revokeAllSessionsSchema).ok).toBe(true);
    });

    it("should reject reason exceeding max length", () => {
      const result = checkInput({ reason: "a".repeat(256) }, revokeAllSessionsSchema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "reason", message: "Too big: expected string to have <=255 characters" },
        ]);
      }
    });
  });

  describe("fieldErrors", () => {
    const schema = z.object({
      tenantId: z.string({ error: "tenantId is required" }),
      user: z.object({ name: z.string({ error: "Name is required" }) }),
    });

    it("should format error details correctly, nested paths joined with dots", () => {
      const result = fieldErrors(schema.safeParse({ user: {} }).error as z.ZodError);

      expect(result).toEqual([
        { field: "tenantId", message: "tenantId is required" },
        { field: "user.name", message: "Name is required" },
      ]);
    });

    it("should return empty array for an error without issues", () => {
      expect(fieldErrors(new z.ZodError([]))).toEqual([]);
    });
  });
});
