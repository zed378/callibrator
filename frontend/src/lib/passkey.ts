/**
 * P10-10 (ADR-098 §5, ADR-108): the browser half of passwordless passkey
 * sign-in, with the WebAuthn API only (no library).
 *
 * The credential is DISCOVERABLE (registration requires `residentKey`), so the
 * ceremony asks for no identifier and the server's options carry no
 * `allowCredentials`: the authenticator offers the user's own passkeys.
 */

/** WebAuthn is there to call. The sign-in page renders the button only then. */
export const passkeySupported = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.PublicKeyCredential === "function" &&
  typeof navigator !== "undefined" &&
  Boolean(navigator.credentials?.get);

const fromB64url = (value: string): ArrayBuffer => {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
};

const toB64url = (buf: ArrayBuffer | null | undefined): string | undefined => {
  if (!buf) return undefined;
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** The server's PublicKeyCredentialRequestOptionsJSON (a subset is enough). */
export interface RequestOptionsJSON {
  challenge: string;
  rpId?: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: Array<{ id: string; type: "public-key"; transports?: string[] }>;
}

/** The AuthenticationResponseJSON the backend verifies (@simplewebauthn/server shape). */
export interface AssertionJSON {
  id: string;
  rawId: string;
  type: string;
  authenticatorAttachment?: string | null;
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string };
}

export const toRequestOptions = (json: RequestOptionsJSON): PublicKeyCredentialRequestOptions => ({
  challenge: fromB64url(json.challenge),
  ...(json.rpId ? { rpId: json.rpId } : {}),
  ...(json.timeout ? { timeout: json.timeout } : {}),
  // A passkey that does not verify the user is refused by the server; ask for it.
  userVerification: json.userVerification ?? "required",
  ...(json.allowCredentials?.length
    ? {
        allowCredentials: json.allowCredentials.map((c) => ({
          id: fromB64url(c.id),
          type: c.type,
          transports: c.transports as AuthenticatorTransport[] | undefined,
        })),
      }
    : {}),
});

export const toAssertionJSON = (cred: PublicKeyCredential): AssertionJSON => {
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId) ?? cred.id,
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? null,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: toB64url(r.clientDataJSON) ?? "",
      authenticatorData: toB64url(r.authenticatorData) ?? "",
      signature: toB64url(r.signature) ?? "",
      ...(r.userHandle ? { userHandle: toB64url(r.userHandle) } : {}),
    },
  };
};

/** Runs the ceremony. Null when the user cancels or the browser refuses (NotAllowedError). */
export const getPasskeyAssertion = async (options: RequestOptionsJSON): Promise<AssertionJSON | null> => {
  try {
    const cred = (await navigator.credentials.get({ publicKey: toRequestOptions(options) })) as PublicKeyCredential | null;
    return cred ? toAssertionJSON(cred) : null;
  } catch (err) {
    if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError")) return null;
    throw err;
  }
};
