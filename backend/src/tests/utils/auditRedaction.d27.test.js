/**
 * D-27 (ADR-070) — `audit_logs.changes` never keeps a secret.
 *
 * Tested against FIXTURES shaped like real audit entries carrying real
 * secret-shaped keys (a password change, an SMTP setting, a webhook secret, an
 * OIDC client, an MFA enrolment, an API key, a bearer header), not against the
 * deny-list itself — CLAUDE.md: a redaction test that iterates the redactor's
 * own key set cannot catch a key being deleted from it. The keys that
 * DESCRIBE a secret without holding it must survive, or the trail loses what
 * it is for.
 */
jest.mock("../../models", () => ({ AuditLog: { create: jest.fn(async (v) => ({ id: "a-1", ...v })) }, User: {} }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { redactAuditChanges, isSecretKey, REDACTED } = require("../../utils/auditRedaction.util");
const { AuditLog } = require("../../models");
const { logger } = require("../../middlewares/activityLog.middleware");
const auditService = require("../../services/audit.service");

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEifQ.c2lnbmF0dXJlLXZhbHVl";

const FIXTURES = [
  {
    name: "a password change (auth)",
    changes: {
      before: { password: "$2b$10$abcdefghijklmnopqrstuv", passwordChangedAt: "2026-01-01T00:00:00Z" },
      after: { password: "$2b$10$zyxwvutsrqponmlkjihgfe", mustChangePassword: false },
      newPassword: "Hunter2!",
      current_password: "old-one",
    },
    secretPaths: ["before.password", "after.password", "newPassword", "current_password"],
    kept: { "before.passwordChangedAt": "2026-01-01T00:00:00Z", "after.mustChangePassword": false },
  },
  {
    name: "tenant settings with an SMTP password and an S3 secret",
    changes: {
      before: { smtp_password: "p@ss", smtpHost: "mail.example.test" },
      after: { smtp_password: "n3w", "s3-secret-access-key": "AKIA/abc", s3SecretAccessKey: "wJalrXUtnFEMI/K7MDENG", smtpHost: "mx" },
    },
    secretPaths: ["before.smtp_password", "after.smtp_password", "after.s3-secret-access-key", "after.s3SecretAccessKey"],
    kept: { "before.smtpHost": "mail.example.test", "after.smtpHost": "mx" },
  },
  {
    name: "a webhook created with its signing secret",
    changes: { url: "https://hooks.example.test/x", secret: "whsec_123", webhookSecret: "whsec_456", secretRotated: true },
    secretPaths: ["secret", "webhookSecret"],
    kept: { url: "https://hooks.example.test/x", secretRotated: true },
  },
  {
    name: "an OIDC client and an MFA enrolment",
    changes: {
      client: { clientId: "portal", clientSecret: "cs_789", redirectUris: ["https://a.test/cb"] },
      mfa: { totpSecret: "JBSWY3DPEHPK3PXP", recoveryCodes: ["1111-2222", "3333-4444"], otp: 123456, enabled: true },
    },
    secretPaths: ["client.clientSecret", "mfa.totpSecret", "mfa.recoveryCodes", "mfa.otp"],
    kept: { "client.clientId": "portal", "mfa.enabled": true },
  },
  {
    name: "an API key and session tokens",
    changes: {
      keyPrefix: "ck_live_abcd",
      apiKey: "ck_live_abcdefghijklmnop",
      keyHash: "e3b0c44298fc1c149afbf4c8996fb924",
      refreshToken: "rt-1",
      tokenHash: "9f86d081884c7d659a2feaa0c55ad015",
      tokenExpiresAt: "2026-10-01T00:00:00Z",
      privateKey: "-----BEGIN PRIVATE KEY-----",
      publicKey: "-----BEGIN PUBLIC KEY-----",
    },
    secretPaths: ["apiKey", "refreshToken", "tokenHash", "privateKey"],
    kept: { keyPrefix: "ck_live_abcd", tokenExpiresAt: "2026-10-01T00:00:00Z", publicKey: "-----BEGIN PUBLIC KEY-----" },
  },
  {
    name: "a request header captured under an unremarkable key",
    changes: { request: { headers: { Authorization: `Bearer ${JWT}` }, note: `retry with Bearer abc.def and ${JWT}` } },
    secretPaths: ["request.headers.Authorization", "request.note"],
    kept: {},
  },
];

const at = (obj, dotted) => dotted.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

describe("D-27 — audit changes are redacted against real-shaped fixtures", () => {
  it.each(FIXTURES)("$name", ({ changes, secretPaths, kept }) => {
    const snapshot = JSON.parse(JSON.stringify(changes));
    const { value, redacted } = redactAuditChanges(changes);

    for (const p of secretPaths) {
      expect(redacted).toContain(p);
    }
    for (const [p, expected] of Object.entries(kept)) {
      expect(at(value, p)).toEqual(expected);
    }
    // No secret VALUE of the fixture survives anywhere in the stored JSON.
    const stored = JSON.stringify(value);
    for (const p of secretPaths.filter((s) => !s.startsWith("request."))) {
      const original = at(snapshot, p);
      for (const piece of [].concat(original).map(String)) {
        expect(stored).not.toContain(piece);
      }
    }
    expect(stored).not.toContain(JWT);
    // The caller's object is untouched.
    expect(changes).toEqual(snapshot);
  });

  it("does not redact what describes a secret without holding it", () => {
    for (const key of ["passwordChangedAt", "tokenExpiresAt", "secretRotated", "keyPrefix", "credentialId", "email"]) {
      expect(isSecretKey(key)).toBe(false);
    }
    const { value, redacted } = redactAuditChanges({
      email: "jane.doe@hospital.example",
      mustChangePassword: true,
      password: "",
      token: null,
    });
    expect(value).toEqual({ email: "jane.doe@hospital.example", mustChangePassword: true, password: "", token: null });
    expect(redacted).toEqual([]);
  });

  it("passes null, scalars and dates through, walks arrays and instances, and survives cycles", () => {
    expect(redactAuditChanges(null)).toEqual({ value: null, redacted: [] });
    expect(redactAuditChanges(5).value).toBe(5);
    const when = new Date("2026-09-25T00:00:00Z");
    const instance = { toJSON: () => ({ password: "x", at: when }) };
    const scalarInstance = { toJSON: () => "plain" };
    const cyclic = { name: "c" };
    cyclic.self = cyclic;
    const { value, redacted } = redactAuditChanges({ list: [instance, scalarInstance], cyclic, bare: `Bearer ${JWT}` });
    expect(value.list[0]).toEqual({ password: REDACTED, at: when });
    expect(value.list[1]).toBe("plain");
    expect(value.cyclic.self).toBe(cyclic);
    expect(value.bare).toBe(`Bearer ${REDACTED}`);
    expect(redacted).toEqual(["list[0].password", "bare"]);
    expect(redactAuditChanges("Bearer abc").redacted).toEqual(["(value)"]);
  });

  it("stops descending past its depth bound", () => {
    let deep = { password: "deep-secret" };
    for (let i = 0; i < 12; i += 1) {
      deep = { next: deep };
    }
    expect(() => redactAuditChanges(deep)).not.toThrow();
  });
});

describe("D-27 — audit.service#logAction stores the redacted copy and names the call site", () => {
  it("writes [REDACTED] in place of the secret and warns with the field paths", async () => {
    await auditService.logAction({
      tenantId: "t-1",
      userId: "u-1",
      action: "UPDATE",
      resourceType: "Webhook",
      resourceId: "w-1",
      changes: { before: { secret: "whsec_1" }, after: { secret: "whsec_2", url: "https://x.test" } },
    });

    const [row] = AuditLog.create.mock.calls[0];
    expect(row.changes).toEqual({ before: { secret: REDACTED }, after: { secret: REDACTED, url: "https://x.test" } });
    expect(logger.warn).toHaveBeenCalledWith(
      "Audit changes carried secret-bearing fields; their values were redacted",
      expect.objectContaining({ resourceType: "Webhook", fields: ["before.secret", "after.secret"] }),
    );
  });

  it("an entry with nothing secret is stored as given, without a warning", async () => {
    logger.warn.mockClear();
    await auditService.logAction({
      tenantId: "t-1",
      userId: "u-1",
      action: "UPDATE",
      resourceType: "Certificate",
      resourceId: "c-1",
      changes: { before: { status: "draft" }, after: { status: "pending_approval" } },
    });
    expect(AuditLog.create.mock.calls.at(-1)[0].changes).toEqual({
      before: { status: "draft" },
      after: { status: "pending_approval" },
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
