import { featureFlagService } from "./featureFlag.service";
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

const BASE = "/api/v1/feature-flags";

describe("featureFlagService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getTenantFlags", () => {
    it("GETs the effective flag map with the tenantId param", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ audit: true }));

      const res = await featureFlagService.getTenantFlags("t1");

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { tenantId: "t1" },
      });
      expect(res).toEqual({ audit: true });
    });

    it("passes undefined tenantId through untouched", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({}));
      await featureFlagService.getTenantFlags();
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { tenantId: undefined },
      });
    });
  });

  describe("getDefinitions", () => {
    it("GETs the definitions catalog and returns data", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope([{ key: "audit", category: "core", defaultValue: true }]),
      );

      const res = await featureFlagService.getDefinitions();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/definitions`);
      expect(res).toHaveLength(1);
    });
  });

  describe("isEnabled", () => {
    it("GETs /:tenantId/:flagKey and returns the unwrapped result", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ flagKey: "audit", enabled: true }),
      );

      const res = await featureFlagService.isEnabled("t1", "audit");

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/t1/audit`);
      expect(res).toEqual({ flagKey: "audit", enabled: true });
    });
  });

  describe("setFlag", () => {
    it("POSTs the override to /:tenantId/:flagKey with tenantId/flagKey/enabled body", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({ flagKey: "audit", enabled: false }),
      );

      const res = await featureFlagService.setFlag("t1", "audit", false);

      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/t1/audit`, {
        tenantId: "t1",
        flagKey: "audit",
        enabled: false,
      });
      expect(res.enabled).toBe(false);
    });
  });

  describe("resetFlag", () => {
    it("DELETEs /:tenantId/:flagKey", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await featureFlagService.resetFlag("t1", "audit");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/t1/audit`);
    });
  });

  describe("initialize", () => {
    it("POSTs to /:tenantId/initialize and returns the seeded map", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ audit: true }));

      const res = await featureFlagService.initialize("t1");

      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/t1/initialize`);
      expect(res).toEqual({ audit: true });
    });
  });
});
