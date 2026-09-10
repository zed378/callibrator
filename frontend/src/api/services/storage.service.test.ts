import { storageService } from "./storage.service";
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

const BASE = "/api/v1/storage";

describe("storageService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getSettings", () => {
    it("GETs settings and unwraps data", async () => {
      const settings = { provider: "s3", usingPlatformDefault: false };
      mockedApi.get.mockResolvedValueOnce(envelope(settings));
      const res = await storageService.getSettings();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/settings`);
      expect(res).toEqual(settings);
    });
  });

  describe("updateSettings", () => {
    it("PUTs the input and unwraps data", async () => {
      const input = { provider: "s3" as const, bucket: "b", region: "us-east-1" };
      const settings = { provider: "s3", usingPlatformDefault: false };
      mockedApi.put.mockResolvedValueOnce(envelope(settings));
      const res = await storageService.updateSettings(input);
      expect(mockedApi.put).toHaveBeenCalledWith(`${BASE}/settings`, input);
      expect(res).toEqual(settings);
    });
  });

  describe("clearSettings", () => {
    it("DELETEs settings and unwraps data", async () => {
      const settings = { provider: "default", usingPlatformDefault: true };
      mockedApi.delete.mockResolvedValueOnce(envelope(settings));
      const res = await storageService.clearSettings();
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/settings`);
      expect(res).toEqual(settings);
    });
  });

  describe("testConnection", () => {
    it("POSTs an empty body to the test path and unwraps data", async () => {
      const health = { ok: true, driver: "s3" };
      mockedApi.post.mockResolvedValueOnce(envelope(health));
      const res = await storageService.testConnection();
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/settings/test`, {});
      expect(res).toEqual(health);
    });
  });

  describe("getUsage", () => {
    it("GETs usage and unwraps data", async () => {
      const usage = { bytes: 100, objects: 2, megabytes: 0, provider: "s3" };
      mockedApi.get.mockResolvedValueOnce(envelope(usage));
      const res = await storageService.getUsage();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/usage`);
      expect(res).toEqual(usage);
    });
  });

  describe("getObject", () => {
    it("GETs the object with key/token params as a blob", async () => {
      const blob = new Blob(["x"]);
      mockedApi.get.mockResolvedValueOnce(blob);
      const res = await storageService.getObject("k1", "tok");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/object`, {
        params: { key: "k1", token: "tok" },
        responseType: "blob",
      });
      expect(res).toBe(blob);
    });
  });
});
