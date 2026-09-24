const { auditActor } = require("../../utils/auditActor.util");

describe("auditActor", () => {
  it("takes the actor, their home tenant, and the request origin", () => {
    expect(
      auditActor({
        user: { id: "u-1", tenantId: "t-home" },
        tenantId: "t-override",
        ip: "10.0.0.1",
        headers: { "user-agent": "UA" },
      }),
    ).toEqual({ userId: "u-1", tenantId: "t-home", ipAddress: "10.0.0.1", userAgent: "UA" });
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
    expect(
      auditActor({
        user: { id: "u-hospital", tenantId: "t-home" },
        impersonatorId: "u-super-admin",
        body: { impersonatorId: "u-forged" },
        ip: "10.0.0.1",
        headers: { "user-agent": "UA" },
      }),
    ).toEqual({
      userId: "u-hospital",
      tenantId: "t-home",
      impersonatorId: "u-super-admin",
      ipAddress: "10.0.0.1",
      userAgent: "UA",
    });
  });

  it("an ordinary request has no impersonatorId — a body value is never read", () => {
    expect(
      auditActor({ user: { id: "u-1" }, body: { impersonatorId: "u-forged" }, headers: {} }),
    ).not.toHaveProperty("impersonatorId");
  });
});
