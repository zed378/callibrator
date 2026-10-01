/**
 * SSO request bodies.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/sso.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the sso routes.
 */
import { z } from "zod";
import { booleanish, optionalText } from "./fields";

const ssoLoginSchema = z.object({
  tenantCode: z.string().trim().min(2).max(100),
});

// A-60: the one-time code the SSO callback puts in its redirect — 32 random
// bytes, base64url, so exactly 43 characters of [A-Za-z0-9_-]. Anything else
// cannot be a code this server issued and is refused before any store lookup.
const ssoExchangeSchema = z.object({
  code: z
    .string()
    .length(43)
    .regex(/^[A-Za-z0-9_-]+$/, { error: "Invalid SSO code" }),
});

const optionalUrl = z.url().or(z.literal("")).nullable().optional();

const ssoSettingsSchema = z.object({
  sso_enabled: booleanish(),
  sso_idp_entry_point: optionalUrl,
  sso_idp_entity_id: optionalText(),
  sso_idp_cert: optionalText(),
  sso_sp_entity_id: optionalText(),
  sso_sp_callback_url: optionalUrl,
});

export { ssoLoginSchema, ssoExchangeSchema, ssoSettingsSchema };

// The client-side (input) and handler-side (output) types of each schema.
export type SsoLoginInput = z.input<typeof ssoLoginSchema>;
export type SsoLoginBody = z.output<typeof ssoLoginSchema>;
export type SsoExchangeInput = z.input<typeof ssoExchangeSchema>;
export type SsoExchangeBody = z.output<typeof ssoExchangeSchema>;
export type SsoSettingsInput = z.input<typeof ssoSettingsSchema>;
export type SsoSettingsBody = z.output<typeof ssoSettingsSchema>;
