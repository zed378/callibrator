import {
  webauthnService,
  base64urlToBuffer,
  bufferToBase64url,
} from "./webauthn.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;
const envelope = <T,>(data: T) => ({
  success: true,
  status: 200,
  message: "ok",
  data,
});

const BASE = "/api/v1/webauthn";

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

/** Minimal stand-in for a browser attestation credential. */
const attestationCredential = () =>
  ({
    id: "cred-id",
    rawId: bytes(1, 2, 3),
    type: "public-key",
    response: {
      clientDataJSON: bytes(4, 5),
      attestationObject: bytes(6, 7),
    },
  }) as unknown as PublicKeyCredential;

/** Minimal stand-in for a browser assertion credential. */
const assertionCredential = () =>
  ({
    id: "cred-id",
    rawId: bytes(1, 2, 3),
    type: "public-key",
    response: {
      clientDataJSON: bytes(4, 5),
      authenticatorData: bytes(8, 9),
      signature: bytes(10, 11),
      userHandle: null,
    },
  }) as unknown as PublicKeyCredential;

describe("base64url helpers", () => {
  it("round-trips a buffer", () => {
    const original = bytes(0, 1, 250, 255, 128);
    const encoded = bufferToBase64url(original);
    expect(encoded).not.toMatch(/[+/=]/); // url-safe, unpadded
    expect(new Uint8Array(base64urlToBuffer(encoded))).toEqual(
      new Uint8Array(original),
    );
  });

  it("decodes unpadded base64url from the server", () => {
    // "AQID" -> [1,2,3]
    expect(new Uint8Array(base64urlToBuffer("AQID"))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
});

describe("webauthnService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("status", () => {
    it("reads enrolment status", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ enabled: true, signCount: 3, lastUpdatedAt: null }),
      );
      const res = await webauthnService.getStatus();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/status`);
      expect(res.enabled).toBe(true);
      expect(res.signCount).toBe(3);
    });
  });

  describe("options", () => {
    it("posts for registration options", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ challenge: "AQID" }));
      const res = await webauthnService.getRegistrationOptions();
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/registration-options`);
      expect(res.challenge).toBe("AQID");
    });

    it("posts for login options", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({ challenge: "AQID", rpId: "localhost" }),
      );
      const res = await webauthnService.getLoginOptions();
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/login-options`);
      expect(res.rpId).toBe("localhost");
    });
  });

  describe("verification", () => {
    it("serializes an attestation credential to base64url", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ success: true }));
      await webauthnService.verifyRegistration(attestationCredential());

      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/verify-registration`, {
        id: "cred-id",
        rawId: "AQID",
        type: "public-key",
        response: {
          clientDataJSON: "BAU",
          attestationObject: "Bgc",
        },
      });
    });

    it("serializes an assertion credential, including signature fields", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ success: true }));
      await webauthnService.verifyLogin(assertionCredential());

      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/verify-login`, {
        id: "cred-id",
        rawId: "AQID",
        type: "public-key",
        response: {
          clientDataJSON: "BAU",
          authenticatorData: "CAk",
          signature: "Cgs",
          userHandle: null,
        },
      });
    });
  });

  describe("disable", () => {
    it("posts to disable", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ success: true }));
      const res = await webauthnService.disable();
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/disable`);
      expect(res.success).toBe(true);
    });
  });

  describe("register ceremony", () => {
    it("decodes challenge/user.id before calling the authenticator", async () => {
      mockedApi.post
        .mockResolvedValueOnce(
          envelope({
            challenge: "AQID",
            rp: { name: "Callibrator", id: "localhost" },
            user: { id: "BAU", name: "a@b.c", displayName: "A" },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          }),
        )
        .mockResolvedValueOnce(envelope({ success: true }));

      const create = jest.fn().mockResolvedValue(attestationCredential());
      Object.defineProperty(globalThis, "navigator", {
        value: { credentials: { create } },
        configurable: true,
      });

      await webauthnService.register();

      const passed = create.mock.calls[0][0].publicKey;
      expect(new Uint8Array(passed.challenge)).toEqual(
        new Uint8Array([1, 2, 3]),
      );
      expect(new Uint8Array(passed.user.id)).toEqual(new Uint8Array([4, 5]));
      expect(mockedApi.post).toHaveBeenLastCalledWith(
        `${BASE}/verify-registration`,
        expect.objectContaining({ rawId: "AQID" }),
      );
    });

    it("throws when the user cancels", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({
          challenge: "AQID",
          rp: { name: "Callibrator", id: "localhost" },
          user: { id: "BAU", name: "a@b.c", displayName: "A" },
          pubKeyCredParams: [],
        }),
      );
      Object.defineProperty(globalThis, "navigator", {
        value: { credentials: { create: jest.fn().mockResolvedValue(null) } },
        configurable: true,
      });

      await expect(webauthnService.register()).rejects.toThrow(
        "Registration was cancelled",
      );
    });
  });

  describe("authenticate ceremony", () => {
    it("decodes the challenge and verifies the assertion", async () => {
      mockedApi.post
        .mockResolvedValueOnce(envelope({ challenge: "AQID", rpId: "localhost" }))
        .mockResolvedValueOnce(envelope({ success: true }));

      const get = jest.fn().mockResolvedValue(assertionCredential());
      Object.defineProperty(globalThis, "navigator", {
        value: { credentials: { get } },
        configurable: true,
      });

      await webauthnService.authenticate();

      const passed = get.mock.calls[0][0].publicKey;
      expect(new Uint8Array(passed.challenge)).toEqual(
        new Uint8Array([1, 2, 3]),
      );
      expect(mockedApi.post).toHaveBeenLastCalledWith(
        `${BASE}/verify-login`,
        expect.objectContaining({
          rawId: "AQID",
          response: expect.objectContaining({ signature: "Cgs" }),
        }),
      );
    });
  });
});
