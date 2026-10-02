import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type components } from "../typed";

/**
 * WebAuthn (passkeys / security keys).
 *
 * The user and tenant are taken from the caller's JWT — no ids are sent.
 * Backend: src/routes/api/webauthn.route.ts (mounted /api/v1/webauthn)
 *   GET  /status
 *   POST /registration-options
 *   POST /verify-registration
 *   POST /login-options
 *   POST /verify-login
 *   POST /disable
 *   GET    /credentials         (ADR-108 Am. 1: the caller's passkeys)
 *   PATCH  /credentials/:id     rename one
 *   DELETE /credentials/:id     remove one (re-authenticated)
 *
 * The backend speaks base64url for every binary field, while the browser's
 * credentials API speaks ArrayBuffer — this module owns that translation so
 * callers can pass the raw PublicKeyCredential straight through.
 *
 * P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
 * contract's (backend/src/routes/api/webauthn.openapi.ts). The ceremony
 * options are published as open objects (the WebAuthn library defines them),
 * so `RegistrationOptions` / `LoginOptions` keep the standard JSON shapes the
 * browser ceremony reads.
 */

// ---------- Types ----------

/** Registration options, as sent by the server (binary fields base64url-encoded). */
export interface RegistrationOptions {
  challenge: string;
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  excludeCredentials?: { id: string; type: "public-key"; transports?: string[] }[];
  authenticatorSelection?: {
    authenticatorAttachment?: AuthenticatorAttachment;
    requireResidentKey?: boolean;
    residentKey?: ResidentKeyRequirement;
    userVerification?: UserVerificationRequirement;
  };
  timeout?: number;
  attestation?: AttestationConveyancePreference;
}

/** Login (assertion) options, as sent by the server. */
export interface LoginOptions {
  challenge: string;
  rpId: string;
  allowCredentials?: { id: string; type: "public-key"; transports?: string[] }[];
  userVerification?: UserVerificationRequirement;
  timeout?: number;
}

type W = "/api/v1/webauthn";

/** POST /verify-login, /disable: `{ success: true }`. */
export type WebauthnResult = DataOf<Op<`${W}/verify-login`, "post">>;

/** POST /verify-registration: `{ success: true, credential }` (the new passkey). */
export type RegistrationResult = DataOf<Op<`${W}/verify-registration`, "post">>;

/** GET /status — `count` passkeys (ADR-108 Am. 1); `signCount` rises on each successful assertion. */
export type WebauthnStatus = DataOf<Op<`${W}/status`, "get">>;

/** One of the caller's passkeys (never its credential id or key). */
export type Passkey = components["schemas"]["Passkey"];

/** The A-213 re-authentication a removal needs. */
export type Reauth = NonNullable<JsonBody<Op<`${W}/credentials/{id}`, "delete">>>;

type VerifyLoginBody = JsonBody<Op<`${W}/verify-login`, "post">>;
type VerifyRegistrationBody = JsonBody<Op<`${W}/verify-registration`, "post">>;

// ---------- base64url helpers ----------

export function base64urlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Serialize a browser credential into the base64url shape the backend expects. */
function serializeCredential(credential: PublicKeyCredential) {
  const response = credential.response as
    | AuthenticatorAttestationResponse
    | AuthenticatorAssertionResponse;

  const serialized: Record<string, unknown> = {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    // @simplewebauthn/server expects the WebAuthn *ResponseJSON shape, which
    // includes clientExtensionResults; omitting it makes verification reject.
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment:
      (credential as PublicKeyCredential & { authenticatorAttachment?: string })
        .authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
    } as Record<string, unknown>,
  };

  const inner = serialized.response as Record<string, unknown>;
  if ("attestationObject" in response) {
    inner.attestationObject = bufferToBase64url(response.attestationObject);
    const transports =
      typeof response.getTransports === "function" ? response.getTransports() : [];
    if (transports.length) inner.transports = transports;
  } else {
    inner.authenticatorData = bufferToBase64url(response.authenticatorData);
    inner.signature = bufferToBase64url(response.signature);
    // Optional per the spec — send only when present.
    if (response.userHandle) {
      inner.userHandle = bufferToBase64url(response.userHandle);
    }
  }

  return serialized;
}

// ---------- Service ----------

export const webauthnService = {
  /** GET /api/v1/webauthn/status — whether the current user has a passkey. */
  getStatus: async (): Promise<WebauthnStatus> =>
    (await typedApi.GET("/api/v1/webauthn/status").then(unwrap)).data,

  /** POST /api/v1/webauthn/registration-options */
  getRegistrationOptions: async (): Promise<RegistrationOptions> =>
    // The contract publishes the options as an open object; this is their standard JSON shape.
    (await typedApi.POST("/api/v1/webauthn/registration-options").then(unwrap)).data as unknown as RegistrationOptions,

  /** POST /api/v1/webauthn/verify-registration */
  verifyRegistration: async (
    credential: PublicKeyCredential,
    name?: string,
  ): Promise<RegistrationResult> => {
    // The serialized credential is the WebAuthn *ResponseJSON shape the body publishes.
    const body = {
      ...serializeCredential(credential),
      ...(name && name.trim() ? { name: name.trim() } : {}),
    } as VerifyRegistrationBody;
    return (await typedApi.POST("/api/v1/webauthn/verify-registration", { body }).then(unwrap)).data;
  },

  /** POST /api/v1/webauthn/login-options */
  getLoginOptions: async (): Promise<LoginOptions> =>
    (await typedApi.POST("/api/v1/webauthn/login-options").then(unwrap)).data as unknown as LoginOptions,

  /** POST /api/v1/webauthn/verify-login */
  verifyLogin: async (
    credential: PublicKeyCredential,
  ): Promise<WebauthnResult> =>
    (
      await typedApi
        .POST("/api/v1/webauthn/verify-login", { body: serializeCredential(credential) as VerifyLoginBody })
        .then(unwrap)
    ).data,

  /**
   * POST /api/v1/webauthn/disable — removes the enrolled credential.
   * A-213: needs the current password and, on an MFA account, a current
   * code (or a recovery code); the backend answers 400 without them.
   */
  disable: async (reauth: Reauth): Promise<WebauthnResult> =>
    (await typedApi.POST("/api/v1/webauthn/disable", { body: reauth }).then(unwrap)).data,

  /** GET /api/v1/webauthn/credentials — the caller's passkeys, oldest first. */
  listPasskeys: async (): Promise<Passkey[]> =>
    (await typedApi.GET("/api/v1/webauthn/credentials").then(unwrap)).data ?? [],

  /** PATCH /api/v1/webauthn/credentials/:id — rename one. */
  renamePasskey: async (id: string, name: string): Promise<Passkey> =>
    (await typedApi.PATCH("/api/v1/webauthn/credentials/{id}", { params: { path: { id } }, body: { name } }).then(unwrap))
      .data,

  /**
   * DELETE /api/v1/webauthn/credentials/:id — remove one. Needs the current
   * password (and a code with MFA): that proof is also what stops the last
   * passkey leaving the account with no way in. The proof is the DELETE's body.
   */
  revokePasskey: async (id: string, reauth: Reauth): Promise<DataOf<Op<`${W}/credentials/{id}`, "delete">>> =>
    (await typedApi.DELETE("/api/v1/webauthn/credentials/{id}", { params: { path: { id } }, body: reauth }).then(unwrap))
      .data,

  /** True when this browser can do WebAuthn at all. */
  isSupported: (): boolean =>
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined",

  /**
   * Full enrolment ceremony: fetch options, prompt the authenticator, verify.
   */
  register: async (name?: string): Promise<WebauthnResult> => {
    const options = await webauthnService.getRegistrationOptions();

    const credential = (await navigator.credentials.create({
      publicKey: {
        ...options,
        challenge: base64urlToBuffer(options.challenge),
        user: {
          ...options.user,
          id: base64urlToBuffer(options.user.id),
        },
        excludeCredentials: options.excludeCredentials?.map((c) => ({
          ...c,
          id: base64urlToBuffer(c.id),
          transports: c.transports as AuthenticatorTransport[] | undefined,
        })),
      } as PublicKeyCredentialCreationOptions,
    })) as PublicKeyCredential | null;

    if (!credential) throw new Error("Registration was cancelled");
    return webauthnService.verifyRegistration(credential, name);
  },

  /**
   * Full assertion ceremony: fetch options, prompt the authenticator, verify.
   */
  authenticate: async (): Promise<WebauthnResult> => {
    const options = await webauthnService.getLoginOptions();

    const credential = (await navigator.credentials.get({
      publicKey: {
        ...options,
        challenge: base64urlToBuffer(options.challenge),
        allowCredentials: options.allowCredentials?.map((c) => ({
          ...c,
          id: base64urlToBuffer(c.id),
          transports: c.transports as AuthenticatorTransport[] | undefined,
        })),
      } as PublicKeyCredentialRequestOptions,
    })) as PublicKeyCredential | null;

    if (!credential) throw new Error("Authentication was cancelled");
    return webauthnService.verifyLogin(credential);
  },
};

export default webauthnService;
