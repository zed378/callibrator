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
});
