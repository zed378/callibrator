/**
 * Tests for Custom Domains Service (model-based, id-keyed).
 */
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../config", () => ({
  db: { Sequelize: { Op: { ne: "ne_symbol" } } },
}));

jest.mock("../../utils/appError.util", () => ({
  AppError: class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  },
}));

jest.mock("../../models", () => ({
  CustomDomain: {
    create: jest.fn(),
    update: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
  },
  User: { findOne: jest.fn() },
}));

jest.mock("../../services/emailQueue.service", () => ({
  emailQueueService: { queueEmail: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("dns", () => ({ promises: { resolveTxt: jest.fn() } }));

jest.mock("fs", () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(),
    writeFile: jest.fn().mockResolvedValue(),
    unlink: jest.fn().mockResolvedValue(),
  },
}));

jest.mock("acme-client", () => ({
  directory: {
    letsencrypt: { staging: "https://acme-staging", production: "https://acme-prod" },
  },
  crypto: {
    createPrivateKey: jest.fn().mockResolvedValue(Buffer.from("ACCOUNT_KEY")),
    createCsr: jest.fn().mockResolvedValue([Buffer.from("CERT_KEY"), Buffer.from("CSR")]),
  },
  Client: jest.fn(),
}));

jest.mock("../../services/kms.service", () => ({
  encryptData: jest.fn(() => ({ ciphertext: "enc", iv: "iv", authTag: "tag" })),
}));

const svc = require("../../services/customDomains.service");
const { AppError } = require("../../utils/appError.util");
const { logger } = require("../../middlewares/activityLog.middleware");
const { CustomDomain, User } = require("../../models");
const { emailQueueService } = require("../../services/emailQueue.service");
const dns = require("dns").promises;
const fs = require("fs");
const acme = require("acme-client");
const kms = require("../../services/kms.service");

const makeRecord = (over = {}) => {
  const rec = {
    id: "d-1",
    tenantId: "tenant-1",
    domain: "app.example.com",
    domainType: "subdomain",
    status: "pending_verification",
    sslEnabled: true,
    isDefault: false,
    verificationToken: "callibrator-verify=abc123",
    verifiedAt: null,
    lastCheckedAt: null,
    ...over,
  };
  rec.update = jest.fn(async (vals) => {
    Object.assign(rec, vals);
    return rec;
  });
  return rec;
};

describe("customDomainsService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CUSTOM_DOMAINS_ENABLED = "true";
    process.env.DEFAULT_SUBDOMAIN = "app";
    process.env.TLS_AUTO_PROVISION = "false";
    delete process.env.DNS_CHECK_INTERVAL;
    CustomDomain.findOne.mockResolvedValue(null);
    CustomDomain.findAll.mockResolvedValue([]);
    CustomDomain.update.mockResolvedValue([1]);
    CustomDomain.create.mockResolvedValue({
      id: "d-1",
      domain: "app.example.com",
      status: "pending_verification",
      sslEnabled: true,
    });
    User.findOne.mockResolvedValue({ email: "admin@example.com" });
    // Default: the DNS TXT record matches makeRecord's default token.
    dns.resolveTxt.mockResolvedValue([["callibrator-verify=abc123"]]);
  });

  describe("getTenantDomains", () => {
    it("returns the tenant's domains", async () => {
      CustomDomain.findAll.mockResolvedValueOnce([{ domain: "a.com" }]);
      const res = await svc.getTenantDomains("t-1");
      expect(res).toEqual([{ domain: "a.com" }]);
    });
    it("returns [] on failure", async () => {
      CustomDomain.findAll.mockRejectedValueOnce(new Error("db"));
      expect(await svc.getTenantDomains("t-1")).toEqual([]);
    });
  });

  describe("addDomain", () => {
    it("adds a domain from the object form and returns DNS instructions", async () => {
      const res = await svc.addDomain("tenant-1", {
        domain: "app.example.com",
        type: "subdomain",
        sslEnabled: true,
      });
      expect(CustomDomain.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-1",
          domain: "app.example.com",
          domainType: "subdomain",
          sslEnabled: true,
          status: "pending_verification",
        }),
      );
      expect(res.verification.cname.value).toBe("cname.callibrator.io.");
      expect(emailQueueService.queueEmail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: "Verify domain: app.example.com" }),
      );
    });

    it("adds a domain from the string form", async () => {
      const res = await svc.addDomain("tenant-1", "app.example.com", "custom");
      expect(res.domain).toBe("app.example.com");
    });

    it("409s when the domain already exists", async () => {
      CustomDomain.findOne.mockResolvedValueOnce({ domain: "app.example.com", status: "active" });
      await expect(svc.addDomain("tenant-1", "app.example.com")).rejects.toMatchObject({ status: 409 });
    });

    it("400s on invalid domain format", async () => {
      await expect(svc.addDomain("tenant-1", "not a domain")).rejects.toMatchObject({ status: 400 });
    });

    it("400s when disabled", async () => {
      process.env.CUSTOM_DOMAINS_ENABLED = "false";
      await expect(svc.addDomain("tenant-1", "app.example.com")).rejects.toMatchObject({ status: 400 });
    });

    it("400s when tenantId or domain missing", async () => {
      await expect(svc.addDomain(null, "app.example.com")).rejects.toMatchObject({ status: 400 });
      await expect(svc.addDomain("tenant-1", null)).rejects.toMatchObject({ status: 400 });
    });

    it("500s and wraps a DB failure", async () => {
      CustomDomain.create.mockRejectedValueOnce(new Error("DB"));
      await expect(svc.addDomain("tenant-1", "app.example.com")).rejects.toMatchObject({ status: 500 });
    });

    it("re-throws an AppError unchanged rather than masking it as a 500", async () => {
      CustomDomain.create.mockRejectedValueOnce(new AppError(422, "Quota exceeded"));

      await expect(svc.addDomain("tenant-1", "app.example.com")).rejects.toMatchObject({
        status: 422,
        message: "Quota exceeded",
      });
    });

    it("defaults type to 'subdomain' and sslEnabled to true for a bare object input", async () => {
      await svc.addDomain("tenant-1", { domain: "app.example.com" });

      expect(CustomDomain.create).toHaveBeenCalledWith(
        expect.objectContaining({ domainType: "subdomain", sslEnabled: true }),
      );
    });

    it("honours sslEnabled:false", async () => {
      await svc.addDomain("tenant-1", { domain: "app.example.com", sslEnabled: false });

      expect(CustomDomain.create).toHaveBeenCalledWith(
        expect.objectContaining({ sslEnabled: false }),
      );
    });

    it("still adds the domain when the tenant has no admin user to notify", async () => {
      User.findOne.mockResolvedValueOnce(null);

      const res = await svc.addDomain("tenant-1", "app.example.com");

      expect(res.id).toBe("d-1");
      expect(emailQueueService.queueEmail).not.toHaveBeenCalled();
    });

    it("still adds the domain when the admin user has no email address", async () => {
      User.findOne.mockResolvedValueOnce({ id: "u-1", email: null });

      const res = await svc.addDomain("tenant-1", "app.example.com");

      expect(res.id).toBe("d-1");
      expect(emailQueueService.queueEmail).not.toHaveBeenCalled();
    });

    it("still adds the domain when queueing the verification email fails", async () => {
      emailQueueService.queueEmail.mockRejectedValueOnce(new Error("queue down"));

      const res = await svc.addDomain("tenant-1", "app.example.com");

      expect(res.id).toBe("d-1");
      expect(logger.warn).toHaveBeenCalledWith(
        "Failed to send verification email",
        expect.objectContaining({ error: "queue down" }),
      );
    });

    it("advertises Let's Encrypt auto-provisioning in the instructions when TLS auto-provision is on", async () => {
      process.env.TLS_AUTO_PROVISION = "true";

      const res = await svc.addDomain("tenant-1", "app.example.com");

      expect(res.verification.instructions[3]).toContain("auto-provisioned");
    });
  });

  describe("verifyDomain", () => {
    it("activates the domain when the TXT token matches", async () => {
      const rec = makeRecord();
      CustomDomain.findOne.mockResolvedValueOnce(rec);
      // Record split across chunks to exercise the join.
      dns.resolveTxt.mockResolvedValueOnce([["callibrator-verify=", "abc123"]]);

      const res = await svc.verifyDomain("tenant-1", "d-1");

      expect(dns.resolveTxt).toHaveBeenCalledWith("_domain_verify.app.example.com");
      expect(res.verified).toBe(true);
      expect(res.status).toBe("active");
      expect(rec.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "active" }),
      );
    });

    it("marks verification_failed when the token is absent from DNS", async () => {
      const rec = makeRecord();
      CustomDomain.findOne.mockResolvedValueOnce(rec);
      dns.resolveTxt.mockResolvedValueOnce([["some-other-token"]]);

      const res = await svc.verifyDomain("tenant-1", "d-1");

      expect(res.verified).toBe(false);
      expect(res.status).toBe("verification_failed");
      expect(res.record).toBeNull();
      expect(rec.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "verification_failed", verifiedAt: null }),
      );
    });

    it("treats a DNS lookup error as unverified", async () => {
      const rec = makeRecord();
      CustomDomain.findOne.mockResolvedValueOnce(rec);
      dns.resolveTxt.mockRejectedValueOnce(new Error("ENOTFOUND"));

      const res = await svc.verifyDomain("tenant-1", "d-1");

      expect(res.verified).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(
        "DNS TXT lookup failed",
        expect.objectContaining({ error: "ENOTFOUND" }),
      );
    });

    it("returns disabled result when the feature is off", async () => {
      process.env.CUSTOM_DOMAINS_ENABLED = "false";
      const res = await svc.verifyDomain("tenant-1", "d-1");
      expect(res.verified).toBe(false);
    });

    it("404s when the domain is not owned", async () => {
      CustomDomain.findOne.mockResolvedValueOnce(null);
      await expect(svc.verifyDomain("tenant-1", "missing")).rejects.toMatchObject({ status: 404 });
    });

    it("generates a token when the record has none stored", async () => {
      const rec = makeRecord({ verificationToken: null });
      CustomDomain.findOne.mockResolvedValueOnce(rec);
      // A freshly generated random token won't be in DNS yet → unverified.
      dns.resolveTxt.mockResolvedValueOnce([["stale"]]);

      const res = await svc.verifyDomain("tenant-1", "d-1");

      expect(res.verified).toBe(false);
      expect(res.dnsRecord.value).toMatch(/^callibrator-verify=[0-9a-f]{32}$/);
      expect(res.dnsRecord.name).toBe("_domain_verify.app.example.com");
    });

    it("reports the reason when persisting the verification result fails", async () => {
      const rec = makeRecord();
      rec.update.mockRejectedValueOnce(new Error("write failed"));
      CustomDomain.findOne.mockResolvedValueOnce(rec);

      const res = await svc.verifyDomain("tenant-1", "d-1");

      expect(res).toEqual({ verified: false, reason: "write failed" });
      expect(logger.error).toHaveBeenCalledWith(
        "Domain verification failed",
        expect.objectContaining({ domainId: "d-1", error: "write failed" }),
      );
    });
  });

  describe("removeDomain", () => {
    it("soft-deletes the domain", async () => {
      const rec = makeRecord();
      CustomDomain.findOne.mockResolvedValueOnce(rec);
      const res = await svc.removeDomain("tenant-1", "d-1");
      expect(res).toEqual({ success: true, id: "d-1" });
      expect(rec.status).toBe("deleted");
    });
    it("404s when not found", async () => {
      await expect(svc.removeDomain("tenant-1", "missing")).rejects.toMatchObject({ status: 404 });
    });
    it("400s when args are missing", async () => {
      await expect(svc.removeDomain(null, "d-1")).rejects.toMatchObject({ status: 400 });
      await expect(svc.removeDomain("tenant-1", null)).rejects.toMatchObject({ status: 400 });
    });

    it("500s when the soft-delete write fails", async () => {
      const rec = makeRecord();
      rec.update.mockRejectedValueOnce(new Error("write failed"));
      CustomDomain.findOne.mockResolvedValueOnce(rec);

      await expect(svc.removeDomain("tenant-1", "d-1")).rejects.toMatchObject({
        status: 500,
        message: "Failed to remove domain",
      });
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to remove domain",
        expect.objectContaining({ error: "write failed" }),
      );
    });
  });

  describe("getDomainStatus", () => {
    it("returns the domain status", async () => {
      CustomDomain.findOne.mockResolvedValueOnce(makeRecord({ status: "active" }));
      const res = await svc.getDomainStatus("tenant-1", "d-1");
      expect(res).toMatchObject({ id: "d-1", status: "active", isDefault: false });
    });
    it("404s when not found", async () => {
      await expect(svc.getDomainStatus("tenant-1", "missing")).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("setDefaultDomain", () => {
    it("clears other defaults and sets this one", async () => {
      const rec = makeRecord({ status: "active" });
      CustomDomain.findOne.mockResolvedValueOnce(rec);
      const res = await svc.setDefaultDomain("tenant-1", "d-1");
      expect(CustomDomain.update).toHaveBeenCalledWith(
        { isDefault: false },
        { where: { tenantId: "tenant-1" } },
      );
      expect(rec.update).toHaveBeenCalledWith({ isDefault: true });
      expect(res.isDefault).toBe(true);
    });
    it("400s for a deleted domain", async () => {
      CustomDomain.findOne.mockResolvedValueOnce(makeRecord({ status: "deleted" }));
      await expect(svc.setDefaultDomain("tenant-1", "d-1")).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("getDnsRecords", () => {
    it("returns TXT + CNAME instructions", async () => {
      CustomDomain.findOne.mockResolvedValueOnce(makeRecord());
      const res = await svc.getDnsRecords("tenant-1", "d-1");
      expect(res.verification.type).toBe("TXT");
      expect(res.cname.type).toBe("CNAME");
      expect(res.verification.value).toBe("callibrator-verify=abc123");
    });

    it("shows a [TOKEN] placeholder when the record has no verification token", async () => {
      CustomDomain.findOne.mockResolvedValueOnce(makeRecord({ verificationToken: null }));

      const res = await svc.getDnsRecords("tenant-1", "d-1");

      expect(res.verification.value).toBe("callibrator-verify=[TOKEN]");
    });
  });

  describe("getDomainByDomain", () => {
    it("returns the matching non-deleted record", async () => {
      const rec = makeRecord({ status: "active" });
      CustomDomain.findOne.mockResolvedValueOnce(rec);

      expect(await svc.getDomainByDomain("app.example.com")).toBe(rec);
      expect(CustomDomain.findOne).toHaveBeenCalledWith({
        where: { domain: "app.example.com", status: { ne_symbol: "deleted" } },
      });
    });

    it("returns null when the lookup fails", async () => {
      CustomDomain.findOne.mockRejectedValueOnce(new Error("db down"));

      expect(await svc.getDomainByDomain("app.example.com")).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to get domain",
        expect.objectContaining({ error: "db down" }),
      );
    });
  });

  describe("resolveTenantByDomain", () => {
    it("resolves a tenant from an active domain", async () => {
      CustomDomain.findOne.mockResolvedValueOnce({ tenantId: "tenant-9", domain: "x.com" });
      expect(await svc.resolveTenantByDomain("x.com")).toEqual({
        tenantId: "tenant-9",
        domain: "x.com",
      });
    });
    it("returns null when disabled", async () => {
      process.env.CUSTOM_DOMAINS_ENABLED = "false";
      expect(await svc.resolveTenantByDomain("x.com")).toBeNull();
    });
    it("returns null on miss", async () => {
      expect(await svc.resolveTenantByDomain("nope.com")).toBeNull();
    });

    it("returns null (does not throw) when the lookup fails", async () => {
      CustomDomain.findOne.mockRejectedValueOnce(new Error("db down"));

      expect(await svc.resolveTenantByDomain("x.com")).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        "Domain resolution failed",
        expect.objectContaining({ hostname: "x.com", error: "db down" }),
      );
    });
  });

  describe("provisionTLSCertificate + status + constants", () => {
    // An `auto` implementation that also exercises the http-01 challenge
    // create/remove callbacks (and their non-http-01 early-return branches).
    const autoWithChallenges = jest.fn(async (opts) => {
      await opts.challengeCreateFn({}, { type: "http-01", token: "tok" }, "KEYAUTH");
      await opts.challengeCreateFn({}, { type: "dns-01", token: "x" }, "y");
      await opts.challengeRemoveFn({}, { type: "http-01", token: "tok" });
      await opts.challengeRemoveFn({}, { type: "dns-01", token: "x" });
      return Buffer.from("CERT_PEM");
    });

    beforeEach(() => {
      acme.Client.mockImplementation(() => ({ auto: autoWithChallenges }));
      // Exercise the unlink .catch() swallow path.
      fs.promises.unlink.mockRejectedValue(new Error("already gone"));
    });

    it("issues a certificate via ACME and encrypts the key for a tenant", async () => {
      process.env.TLS_AUTO_PROVISION = "true";

      const res = await svc.provisionTLSCertificate("x.com", "tenant-1");

      expect(res.success).toBe(true);
      expect(res.certificate.domain).toBe("x.com");
      expect(res.certificate.issuer).toBe("Let's Encrypt");
      expect(res.certificate.certificate).toBe("CERT_PEM");
      expect(kms.encryptData).toHaveBeenCalledWith("tenant-1", "CERT_KEY");
      expect(res.certificate.encryptedPrivateKey).toEqual({
        ciphertext: "enc",
        iv: "iv",
        authTag: "tag",
      });
      // The http-01 token was written under the challenge dir.
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("tok"),
        "KEYAUTH",
      );
    });

    it("omits the encrypted key when no tenant is supplied", async () => {
      process.env.TLS_AUTO_PROVISION = "true";

      const res = await svc.provisionTLSCertificate("x.com");

      expect(res.success).toBe(true);
      expect(res.certificate.encryptedPrivateKey).toBeNull();
      expect(kms.encryptData).not.toHaveBeenCalled();
    });

    it("declines when disabled", async () => {
      process.env.TLS_AUTO_PROVISION = "false";
      const res = await svc.provisionTLSCertificate("x.com");
      expect(res.success).toBe(false);
      expect(res.reason).toBe("TLS auto-provisioning disabled");
    });

    it("degrades gracefully instead of throwing if issuance fails", async () => {
      process.env.TLS_AUTO_PROVISION = "true";
      acme.crypto.createPrivateKey.mockRejectedValueOnce(new Error("acme down"));

      const res = await svc.provisionTLSCertificate("x.com");

      expect(res).toEqual({ success: false, reason: "acme down" });
    });
    it("reports status and constants", () => {
      process.env.DNS_CHECK_INTERVAL = "60";
      expect(svc.getStatus()).toMatchObject({
        enabled: true,
        defaultSubdomain: "app",
        dnsCheckInterval: 60,
        tlsAutoProvision: false,
      });
      expect(svc.DOMAIN_STATUS).toHaveProperty("ACTIVE", "active");
      expect(svc.DOMAIN_TYPE).toHaveProperty("SUBDOMAIN", "subdomain");
    });

    it("falls back to the built-in subdomain and DNS interval defaults", () => {
      delete process.env.DEFAULT_SUBDOMAIN;
      delete process.env.DNS_CHECK_INTERVAL;
      delete process.env.CUSTOM_DOMAINS_ENABLED;

      expect(svc.getStatus()).toEqual({
        enabled: false,
        defaultSubdomain: "app",
        dnsCheckInterval: 300,
        tlsAutoProvision: false,
      });
    });
  });
});
