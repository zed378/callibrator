import { api } from "../client";

/**
 * WebAuthn (passkeys / security keys).
 *
 * The user and tenant are taken from the caller's JWT — no ids are sent.
 * Backend: src/routes/api/webauthn.route.js (mounted /api/v1/webauthn)
 *   GET  /status
 *   POST /registration-options
 *   POST /verify-registration
 *   POST /login-options
 *   POST /verify-login
 *   POST /disable
 *
 * The backend speaks base64url for every binary field, while the browser's
 * credentials API speaks ArrayBuffer — this module owns that translation so
 * callers can pass the raw PublicKeyCredential straight through.
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

export interface WebauthnResult {
  success: boolean;
}

export interface WebauthnStatus {
  enabled: boolean;
  /** Authenticator signature counter — rises on each successful assertion. */
  signCount: number;
  lastUpdatedAt: string | null;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

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
  getStatus: async (): Promise<WebauthnStatus> => {
    const response = await api.get<BackendResponse<WebauthnStatus>>(
      "/api/v1/webauthn/status",
    );
    return response.data;
  },

  /** POST /api/v1/webauthn/registration-options */
  getRegistrationOptions: async (): Promise<RegistrationOptions> => {
    const response = await api.post<BackendResponse<RegistrationOptions>>(
      "/api/v1/webauthn/registration-options",
    );
    return response.data;
  },

  /** POST /api/v1/webauthn/verify-registration */
  verifyRegistration: async (
    credential: PublicKeyCredential,
  ): Promise<WebauthnResult> => {
    const response = await api.post<BackendResponse<WebauthnResult>>(
      "/api/v1/webauthn/verify-registration",
      serializeCredential(credential),
    );
    return response.data;
  },

  /** POST /api/v1/webauthn/login-options */
  getLoginOptions: async (): Promise<LoginOptions> => {
    const response = await api.post<BackendResponse<LoginOptions>>(
      "/api/v1/webauthn/login-options",
    );
    return response.data;
  },

  /** POST /api/v1/webauthn/verify-login */
  verifyLogin: async (
    credential: PublicKeyCredential,
  ): Promise<WebauthnResult> => {
    const response = await api.post<BackendResponse<WebauthnResult>>(
      "/api/v1/webauthn/verify-login",
      serializeCredential(credential),
    );
    return response.data;
  },

  /** POST /api/v1/webauthn/disable — removes the enrolled credential. */
  disable: async (): Promise<WebauthnResult> => {
    const response = await api.post<BackendResponse<WebauthnResult>>(
      "/api/v1/webauthn/disable",
    );
    return response.data;
  },

  /** True when this browser can do WebAuthn at all. */
  isSupported: (): boolean =>
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined",

  /**
   * Full enrolment ceremony: fetch options, prompt the authenticator, verify.
   */
  register: async (): Promise<WebauthnResult> => {
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
    return webauthnService.verifyRegistration(credential);
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
