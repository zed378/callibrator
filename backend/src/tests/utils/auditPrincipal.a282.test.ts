/**
 * A-282 (ADR-094) — utils/auditPrincipal: an API key is never recorded as a
 * user. `audit_logs.user_id` references `users`; a key's id there fails the
 * foreign key and rolls the write back. A key is `system:api-key` with its id
 * in `changes.apiKeyId`.
 */
import {
  auditPrincipal,
  actorFields,
  actorChanges,
  auditEntryActor,
} from "../../utils/auditPrincipal.util";

describe("A-282 — auditPrincipal", () => {
  it("a user is the row's user, with the request's address and agent", () => {
    const principal = auditPrincipal({
      user: { id: "u-1", tenantId: "t-1" },
      ip: "10.0.0.1",
      headers: { "user-agent": "UA" },
    });
    expect(principal).toEqual({
      userId: "u-1",
      apiKeyId: null,
      ipAddress: "10.0.0.1",
      userAgent: "UA",
    });
    expect(auditEntryActor(principal)).toEqual({
      userId: "u-1",
      ipAddress: "10.0.0.1",
      userAgent: "UA",
    });
    expect(actorChanges(principal)).toEqual({});
  });

  it("an API key is never the row's user: system:api-key, the key in changes", () => {
    const principal = auditPrincipal({
      user: { id: "k-1", tenantId: "t-1", isApiKey: true },
    });
    expect(principal).toEqual({
      userId: null,
      apiKeyId: "k-1",
      ipAddress: null,
      userAgent: null,
    });
    expect(actorFields(principal)).toEqual({ systemActor: "system:api-key" });
    expect(actorChanges(principal)).toEqual({ apiKeyId: "k-1" });
  });

  it("no principal names no user, so the insert fails closed", () => {
    expect(auditPrincipal({})).toEqual({
      userId: null,
      apiKeyId: null,
      ipAddress: null,
      userAgent: null,
    });
    expect(actorFields(undefined)).toEqual({ userId: null });
    expect(actorChanges(null)).toEqual({});
    expect(auditEntryActor(null)).toEqual({
      userId: null,
      ipAddress: null,
      userAgent: null,
    });
  });
});

describe("A-282 (ADR-100) — a service's system actor passes through", () => {
  it("a principal that names only a system actor is that system actor", () => {
    expect(actorFields({ systemActor: "system:calibration-scan" })).toEqual({
      systemActor: "system:calibration-scan",
    });
    expect(auditEntryActor({ systemActor: "system:calibration-scan" })).toEqual({
      systemActor: "system:calibration-scan",
      ipAddress: null,
      userAgent: null,
    });
  });

  it("a user beats a system actor, and a key beats both", () => {
    expect(actorFields({ userId: "u-1", systemActor: "system:calibration-scan" })).toEqual({ userId: "u-1" });
    expect(actorFields({ userId: "k-1", apiKeyId: "k-1", systemActor: "system:calibration-scan" })).toEqual({
      systemActor: "system:api-key",
    });
  });
});

describe("A-282 (ADR-100) — the user agent is one string", () => {
  it("a repeated header is joined, as the audit column holds one string", () => {
    expect(auditPrincipal({ headers: { "user-agent": ["a", "b"] } }).userAgent).toBe("a, b");
  });
});
