/**
 * A-141 — MFA could not be turned off and had no recovery path: a lost
 * authenticator was a locked-out account, and replacing an authenticator left
 * every other session signed in.
 *
 * Now:
 *  - enabling or replacing an authenticator issues ten one-time recovery
 *    codes, returned once and stored only as salted hashes;
 *  - a recovery code is accepted at the MFA sign-in step in place of a TOTP
 *    code, ONCE (a conditional update removes its hash — the replay-safe shape
 *    of A-115), and it is spent only if the session and its LOGIN row commit;
 *  - POST /auth/mfa/disable needs the current password AND a current TOTP
 *    code or a recovery code; it clears every MFA column, signs out every
 *    other session and is audited, all in one transaction;
 *  - replacing an authenticator signs out every other session.
 *
 * Fail-before: verifyMfaSetup returned no codes and revoked nothing;
 * loginMfa had no recovery path (a recovery code was a wrong code);
 * authService.disableMfa did not exist.
 *
 * Nothing here mocks otplib: every TOTP code is generated from the secret with
 * the real library. Faked: the models, the password hash, createSession, the
 * session revocation and the audit insert. The transaction double keeps an
 * undo log — `row.update` and the conditional `Users.update` stamps are
 * reverted when the callback throws — so "rolled back" is observable.
 */

const mockTable = { row: null };

jest.mock("../../config", () => ({
  db: {
    transaction: jest.fn(async (fn) => {
      const tx = { undo: [] };
      try {
        return await fn(tx);
      } catch (err) {
        for (const [row, prior] of tx.undo.reverse()) {
          Object.assign(row, prior);
        }
        throw err;
      }
    }),
  },
}));

jest.mock("../../models", () => {
  const { Op } = jest.requireActual("sequelize");
  const remember = (options, row, values) => {
    if (options && options.transaction) {
      const prior = {};
      for (const key of Object.keys(values)) {
        prior[key] = Array.isArray(row[key]) ? [...row[key]] : row[key];
      }
      options.transaction.undo.push([row, prior]);
    }
  };
  return {
    Users: {
      findOne: jest.fn(),
      findByPk: jest.fn(async () => mockTable.row),
      // Applies the WHERE of both conditional stamps to the in-memory row, as
      // PostgreSQL would: consumeCode's step guard and consumeRecoveryCode's
      // `mfa_recovery_codes @> ARRAY[hash]` with array_remove.
      update: jest.fn(async (values, options) => {
        const row = mockTable.row;
        const { where } = options;
        if (row.id !== where.id) {
          return [0];
        }
        if (where.mfaRecoveryCodes) {
          const [hash] = where.mfaRecoveryCodes[Op.contains];
          if (!Array.isArray(row.mfaRecoveryCodes) || !row.mfaRecoveryCodes.includes(hash)) {
            return [0];
          }
          remember(options, row, { mfaRecoveryCodes: null });
          row.mfaRecoveryCodes = row.mfaRecoveryCodes.filter((h) => h !== hash);
          return [1];
        }
        const step = where[Op.or][1].mfaLastUsedStep[Op.lt];
        const last = row.mfaLastUsedStep;
        if (last !== null && last !== undefined && !(last < step)) {
          return [0];
        }
        remember(options, row, values);
        Object.assign(row, values);
        return [1];
      }),
    },
    User: {},
    Role: {},
    Tenants: { name: "Tenants" },
  };
});

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(async (plain, hash) => hash === `hash:${plain}`),
}));

jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

jest.mock("../../services/session.service", () => ({
  createSession: jest.fn(),
  revokeOtherSessions: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const otplib = require("otplib");
const { Op } = require("sequelize");
const { Users } = require("../../models");
const auditService = require("../../services/audit.service");
const { createSession, revokeOtherSessions } = require("../../services/session.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const authService = require("../../services/auth.service");
const mfaService = require("../../services/mfa.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "99999999-9999-4999-8999-999999999999";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "correct horse battery staple";
const LIVE = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const MY_SESSION = "sess-mine";
// Mid-step (xx:00:15), so ±1 step is unambiguous.
const NOW_S = Date.parse("2026-09-24T10:00:15Z") / 1000;

const codeAt = (secret, epoch = NOW_S) => otplib.generateSync({ secret, epoch });
const setNow = (epochSeconds) => jest.spyOn(Date, "now").mockReturnValue(epochSeconds * 1000);
const SHAPE = /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/;

const makeUser = (overrides = {}) => {
  const row = {
    id: USER_ID,
    tenantId: TENANT_ID,
    tenant: { id: TENANT_ID, status: "active" },
    username: "ada",
    email: "ada@hospital.example.com",
    password: `hash:${PASSWORD}`,
    isActive: true,
    status: "ACTIVE",
    lockedUntil: null,
    mfaEnabled: true,
    mfaSecret: LIVE,
    mfaPendingSecret: null,
    mfaPendingCreatedAt: null,
    mfaLastUsedStep: null,
    mfaRecoveryCodes: null,
    role: null,
    ...overrides,
  };
  row.update = jest.fn(async (patch, options) => {
    if (options && options.transaction) {
      const prior = {};
      for (const key of Object.keys(patch)) {
        prior[key] = row[key];
      }
      options.transaction.undo.push([row, prior]);
    }
    return Object.assign(row, patch);
  });
  mockTable.row = row;
  return row;
};

/** Enrol `row` for real: setup + verify with a code from the new secret. */
const enrol = async (options = {}) => {
  const setup = await authService.setupMfa(USER_ID);
  return authService.verifyMfaSetup(USER_ID, codeAt(setup.secret), options);
};

beforeEach(() => {
  jest.clearAllMocks();
  setNow(NOW_S);
  createSession.mockResolvedValue({ id: "session-new" });
  revokeOtherSessions.mockResolvedValue(3);
  auditService.logAction.mockResolvedValue({ id: "audit-1" });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ------------------------------------------------------------------
describe("A-141 — recovery code primitives (mfa.service)", () => {
  it("issues ten distinct 80-bit codes, formatted in four groups of four", () => {
    const codes = mfaService.createRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(mfaService.RECOVERY_CODE_COUNT).toBe(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(SHAPE);
    }
  });

  it("normalizes case, spaces and hyphens, and refuses anything that cannot be a code", () => {
    const [code] = mfaService.createRecoveryCodes();
    const canonical = code.replace(/-/g, "");
    expect(mfaService.normalizeRecoveryCode(code)).toBe(canonical);
    expect(mfaService.normalizeRecoveryCode(code.toLowerCase())).toBe(canonical);
    expect(mfaService.normalizeRecoveryCode(` ${canonical.match(/.{4}/g).join(" ")} `)).toBe(canonical);

    expect(mfaService.normalizeRecoveryCode("123456")).toBeNull(); // a TOTP code
    expect(mfaService.normalizeRecoveryCode("ABCD-EFGH-IJKL-MNO1")).toBeNull(); // 1 is not base32
    expect(mfaService.normalizeRecoveryCode("ABCD-EFGH-IJKL")).toBeNull();
    expect(mfaService.normalizeRecoveryCode(12345678)).toBeNull();
    expect(mfaService.normalizeRecoveryCode(undefined)).toBeNull();
  });

  it("hashes are salted with the user id: the same code hashes differently on two accounts", () => {
    const canonical = mfaService.normalizeRecoveryCode(mfaService.createRecoveryCodes()[0]);
    const mine = mfaService.hashRecoveryCode(USER_ID, canonical);
    const theirs = mfaService.hashRecoveryCode(OTHER_USER_ID, canonical);
    expect(mine).toMatch(/^[0-9a-f]{64}$/);
    expect(mine).not.toBe(theirs);
    expect(mine).not.toContain(canonical);
  });

  it("consumes a code once, with a conditional array_remove — the second use is refused", async () => {
    const codes = mfaService.createRecoveryCodes();
    const user = makeUser({ mfaRecoveryCodes: mfaService.hashRecoveryCodes(USER_ID, codes) });

    await expect(mfaService.consumeRecoveryCode(user, codes[4])).resolves.toBe(true);
    expect(user.mfaRecoveryCodes).toHaveLength(9);

    // The SQL shape: SET mfa_recovery_codes = array_remove(mfa_recovery_codes, hash)
    // WHERE id = :id AND mfa_recovery_codes @> ARRAY[hash].
    const [values, options] = Users.update.mock.calls[0];
    const hash = mfaService.hashRecoveryCode(USER_ID, mfaService.normalizeRecoveryCode(codes[4]));
    expect(values.mfaRecoveryCodes.fn).toBe("array_remove");
    expect(values.mfaRecoveryCodes.args[0].col).toBe("mfa_recovery_codes");
    expect(values.mfaRecoveryCodes.args[1]).toBe(hash);
    expect(options.where).toEqual({ id: USER_ID, mfaRecoveryCodes: { [Op.contains]: [hash] } });

    await expect(mfaService.consumeRecoveryCode(user, codes[4])).resolves.toBe(false);
  });

  it("a code another request spent first (the conditional update changed nothing) is refused", async () => {
    const codes = mfaService.createRecoveryCodes();
    const hashes = mfaService.hashRecoveryCodes(USER_ID, codes);
    const user = makeUser({ mfaRecoveryCodes: hashes });
    // This request loaded the row before the other one committed: its copy
    // still holds the hash, the table no longer does.
    const stale = { ...user, mfaRecoveryCodes: [...hashes] };
    await mfaService.consumeRecoveryCode(user, codes[0]);

    await expect(mfaService.consumeRecoveryCode(stale, codes[0])).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith("MFA recovery code refused: used concurrently", {
      userId: USER_ID,
    });
  });

  it("an unknown, malformed or absent code is refused without touching the database", async () => {
    const codes = mfaService.createRecoveryCodes();
    const user = makeUser({ mfaRecoveryCodes: mfaService.hashRecoveryCodes(USER_ID, codes) });

    await expect(mfaService.consumeRecoveryCode(user, mfaService.createRecoveryCodes()[0])).resolves.toBe(false);
    await expect(mfaService.consumeRecoveryCode(user, "not-a-code")).resolves.toBe(false);
    await expect(mfaService.consumeRecoveryCode(makeUser({ mfaRecoveryCodes: null }), codes[0])).resolves.toBe(false);
    expect(Users.update).not.toHaveBeenCalled();
  });

  it("another account's code is refused (the salt is the account)", async () => {
    const codes = mfaService.createRecoveryCodes();
    const user = makeUser({ mfaRecoveryCodes: mfaService.hashRecoveryCodes(OTHER_USER_ID, codes) });

    await expect(mfaService.consumeRecoveryCode(user, codes[0])).resolves.toBe(false);
  });
});

// ------------------------------------------------------------------
describe("A-141 — codes are issued when an authenticator is enabled or replaced", () => {
  it("first enrolment returns ten codes once, stores only their hashes, and revokes nothing", async () => {
    const user = makeUser({ mfaEnabled: false, mfaSecret: null });

    const result = await enrol({ sessionId: MY_SESSION });

    expect(result.recoveryCodes).toHaveLength(10);
    expect(user.mfaRecoveryCodes).toEqual(mfaService.hashRecoveryCodes(USER_ID, result.recoveryCodes));
    for (const code of result.recoveryCodes) {
      expect(JSON.stringify(user.mfaRecoveryCodes)).not.toContain(code.replace(/-/g, ""));
    }
    expect(revokeOtherSessions).not.toHaveBeenCalled();
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ changes: { operation: "MFA_ENABLE", recoveryCodesIssued: 10 } }),
      expect.anything(),
    );
    // Never a code in the permanent trail.
    const trail = JSON.stringify(auditService.logAction.mock.calls.map(([entry]) => entry));
    for (const code of result.recoveryCodes) {
      expect(trail).not.toContain(code);
    }
  });

  it("replacing the authenticator issues a NEW set (the old codes stop working) and signs out every other session", async () => {
    const oldCodes = mfaService.createRecoveryCodes();
    const user = makeUser({ mfaRecoveryCodes: mfaService.hashRecoveryCodes(USER_ID, oldCodes) });

    const setup = await authService.setupMfa(USER_ID, {
      currentPassword: PASSWORD,
      code: codeAt(LIVE),
    });
    setNow(NOW_S + 30);
    const result = await authService.verifyMfaSetup(USER_ID, codeAt(setup.secret, NOW_S + 30), {
      sessionId: MY_SESSION,
    });

    expect(result.recoveryCodes).toHaveLength(10);
    expect(await mfaService.consumeRecoveryCode(user, oldCodes[0])).toBe(false);
    expect(revokeOtherSessions).toHaveBeenCalledWith(USER_ID, MY_SESSION, "MFA_ROTATED", {
      transaction: expect.any(Object),
    });
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { operation: "MFA_ROTATE", recoveryCodesIssued: 10, otherSessionsRevoked: 3 },
      }),
      expect.anything(),
    );
  });
});

// ------------------------------------------------------------------
describe("A-141 — a recovery code at the MFA sign-in step", () => {
  it("signs in once, is audited as password+recovery_code, and cannot be used again", async () => {
    const codes = mfaService.createRecoveryCodes();
    const user = makeUser({ mfaRecoveryCodes: mfaService.hashRecoveryCodes(USER_ID, codes) });

    const result = await authService.loginMfa(USER_ID, undefined, "10.0.0.1", "ua", {
      recoveryCode: codes[2].toLowerCase(),
    });

    expect(result.status).toBe(200);
    expect(result.token).toEqual(expect.any(String));
    expect(result.data).toMatchObject({ usedRecoveryCode: true, mfaRecoveryCodesRemaining: 9 });
    expect(user.mfaRecoveryCodes).toHaveLength(9);
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LOGIN",
        changes: { method: "password+recovery_code", recoveryCodesRemaining: 9 },
      }),
      expect.anything(),
    );

    createSession.mockClear();
    await expect(
      authService.loginMfa(USER_ID, undefined, "10.0.0.1", "ua", { recoveryCode: codes[2] }),
    ).rejects.toMatchObject({ status: 401, message: "Invalid MFA code" });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("a wrong recovery code is the same 401 as a wrong TOTP code, and opens no session", async () => {
    makeUser({ mfaRecoveryCodes: mfaService.hashRecoveryCodes(USER_ID, mfaService.createRecoveryCodes()) });

    await expect(
      authService.loginMfa(USER_ID, undefined, "10.0.0.1", "ua", {
        recoveryCode: mfaService.createRecoveryCodes()[0],
      }),
    ).rejects.toMatchObject({ status: 401, message: "Invalid MFA code" });
    expect(createSession).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("a recovery code is spent only if the session and its LOGIN row commit", async () => {
    const codes = mfaService.createRecoveryCodes();
    const user = makeUser({ mfaRecoveryCodes: mfaService.hashRecoveryCodes(USER_ID, codes) });
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    await expect(
      authService.loginMfa(USER_ID, undefined, "10.0.0.1", "ua", { recoveryCode: codes[0] }),
    ).rejects.toThrow("audit insert failed");
    expect(user.mfaRecoveryCodes).toHaveLength(10);

    // ...so the same code still works once the audit trail is back.
    await expect(
      authService.loginMfa(USER_ID, undefined, "10.0.0.1", "ua", { recoveryCode: codes[0] }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("a TOTP sign-in still works and reports the codes left", async () => {
    makeUser({ mfaRecoveryCodes: ["h1", "h2"] });

    const result = await authService.loginMfa(USER_ID, codeAt(LIVE), "10.0.0.1", "ua");

    expect(result.data).toMatchObject({ usedRecoveryCode: false, mfaRecoveryCodesRemaining: 2 });
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ changes: { method: "password+totp" } }),
      expect.anything(),
    );
  });

  it("an empty recoveryCode falls back to the TOTP code", async () => {
    makeUser();

    await expect(
      authService.loginMfa(USER_ID, codeAt(LIVE), "10.0.0.1", "ua", { recoveryCode: "" }),
    ).resolves.toMatchObject({ status: 200 });
  });
});

// ------------------------------------------------------------------
describe("A-141 — POST /auth/mfa/disable (authService.disableMfa)", () => {
  const ctx = { ipAddress: "203.0.113.9", userAgent: "jest", sessionId: MY_SESSION };

  it("with the password and a current code: clears every MFA column, signs out the other sessions, audits MFA_DISABLE", async () => {
    const user = makeUser({
      mfaPendingSecret: "PENDINGPENDINGPENDINGPENDINGPEND",
      mfaPendingCreatedAt: new Date(),
      mfaRecoveryCodes: ["h1"],
    });

    const result = await authService.disableMfa(
      USER_ID,
      { currentPassword: PASSWORD, code: codeAt(LIVE) },
      ctx,
    );

    expect(result).toEqual({ success: true, message: "MFA disabled", otherSessionsRevoked: 3 });
    expect(user).toMatchObject({
      mfaEnabled: false,
      mfaSecret: null,
      mfaPendingSecret: null,
      mfaPendingCreatedAt: null,
      mfaLastUsedStep: null,
      mfaRecoveryCodes: null,
    });
    expect(revokeOtherSessions).toHaveBeenCalledWith(USER_ID, MY_SESSION, "MFA_DISABLED", {
      transaction: expect.any(Object),
    });
    expect(auditService.logAction).toHaveBeenCalledWith(
      {
        tenantId: TENANT_ID,
        userId: USER_ID,
        action: "UPDATE",
        resourceType: "User",
        resourceId: USER_ID,
        changes: { operation: "MFA_DISABLE", method: "totp", otherSessionsRevoked: 3 },
        ipAddress: "203.0.113.9",
        userAgent: "jest",
      },
      { transaction: expect.any(Object) },
    );
    expect(JSON.stringify(auditService.logAction.mock.calls.map(([entry]) => entry))).not.toContain(LIVE);

    // The old authenticator no longer signs in.
    setNow(NOW_S + 30);
    await expect(authService.loginMfa(USER_ID, codeAt(LIVE, NOW_S + 30))).rejects.toMatchObject({
      status: 400,
      message: "MFA is not enabled for this account",
    });
  });

  it("the lost-phone path: sign in with a recovery code, then disable with another", async () => {
    const codes = mfaService.createRecoveryCodes();
    const user = makeUser({ mfaRecoveryCodes: mfaService.hashRecoveryCodes(USER_ID, codes) });

    await authService.loginMfa(USER_ID, undefined, "10.0.0.1", "ua", { recoveryCode: codes[0] });
    const result = await authService.disableMfa(
      USER_ID,
      { currentPassword: PASSWORD, recoveryCode: codes[1] },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(user.mfaEnabled).toBe(false);
    expect(auditService.logAction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        changes: { operation: "MFA_DISABLE", method: "recovery_code", otherSessionsRevoked: 3 },
      }),
      expect.anything(),
    );
  });

  it("a wrong password is refused before the code is looked at — the code is not burned", async () => {
    const user = makeUser();
    const code = codeAt(LIVE);

    await expect(
      authService.disableMfa(USER_ID, { currentPassword: "guess", code }, ctx),
    ).rejects.toMatchObject({ status: 400, message: "Current password or MFA code is incorrect" });
    expect(user.mfaLastUsedStep).toBeNull();
    expect(user.mfaEnabled).toBe(true);

    // The same code still disables with the right password.
    await expect(
      authService.disableMfa(USER_ID, { currentPassword: PASSWORD, code }, ctx),
    ).resolves.toMatchObject({ success: true });
  });

  it("a wrong code is the SAME combined 400; nothing is cleared, nothing revoked, nothing audited", async () => {
    const user = makeUser();
    const good = codeAt(LIVE);
    const wrong = String((Number(good) + 1) % 1000000).padStart(6, "0");

    await expect(
      authService.disableMfa(USER_ID, { currentPassword: PASSWORD, code: wrong }, ctx),
    ).rejects.toMatchObject({ status: 400, message: "Current password or MFA code is incorrect" });
    await expect(
      authService.disableMfa(
        USER_ID,
        { currentPassword: PASSWORD, recoveryCode: mfaService.createRecoveryCodes()[0] },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 400, message: "Current password or MFA code is incorrect" });
    expect(user.mfaEnabled).toBe(true);
    expect(user.mfaSecret).toBe(LIVE);
    expect(revokeOtherSessions).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("a code already used to sign in cannot be replayed to disable", async () => {
    const user = makeUser();
    const code = codeAt(LIVE);
    await authService.loginMfa(USER_ID, code, "10.0.0.1", "ua");

    await expect(
      authService.disableMfa(USER_ID, { currentPassword: PASSWORD, code }, ctx),
    ).rejects.toMatchObject({ status: 400 });
    expect(user.mfaEnabled).toBe(true);
  });

  it("a failed audit insert rolls the disable back — MFA stays on and the code is not burned", async () => {
    const user = makeUser();
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    await expect(
      authService.disableMfa(USER_ID, { currentPassword: PASSWORD, code: codeAt(LIVE) }, ctx),
    ).rejects.toThrow("audit insert failed");
    expect(user.mfaEnabled).toBe(true);
    expect(user.mfaSecret).toBe(LIVE);
    expect(user.mfaLastUsedStep).toBeNull();
  });

  it.each([
    [{}, "no re-authentication"],
    [{ currentPassword: PASSWORD }, "a password alone"],
    [{ code: "123456" }, "a code alone"],
  ])("%j (%s) is a 400 that says what is needed", async (reauth) => {
    makeUser();
    await expect(authService.disableMfa(USER_ID, reauth, ctx)).rejects.toMatchObject({
      status: 400,
      message: "Current password and an MFA or recovery code are required",
    });
  });

  it("no re-authentication object at all is the same 400", async () => {
    makeUser();
    await expect(authService.disableMfa(USER_ID)).rejects.toMatchObject({ status: 400 });
  });

  it("an account without MFA is a 409; an unknown user a 404", async () => {
    makeUser({ mfaEnabled: false, mfaSecret: null });
    await expect(
      authService.disableMfa(USER_ID, { currentPassword: PASSWORD, code: "123456" }, ctx),
    ).rejects.toMatchObject({ status: 409, message: "MFA is not enabled for this account" });

    Users.findByPk.mockResolvedValueOnce(null);
    await expect(authService.disableMfa(USER_ID, {}, ctx)).rejects.toMatchObject({ status: 404 });
  });

  it("a tenant-less account (platform super admin) disables, with the missing row logged", async () => {
    const user = makeUser({ tenantId: null, tenant: null });

    await authService.disableMfa(USER_ID, { currentPassword: PASSWORD, code: codeAt(LIVE) });

    expect(user.mfaEnabled).toBe(false);
    // No session id given: every other session — i.e. all of them — is revoked.
    expect(revokeOtherSessions).toHaveBeenCalledWith(USER_ID, null, "MFA_DISABLED", expect.anything());
    expect(auditService.logAction).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Credential change not audited: the user has no tenant",
      { userId: USER_ID, operation: "MFA_DISABLE" },
    );
  });
});
