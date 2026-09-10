import { riskService } from "./risk.service";
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

const BASE = "/api/v1/risk";

describe("riskService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("list", () => {
    it("GETs with params and unwraps the array in data", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope([{ id: "r1", title: "Risk 1" }]),
      );

      const params = { status: "OPEN", category: "SAFETY", page: 1, limit: 20 };
      const res = await riskService.list(params);

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, { params });
      expect(res).toHaveLength(1);
    });

    it("passes params as undefined when none given", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([]));

      await riskService.list();

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, { params: undefined });
    });
  });

  describe("getById", () => {
    it("GETs one risk by id", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "r1" }));

      const res = await riskService.getById("r1");

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/r1`);
      expect(res.id).toBe("r1");
    });
  });

  describe("create", () => {
    it("POSTs the input body and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "r1" }));

      const input = { title: "New risk", severity: 4, likelihood: 3 };
      const res = await riskService.create(input);

      expect(mockedApi.post).toHaveBeenCalledWith(BASE, input);
      expect(res.id).toBe("r1");
    });
  });

  describe("update", () => {
    it("PUTs a partial by id", async () => {
      mockedApi.put.mockResolvedValueOnce(envelope({ id: "r1" }));

      await riskService.update("r1", { status: "MITIGATED" });

      expect(mockedApi.put).toHaveBeenCalledWith(`${BASE}/r1`, {
        status: "MITIGATED",
      });
    });
  });

  describe("delete", () => {
    it("DELETEs by id and resolves void", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));

      const res = await riskService.delete("r1");

      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/r1`);
      expect(res).toBeUndefined();
    });
  });
});
