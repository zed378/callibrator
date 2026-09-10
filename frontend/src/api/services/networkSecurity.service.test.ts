import { networkSecurityService } from "./networkSecurity.service";
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

const BASE = "/api/v1/network-security";

describe("networkSecurityService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("ip allowlist", () => {
    it("unwraps the allowlist array", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ allowlist: ["10.0.0.0/8"] }),
      );
      const res = await networkSecurityService.getIpAllowlist();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/ip-allowlist`);
      expect(res).toEqual(["10.0.0.0/8"]);
    });

    it("returns [] when the tenant has no allowlist configured", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ allowlist: null }));
      await expect(networkSecurityService.getIpAllowlist()).resolves.toEqual([]);
    });

    it("replaces the allowlist", async () => {
      mockedApi.put.mockResolvedValueOnce(
        envelope({ tenantId: "t1", allowlist: ["192.168.1.0/24"] }),
      );
      await networkSecurityService.setIpAllowlist(["192.168.1.0/24"]);
      expect(mockedApi.put).toHaveBeenCalledWith(`${BASE}/ip-allowlist`, {
        cidrs: ["192.168.1.0/24"],
      });
    });
  });

  describe("geofence", () => {
    it("unwraps the geofence", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ geofence: { latitude: 1, longitude: 2, radiusKm: 50 } }),
      );
      const res = await networkSecurityService.getGeofence();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/geofence`);
      expect(res).toEqual({ latitude: 1, longitude: 2, radiusKm: 50 });
    });

    it("returns null when no geofence is configured", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ geofence: null }));
      await expect(networkSecurityService.getGeofence()).resolves.toBeNull();
    });

    it("omits radiusKm so the server default applies", async () => {
      mockedApi.put.mockResolvedValueOnce(
        envelope({ tenantId: "t1", geofence: {} }),
      );
      await networkSecurityService.setGeofence(-6.2, 106.8);
      expect(mockedApi.put).toHaveBeenCalledWith(`${BASE}/geofence`, {
        latitude: -6.2,
        longitude: 106.8,
      });
    });

    it("sends radiusKm when given", async () => {
      mockedApi.put.mockResolvedValueOnce(
        envelope({ tenantId: "t1", geofence: {} }),
      );
      await networkSecurityService.setGeofence(-6.2, 106.8, 25);
      expect(mockedApi.put).toHaveBeenCalledWith(`${BASE}/geofence`, {
        latitude: -6.2,
        longitude: 106.8,
        radiusKm: 25,
      });
    });
  });

  describe("evaluateLogin", () => {
    it("sends only the ip when no coordinates are supplied", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({
          allowed: true,
          ip: { allowed: true },
          geofence: { allowed: true },
          requiresStepUp: false,
        }),
      );
      const res = await networkSecurityService.evaluateLogin("8.8.8.8");
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/evaluate-login`, {
        ip: "8.8.8.8",
      });
      expect(res.requiresStepUp).toBe(false);
    });

    it("includes coordinates when supplied", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({
          allowed: false,
          ip: { allowed: true },
          geofence: { allowed: false, distanceKm: 900, radiusKm: 50 },
          requiresStepUp: true,
        }),
      );
      const res = await networkSecurityService.evaluateLogin(
        "8.8.8.8",
        -6.2,
        106.8,
      );
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/evaluate-login`, {
        ip: "8.8.8.8",
        latitude: -6.2,
        longitude: 106.8,
      });
      expect(res.requiresStepUp).toBe(true);
    });
  });
});
