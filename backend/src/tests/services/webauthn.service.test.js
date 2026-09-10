/**
 * Tests for the WebAuthn service (real @simplewebauthn/server verification +
 * Redis-backed challenge store).
 */

jest.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

jest.mock("../../services/redis.service", () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
}));

jest.mock("../../models", () => ({
  Users: { findOne: jest.fn(), update: jest.fn() },
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const lib = require("@simplewebauthn/server");
const redis = require("../../services/redis.service");
const { Users } = require("../../models");
const webauthn = require("../../services/webauthn.service");

describe("webauthn.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redis.set.mockResolvedValue(true);
    redis.del.mockResolvedValue(true);
  });

  // ------------------------------------------------------ getRegistrationOptions
  describe("getRegistrationOptions", () => {
    const user = { id: "u1", email: "a@b.com", firstName: "Ann", lastName: "Lee" };

    it("generates options and stores the challenge", async () => {
      lib.generateRegistrationOptions.mockResolvedValue({ challenge: "c1" });

      const result = await webauthn.getRegistrationOptions(user);

      expect(result).toEqual({ challenge: "c1" });
      expect(redis.set).toHaveBeenCalledWith("webauthn:challenge:u1", "c1", 300);
      expect(lib.generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          rpID: "localhost",
          userName: "a@b.com",
          userDisplayName: "Ann Lee",
        }),
      );
    });

    it("maps existing credentials into excludeCredentials", async () => {
      lib.generateRegistrationOptions.mockResolvedValue({ challenge: "c1" });

      await webauthn.getRegistrationOptions(user, [
        { credentialId: "cred-1", transports: ["usb"] },
      ]);

      expect(lib.generateRegistrationOptions.mock.calls[0][0].excludeCredentials).toEqual([
        { id: "cred-1", transports: ["usb"] },
      ]);
    });

    it("falls back to email when both names are missing", async () => {
      lib.generateRegistrationOptions.mockResolvedValue({ challenge: "c1" });

      await webauthn.getRegistrationOptions({ id: "u1", email: "a@b.com" });

      expect(lib.generateRegistrationOptions.mock.calls[0][0].userDisplayName).toBe("a@b.com");
    });

    it("builds displayName from firstName alone", async () => {
      lib.generateRegistrationOptions.mockResolvedValue({ challenge: "c1" });

      await webauthn.getRegistrationOptions({ id: "u1", email: "a@b.com", firstName: "Ann" });

      expect(lib.generateRegistrationOptions.mock.calls[0][0].userDisplayName).toBe("Ann");
    });

    it("throws 503 when the challenge cannot be stored", async () => {
      lib.generateRegistrationOptions.mockResolvedValue({ challenge: "c1" });
      redis.set.mockResolvedValue(false);

      await expect(webauthn.getRegistrationOptions(user)).rejects.toMatchObject({
        status: 503,
      });
    });
  });

  // ------------------------------------------------------------ getLoginOptions
  describe("getLoginOptions", () => {
    it("restricts allowCredentials to the enrolled credential", async () => {
      Users.findOne.mockResolvedValue({ webauthnCredentialId: "cred-1" });
      lib.generateAuthenticationOptions.mockResolvedValue({ challenge: "c2" });

      const result = await webauthn.getLoginOptions("u1");

      expect(result).toEqual({ challenge: "c2" });
      expect(lib.generateAuthenticationOptions.mock.calls[0][0].allowCredentials).toEqual([
        { id: "cred-1" },
      ]);
      expect(redis.set).toHaveBeenCalledWith("webauthn:challenge:u1", "c2", 300);
    });

    it("uses an empty allowCredentials list when the user has no credential", async () => {
      Users.findOne.mockResolvedValue({ webauthnCredentialId: null });
      lib.generateAuthenticationOptions.mockResolvedValue({ challenge: "c2" });

      await webauthn.getLoginOptions("u1");

      expect(lib.generateAuthenticationOptions.mock.calls[0][0].allowCredentials).toEqual([]);
    });

    it("uses an empty list when the user is not found", async () => {
      Users.findOne.mockResolvedValue(null);
      lib.generateAuthenticationOptions.mockResolvedValue({ challenge: "c2" });

      await webauthn.getLoginOptions("u1");

      expect(lib.generateAuthenticationOptions.mock.calls[0][0].allowCredentials).toEqual([]);
    });
  });

  // -------------------------------------------------------- verifyRegistration
  describe("verifyRegistration", () => {
    const resp = { id: "cred-1" };

    it("throws 400 when the challenge is missing/expired", async () => {
      redis.get.mockResolvedValue(null);

      await expect(webauthn.verifyRegistration("t1", "u1", resp)).rejects.toMatchObject({
        status: 400,
      });
    });

    it("throws 400 when the library rejects the attestation", async () => {
      redis.get.mockResolvedValue("c1");
      lib.verifyRegistrationResponse.mockRejectedValue(new Error("bad attestation"));

      await expect(webauthn.verifyRegistration("t1", "u1", resp)).rejects.toMatchObject({
        status: 400,
      });
    });

    it("throws 400 when the attestation is not verified", async () => {
      redis.get.mockResolvedValue("c1");
      lib.verifyRegistrationResponse.mockResolvedValue({ verified: false });

      await expect(webauthn.verifyRegistration("t1", "u1", resp)).rejects.toMatchObject({
        status: 400,
      });
    });

    it("throws 400 when registrationInfo is absent", async () => {
      redis.get.mockResolvedValue("c1");
      lib.verifyRegistrationResponse.mockResolvedValue({ verified: true, registrationInfo: null });

      await expect(webauthn.verifyRegistration("t1", "u1", resp)).rejects.toMatchObject({
        status: 400,
      });
    });

    it("persists the real credential on success", async () => {
      redis.get.mockResolvedValue("c1");
      lib.verifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: "cred-1", publicKey: Buffer.from([1, 2, 3]), counter: 5 },
        },
      });

      const result = await webauthn.verifyRegistration("t1", "u1", resp);

      expect(result).toEqual({ success: true });
      const [values, opts] = Users.update.mock.calls[0];
      expect(values).toMatchObject({
        webauthnCredentialId: "cred-1",
        webauthnSignCount: 5,
        webauthnEnabled: true,
      });
      expect(typeof values.webauthnPublicKey).toBe("string");
      expect(opts).toEqual({ where: { id: "u1", tenantId: "t1" } });
      // Challenge consumed (deleted) so it cannot be replayed.
      expect(redis.del).toHaveBeenCalledWith("webauthn:challenge:u1");
    });
  });

  // --------------------------------------------------------------- verifyLogin
  describe("verifyLogin", () => {
    const enrolled = {
      webauthnEnabled: true,
      webauthnCredentialId: "cred-1",
      // Length 3 (not a multiple of 4) so base64url decoding exercises padding.
      webauthnPublicKey: "AQI",
      webauthnSignCount: 5,
    };
    const resp = { id: "cred-1" };

    it("throws 404 when webauthn is not enrolled", async () => {
      Users.findOne.mockResolvedValue({ webauthnEnabled: false });

      await expect(webauthn.verifyLogin("t1", "u1", resp)).rejects.toMatchObject({
        status: 404,
      });
    });

    it("throws 400 when the challenge is missing", async () => {
      Users.findOne.mockResolvedValue(enrolled);
      redis.get.mockResolvedValue(null);

      await expect(webauthn.verifyLogin("t1", "u1", resp)).rejects.toMatchObject({
        status: 400,
      });
    });

    it("throws 401 when the library rejects the assertion", async () => {
      Users.findOne.mockResolvedValue(enrolled);
      redis.get.mockResolvedValue("c2");
      lib.verifyAuthenticationResponse.mockRejectedValue(new Error("bad sig"));

      await expect(webauthn.verifyLogin("t1", "u1", resp)).rejects.toMatchObject({
        status: 401,
      });
    });

    it("throws 401 when the assertion is not verified", async () => {
      Users.findOne.mockResolvedValue(enrolled);
      redis.get.mockResolvedValue("c2");
      lib.verifyAuthenticationResponse.mockResolvedValue({ verified: false });

      await expect(webauthn.verifyLogin("t1", "u1", resp)).rejects.toMatchObject({
        status: 401,
      });
    });

    it("advances the sign counter on success", async () => {
      Users.findOne.mockResolvedValue(enrolled);
      redis.get.mockResolvedValue("c2");
      lib.verifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      });

      const result = await webauthn.verifyLogin("t1", "u1", resp);

      expect(result).toEqual({ success: true });
      expect(Users.update).toHaveBeenCalledWith(
        { webauthnSignCount: 6 },
        { where: { id: "u1" } },
      );
    });

    it("defaults a missing stored counter to zero", async () => {
      Users.findOne.mockResolvedValue({
        webauthnEnabled: true,
        webauthnCredentialId: "cred-1",
        webauthnPublicKey: "AQI",
        // no webauthnSignCount
      });
      redis.get.mockResolvedValue("c2");
      lib.verifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      });

      await webauthn.verifyLogin("t1", "u1", resp);

      expect(lib.verifyAuthenticationResponse.mock.calls[0][0].credential.counter).toBe(0);
    });
  });

  // ----------------------------------------------------------------- getStatus
  describe("getStatus", () => {
    it("reports an enrolled user", async () => {
      Users.findOne.mockResolvedValue({
        webauthnEnabled: true,
        webauthnSignCount: 3,
        updatedAt: new Date("2026-01-01"),
      });

      const result = await webauthn.getStatus("t1", "u1");

      expect(result).toEqual({
        enabled: true,
        signCount: 3,
        lastUpdatedAt: new Date("2026-01-01"),
      });
    });

    it("normalizes missing signCount/updatedAt", async () => {
      Users.findOne.mockResolvedValue({ webauthnEnabled: false });

      const result = await webauthn.getStatus("t1", "u1");

      expect(result).toEqual({ enabled: false, signCount: 0, lastUpdatedAt: null });
    });

    it("throws 404 when the user is not found", async () => {
      Users.findOne.mockResolvedValue(null);

      await expect(webauthn.getStatus("t1", "u1")).rejects.toMatchObject({ status: 404 });
    });
  });

  // ------------------------------------------------------------------- disable
  describe("disable", () => {
    it("clears the credential fields", async () => {
      const result = await webauthn.disable("t1", "u1");

      expect(result).toEqual({ success: true });
      expect(Users.update).toHaveBeenCalledWith(
        {
          webauthnEnabled: false,
          webauthnCredentialId: null,
          webauthnPublicKey: null,
          webauthnSignCount: 0,
        },
        { where: { id: "u1", tenantId: "t1" } },
      );
    });
  });

  // -------------------------------------------------------------- ORIGIN config
  describe("expectedOrigin resolution", () => {
    const OLD = { ...process.env };
    afterEach(() => {
      process.env = { ...OLD };
      jest.resetModules();
    });

    const loadWith = (env) => {
      jest.resetModules();
      Object.assign(process.env, env);
      jest.doMock("@simplewebauthn/server", () => lib);
      jest.doMock("../../services/redis.service", () => redis);
      jest.doMock("../../models", () => ({ Users }));
      return require("../../services/webauthn.service");
    };

    const okRegistration = () => {
      redis.get.mockResolvedValue("c1");
      redis.del.mockResolvedValue(true);
      lib.verifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: { credential: { id: "c", publicKey: Buffer.from([1]), counter: 0 } },
      });
    };

    it("defaults to http://localhost:3000 for the localhost RP", async () => {
      delete process.env.WEBAUTHN_ORIGIN;
      delete process.env.WEBAUTHN_RP_ID;
      const svc = loadWith({});
      okRegistration();

      await svc.verifyRegistration("t1", "u1", {});

      expect(lib.verifyRegistrationResponse.mock.calls.at(-1)[0].expectedOrigin).toBe(
        "http://localhost:3000",
      );
    });

    it("honors an explicit WEBAUTHN_ORIGIN", async () => {
      const svc = loadWith({
        WEBAUTHN_ORIGIN: "https://app.example.com",
        WEBAUTHN_RP_ID: "example.com",
      });
      okRegistration();

      await svc.verifyRegistration("t1", "u1", {});

      expect(lib.verifyRegistrationResponse.mock.calls.at(-1)[0].expectedOrigin).toBe(
        "https://app.example.com",
      );
    });

    it("derives https://<rpID> for a non-localhost RP", async () => {
      delete process.env.WEBAUTHN_ORIGIN;
      const svc = loadWith({ WEBAUTHN_RP_ID: "example.com" });
      okRegistration();

      await svc.verifyRegistration("t1", "u1", {});

      expect(lib.verifyRegistrationResponse.mock.calls.at(-1)[0].expectedOrigin).toBe(
        "https://example.com",
      );
    });
  });
});
