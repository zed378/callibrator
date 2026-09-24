/**
 * Tests for mfa.service.js
 *
 * Covers: createSecret, matchTimeStep, checkCode, consumeCode (A-115),
 * verifyLogin.
 *
 * A-99: otplib is the REAL library here. This file used to mock it with an
 * `authenticator` object that otplib 13 does not export, so it proved only that
 * the service agreed with the mock. Codes are now generated from the secret
 * with otplib itself.
 *
 * A-114: `generateSecret`, `verifyAndEnable` and `disable` were removed from
 * the service — no code called them, and they kept the enrolment in
 * `mfaSecretTemp`, which is no attribute of User. Their tests went with them.
 *
 * The one database write, consumeCode's conditional stamp, goes to a fake
 * `Users.update` that APPLIES the WHERE it is given to an in-memory row — so a
 * test proves the predicate refuses a replay, not only that it was sent.
 */

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockRows = new Map();
jest.mock("../../models", () => {
  const { Op } = jest.requireActual("sequelize");
  // The WHERE consumeCode sends: { id, [Op.or]: [{ mfaLastUsedStep: null },
  // { mfaLastUsedStep: { [Op.lt]: step } }] } — evaluated, not trusted.
  const matches = (row, where) => {
    if (row.id !== where.id) {return false;}
    return where[Op.or].some((clause) => {
      const cond = clause.mfaLastUsedStep;
      if (cond === null) {return row.mfaLastUsedStep === null;}
      return row.mfaLastUsedStep !== null && row.mfaLastUsedStep < cond[Op.lt];
    });
  };
  return {
    Users: {
      update: jest.fn(async (values, { where }) => {
        const row = mockRows.get(where.id);
        if (!row || !matches(row, where)) {return [0];}
        Object.assign(row, values);
        return [1];
      }),
    },
  };
});

const { generateSync } = require("otplib");
const { Users } = require("../../models");
const { logger } = require("../../middlewares/activityLog.middleware");
const mfaService = require("../../services/mfa.service");

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
// Mid-step (xx:00:15), so ±1 step is unambiguous.
const NOW_S = Date.parse("2026-09-24T10:00:15Z") / 1000;
const STEP = Math.floor(NOW_S / 30);
const codeAt = (epoch, secret = SECRET) => generateSync({ secret, epoch });
const liveCode = (secret = SECRET) => codeAt(NOW_S, secret);
// A six-digit code that is none of the three codes the ±1 window accepts.
const deadCode = (secret = SECRET) => {
  const accepted = new Set([-30, 0, 30].map((d) => codeAt(NOW_S + d, secret)));
  let n = 0;
  while (accepted.has(String(n).padStart(6, "0"))) {
    n += 1;
  }
  return String(n).padStart(6, "0");
};

/** A user row, registered with the fake table so its stamp is shared. */
const makeUser = (overrides = {}) => {
  const row = {
    id: `u-${mockRows.size + 1}`,
    mfaEnabled: true,
    mfaSecret: SECRET,
    mfaLastUsedStep: null,
    ...overrides,
  };
  mockRows.set(row.id, { id: row.id, mfaLastUsedStep: row.mfaLastUsedStep });
  return row;
};

describe("mfa.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRows.clear();
    jest.spyOn(Date, "now").mockReturnValue(NOW_S * 1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("createSecret", () => {
    it("generates a real 20-byte base32 secret, different each time", () => {
      const a = mfaService.createSecret();
      const b = mfaService.createSecret();
      expect(a).toMatch(/^[A-Z2-7]{32}$/);
      expect(a).not.toBe(b);
    });
  });

  describe("matchTimeStep", () => {
    it("returns the step the code belongs to", () => {
      expect(mfaService.matchTimeStep(liveCode(), SECRET)).toBe(STEP);
      expect(mfaService.matchTimeStep(codeAt(NOW_S - 30), SECRET)).toBe(STEP - 1);
      expect(mfaService.matchTimeStep(codeAt(NOW_S + 30), SECRET)).toBe(STEP + 1);
    });

    it("returns null for a wrong or malformed code", () => {
      expect(mfaService.matchTimeStep(deadCode(), SECRET)).toBeNull();
      expect(mfaService.matchTimeStep("12ab56", SECRET)).toBeNull();
      expect(mfaService.matchTimeStep(undefined, SECRET)).toBeNull();
      expect(mfaService.matchTimeStep("123456", null)).toBeNull();
    });
  });

  describe("consumeCode (A-115)", () => {
    it("a TOTP code cannot be used twice", async () => {
      const user = makeUser();
      const code = liveCode();

      await expect(mfaService.consumeCode(user, code)).resolves.toBe(true);
      expect(user.mfaLastUsedStep).toBe(STEP);
      expect(mockRows.get(user.id).mfaLastUsedStep).toBe(STEP);

      // The same code, a second later, from the same row as reloaded.
      const reloaded = { ...user, mfaLastUsedStep: mockRows.get(user.id).mfaLastUsedStep };
      await expect(mfaService.consumeCode(reloaded, code)).resolves.toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        "TOTP code refused: its time step was already used",
        { userId: user.id },
      );
    });

    it("a code from an EARLIER step than the last one used is refused too", async () => {
      const user = makeUser();
      await expect(mfaService.consumeCode(user, codeAt(NOW_S + 30))).resolves.toBe(true);
      // Still inside the drift window, but older than what was used.
      await expect(mfaService.consumeCode(user, liveCode())).resolves.toBe(false);
      await expect(mfaService.consumeCode(user, codeAt(NOW_S - 30))).resolves.toBe(false);
    });

    it("the next step's code is accepted after this one's", async () => {
      const user = makeUser();
      await expect(mfaService.consumeCode(user, liveCode())).resolves.toBe(true);
      await expect(mfaService.consumeCode(user, codeAt(NOW_S + 30))).resolves.toBe(true);
      expect(user.mfaLastUsedStep).toBe(STEP + 1);
    });

    it("the same code racing on two requests is accepted once: the conditional update decides", async () => {
      // Both requests loaded the row before either stamped it.
      const first = makeUser();
      const second = { ...first };
      const code = liveCode();

      const results = await Promise.all([
        mfaService.consumeCode(first, code),
        mfaService.consumeCode(second, code),
      ]);

      expect(results.sort()).toEqual([false, true]);
      expect(logger.warn).toHaveBeenCalledWith("TOTP code refused: used concurrently", {
        userId: first.id,
      });
    });

    it("sends the replay predicate and the caller's transaction to the database", async () => {
      const { Op } = require("sequelize");
      const user = makeUser();
      await mfaService.consumeCode(user, liveCode(), { transaction: "TX" });

      expect(Users.update).toHaveBeenCalledWith(
        { mfaLastUsedStep: STEP },
        {
          where: {
            id: user.id,
            [Op.or]: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { [Op.lt]: STEP } }],
          },
          transaction: "TX",
        },
      );
    });

    it("a stored step read back as a string (BIGINT-style) still compares as a number", async () => {
      const user = makeUser({ mfaLastUsedStep: String(STEP) });
      await expect(mfaService.consumeCode(user, liveCode())).resolves.toBe(false);
      expect(Users.update).not.toHaveBeenCalled();
    });

    it("verifies against `secret` when given (the pending secret) instead of the live one", async () => {
      const pending = mfaService.createSecret();
      const user = makeUser();

      await expect(mfaService.consumeCode(user, liveCode(), { secret: pending })).resolves.toBe(
        false,
      );
      await expect(
        mfaService.consumeCode(user, liveCode(pending), { secret: pending }),
      ).resolves.toBe(true);
    });

    it("a wrong code writes nothing", async () => {
      const user = makeUser();
      await expect(mfaService.consumeCode(user, deadCode())).resolves.toBe(false);
      expect(Users.update).not.toHaveBeenCalled();
    });
  });

  describe("verifyLogin", () => {
    it("rejects when MFA is not enabled", async () => {
      await expect(
        mfaService.verifyLogin({ mfaEnabled: false, mfaSecret: null }, "123456"),
      ).rejects.toThrow("MFA is not enabled for this user.");
    });

    it("rejects when the MFA secret is null", async () => {
      await expect(
        mfaService.verifyLogin({ mfaEnabled: true, mfaSecret: null }, "123456"),
      ).rejects.toThrow("MFA is not enabled for this user.");
    });

    it("accepts a valid code once, and consumes it (A-115)", async () => {
      const user = makeUser();
      await expect(mfaService.verifyLogin(user, liveCode())).resolves.toBe(true);
      await expect(mfaService.verifyLogin(user, liveCode())).resolves.toBe(false);
    });

    it("refuses an invalid code", async () => {
      const user = makeUser();
      await expect(mfaService.verifyLogin(user, deadCode())).resolves.toBe(false);
      await expect(mfaService.verifyLogin(user, "wrong-token")).resolves.toBe(false);
    });
  });
});
