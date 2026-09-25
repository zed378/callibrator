/**
 * A-216 — a session that signed in through SSO is told its password belongs
 * to the identity provider, instead of being asked for one it never had.
 *
 * Before: a user provisioned just-in-time by SSO (sso.service#provisionUser)
 * holds a random local password nobody knows. Change Password could only
 * answer 400 "Current password is incorrect", and ADR-051 (A-98)'s "SSO users
 * are pointed to their identity provider" was implemented nowhere.
 *
 * Now: justUpdatePassword answers a federated session (`amr` "saml"/"oidc",
 * A-160) 409 with a state explanation naming the provider, before anything
 * else, and /auth/verify reports `passwordManagedBy` so the frontend shows the
 * explanation instead of the form. An account under the A-123 forced change
 * is the exception: an administrator gave it a temporary password, which its
 * holder knows and must replace.
 *
 * What is real: auth.service#justUpdatePassword and #passwordManagedBy.
 * Faked: the rows, the tenant settings, bcrypt.
 */
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb) => cb({ id: "tx" })) },
}));

jest.mock("../../models", () => ({
  Users: { findOne: jest.fn(), findByPk: jest.fn(), update: jest.fn() },
  TenantSettings: { findAll: jest.fn() },
  Role: {},
  User: {},
  Tenants: {},
  AuditLog: { create: jest.fn() },
}));

jest.mock("../../services/session.service", () => ({ revokeAllSessions: jest.fn(async () => 0) }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(async (plain) => `hash:${plain}`),
  comparePassword: jest.fn(async (plain, hash) => hash === `hash:${plain}`),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { Users, TenantSettings } = require("../../models");
const authService = require("../../services/auth.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

const userRow = (overrides = {}) => ({
  id: USER_ID,
  tenantId: TENANT_ID,
  password: "hash:random-nobody-knows",
  mustChangePassword: false,
  update: jest.fn(async () => undefined),
  ...overrides,
});

let account;

beforeEach(() => {
  jest.clearAllMocks();
  account = userRow();
  Users.findByPk.mockImplementation(async () => account);
  TenantSettings.findAll.mockResolvedValue([
    { key: "oidc_authority", value: "https://login.microsoftonline.com/0000-tenant/v2.0" },
    { key: "sso_idp_entity_id", value: "urn:example:idp" },
    { key: "sso_idp_entry_point", value: "https://idp.example.org/sso" },
  ]);
});

const change = (signInMethod, current = "whatever-I-type") =>
  authService.justUpdatePassword(USER_ID, "New-Passw0rd-1", current, { signInMethod });

describe("A-216: change password in a federated session", () => {
  it("OIDC: 409 naming the provider's host — not the 400 'Current password is incorrect'", async () => {
    await expect(change("oidc")).rejects.toMatchObject({
      status: 409,
      message:
        "You signed in through your organisation's identity provider (OIDC, login.microsoftonline.com). Your password is managed there: change it with that provider, not here.",
    });
    expect(account.update).not.toHaveBeenCalled();
    // The tenant is the user's own, read before any tenant context is trusted.
    expect(TenantSettings.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT_ID }), skipTenantScope: true }),
    );
  });

  it("SAML: names the IdP entity id", async () => {
    await expect(change("saml")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("(SAML, urn:example:idp)"),
    });
  });

  it("SAML without an entity id: the entry point's host", async () => {
    TenantSettings.findAll.mockResolvedValue([{ key: "sso_idp_entry_point", value: "https://idp.example.org/sso" }]);
    await expect(change("saml")).rejects.toMatchObject({ message: expect.stringContaining("(SAML, idp.example.org)") });
  });

  it("no provider configured: still the 409, with the protocol alone", async () => {
    TenantSettings.findAll.mockResolvedValue([]);
    await expect(change("oidc")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("identity provider (OIDC). Your password is managed there"),
    });
  });

  it("is decided first — before the length check a federated user could never pass meaningfully", async () => {
    await expect(authService.justUpdatePassword(USER_ID, "x", "y", { signInMethod: "oidc" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("an account under the forced change (an administrator's temporary password) may change it", async () => {
    account = userRow({ mustChangePassword: true, password: "hash:Temp-Pw-1", temporaryPasswordExpiresAt: null });

    await expect(change("oidc", "Temp-Pw-1")).resolves.toMatchObject({ status: 200 });
    expect(account.update).toHaveBeenCalled();
  });

  it("a password session is unaffected", async () => {
    account = userRow({ password: "hash:Mine-1234" });
    await expect(change("password", "Mine-1234")).resolves.toMatchObject({ status: 200 });
    await expect(change(null, "Mine-1234")).resolves.toMatchObject({ status: 200 });
    expect(TenantSettings.findAll).not.toHaveBeenCalled();
  });
});

describe("A-216: passwordManagedBy (what /auth/verify reports)", () => {
  it("names the protocol and provider for a federated session", async () => {
    await expect(authService.passwordManagedBy(account, "oidc")).resolves.toEqual({
      protocol: "oidc",
      provider: "login.microsoftonline.com",
    });
  });

  it("is null for a password session, a forced change, or no user", async () => {
    await expect(authService.passwordManagedBy(account, "password+totp")).resolves.toBeNull();
    await expect(authService.passwordManagedBy(userRow({ mustChangePassword: true }), "saml")).resolves.toBeNull();
    await expect(authService.passwordManagedBy(null, "saml")).resolves.toBeNull();
  });

  it("a tenant-less account: the protocol, no provider, no settings read", async () => {
    await expect(authService.passwordManagedBy(userRow({ tenantId: null }), "saml")).resolves.toEqual({
      protocol: "saml",
      provider: null,
    });
    expect(TenantSettings.findAll).not.toHaveBeenCalled();
  });

  it("bounds an overlong non-URL setting", async () => {
    TenantSettings.findAll.mockResolvedValue([{ key: "sso_idp_entity_id", value: `urn:${"x".repeat(500)}` }]);
    const { provider } = await authService.passwordManagedBy(account, "saml");
    expect(provider).toHaveLength(120);
  });

  it("a setting that is not a URL is named as it is", async () => {
    TenantSettings.findAll.mockResolvedValue([{ key: "sso_idp_entity_id", value: " Hospital IdP " }]);
    await expect(authService.passwordManagedBy(account, "saml")).resolves.toEqual({
      protocol: "saml",
      provider: "Hospital IdP",
    });
  });

  it("a blank or non-string setting names no provider", async () => {
    TenantSettings.findAll.mockResolvedValue([
      { key: "sso_idp_entity_id", value: "   " },
      { key: "sso_idp_entry_point", value: null },
    ]);
    await expect(authService.passwordManagedBy(account, "saml")).resolves.toEqual({ protocol: "saml", provider: null });
  });
});
