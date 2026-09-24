/**
 * A-160 — utils/mfaPolicy.util.js, the parts the middleware suite
 * (tests/middlewares/auth.mfaPolicy.a160.test.js) does not reach: the keys
 * are the ones the settings API stores, and absent input means no policy.
 *
 * Fail-before (baseline 2a157f1): the module did not exist.
 */
const {
  MFA_REQUIRED_KEY,
  MFA_REQUIRED_MIN_ROLE_LEVEL_KEY,
  MFA_POLICY_KEYS,
  NO_POLICY,
  parseMfaPolicy,
  mfaEnrolmentRequired,
} = require("../../utils/mfaPolicy.util");
const { isSecretSettingKey } = require("../../constants/tenantSecretSettings");

describe("A-160: the MFA policy settings", () => {
  it("are two plain tenant_settings keys", () => {
    expect(MFA_REQUIRED_KEY).toBe("mfa_required");
    expect(MFA_REQUIRED_MIN_ROLE_LEVEL_KEY).toBe("mfa_required_min_role_level");
    expect(MFA_POLICY_KEYS).toEqual(["mfa_required", "mfa_required_min_role_level"]);
  });

  it("are not treated as secrets (so a settings read returns them unmasked)", () => {
    for (const key of MFA_POLICY_KEYS) {
      expect(isSecretSettingKey(key)).toBe(false);
    }
  });

  it("no rows at all is no policy", () => {
    expect(parseMfaPolicy(undefined)).toBe(NO_POLICY);
    expect(parseMfaPolicy([])).toBe(NO_POLICY);
    expect(NO_POLICY).toEqual({ required: false, minRoleLevel: null });
  });

  it("a minimum level without the switch is no policy", () => {
    expect(parseMfaPolicy([{ key: MFA_REQUIRED_MIN_ROLE_LEVEL_KEY, value: "3" }])).toBe(NO_POLICY);
  });

  it("no principal is never required to enrol", () => {
    expect(mfaEnrolmentRequired(undefined, null)).toBe(false);
    expect(mfaEnrolmentRequired(null, null)).toBe(false);
  });
});
