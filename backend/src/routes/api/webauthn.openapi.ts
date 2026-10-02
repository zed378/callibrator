/**
 * P9-21 / P9-25 (ADR-103) — the contract of `webauthn.route.ts`, code-first.
 *
 * `router.use(auth)` authenticates every route, and no route carries a gate:
 * each acts on the CALLER's own passkeys (the user id and tenant come from the
 * token, never the request), so `permission` is `authenticated`. Another
 * user's passkey id, in any tenant, is a 404 (ADR-108 Amendment 1). The
 * ceremony bodies are the browser's WebAuthn JSON, passed to
 * @simplewebauthn/server; the two passkey-management bodies are the mounted
 * schemas (`@callibrator/contracts/webauthnCredential`). The passkey SIGN-IN
 * (no token) is authPublic's. Examples are synthetic.
 */
import { z } from "zod";
import { renamePasskeySchema, revokePasskeySchema } from "../../validators/webauthnCredential.validator";
import { defineRouteDocs } from "../../docs/openapi/operation";

const own = { kind: "authenticated", reason: "the caller's own passkeys (user and tenant from the token)" } as const;

const params = z.object({
  id: z.guid().meta({ description: "The passkey's row id (never the credential id)", example: "7d6c5b4a-3928-4f17-8e6d-5c4b3a291807" }),
});

const passkey = z
  .object({
    id: z.guid(),
    name: z.string(),
    createdAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime().nullable(),
    transports: z.array(z.string()).nullable(),
  })
  .meta({ id: "Passkey", description: "One of the caller's passkeys; never its credential id or key" });

/** The A-213 re-authentication: the current password, and with MFA a current code or a recovery code. */
const reauth = {
  currentPassword: z.string().optional(),
  code: z.string().optional().meta({ description: "A current TOTP code (accounts with MFA)" }),
  recoveryCode: z.string().optional().meta({ description: "Or a recovery code (accounts with MFA)" }),
};

const ceremonyBody = (what: string) =>
  z.looseObject({ id: z.string(), rawId: z.string(), type: z.literal("public-key"), response: z.looseObject({}) }).meta({
    description: `The browser's ${what} (WebAuthn JSON, as @simplewebauthn/browser produces it)`,
  });

export default defineRouteDocs({
  router: "api/webauthn.route",
  mount: "/api/v1/webauthn",
  tag: "WebAuthn",
  tagDescription: "The signed-in user's passkeys: enrolment, a passkey assertion, and managing the passkeys held.",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/status",
      operationId: "getWebauthnStatus",
      summary: "Get the caller's passkey status",
      permission: own,
      audited: false,
      success: {
        status: 200,
        description: "Whether passkeys are enabled, and how many",
        data: z.object({
          enabled: z.boolean(),
          count: z.number().int(),
          signCount: z.number().int().meta({ description: "The highest signature counter among the passkeys" }),
          lastUpdatedAt: z.iso.datetime().nullable(),
        }),
      },
      errors: [404],
    },
    {
      method: "post",
      path: "/registration-options",
      operationId: "getWebauthnRegistrationOptions",
      summary: "Begin a passkey registration",
      description: "The creation options for `navigator.credentials.create()`. No body is read. Answers 503 when the challenge store is unavailable.",
      permission: own,
      audited: false,
      success: {
        status: 200,
        description: "PublicKeyCredentialCreationOptionsJSON",
        data: z.looseObject({ challenge: z.string(), rp: z.looseObject({}), user: z.looseObject({}), pubKeyCredParams: z.array(z.looseObject({})) }),
      },
      conflict: "The account already holds the most passkeys it can; remove one first.",
      errors: [404],
    },
    {
      method: "post",
      path: "/verify-registration",
      operationId: "verifyWebauthnRegistration",
      summary: "Finish a passkey registration",
      description: "The attestation, plus an optional `name` for the passkey. A stale or missing challenge, or a failed verification, is a 400.",
      permission: own,
      audited: true,
      body: ceremonyBody("attestation").extend({ name: z.string().optional().meta({ description: "A label for the passkey" }) }),
      success: { status: 200, description: "The new passkey", data: z.object({ success: z.literal(true), credential: passkey }) },
      conflict: "The passkey is already registered, or the account holds the most passkeys it can.",
      errors: [404],
    },
    {
      method: "post",
      path: "/login-options",
      operationId: "getWebauthnLoginOptions",
      summary: "Begin a passkey assertion",
      description: "The request options for `navigator.credentials.get()`, over the caller's passkeys. No body is read.",
      permission: own,
      audited: false,
      success: {
        status: 200,
        description: "PublicKeyCredentialRequestOptionsJSON",
        data: z.looseObject({ challenge: z.string(), allowCredentials: z.array(z.looseObject({})).optional() }),
      },
    },
    {
      method: "post",
      path: "/verify-login",
      operationId: "verifyWebauthnLogin",
      summary: "Verify a passkey assertion",
      description:
        "Verifies the caller's assertion, then applies the tenant's sign-in policy (IP allowlist, and the geofence from the " +
        "device-reported `location`), which refuses with a 403. A failed assertion is a 401; no passkey, a 404.",
      permission: own,
      audited: false,
      body: ceremonyBody("assertion").extend({
        location: z.object({ latitude: z.number(), longitude: z.number() }).optional().meta({ description: "The device-reported location (A-288)" }),
      }),
      success: { status: 200, description: "The assertion is valid", data: z.object({ success: z.literal(true) }) },
      errors: [404],
    },
    {
      method: "post",
      path: "/disable",
      operationId: "disableWebauthn",
      summary: "Remove all of the caller's passkeys",
      description:
        "A-213: needs the current password and, on an account with MFA, a current `code` or a `recoveryCode` (a wrong or " +
        "missing proof is a 400). Audited as WEBAUTHN_DISABLE. A-260: the signed-in password-check budget answers 429.",
      permission: own,
      audited: true,
      body: z.object(reauth),
      success: { status: 200, description: "Passkeys removed", data: z.object({ success: z.literal(true) }) },
      conflict: "No passkey is enrolled on this account.",
      errors: [404],
    },
    {
      method: "get",
      path: "/credentials",
      operationId: "listPasskeys",
      summary: "List the caller's passkeys",
      description: "Oldest first.",
      permission: own,
      audited: false,
      success: { status: 200, description: "The passkeys", data: z.array(passkey) },
      errors: [404],
    },
    {
      method: "patch",
      path: "/credentials/:id",
      operationId: "renamePasskey",
      summary: "Rename one of the caller's passkeys",
      permission: own,
      audited: true,
      params,
      body: renamePasskeySchema.omit({ id: true }),
      success: { status: 200, description: "The renamed passkey", data: passkey },
    },
    {
      method: "delete",
      path: "/credentials/:id",
      operationId: "revokePasskey",
      summary: "Remove one of the caller's passkeys",
      description:
        "Needs the A-213 re-authentication, which is also the lock-out guard: the last passkey goes only after the " +
        "password is proven. A wrong or missing proof is a 400.",
      permission: own,
      audited: true,
      params,
      body: revokePasskeySchema.omit({ id: true }),
      success: { status: 200, description: "Removed; `remaining` passkeys are left", data: z.object({ success: z.literal(true), remaining: z.number().int() }) },
    },
  ],
});
