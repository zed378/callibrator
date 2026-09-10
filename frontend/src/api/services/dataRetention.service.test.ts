import { dataRetentionService } from "./dataRetention.service";
import { api } from "../client";

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
    it("gets the tenant retention policy", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ audit_log_retention_days: 365 }),
      );
      const res = await dataRetentionService.getPolicy(TENANT);
      expect(mockedApi.get).toHaveBeenCalledWith(
        `/api/v1/tenants/${TENANT}/policy`,
      );
      expect(res).toEqual({ audit_log_retention_days: 365 });
    });

    it("sets a retention policy window", async () => {
      mockedApi.put.mockResolvedValueOnce(
        envelope({ audit_log_retention_days: 90 }),
      );
      await dataRetentionService.setPolicy(
        TENANT,
        "audit_log_retention_days",
        90,
      );
      expect(mockedApi.put).toHaveBeenCalledWith(
        `/api/v1/tenants/${TENANT}/policy`,
        { tenantId: TENANT, policyKey: "audit_log_retention_days", days: 90 },
      );
    });
  });

  describe("legal hold", () => {
    it("reads legal-hold status", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ enabled: false }));
      const res = await dataRetentionService.getLegalHold(TENANT);
      expect(mockedApi.get).toHaveBeenCalledWith(
        `/api/v1/tenants/${TENANT}/legal-hold`,
      );
      expect(res.enabled).toBe(false);
    });

    it("enables legal hold with a reason", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({ enabled: true, reason: "litigation" }),
      );
      await dataRetentionService.enableLegalHold(TENANT, "litigation");
      expect(mockedApi.post).toHaveBeenCalledWith(
        `/api/v1/tenants/${TENANT}/legal-hold`,
        { tenantId: TENANT, reason: "litigation" },
      );
    });

    it("disables legal hold", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope({ enabled: false }));
      await dataRetentionService.disableLegalHold(TENANT);
      expect(mockedApi.delete).toHaveBeenCalledWith(
        `/api/v1/tenants/${TENANT}/legal-hold`,
      );
    });
  });

  describe("destructive operations", () => {
    it("purges expired records", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ purged: true }));
      const res = await dataRetentionService.purge(TENANT);
      expect(mockedApi.post).toHaveBeenCalledWith(
        `/api/v1/tenants/${TENANT}/purge`,
        { tenantId: TENANT },
      );
      expect(res.purged).toBe(true);
    });

    it("masks PII for the given records", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ masked: true, count: 2 }));
      await dataRetentionService.maskPii(TENANT, "users", ["a", "b"]);
      expect(mockedApi.post).toHaveBeenCalledWith(
        `/api/v1/tenants/${TENANT}/mask-pii`,
        { tenantId: TENANT, entityType: "users", recordIds: ["a", "b"] },
      );
    });

    it("anonymizes a dataset, defaulting options to an empty object", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ anonymized: true }));
      await dataRetentionService.anonymize(TENANT, "users");
      expect(mockedApi.post).toHaveBeenCalledWith(
        `/api/v1/tenants/${TENANT}/anonymize`,
        { tenantId: TENANT, entityType: "users", options: {} },
      );
    });

    it("passes anonymize options through", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ anonymized: true }));
      await dataRetentionService.anonymize(TENANT, "users", {
        keepDates: true,
      });
      expect(mockedApi.post).toHaveBeenCalledWith(
        `/api/v1/tenants/${TENANT}/anonymize`,
        {
          tenantId: TENANT,
          entityType: "users",
          options: { keepDates: true },
        },
      );
    });
  });
});
