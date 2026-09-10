jest.mock("../../services/search.service", () => ({
  search: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn((res, data, meta, message, status) => {
    res.status(status || 200).json({ success: true, data, message });
  }),
}));

const searchController = require("../../controllers/search.controller");
const searchService = require("../../services/search.service");

describe("search Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { params: {}, body: {}, query: {}, user: { id: "user-1", tenantId: "tenant-1" } };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    next = jest.fn();
  });

  describe("search", () => {
    it("should search without types", async () => {
      req.query = { q: "test", limit: 10 };
      searchService.search.mockResolvedValue([]);
      await searchController.search(req, res, next);
      expect(searchService.search).toHaveBeenCalledWith("tenant-1", { q: "test", types: undefined, limit: 10 });
      expect(res.json).toHaveBeenCalled();
    });

    it("should search with comma-separated types", async () => {
      req.query = { q: "test", types: "device,stock", limit: 5 };
      searchService.search.mockResolvedValue([]);
      await searchController.search(req, res, next);
      expect(searchService.search).toHaveBeenCalledWith("tenant-1", { q: "test", types: ["device", "stock"], limit: 5 });
    });

    it("should filter empty types", async () => {
      req.query = { q: "test", types: "device,,stock,", limit: 5 };
      searchService.search.mockResolvedValue([]);
      await searchController.search(req, res, next);
      expect(searchService.search).toHaveBeenCalledWith("tenant-1", { q: "test", types: ["device", "stock"], limit: 5 });
    });

    it("should handle errors", async () => {
      req.query = { q: "test" };
      searchService.search.mockRejectedValue(new Error("err"));
      await searchController.search(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});