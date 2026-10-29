jest.mock("../../services/search.service", () => ({
  search: jest.fn(),
  TYPE_MENUS: { device: "calibration", stock: "warehouse", certificate: "certificate" },
}));

interface FakeReq {
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  body: Record<string, unknown>;
  user?: Record<string, unknown> | null;
  file?: unknown;
  files?: unknown;
  headers?: Record<string, unknown>;
  ip?: string;
  protocol?: string;
  get?: jest.Mock;
  validated?: unknown;
}

interface FakeRes {
  status: jest.Mock;
  json: jest.Mock;
}

// The gate is exercised for real in search.permissions.a04.test.js. Here it is
// replaced by a list of menus the caller may read, so these cases can focus on
// the controller's own job: parsing the query and passing on only the types
// the gate allowed.
let readableMenus = ["calibration", "warehouse", "certificate"];
// Menus whose check FAILS: the real gate hands the error to next(err) (A-13).
let failingMenus: string[] = [];
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: jest.fn((menu: string) => (_req: FakeReq, res: FakeRes, next: (err?: unknown) => void) => {
    if (failingMenus.includes(menu)) {
      next(new Error("permission store down"));
      return;
    }
    if (readableMenus.includes(menu)) {
      next();
      return;
    }
    (res.status(403) as FakeRes).json({ success: false });
  }),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn((res: FakeRes, data: unknown, _meta: unknown, message: unknown, status?: number) => {
    res.status(status ?? 200);
    res.json({ success: true, data, message });
  }),
}));

type Handler = (req: FakeReq, res: FakeRes, next: jest.Mock) => Promise<unknown>;

interface SearchControllerDouble {
  search: Handler;
}

interface SearchServiceDouble {
  search: jest.Mock;
  TYPE_MENUS: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const searchController = require("../../controllers/search.controller") as SearchControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const searchService = require("../../services/search.service") as SearchServiceDouble;

describe("search Controller", () => {
  let req: FakeReq;
  let res: FakeRes;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    readableMenus = ["calibration", "warehouse", "certificate"];
    failingMenus = [];
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

    it("should drop a type whose permission check fails with next(err) (A-13)", async () => {
      // Only a bare next() means allowed. The menu is also in readableMenus
      // so the ONLY thing keeping "device" out is the error argument.
      failingMenus = ["calibration"];
      req.query = { q: "test" };
      searchService.search.mockResolvedValue([]);
      await searchController.search(req, res, next);
      expect(searchService.search).toHaveBeenCalledWith("tenant-1", {
        q: "test",
        types: ["stock", "certificate"],
        limit: undefined,
      });
      // The probe consumes the error; it is not forwarded as a request failure.
      expect(next).not.toHaveBeenCalled();
    });

    it("should handle errors", async () => {
      req.query = { q: "test" };
      searchService.search.mockRejectedValue(new Error("err"));
      await searchController.search(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
