import { supplierScorecardService } from "./supplierScorecard.service";
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

const BASE = "/api/v1/supplier-scorecard";

describe("supplierScorecardService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("list", () => {
    it("GETs the collection with params and unwraps the data array", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "sc1" }]));
      const params = { vendorId: "v1", status: "APPROVED" };
      const res = await supplierScorecardService.list(params);
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, { params });
      expect(res).toEqual([{ id: "sc1" }]);
    });

    it("passes undefined params through when none given", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([]));
      const res = await supplierScorecardService.list();
      expect(mockedApi.get).toHaveBeenCalledWith(BASE, { params: undefined });
      expect(res).toEqual([]);
    });
  });

  describe("getById", () => {
    it("GETs one scorecard and unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "sc1" }));
      const res = await supplierScorecardService.getById("sc1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/sc1`);
      expect(res).toEqual({ id: "sc1" });
    });
  });

  describe("create", () => {
    it("POSTs the body and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "sc1" }));
      const input = { vendorId: "v1", evaluationDate: "2026-01-01", qualityScore: 90 };
      const res = await supplierScorecardService.create(input);
      expect(mockedApi.post).toHaveBeenCalledWith(BASE, input);
      expect(res).toEqual({ id: "sc1" });
    });
  });

  describe("update", () => {
    it("PUTs a partial by id and unwraps data", async () => {
      mockedApi.put.mockResolvedValueOnce(envelope({ id: "sc1" }));
      const res = await supplierScorecardService.update("sc1", { qualityScore: 80 });
      expect(mockedApi.put).toHaveBeenCalledWith(`${BASE}/sc1`, {
        qualityScore: 80,
      });
      expect(res).toEqual({ id: "sc1" });
    });
  });

  describe("delete", () => {
    it("DELETEs by id and returns void", async () => {
      mockedApi.delete.mockResolvedValueOnce(undefined);
      const res = await supplierScorecardService.delete("sc1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/sc1`);
      expect(res).toBeUndefined();
    });
  });
});
