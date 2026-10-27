import { auditActor } from "../../utils/auditActor.util";
import type { AuditActorRequest } from "../../utils/auditActor.util";

interface OverrideRequest extends AuditActorRequest {
    tenantId: string;
}

describe("auditActor", () => {
  it("takes the actor, their home tenant, and the request origin", () => {
    const req: OverrideRequest = {
      user: { id: "u-1", tenantId: "t-home" },
      tenantId: "t-override",
      ip: "10.0.0.1",
      headers: { "user-agent": "UA" },
    };
    expect(auditActor(req)).toEqual({ userId: "u-1", tenantId: "t-home", ipAddress: "10.0.0.1", userAgent: "UA" });
  });

  it("is null, never undefined, for anything missing", () => {
    expect(auditActor({})).toEqual({ userId: null, tenantId: null, ipAddress: null, userAgent: null });
    expect(auditActor({ user: {}, headers: {} })).toEqual({
      userId: null,
      tenantId: null,
      ipAddress: null,
      userAgent: null,
    });
  });

  // F-8. Set by the auth middleware from the verified token claim only.
  it("names the impersonating super admin on an impersonated request", () => {
    const req = {
      user: { id: "u-hospital", tenantId: "t-home" },
      impersonatorId: "u-super-admin",
      body: { impersonatorId: "u-forged" },
      ip: "10.0.0.1",
      headers: { "user-agent": "UA" },
    } as unknown as AuditActorRequest;
    expect(auditActor(req)).toEqual({
      userId: "u-hospital",
      tenantId: "t-home",
      impersonatorId: "u-super-admin",
      ipAddress: "10.0.0.1",
      userAgent: "UA",
    });
  });

  it("an ordinary request has no impersonatorId — a body value is never read", () => {
    const req = {
      user: { id: "u-1" },
      body: { impersonatorId: "u-forged" },
      headers: {},
    } as unknown as AuditActorRequest;
    expect(auditActor(req)).not.toHaveProperty("impersonatorId");
  });
});
