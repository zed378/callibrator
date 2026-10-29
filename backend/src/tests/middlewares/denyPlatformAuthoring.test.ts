/**
 * A-127 (ADR-051 Q-17) — denyPlatformAuthoring, unit level. The route-level
 * behaviour and the enumeration of guarded routes are in
 * tests/routes/denyPlatformAuthoring.a127.test.js.
 */
import type { Request, Response } from "express";
import type * as AuditActorModule from "../../utils/auditActor.util";
import type * as DenyPlatformAuthoringModule from "../../middlewares/denyPlatformAuthoring.middleware";
import type * as TenantContextModule from "../../middlewares/tenantContext.middleware";

jest.mock("../../utils/response.util", () => ({
  forbidden: jest.fn((_res: Response, message: string) => ({ status: 403, message })),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { forbidden } = require("../../utils/response.util") as { forbidden: jest.Mock };
const { tenantStorage } =
  require("../../middlewares/tenantContext.middleware") as typeof TenantContextModule;
const { runWithImpersonator } =
  require("../../utils/auditActor.util") as typeof AuditActorModule;
const {
  denyPlatformAuthoring,
  platformAuthoringRefusal,
  MESSAGES,
} = require("../../middlewares/denyPlatformAuthoring.middleware") as typeof DenyPlatformAuthoringModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const HOME = "33333333-3333-4333-8333-333333333333";
const OTHER = "22222222-2222-4222-8222-222222222222";

const mockRes = (): Response => {
  const r: unknown = {};
  return r as Response;
};

const mockReq = (data: Record<string, unknown>): Request => {
  const r: unknown = data;
  return r as Request;
};

const superAdmin = (roleName = "SUPERADMIN", tenantId: string | null = HOME): { id: string; tenantId: string | null; role: { name: string } } => ({
  id: "op",
  tenantId,
  role: { name: roleName },
});

describe("platformAuthoringRefusal", () => {
  it("refuses an impersonated request named on req", () => {
    expect(platformAuthoringRefusal(mockReq({ impersonatorId: "op", user: { role: { name: "X" } } }))).toBe(
      MESSAGES.IMPERSONATING,
    );
  });

  it("refuses an impersonated request known only from the request context", () => {
    const refusal = runWithImpersonator("op", () =>
      platformAuthoringRefusal(mockReq({ user: { tenantId: OTHER, role: { name: "TECHNICIAN" } } })),
    );
    expect(refusal).toBe(MESSAGES.IMPERSONATING);
  });

  it("lets an ordinary member, a principal-less request and a role-less user through", () => {
    expect(platformAuthoringRefusal(mockReq({ user: { tenantId: OTHER, role: { name: "TECHNICIAN" } }, tenantId: OTHER }))).toBeNull();
    expect(platformAuthoringRefusal(mockReq({}))).toBeNull();
    expect(platformAuthoringRefusal(mockReq({ user: { tenantId: OTHER } }))).toBeNull();
  });

  it.each(["SUPERADMIN", "SUPER_ADMIN"])("refuses a %s overriding into another tenant", (name) => {
    expect(platformAuthoringRefusal(mockReq({ user: superAdmin(name), tenantId: OTHER }))).toBe(
      MESSAGES.OTHER_TENANT,
    );
  });

  it("refuses a super admin who is a member of no tenant", () => {
    expect(platformAuthoringRefusal(mockReq({ user: superAdmin("SUPERADMIN", null), tenantId: OTHER }))).toBe(
      MESSAGES.NO_TENANT,
    );
  });

  it("lets a super admin act in their home tenant, with or without an effective tenant set", () => {
    expect(platformAuthoringRefusal(mockReq({ user: superAdmin(), tenantId: HOME }))).toBeNull();
    expect(platformAuthoringRefusal(mockReq({ user: superAdmin(), tenantId: null }))).toBeNull();
  });
});

describe("denyPlatformAuthoring", () => {
  it("answers 403 with the explanation and does not call next", () => {
    const next = jest.fn();
    const res = mockRes();
    const out = denyPlatformAuthoring(mockReq({ impersonatorId: "op" }), res, next);
    expect(forbidden).toHaveBeenCalledWith(res, MESSAGES.IMPERSONATING);
    expect(out).toEqual({ status: 403, message: MESSAGES.IMPERSONATING });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next in the caller's own context for an ordinary member", () => {
    const outer = { tenantId: OTHER, isSuperAdmin: false, isSystemTask: false };
    let seen: unknown;
    tenantStorage.run(outer as never, () => {
      denyPlatformAuthoring(mockReq({ user: { tenantId: OTHER, role: { name: "TECHNICIAN" } } }), mockRes(), () => {
        seen = tenantStorage.getStore();
      });
    });
    expect(seen).toBe(outer);
  });

  it("rebinds a home-tenant super admin to that tenant as an ordinary member", () => {
    let seen: unknown;
    tenantStorage.run({ tenantId: HOME as never, isSuperAdmin: true, isSystemTask: false }, () => {
      denyPlatformAuthoring(mockReq({ user: superAdmin(), tenantId: HOME }), mockRes(), () => {
        seen = tenantStorage.getStore();
      });
    });
    expect(seen).toEqual({ tenantId: HOME, isSuperAdmin: false, isSystemTask: false });
  });
});
