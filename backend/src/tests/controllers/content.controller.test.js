/**
 * Tests for content.controller.js
 */

jest.mock("../../services/content.service", () => ({
  listPosts: jest.fn(),
  getPostById: jest.fn(),
  createPost: jest.fn(),
  updatePost: jest.fn(),
  deletePost: jest.fn(),
  checkSlug: jest.fn(),
  listPublishedPosts: jest.fn(),
  getPublishedPostBySlug: jest.fn(),
  listCategories: jest.fn(),
  createCategory: jest.fn(),
  updateCategory: jest.fn(),
  deleteCategory: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const contentService = require("../../services/content.service");
const contentController = require("../../controllers/content.controller");
const { success } = require("../../utils/response.util");

const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";

describe("contentController", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    req = {
      query: {},
      params: {},
      body: {},
      user: { id: VALID_USER_ID, tenantId: VALID_TENANT_ID },
      ip: "127.0.0.1",
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("listPosts", () => {
    it("should return paginated posts", async () => {
      req.query = { page: "1", limit: "10", type: "article", status: "draft" };
      const mockResult = {
        success: true,
        status: 200,
        message: "Fetch posts successful",
        data: {
          rows: [{ id: "post-1", title: "Test Post" }],
          meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
        },
      };
      contentService.listPosts.mockResolvedValue(mockResult);

      await contentController.listPosts(req, res, next);

      expect(contentService.listPosts).toHaveBeenCalledWith(req.query);
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("getPost", () => {
    it("should return a specific post", async () => {
      req.params = { id: "post-1" };
      contentService.getPostById.mockResolvedValue({
        success: true,
        status: 200,
        message: "Post retrieved successfully",
        data: { id: "post-1", title: "Test Post" },
      });

      await contentController.getPost(req, res, next);

      expect(contentService.getPostById).toHaveBeenCalledWith("post-1");
      expect(success).toHaveBeenCalled();
    });
  });

  describe("createPost", () => {
    it("should create a post with valid data", async () => {
      req.body = {
        title: "Test Post",
        slug: "test-post",
        contentHtml: "<p>Hello</p>",
        status: "DRAFT",
        categoryIds: ["cat-1"],
      };
      contentService.createPost.mockResolvedValue({
        success: true,
        status: 201,
        message: "Post created successfully",
        data: { id: "post-new", title: "Test Post" },
      });

      await contentController.createPost(req, res, next);

      expect(contentService.createPost).toHaveBeenCalledWith(req.body, VALID_USER_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("updatePost", () => {
    it("should update a post", async () => {
      req.params = { id: "post-1" };
      req.body = { title: "Updated Post" };
      contentService.updatePost.mockResolvedValue({
        success: true,
        status: 200,
        message: "Post updated successfully",
        data: { id: "post-1", title: "Updated Post" },
      });

      await contentController.updatePost(req, res, next);

      expect(contentService.updatePost).toHaveBeenCalledWith("post-1", req.body);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deletePost", () => {
    it("should delete a post", async () => {
      req.params = { id: "post-1" };
      contentService.deletePost.mockResolvedValue({
        success: true,
        status: 200,
        message: "Post deleted successfully",
      });

      await contentController.deletePost(req, res, next);

      expect(contentService.deletePost).toHaveBeenCalledWith("post-1");
      expect(success).toHaveBeenCalled();
    });
  });

  describe("checkSlug", () => {
    it("should check slug availability", async () => {
      req.query = { slug: "test-post", excludeId: "post-1" };
      contentService.checkSlug.mockResolvedValue({
        success: true,
        status: 200,
        message: "OK",
        data: { slug: "test-post", available: true, suggestion: "test-post" },
      });

      await contentController.checkSlug(req, res, next);

      expect(contentService.checkSlug).toHaveBeenCalledWith("test-post", "post-1");
      expect(success).toHaveBeenCalled();
    });
  });

  describe("listPublishedPosts", () => {
    it("should return published posts", async () => {
      req.query = { page: "1", limit: "10" };
      contentService.listPublishedPosts.mockResolvedValue({
        success: true,
        status: 200,
        message: "OK",
        data: {
          rows: [{ id: "post-1", title: "Published Post" }],
          meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
        },
      });

      await contentController.listPublishedPosts(req, res, next);

      expect(contentService.listPublishedPosts).toHaveBeenCalledWith(req.query);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getPublishedPost", () => {
    it("should return a published post by slug", async () => {
      req.params = { slug: "test-slug" };
      contentService.getPublishedPostBySlug.mockResolvedValue({
        success: true,
        status: 200,
        message: "OK",
        data: { id: "post-1", slug: "test-slug" },
      });

      await contentController.getPublishedPost(req, res, next);

      expect(contentService.getPublishedPostBySlug).toHaveBeenCalledWith("test-slug");
      expect(success).toHaveBeenCalled();
    });
  });

  describe("listCategories", () => {
    it("should return all categories", async () => {
      contentService.listCategories.mockResolvedValue({
        success: true,
        status: 200,
        message: "OK",
        data: [
          { id: "cat-1", name: "Technology" },
        ],
      });

      await contentController.listCategories(req, res, next);

      expect(contentService.listCategories).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
    });
  });

  describe("createCategory", () => {
    it("should create a category with valid data", async () => {
      req.body = { name: "Technology", slug: "technology" };
      contentService.createCategory.mockResolvedValue({
        success: true,
        status: 201,
        message: "Category created successfully",
        data: { id: "cat-1", name: "Technology" },
      });

      await contentController.createCategory(req, res, next);

      expect(contentService.createCategory).toHaveBeenCalledWith(req.body);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("updateCategory", () => {
    it("should update a category", async () => {
      req.params = { id: "cat-1" };
      req.body = { name: "Updated Category" };
      contentService.updateCategory.mockResolvedValue({
        success: true,
        status: 200,
        message: "Category updated successfully",
        data: { id: "cat-1", name: "Updated Category" },
      });

      await contentController.updateCategory(req, res, next);

      expect(contentService.updateCategory).toHaveBeenCalledWith("cat-1", req.body);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deleteCategory", () => {
    it("should delete a category", async () => {
      req.params = { id: "cat-1" };
      contentService.deleteCategory.mockResolvedValue({
        success: true,
        status: 200,
        message: "Category deleted successfully",
      });

      await contentController.deleteCategory(req, res, next);

      expect(contentService.deleteCategory).toHaveBeenCalledWith("cat-1");
      expect(success).toHaveBeenCalled();
    });
  });
});
