/**
 * Tests for the WebAuthn service (the @simplewebauthn/server calls doubled, the
 * Redis-backed challenge store doubled) — the branches of every function.
 *
 * ADR-108 Amendment 1: several passkeys per user, in `webauthn_credentials`
 * (the WebauthnCredential model). The end-to-end behaviour — real models and
 * hooks, a real attestation, the two-tenant 404 — is
 * routes/webauthnCredentials.twoTenant.test.ts; A-213's re-authenticated
 * remove-all is webauthn.disable.a213.test.js.
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

jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (fn) => fn({ id: "tx", LOCK: { UPDATE: "UPDATE" } })) },
}));

jest.mock("../../models", () => ({
  Users: { findOne: jest.fn(), update: jest.fn() },
  WebauthnCredential: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
  },
}));

jest.mock("../../services/auth.service", () => ({
  auditCredentialChange: jest.fn(),
  reauthenticate: jest.fn(async () => "password"),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const lib = require("@simplewebauthn/server");
const redis = require("../../services/redis.service");
const { Users, WebauthnCredential } = require("../../models");
const authService = require("../../services/auth.service");
const webauthn = require("../../services/webauthn.service");

const userRow = (extra = {}) => ({
  id: "u1",
  tenantId: "t1",
  webauthnEnabled: true,
  update: jest.fn(async function (values) {
    Object.assign(this, values);
    return this;
  }),
  ...extra,
});

const passkeyRow = (extra = {}) => ({
  id: "p1",
  userId: "u1",
  credentialId: "cred-1",
  // Length 3 (not a multiple of 4) so base64url decoding exercises padding.
  publicKey: "AQI",
  signCount: 5,
  name: "Laptop",
  transports: ["internal"],
  createdAt: new Date("2026-09-01"),
  lastUsedAt: null,
  update: jest.fn(async function (values) {
    Object.assign(this, values);
    return this;
  }),
  destroy: jest.fn(async () => undefined),
  ...extra,
});

describe("webauthn.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redis.set.mockResolvedValue(true);
    redis.del.mockResolvedValue(true);
    WebauthnCredential.findAll.mockResolvedValue([]);
    WebauthnCredential.count.mockResolvedValue(0);
  });

  // ------------------------------------------------------ getRegistrationOptions
  describe("getRegistrationOptions", () => {
    const user = { id: "u1", email: "a@b.com", firstName: "Ann", lastName: "Lee" };

    it("generates options, stores the challenge and excludes the caller's enrolled passkeys", async () => {
      lib.generateRegistrationOptions.mockResolvedValue({ challenge: "c1" });
      WebauthnCredential.findAll.mockResolvedValue([
        { credentialId: "cred-1", transports: ["usb"] },
        { credentialId: "cred-2", transports: null },
      ]);

      const result = await webauthn.getRegistrationOptions(user);

      expect(result).toEqual({ challenge: "c1" });
      expect(WebauthnCredential.findAll).toHaveBeenCalledWith({
        where: { userId: "u1" },
        attributes: ["credentialId", "transports"],
      });
      expect(redis.set).toHaveBeenCalledWith("webauthn:challenge:u1", "c1", 300);
      const args = lib.generateRegistrationOptions.mock.calls[0][0];
      expect(args).toMatchObject({ rpID: "localhost", userName: "a@b.com", userDisplayName: "Ann Lee" });
      expect(args.excludeCredentials).toEqual([
        { id: "cred-1", transports: ["usb"] },
        { id: "cred-2", transports: undefined },
      ]);
    });

    it("takes an explicit list when given (and reads none)", async () => {
      lib.generateRegistrationOptions.mockResolvedValue({ challenge: "c1" });
      await webauthn.getRegistrationOptions(user, [{ credentialId: "cred-9", transports: ["nfc"] }]);
      expect(WebauthnCredential.findAll).not.toHaveBeenCalled();
      expect(lib.generateRegistrationOptions.mock.calls[0][0].excludeCredentials).toEqual([
        { id: "cred-9", transports: ["nfc"] },
      ]);
    });

    it("refuses at the limit (409)", async () => {
      WebauthnCredential.findAll.mockResolvedValue(
        Array.from({ length: webauthn.MAX_PASSKEYS_PER_USER }, (_, i) => ({ credentialId: `c${i}`, transports: null })),
      );
      await expect(webauthn.getRegistrationOptions(user)).rejects.toMatchObject({ status: 409 });
    });

    it("falls back to email when both names are missing; firstName alone is used", async () => {
      lib.generateRegistrationOptions.mockResolvedValue({ challenge: "c1" });
      await webauthn.getRegistrationOptions({ id: "u1", email: "a@b.com" });
      expect(lib.generateRegistrationOptions.mock.calls[0][0].userDisplayName).toBe("a@b.com");
      await webauthn.getRegistrationOptions({ id: "u1", email: "a@b.com", firstName: "Ann" });
      expect(lib.generateRegistrationOptions.mock.calls[1][0].userDisplayName).toBe("Ann");
    });

    it("throws 503 when the challenge cannot be stored", async () => {
      lib.generateRegistrationOptions.mockResolvedValue({ challenge: "c1" });
      redis.set.mockResolvedValue(false);
      await expect(webauthn.getRegistrationOptions(user)).rejects.toMatchObject({ status: 503 });
    });
  });

  // ------------------------------------------------------------ getLoginOptions
  describe("getLoginOptions", () => {
    it("allows every one of the caller's passkeys", async () => {
      WebauthnCredential.findAll.mockResolvedValue([{ credentialId: "cred-1" }, { credentialId: "cred-2" }]);
      lib.generateAuthenticationOptions.mockResolvedValue({ challenge: "c2" });

      const result = await webauthn.getLoginOptions("u1");

      expect(result).toEqual({ challenge: "c2" });
      expect(lib.generateAuthenticationOptions.mock.calls[0][0].allowCredentials).toEqual([
        { id: "cred-1" },
        { id: "cred-2" },
      ]);
      expect(redis.set).toHaveBeenCalledWith("webauthn:challenge:u1", "c2", 300);
    });

    it("an account with none gets an empty list", async () => {
      lib.generateAuthenticationOptions.mockResolvedValue({ challenge: "c2" });
      await webauthn.getLoginOptions("u1");
      expect(lib.generateAuthenticationOptions.mock.calls[0][0].allowCredentials).toEqual([]);
    });
  });

  // -------------------------------------------------------- verifyRegistration
  describe("verifyRegistration", () => {
    const resp = { id: "cred-new" };
    const verified = (transports) => ({
      verified: true,
      registrationInfo: {
        credential: { id: "cred-new", publicKey: Buffer.from([1, 2, 3]), counter: 5, ...(transports ? { transports } : {}) },
      },
    });

    it("throws 400 when the challenge is missing/expired", async () => {
      redis.get.mockResolvedValue(null);
      await expect(webauthn.verifyRegistration("t1", "u1", resp)).rejects.toMatchObject({ status: 400 });
    });

    it("throws 400 when the library rejects, does not verify, or gives no registrationInfo", async () => {
      redis.get.mockResolvedValue("c1");
      lib.verifyRegistrationResponse.mockRejectedValueOnce(new Error("bad attestation"));
      await expect(webauthn.verifyRegistration("t1", "u1", resp)).rejects.toMatchObject({ status: 400 });
      lib.verifyRegistrationResponse.mockResolvedValueOnce({ verified: false });
      await expect(webauthn.verifyRegistration("t1", "u1", resp)).rejects.toMatchObject({ status: 400 });
      lib.verifyRegistrationResponse.mockResolvedValueOnce({ verified: true, registrationInfo: null });
      await expect(webauthn.verifyRegistration("t1", "u1", resp)).rejects.toMatchObject({ status: 400 });
    });

    it("stores a NEW passkey beside the others, named, audited; the challenge is consumed", async () => {
      redis.get.mockResolvedValue("c1");
      lib.verifyRegistrationResponse.mockResolvedValue(verified(["internal"]));
      const user = userRow();
      Users.findOne.mockResolvedValue(user);
      WebauthnCredential.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
      WebauthnCredential.create.mockImplementation(async (values) => passkeyRow({ ...values, id: "p-new" }));

      const result = await webauthn.verifyRegistration("t1", "u1", resp, { name: "  YubiKey  ", ipAddress: "1.2.3.4", userAgent: "ua" });

      expect(result).toMatchObject({ success: true, credential: { id: "p-new", name: "YubiKey" } });
      const [values, opts] = WebauthnCredential.create.mock.calls[0];
      expect(values).toMatchObject({ userId: "u1", credentialId: "cred-new", signCount: 5, name: "YubiKey", transports: ["internal"] });
      expect(typeof values.publicKey).toBe("string");
      expect(opts).toEqual({ transaction: expect.objectContaining({ id: "tx" }) });
      // The flag was already on: no purge, no update.
      expect(WebauthnCredential.destroy).not.toHaveBeenCalled();
      expect(user.update).not.toHaveBeenCalled();
      expect(authService.auditCredentialChange.mock.calls[0][1]).toMatchObject({
        operation: "WEBAUTHN_REGISTER",
        details: { passkeyId: "p-new", name: "YubiKey", passkeysHeld: 3 },
        ipAddress: "1.2.3.4",
        userAgent: "ua",
      });
      expect(redis.del).toHaveBeenCalledWith("webauthn:challenge:u1");
    });

    it("the first passkey after a reset purges leftovers, turns the flag on, and is named 'Passkey'", async () => {
      redis.get.mockResolvedValue("c1");
      lib.verifyRegistrationResponse.mockResolvedValue(verified());
      const user = userRow({ webauthnEnabled: false });
      Users.findOne.mockResolvedValue(user);
      WebauthnCredential.create.mockImplementation(async (values) => passkeyRow({ ...values, id: "p-new" }));

      const result = await webauthn.verifyRegistration("t1", "u1", resp);

      expect(WebauthnCredential.destroy).toHaveBeenCalledWith({ where: { userId: "u1" }, transaction: expect.anything() });
      expect(user.update).toHaveBeenCalledWith({ webauthnEnabled: true }, { transaction: expect.anything() });
      expect(result.credential.name).toBe("Passkey");
      expect(WebauthnCredential.create.mock.calls[0][0].transports).toBeNull();
    });

    it("404 no such user in the tenant; 409 at the limit; 409 an already-registered credential", async () => {
      redis.get.mockResolvedValue("c1");
      lib.verifyRegistrationResponse.mockResolvedValue(verified());
      Users.findOne.mockResolvedValueOnce(null);
      await expect(webauthn.verifyRegistration("t1", "u1", resp)).rejects.toMatchObject({ status: 404 });

      Users.findOne.mockResolvedValue(userRow());
      WebauthnCredential.count.mockResolvedValueOnce(webauthn.MAX_PASSKEYS_PER_USER);
      await expect(webauthn.verifyRegistration("t1", "u1", resp)).rejects.toMatchObject({ status: 409 });

      WebauthnCredential.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
      await expect(webauthn.verifyRegistration("t1", "u1", resp)).rejects.toMatchObject({
        status: 409,
        message: "This passkey is already registered",
      });
      expect(WebauthnCredential.create).not.toHaveBeenCalled();
    });

    it("an unnamed second passkey is 'Passkey 2'", async () => {
      redis.get.mockResolvedValue("c1");
      lib.verifyRegistrationResponse.mockResolvedValue(verified());
      Users.findOne.mockResolvedValue(userRow());
      WebauthnCredential.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      WebauthnCredential.create.mockImplementation(async (values) => passkeyRow(values));
      const result = await webauthn.verifyRegistration("t1", "u1", resp, { name: "   " });
      expect(result.credential.name).toBe("Passkey 2");
    });
  });

  // --------------------------------------------------------------- verifyLogin
  describe("verifyLogin (the signed-in step-up)", () => {
    const resp = { id: "cred-1" };

    it("404 when the account has no passkey (or no such user)", async () => {
      Users.findOne.mockResolvedValueOnce({ webauthnEnabled: false });
      await expect(webauthn.verifyLogin("t1", "u1", resp)).rejects.toMatchObject({ status: 404 });
      Users.findOne.mockResolvedValueOnce(null);
      await expect(webauthn.verifyLogin("t1", "u1", resp)).rejects.toMatchObject({ status: 404 });
    });

    it("401 when the credential is not one of the caller's", async () => {
      Users.findOne.mockResolvedValue(userRow());
      WebauthnCredential.findOne.mockResolvedValue(null);
      await expect(webauthn.verifyLogin("t1", "u1", resp)).rejects.toMatchObject({ status: 401 });
      expect(WebauthnCredential.findOne).toHaveBeenCalledWith({ where: { userId: "u1", credentialId: "cred-1" } });
    });

    it("400 when the challenge is missing; 401 when the library rejects or does not verify", async () => {
      Users.findOne.mockResolvedValue(userRow());
      WebauthnCredential.findOne.mockResolvedValue(passkeyRow());
      redis.get.mockResolvedValueOnce(null);
      await expect(webauthn.verifyLogin("t1", "u1", resp)).rejects.toMatchObject({ status: 400 });
      redis.get.mockResolvedValue("c2");
      lib.verifyAuthenticationResponse.mockRejectedValueOnce(new Error("bad sig"));
      await expect(webauthn.verifyLogin("t1", "u1", resp)).rejects.toMatchObject({ status: 401 });
      lib.verifyAuthenticationResponse.mockResolvedValueOnce({ verified: false });
      await expect(webauthn.verifyLogin("t1", "u1", resp)).rejects.toMatchObject({ status: 401 });
    });

    it("advances THAT passkey's counter and stamps its last use", async () => {
      Users.findOne.mockResolvedValue(userRow());
      const row = passkeyRow();
      WebauthnCredential.findOne.mockResolvedValue(row);
      redis.get.mockResolvedValue("c2");
      lib.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 6 } });

      expect(await webauthn.verifyLogin("t1", "u1", resp)).toEqual({ success: true });
      expect(lib.verifyAuthenticationResponse.mock.calls[0][0].credential).toMatchObject({ id: "cred-1", counter: 5 });
      expect(row.update).toHaveBeenCalledWith({ signCount: 6, lastUsedAt: expect.any(Date) });
    });
  });

  // ----------------------------------------------------------------- getStatus
  describe("getStatus", () => {
    it("reports the count and the highest counter", async () => {
      Users.findOne.mockResolvedValue({ webauthnEnabled: true, updatedAt: new Date("2026-01-01") });
      WebauthnCredential.findAll.mockResolvedValue([{ signCount: 3 }, { signCount: "9" }]);
      expect(await webauthn.getStatus("t1", "u1")).toEqual({
        enabled: true,
        count: 2,
        signCount: 9,
        lastUpdatedAt: new Date("2026-01-01"),
      });
    });

    it("an account with the flag off has none, whatever rows are left", async () => {
      Users.findOne.mockResolvedValue({ webauthnEnabled: false });
      expect(await webauthn.getStatus("t1", "u1")).toEqual({ enabled: false, count: 0, signCount: 0, lastUpdatedAt: null });
      expect(WebauthnCredential.findAll).not.toHaveBeenCalled();
    });

    it("throws 404 when the user is not found", async () => {
      Users.findOne.mockResolvedValue(null);
      await expect(webauthn.getStatus("t1", "u1")).rejects.toMatchObject({ status: 404 });
    });
  });

  // ------------------------------------------------- list / rename / revoke
  describe("listPasskeys, renamePasskey, revokePasskey", () => {
    it("lists the caller's passkeys oldest first, without the credential id or key", async () => {
      Users.findOne.mockResolvedValue(userRow());
      WebauthnCredential.findAll.mockResolvedValue([passkeyRow()]);
      const list = await webauthn.listPasskeys("t1", "u1");
      expect(list).toEqual([
        { id: "p1", name: "Laptop", createdAt: new Date("2026-09-01"), lastUsedAt: null, transports: ["internal"] },
      ]);
      expect(WebauthnCredential.findAll).toHaveBeenCalledWith({ where: { userId: "u1" }, order: [["createdAt", "ASC"]] });
    });

    it("an unknown user is 404; a flag-off account lists nothing", async () => {
      Users.findOne.mockResolvedValueOnce(null);
      await expect(webauthn.listPasskeys("t1", "u1")).rejects.toMatchObject({ status: 404 });
      Users.findOne.mockResolvedValueOnce(userRow({ webauthnEnabled: false }));
      expect(await webauthn.listPasskeys("t1", "u1")).toEqual([]);
    });

    it("renames one of the caller's passkeys, audited", async () => {
      Users.findOne.mockResolvedValue(userRow());
      const row = passkeyRow();
      WebauthnCredential.findOne.mockResolvedValue(row);
      const result = await webauthn.renamePasskey("t1", "u1", "p1", "Work laptop", { ipAddress: "1.1.1.1" });
      expect(result.name).toBe("Work laptop");
      expect(WebauthnCredential.findOne).toHaveBeenCalledWith({
        where: { id: "p1", userId: "u1" },
        transaction: expect.anything(),
        lock: "UPDATE",
      });
      expect(authService.auditCredentialChange.mock.calls[0][1]).toMatchObject({
        operation: "WEBAUTHN_RENAME",
        details: { passkeyId: "p1", before: { name: "Laptop" }, after: { name: "Work laptop" } },
      });
    });

    it("rename and revoke answer 404 for another user's passkey, and for a flag-off account", async () => {
      Users.findOne.mockResolvedValue(userRow());
      WebauthnCredential.findOne.mockResolvedValue(null);
      await expect(webauthn.renamePasskey("t1", "u1", "px", "x")).rejects.toMatchObject({ status: 404 });
      await expect(webauthn.revokePasskey("t1", "u1", "px", { currentPassword: "p" })).rejects.toMatchObject({ status: 404 });
      Users.findOne.mockResolvedValue(userRow({ webauthnEnabled: false }));
      await expect(webauthn.renamePasskey("t1", "u1", "p1", "x")).rejects.toMatchObject({ status: 404 });
      await expect(webauthn.revokePasskey("t1", "u1", "p1")).rejects.toMatchObject({ status: 404 });
      expect(authService.reauthenticate).not.toHaveBeenCalled();
    });

    it("revokes one after re-authentication; the last one turns the flag off (the lock-out guard is the proof)", async () => {
      const user = userRow();
      Users.findOne.mockResolvedValue(user);
      const row = passkeyRow();
      WebauthnCredential.findOne.mockResolvedValue(row);

      WebauthnCredential.count.mockResolvedValueOnce(2);
      expect(await webauthn.revokePasskey("t1", "u1", "p1", { currentPassword: "pw" })).toEqual({ success: true, remaining: 1 });
      expect(authService.reauthenticate.mock.calls[0][2].purpose).toBe("Removing a passkey");
      expect(row.destroy).toHaveBeenCalled();
      expect(user.update).not.toHaveBeenCalled();

      WebauthnCredential.count.mockResolvedValueOnce(1);
      expect(await webauthn.revokePasskey("t1", "u1", "p1", { currentPassword: "pw" })).toEqual({ success: true, remaining: 0 });
      expect(authService.reauthenticate.mock.calls[1][2].purpose).toBe("Removing your last passkey");
      expect(user.update).toHaveBeenCalledWith({ webauthnEnabled: false }, { transaction: expect.anything() });
      expect(authService.auditCredentialChange.mock.calls[1][1]).toMatchObject({
        operation: "WEBAUTHN_REVOKE",
        details: { passkeyId: "p1", remaining: 0, reauthenticatedWith: "password" },
      });
    });

    it("a failed re-authentication removes nothing", async () => {
      Users.findOne.mockResolvedValue(userRow());
      const row = passkeyRow();
      WebauthnCredential.findOne.mockResolvedValue(row);
      WebauthnCredential.count.mockResolvedValue(1);
      authService.reauthenticate.mockRejectedValueOnce(Object.assign(new Error("Removing your last passkey requires your current password"), { status: 400 }));
      await expect(webauthn.revokePasskey("t1", "u1", "p1")).rejects.toMatchObject({ status: 400 });
      expect(row.destroy).not.toHaveBeenCalled();
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
      jest.doMock("../../models", () => ({ Users, WebauthnCredential }));
      return require("../../services/webauthn.service");
    };

    const okRegistration = () => {
      redis.get.mockResolvedValue("c1");
      redis.del.mockResolvedValue(true);
      lib.verifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: { credential: { id: "c", publicKey: Buffer.from([1]), counter: 0 } },
      });
      Users.findOne.mockResolvedValue(userRow());
      WebauthnCredential.count.mockResolvedValue(0);
      WebauthnCredential.create.mockImplementation(async (values) => passkeyRow(values));
    };

    it.each([
      [{}, "http://localhost:3000", true],
      [{ WEBAUTHN_ORIGIN: "https://app.example.com", WEBAUTHN_RP_ID: "example.com" }, "https://app.example.com", false],
      [{ WEBAUTHN_RP_ID: "example.com" }, "https://example.com", true],
    ])("with %j the expected origin is %s", async (env, expected, clearOrigin) => {
      if (clearOrigin) {
        delete process.env.WEBAUTHN_ORIGIN;
      }
      if (!env.WEBAUTHN_RP_ID) {
        delete process.env.WEBAUTHN_RP_ID;
      }
      const svc = loadWith(env);
      okRegistration();
      await svc.verifyRegistration("t1", "u1", {});
      expect(lib.verifyRegistrationResponse.mock.calls.at(-1)[0].expectedOrigin).toBe(expected);
    });
  });
});
