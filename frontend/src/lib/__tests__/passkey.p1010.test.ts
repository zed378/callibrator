/** @jest-environment jsdom */
/**
 * P10-10 — the WebAuthn wire format the backend verifies (@simplewebauthn's
 * JSON). The options' base64url challenge becomes bytes; an assertion's
 * buffers become unpadded base64url; a cancelled ceremony is null, not an error;
 * no identifier or allowCredentials is invented for a discoverable credential.
 */
import { getPasskeyAssertion, passkeySupported, toAssertionJSON, toRequestOptions } from "../passkey";

const bytes = (...n: number[]) => new Uint8Array(n).buffer;

describe("P10-10: passkey wire format", () => {
  it("decodes the challenge and asks for user verification; no allowCredentials when none is sent", () => {
    const o = toRequestOptions({ challenge: "AQID_-8", rpId: "rs.test", timeout: 60000 });
    expect(Array.from(new Uint8Array(o.challenge as ArrayBuffer))).toEqual([1, 2, 3, 255, 239]);
    expect(o.userVerification).toBe("required");
    expect(o.rpId).toBe("rs.test");
    expect(o).not.toHaveProperty("allowCredentials");
  });

  it("encodes an assertion as unpadded base64url", () => {
    const cred = {
      id: "cred-1",
      rawId: bytes(251, 255),
      type: "public-key",
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: bytes(1),
        authenticatorData: bytes(2, 3),
        signature: bytes(4, 5, 6),
        userHandle: bytes(7),
      },
    } as unknown as PublicKeyCredential;
    expect(toAssertionJSON(cred)).toEqual({
      id: "cred-1",
      rawId: "-_8",
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: { clientDataJSON: "AQ", authenticatorData: "AgM", signature: "BAUG", userHandle: "Bw" },
    });
  });

  it("a cancelled ceremony is null; support needs PublicKeyCredential", async () => {
    Object.defineProperty(navigator, "credentials", {
      value: { get: jest.fn().mockRejectedValue(new DOMException("cancel", "NotAllowedError")) },
      configurable: true,
    });
    await expect(getPasskeyAssertion({ challenge: "AA" })).resolves.toBeNull();
    expect(passkeySupported()).toBe(false);
    (window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = function PublicKeyCredential() {};
    expect(passkeySupported()).toBe(true);
    delete (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential;
  });
});
