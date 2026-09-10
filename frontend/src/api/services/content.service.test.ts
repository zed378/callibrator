import { contentService } from "./content.service";
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

describe("contentService.posts", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("GETs posts with page/limit + spread filters and unwraps data with top-level meta", async () => {
      mockedApi.get.mockResolvedValueOnce({
        success: true,
        message: "ok",
        data: [{ id: "p1" }],
        meta: { total: 3, page: 2, limit: 10, totalPages: 1 },
      });

      const res = await contentService.posts.getAll(2, 10, {
        type: "BLOG",
        status: "PUBLISHED",
      });

      expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/content/posts", {
        params: { page: 2, limit: 10, type: "BLOG", status: "PUBLISHED" },
      });
      expect(res.data).toEqual([{ id: "p1" }]);
      expect(res.meta).toEqual({
        total: 3,
        page: 2,
        limit: 10,
        totalPages: 1,
      });
    });

    it("returns [] and computed meta when data is null", async () => {
      mockedApi.get.mockResolvedValueOnce({
        success: true,
        message: "",
        data: null,
      });

      const res = await contentService.posts.getAll();

      expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/content/posts", {
        params: { page: 1, limit: 20 },
      });
      expect(res.data).toEqual([]);
      expect(res.meta).toEqual({ total: 0, page: 1, limit: 20, totalPages: 1 });
    });
  });

  describe("get", () => {
    it("GETs one post and returns data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "p1" }));
      const res = await contentService.posts.get("p1");
      expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/content/posts/p1");
      expect(res).toEqual({ id: "p1" });
    });
  });

  describe("create", () => {
    it("POSTs the input and returns data", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "p1" }));
      const input = { type: "NEWS" as const, title: "Hello" };
      const res = await contentService.posts.create(input);
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/api/v1/content/posts",
        input,
      );
      expect(res).toEqual({ id: "p1" });
    });
  });

  describe("update", () => {
    it("PATCHes a partial to /:id", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "p1" }));
      await contentService.posts.update("p1", { title: "Renamed" });
      expect(mockedApi.patch).toHaveBeenCalledWith("/api/v1/content/posts/p1", {
        title: "Renamed",
      });
    });
  });

  describe("remove", () => {
    it("DELETEs by id", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await contentService.posts.remove("p1");
      expect(mockedApi.delete).toHaveBeenCalledWith("/api/v1/content/posts/p1");
    });
  });

  describe("checkSlug", () => {
    it("GETs slug-check with slug + excludeId and returns data", async () => {
      const data = { slug: "hi", available: true, suggestion: "hi" };
      mockedApi.get.mockResolvedValueOnce(envelope(data));
      const res = await contentService.posts.checkSlug("hi", "p1");
      expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/content/slug-check", {
        params: { slug: "hi", excludeId: "p1" },
      });
      expect(res).toEqual(data);
    });
  });
});

describe("contentService.categories", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("GETs categories and returns the array", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "cat1" }]));
      const res = await contentService.categories.getAll();
      expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/content/categories");
      expect(res).toEqual([{ id: "cat1" }]);
    });

    it("returns [] when data is not an array", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      await expect(contentService.categories.getAll()).resolves.toEqual([]);
    });
  });

  describe("create", () => {
    it("POSTs the category input", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "cat1" }));
      const input = { name: "Ops" };
      await contentService.categories.create(input);
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/api/v1/content/categories",
        input,
      );
    });
  });

  describe("update", () => {
    it("PATCHes a partial to /:id", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope({ id: "cat1" }));
      await contentService.categories.update("cat1", { name: "New" });
      expect(mockedApi.patch).toHaveBeenCalledWith(
        "/api/v1/content/categories/cat1",
        { name: "New" },
      );
    });
  });

  describe("remove", () => {
    it("DELETEs by id", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await contentService.categories.remove("cat1");
      expect(mockedApi.delete).toHaveBeenCalledWith(
        "/api/v1/content/categories/cat1",
      );
    });
  });
});
