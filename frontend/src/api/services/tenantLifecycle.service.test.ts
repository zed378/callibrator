import { tenantLifecycleService } from "./tenantLifecycle.service";
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

const TID = "t1";
const BASE = `/api/v1/tenants/${TID}`;

describe("tenantLifecycleService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getStatus", () => {
    it("GETs /status and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ tenantId: TID, status: "ACTIVE" }));
      const res = await tenantLifecycleService.getStatus(TID);
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/status`);
      expect(res).toEqual({ tenantId: TID, status: "ACTIVE" });
    });
  });

  describe("suspend", () => {
    it("POSTs /suspend with tenantId and reason", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ status: "SUSPENDED" }));
      const res = await tenantLifecycleService.suspend(TID, "nonpayment");
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/suspend`, {
        tenantId: TID,
        reason: "nonpayment",
      });
      expect(res).toEqual({ status: "SUSPENDED" });
    });
  });

  describe("resume", () => {
    it("POSTs /resume with no body", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ status: "ACTIVE" }));
      await tenantLifecycleService.resume(TID);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/resume`);
    });
  });

  describe("enterGracePeriod", () => {
    it("POSTs /grace-period with no body", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ status: "ACTIVE" }));
      await tenantLifecycleService.enterGracePeriod(TID);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/grace-period`);
    });
  });

  describe("offboard", () => {
    it("POSTs /offboard with force flag and unwraps { tenant, exportData }", async () => {
      const payload = { tenant: { status: "OFFBOARDED" }, exportData: { exportedAt: "x", tenant: {} } };
      mockedApi.post.mockResolvedValueOnce(envelope(payload));
      const res = await tenantLifecycleService.offboard(TID, true);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/offboard`, { force: true });
      expect(res).toEqual(payload);
    });

    it("passes force:undefined when omitted", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ tenant: {}, exportData: {} }));
      await tenantLifecycleService.offboard(TID);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/offboard`, { force: undefined });
    });
  });

  describe("cancelOffboarding", () => {
    it("POSTs /offboard/cancel", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ status: "ACTIVE" }));
      await tenantLifecycleService.cancelOffboarding(TID);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/offboard/cancel`);
    });
  });

  describe("exportData", () => {
    it("GETs /export and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ exportedAt: "x", tenant: {} }));
      const res = await tenantLifecycleService.exportData(TID);
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/export`);
      expect(res).toEqual({ exportedAt: "x", tenant: {} });
    });
  });
});
