import { quotaService } from "./quota.service";
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

const BASE = "/api/v1/quota";

describe("quotaService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getQuota", () => {
    it("GETs /api/v1/quota and unwraps the quota in data", async () => {
      const quota = {
        plan: "professional",
        status: "active",
        features: ["reports", "risk"],
        seats: { used: 3, limit: 10 },
        storage: { usedMb: 200, limitMb: 5000 },
      };
      mockedApi.get.mockResolvedValueOnce(envelope(quota));

      const res = await quotaService.getQuota();

      expect(mockedApi.get).toHaveBeenCalledWith(BASE);
      expect(res).toEqual(quota);
    });
  });
});
