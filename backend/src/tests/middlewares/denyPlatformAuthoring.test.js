/**
 * A-127 (ADR-051 Q-17) — denyPlatformAuthoring, unit level. The route-level
 * behaviour and the enumeration of guarded routes are in
 * tests/routes/denyPlatformAuthoring.a127.test.js.
 */
jest.mock("../../utils/response.util", () => ({
  forbidden: jest.fn((res, message) => ({ status: 403, message })),
}));

const { forbidden } = require("../../utils/response.util");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const { runWithImpersonator } = require("../../utils/auditActor.util");
const {
  denyPlatformAuthoring,
  platformAuthoringRefusal,
  MESSAGES,
} = require("../../middlewares/denyPlatformAuthoring.middleware");

const HOME = "33333333-3333-4333-8333-333333333333";
const OTHER = "22222222-2222-4222-8222-222222222222";

const superAdmin = (roleName = "SUPERADMIN", tenantId = HOME) => ({
  id: "op",
  tenantId,
  role: { name: roleName },
});

describe("platformAuthoringRefusal", () => {
  it("refuses an impersonated request named on req", () => {
    expect(platformAuthoringRefusal({ impersonatorId: "op", user: { role: { name: "X" } } })).toBe(
      MESSAGES.IMPERSONATING,
    );
  });

  it("refuses an impersonated request known only from the request context", () => {
    const refusal = runWithImpersonator("op", () =>
      platformAuthoringRefusal({ user: { tenantId: OTHER, role: { name: "TECHNICIAN" } } }),
    );
    expect(refusal).toBe(MESSAGES.IMPERSONATING);
  });

  it("lets an ordinary member, a principal-less request and a role-less user through", () => {
    expect(platformAuthoringRefusal({ user: { tenantId: OTHER, role: { name: "TECHNICIAN" } }, tenantId: OTHER })).toBeNull();
    expect(platformAuthoringRefusal({})).toBeNull();
    expect(platformAuthoringRefusal({ user: { tenantId: OTHER } })).toBeNull();
  });

  it.each(["SUPERADMIN", "SUPER_ADMIN"])("refuses a %s overriding into another tenant", (name) => {
    expect(platformAuthoringRefusal({ user: superAdmin(name), tenantId: OTHER })).toBe(
      MESSAGES.OTHER_TENANT,
    );
  });

  it("refuses a super admin who is a member of no tenant", () => {
    expect(platformAuthoringRefusal({ user: superAdmin("SUPERADMIN", null), tenantId: OTHER })).toBe(
      MESSAGES.NO_TENANT,
    );
  });

  it("lets a super admin act in their home tenant, with or without an effective tenant set", () => {
    expect(platformAuthoringRefusal({ user: superAdmin(), tenantId: HOME })).toBeNull();
    expect(platformAuthoringRefusal({ user: superAdmin(), tenantId: null })).toBeNull();
  });
});

describe("denyPlatformAuthoring", () => {
  it("answers 403 with the explanation and does not call next", () => {
    const next = jest.fn();
    const res = {};
    const out = denyPlatformAuthoring({ impersonatorId: "op" }, res, next);
    expect(forbidden).toHaveBeenCalledWith(res, MESSAGES.IMPERSONATING);
    expect(out).toEqual({ status: 403, message: MESSAGES.IMPERSONATING });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next in the caller's own context for an ordinary member", () => {
    const outer = { tenantId: OTHER, isSuperAdmin: false, isSystemTask: false };
    let seen;
    tenantStorage.run(outer, () =>
      denyPlatformAuthoring({ user: { tenantId: OTHER, role: { name: "TECHNICIAN" } } }, {}, () => {
        seen = tenantStorage.getStore();
      }),
    );
    expect(seen).toBe(outer);
  });

  it("rebinds a home-tenant super admin to that tenant as an ordinary member", () => {
    let seen;
    tenantStorage.run({ tenantId: HOME, isSuperAdmin: true, isSystemTask: false }, () =>
      denyPlatformAuthoring({ user: superAdmin(), tenantId: HOME }, {}, () => {
        seen = tenantStorage.getStore();
      }),
    );
    expect(seen).toEqual({ tenantId: HOME, isSuperAdmin: false, isSystemTask: false });
  });
});
