import { searchErrorMessage, searchService } from "./search.service";
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

  // A-56: the text GlobalSearch shows for a failed search.
  describe("searchErrorMessage", () => {
    it("names the failure and quotes the request id from the error body", () => {
      const err = Object.assign(new Error("An unexpected error occurred."), {
        response: { data: { requestId: "req-9" } },
      });
      expect(searchErrorMessage(err)).toBe(
        "Search failed: An unexpected error occurred. (reference req-9)",
      );
    });

    it("omits the reference when there is no string request id", () => {
      const err = Object.assign(new Error("boom"), {
        response: { data: { requestId: 42 } },
      });
      expect(searchErrorMessage(err)).toBe("Search failed: boom");
      expect(searchErrorMessage(new Error("net down"))).toBe("Search failed: net down");
    });

    it("falls back to a generic detail for a non-Error or an empty message", () => {
      expect(searchErrorMessage("nope")).toBe("Search failed: Unknown error");
      expect(searchErrorMessage(null)).toBe("Search failed: Unknown error");
      expect(searchErrorMessage(new Error(""))).toBe("Search failed: Unknown error");
    });
  });
});
