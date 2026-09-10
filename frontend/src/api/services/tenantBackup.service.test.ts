import { tenantBackupService } from "./tenantBackup.service";
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
const envelope = <T,>(data: T, meta?: unknown) => ({
  success: true,
  status: 200,
  message: "ok",
  data,
  ...(meta !== undefined ? { meta } : {}),
});

const TID = "t1";
const BASE = `/api/v1/tenants/${TID}/backups`;

describe("tenantBackupService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("create", () => {
    it("POSTs the payload and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "b1" }));
      const input = { name: "nightly", backupType: "FULL" as const };
      const res = await tenantBackupService.create(TID, input);
      expect(mockedApi.post).toHaveBeenCalledWith(BASE, input);
      expect(res).toEqual({ id: "b1" });
    });
  });

  describe("getAll", () => {
    it("passes page/limit/status params and returns rows + top-level meta", async () => {
      const meta = { total: 1, page: 2, limit: 10, totalPages: 1 };
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "b1" }], meta));
      const res = await tenantBackupService.getAll(TID, 2, 10, "COMPLETED");
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 2, limit: 10, status: "COMPLETED" },
      });
      expect(res.data).toHaveLength(1);
      expect(res.meta).toEqual(meta);
    });

    it("falls back to [] rows and synthesized meta when data is null and meta missing", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      const res = await tenantBackupService.getAll(TID);
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 1, limit: 20, status: undefined },
      });
      expect(res.data).toEqual([]);
      expect(res.meta).toEqual({ total: 0, page: 1, limit: 20, totalPages: 1 });
    });
  });

  describe("getById", () => {
    it("GETs one backup and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "b1" }));
      const res = await tenantBackupService.getById(TID, "b1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/b1`);
      expect(res).toEqual({ id: "b1" });
    });
  });

  describe("download", () => {
    it("requests the download URL as a blob and returns the raw blob", async () => {
      const blob = new Blob(["zip"]);
      mockedApi.get.mockResolvedValueOnce(blob);
      const res = await tenantBackupService.download(TID, "b1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/b1/download`, {
        responseType: "blob",
      });
      expect(res).toBe(blob);
    });
  });

  describe("restore", () => {
    it("maps overwriteExisting:false to mergeData:true and returns success/message", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope(null));
      const res = await tenantBackupService.restore(TID, "b1", {
        overwriteExisting: false,
      });
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/b1/restore`, {
        mergeData: true,
      });
      expect(res).toEqual({ success: true, message: "ok" });
    });

    it("defaults mergeData to false when no options given", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope(null));
      await tenantBackupService.restore(TID, "b1");
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/b1/restore`, {
        mergeData: false,
      });
    });
  });

  describe("delete", () => {
    it("DELETEs by id", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await tenantBackupService.delete(TID, "b1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/b1`);
    });
  });

  describe("getStats", () => {
    it("GETs the stats endpoint and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ totalBackups: 3 }));
      const res = await tenantBackupService.getStats(TID);
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/stats`);
      expect(res).toEqual({ totalBackups: 3 });
    });
  });
});
