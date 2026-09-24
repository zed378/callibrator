import { dataRetentionService, RETENTION_MIN_DAYS } from "./dataRetention.service";
import { api } from "../client";

/**
 * A-135: every fixture below is the envelope the BACKEND sends, copied from
 * backend/src/services/dataRetention.service.js and its controller — not a
 * shape this file's author expected. The previous fixtures
 * (`{ audit_log_retention_days: 365 }`, `{ enabled: false }`, `{ purged: true }`)
 * were ones the backend never produced, so they tested the client against an
 * imagined contract (CLAUDE.md: "a mock proves the client, not the contract").
 */

jest.mock("../client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;
const envelope = <T,>(data: T) => ({
  success: true,
  status: 200,
  message: "ok",
  data,
});

const TENANT = "tenant-1";

describe("dataRetentionService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("policy", () => {
    it("reads the backend's policy keys: notifications and sessions, never audit logs", async () => {
      // getRetentionPolicy: `{ ...DEFAULT_RETENTION_DAYS, ...overrides }`.
      mockedApi.get.mockResolvedValueOnce(envelope({ notifications: 90, sessions: 30 }));
      const res = await dataRetentionService.getPolicy(TENANT);
      expect(mockedApi.get).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/policy`);
      expect(res).toEqual({ notifications: 90, sessions: 30 });
    });

    it("sets a policy with a key the backend accepts, and returns what it set", async () => {
      // setRetentionPolicy returns `{ policyKey, days }`.
      mockedApi.put.mockResolvedValueOnce(envelope({ policyKey: "notifications", days: 60 }));
      const res = await dataRetentionService.setPolicy(TENANT, "notifications", 60);
      expect(mockedApi.put).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/policy`, {
        tenantId: TENANT,
        policyKey: "notifications",
        days: 60,
      });
      expect(res).toEqual({ policyKey: "notifications", days: 60 });
    });

    it("mirrors the backend's floors (MIN_RETENTION_DAYS)", () => {
      expect(RETENTION_MIN_DAYS).toEqual({ notifications: 30, sessions: 30 });
    });
  });

  describe("legal hold", () => {
    it("normalises the backend's onLegalHold flag", async () => {
      // controller isOnLegalHold: `{ tenantId, onLegalHold }`.
      mockedApi.get.mockResolvedValueOnce(envelope({ tenantId: TENANT, onLegalHold: true }));
      const res = await dataRetentionService.getLegalHold(TENANT);
      expect(mockedApi.get).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/legal-hold`);
      expect(res).toEqual({ enabled: true });
    });

    it("reads a hold as off unless the backend says true", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ tenantId: TENANT, onLegalHold: false }));
      expect(await dataRetentionService.getLegalHold(TENANT)).toEqual({ enabled: false });
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      expect(await dataRetentionService.getLegalHold(TENANT)).toEqual({ enabled: false });
    });

    it("enables legal hold with a reason", async () => {
      const set = { tenantId: TENANT, enabled: true, reason: "litigation", enabledBy: "u-1" };
      mockedApi.post.mockResolvedValueOnce(envelope(set));
      const res = await dataRetentionService.enableLegalHold(TENANT, "litigation");
      expect(mockedApi.post).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/legal-hold`, {
        tenantId: TENANT,
        reason: "litigation",
      });
      expect(res).toEqual(set);
    });

    it("disables legal hold", async () => {
      const released = { tenantId: TENANT, enabled: false, disabledBy: "u-1" };
      mockedApi.delete.mockResolvedValueOnce(envelope(released));
      const res = await dataRetentionService.disableLegalHold(TENANT);
      expect(mockedApi.delete).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/legal-hold`);
      expect(res).toEqual(released);
    });
  });

  describe("destructive operations", () => {
    it("purges expired records and returns the per-entity counts", async () => {
      // purgeExpiredRecords: `{ tenantId, purged: results, skipped: false }`.
      const done = { tenantId: TENANT, purged: { notifications: 7 }, skipped: false };
      mockedApi.post.mockResolvedValueOnce(envelope(done));
      const res = await dataRetentionService.purge(TENANT);
      expect(mockedApi.post).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/purge`, {
        tenantId: TENANT,
      });
      expect(res).toEqual(done);
    });

    it("reports a purge skipped under legal hold", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ skipped: true, reason: "legal_hold" }));
      const res = await dataRetentionService.purge(TENANT);
      expect(res).toEqual({ skipped: true, reason: "legal_hold" });
    });

    it("masks PII for users by recordIds", async () => {
      const masked = { masked: 2, fields: ["email", "firstName", "lastName", "phone"] };
      mockedApi.post.mockResolvedValueOnce(envelope(masked));
      const res = await dataRetentionService.maskPii(TENANT, "users", ["a", "b"]);
      expect(mockedApi.post).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/mask-pii`, {
        tenantId: TENANT,
        entityType: "users",
        recordIds: ["a", "b"],
      });
      expect(res).toEqual(masked);
    });

    it("masks a data subject's audit trail by subjectIds — the only field the backend accepts for it", async () => {
      const masked = { masked: 3, fields: ["changes", "ipAddress", "userAgent"] };
      mockedApi.post.mockResolvedValueOnce(envelope(masked));
      const res = await dataRetentionService.maskPii(TENANT, "audit_logs", ["subject-1"]);
      expect(mockedApi.post).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/mask-pii`, {
        tenantId: TENANT,
        entityType: "audit_logs",
        subjectIds: ["subject-1"],
      });
      expect(res).toEqual(masked);
    });

    it("anonymizes a dataset, defaulting options to an empty object", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ anonymized: 4, entityType: "users" }));
      const res = await dataRetentionService.anonymize(TENANT, "users");
      expect(mockedApi.post).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/anonymize`, {
        tenantId: TENANT,
        entityType: "users",
        options: {},
      });
      expect(res).toEqual({ anonymized: 4, entityType: "users" });
    });

    it("passes anonymize options through", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ anonymized: 1, entityType: "users" }));
      await dataRetentionService.anonymize(TENANT, "users", { keepDates: true });
      expect(mockedApi.post).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/anonymize`, {
        tenantId: TENANT,
        entityType: "users",
        options: { keepDates: true },
      });
    });
  });
});
