import { searchService } from "./search.service";
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

const BASE = "/api/v1/search";

describe("searchService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("search", () => {
    it("joins types into a CSV param and passes q + limit", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ query: "cal", total: 1, results: [], byType: {} }),
      );

      const res = await searchService.search("cal", ["device", "stock"], 25);

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { q: "cal", types: "device,stock", limit: 25 },
      });
      expect(res.query).toBe("cal");
    });

    it("sends types as undefined when the array is empty, limit undefined when falsy", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ query: "x", total: 0, results: [], byType: {} }),
      );

      await searchService.search("x", []);

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { q: "x", types: undefined, limit: undefined },
      });
    });

    it("sends types undefined when the arg is omitted", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ query: "y", total: 0, results: [], byType: {} }),
      );

      await searchService.search("y");

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { q: "y", types: undefined, limit: undefined },
      });
    });
  });
});
