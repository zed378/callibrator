jest.mock("../../services/search.service", () => ({
  search: jest.fn(),
  TYPE_MENUS: { device: "calibration", stock: "warehouse", certificate: "certificate" },
}));

// The gate is exercised for real in search.permissions.a04.test.js. Here it is
// replaced by a list of menus the caller may read, so these cases can focus on
// the controller's own job: parsing the query and passing on only the types
// the gate allowed.
let readableMenus = ["calibration", "warehouse", "certificate"];
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: jest.fn((menu) => (req, res, next) => {
    if (readableMenus.includes(menu)) {
      return next();
    }
    return res.status(403).json({ success: false });
  }),
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
    readableMenus = ["calibration", "warehouse", "certificate"];
    req = { params: {}, body: {}, query: {}, user: { id: "user-1", tenantId: "tenant-1" } };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    next = jest.fn();
  });

  describe("search", () => {
    it("should search every permitted type when none is requested", async () => {
      req.query = { q: "test", limit: 10 };
      searchService.search.mockResolvedValue([]);
      await searchController.search(req, res, next);
      expect(searchService.search).toHaveBeenCalledWith("tenant-1", {
        q: "test",
        types: ["device", "stock", "certificate"],
        limit: 10,
      });
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

    it("should drop a requested type the caller may not read", async () => {
      readableMenus = ["warehouse"];
      req.query = { q: "test", types: "device,stock", limit: 5 };
      searchService.search.mockResolvedValue([]);
      await searchController.search(req, res, next);
      expect(searchService.search).toHaveBeenCalledWith("tenant-1", { q: "test", types: ["stock"], limit: 5 });
    });

    it("should pass an empty type list when the caller may read nothing", async () => {
      readableMenus = [];
      req.query = { q: "test" };
      searchService.search.mockResolvedValue([]);
      await searchController.search(req, res, next);
      expect(searchService.search).toHaveBeenCalledWith("tenant-1", { q: "test", types: [], limit: undefined });
    });

    it("should handle errors", async () => {
      req.query = { q: "test" };
      searchService.search.mockRejectedValue(new Error("err"));
      await searchController.search(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
