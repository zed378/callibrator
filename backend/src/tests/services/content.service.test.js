/**
 * Tests for content.service.js
 *
 * Covers: listPosts, getPostById, createPost, updatePost, deletePost,
 * checkSlug, listPublishedPosts, getPublishedPostBySlug,
 * listCategories, createCategory, updateCategory, deleteCategory
 */

jest.mock("../../config", () => ({
  Sequelize: { useCLS: jest.fn() },
  db: {
    transaction: jest.fn(),
  },
}));

jest.mock("sanitize-html", () => {
  const mockDefaults = {
    allowedTags: ["p", "b", "i", "em", "strong", "a", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "br", "img", "div", "span", "code", "pre", "blockquote", "figure", "figcaption", "u", "s", "table", "thead", "tbody", "tr", "td", "th"],
  };
  const mock = (html, _opts) => String(html || "");
  mock.defaults = mockDefaults;
  mock.simpleTransform = (tag, attrs) => (() => ({ tag, attribs: attrs || {} }));
  return mock;
});

jest.mock("../../constants", () => ({
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
}));

jest.mock("../../models", () => ({
  Post: {
    findByPk: jest.fn(),
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    softDelete: jest.fn(),
    unscoped: jest.fn(function () { return this; }),
  },
  Category: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    unscoped: jest.fn(function () { return this; }),
  },
}));

jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "AppError";
      this.status = status;
    }
  }
  return { AppError };
});

const { Post, Category } = require("../../models");
const { db } = require("../../config");
const contentService = require("../../services/content.service");
const { Op } = require("sequelize");

// ---------- helpers ----------
const mockPost = (extra = {}) => {
  const post = {
    id: "p-1",
    type: "ARTICLE",
    title: "Test Post",
    slug: "test-post",
    excerpt: "Excerpt",
    coverImageUrl: "/cover.jpg",
    publishedAt: new Date(),
    authorName: "Author",
    authorRole: "Admin",
    readingMinutes: 3,
    featured: false,
    status: "DRAFT",
    contentHtml: "<p>Body</p>",
    ...extra,
    toJSON() {
      return { ...this };
    },
  };
  return post;
};

const mockCategory = (id = "c-1", name = "Tech", slug = "tech") => ({
  id,
  name,
  slug,
  toJSON() {
    return { id: this.id, name: this.name, slug: this.slug };
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  // Provide a fresh transaction object for each test (avoids rollback/commit undefined).
  db.transaction.mockResolvedValue({ commit: jest.fn(), rollback: jest.fn() });
});

// =========================
// POSTS — admin
// =========================

describe("listPosts", () => {
  it("should return paginated posts", async () => {
    Post.findAndCountAll.mockResolvedValue({
      count: 3,
      rows: [mockPost({ id: "p-1" }), mockPost({ id: "p-2" })],
    });

    const result = await contentService.listPosts({ page: 1, limit: 10 });

    expect(result.success).toBe(true);
    expect(result.data.rows.length).toBe(2);
    expect(result.data.meta.total).toBe(3);
    expect(Post.findAndCountAll).toHaveBeenCalled();
  });

  it("should filter by type and status", async () => {
    Post.findAndCountAll.mockResolvedValue({ count: 1, rows: [] });

    await contentService.listPosts({ type: "ARTICLE", status: "PUBLISHED" });

    expect(Post.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "ARTICLE", status: "PUBLISHED" }),
      }),
    );
  });

  it("should filter by category", async () => {
    Post.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

    await contentService.listPosts({ category: "tech" });

    expect(Post.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({
        include: [expect.objectContaining({ required: true })],
      }),
    );
  });

  it("should return error object when query fails", async () => {
    Post.findAndCountAll.mockRejectedValue(new Error("DB error"));

    await expect(contentService.listPosts({})).rejects.toMatchObject({ status: 500 });
  });
});

describe("getPostById", () => {
  it("should return post with categories", async () => {
    const p = mockPost();
    p.categories = [mockCategory()];
    Post.findByPk.mockResolvedValue(p);

    const result = await contentService.getPostById("p-1");

    expect(result.success).toBe(true);
    expect(result.data.title).toBe("Test Post");
  });

  it("should throw 404 when post not found", async () => {
    Post.findByPk.mockResolvedValue(null);

    await expect(contentService.getPostById("nonexistent")).rejects.toMatchObject({
      status: 404,
      message: "Post not found",
    });
  });
});

describe("createPost", () => {
  it("should create a post and return it", async () => {
    const created = mockPost({ id: "p-pub", status: "PUBLISHED", title: "Pub Post" });
    created.setCategories = jest.fn().mockResolvedValue(true);
    Post.create.mockResolvedValue(created);
    // ensureUniqueSlug uses Post.unscoped().findOne -> returns undefined (unique)
    Post.unscoped.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
    Post.findByPk.mockResolvedValue(created);

    const result = await contentService.createPost(
      { title: "Pub Post", contentHtml: "<p>Hi</p>", status: "PUBLISHED", categoryIds: ["c-1"] },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(Post.create).toHaveBeenCalled();
    expect(created.setCategories).toHaveBeenCalled();
    expect(result.data.title).toBe("Pub Post");
  });

  it("should stamp publishedAt when publishing", async () => {
    const created = mockPost({ id: "p-pub", status: "PUBLISHED", title: "Pub Post" });
    created.setCategories = jest.fn().mockResolvedValue(true);
    Post.create.mockResolvedValue(created);
    Post.unscoped.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
    Post.findByPk.mockResolvedValue(created);

    const result = await contentService.createPost(
      { title: "Pub Post", contentHtml: "<p>Hi</p>", status: "PUBLISHED", categoryIds: ["c-1"] },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(Post.create).toHaveBeenCalled();
    expect(created.setCategories).toHaveBeenCalled();
    expect(result.data.title).toBe("Pub Post");
  });

  it("should stamp publishedAt when publishing", async () => {
    const created = mockPost({ id: "p-pub", status: "PUBLISHED", title: "Pub Post" });
    created.setCategories = jest.fn().mockResolvedValue(true);
    Post.create.mockResolvedValue(created);
    Post.unscoped.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
    Post.findByPk.mockResolvedValue(created);

    await contentService.createPost(
      { title: "Pub Post", contentHtml: "<p>Hi</p>", status: "PUBLISHED", categoryIds: ["c-1"] },
      "user-1",
    );

    const callArgs = Post.create.mock.calls[0][0];
    expect(callArgs.publishedAt).toBeDefined();
  });
});

describe("updatePost", () => {
  it("should update post fields", async () => {
    const p = mockPost();
    p.update = jest.fn(function (patch) {
      Object.assign(p, patch);
      return Promise.resolve(p);
    });
    // Both the initial fetch and the re-fetch return the same (mutated) object.
    Post.findByPk.mockResolvedValue(p);

    const result = await contentService.updatePost("p-1", { title: "Updated" });

    expect(result.success).toBe(true);
    expect(result.data.title).toBe("Updated");
  });

  it("should throw 404 when post not found", async () => {
    Post.findByPk.mockResolvedValue(null);

    await expect(contentService.updatePost("nonexistent", { title: "x" })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("deletePost", () => {
  it("should soft-delete the post", async () => {
    const p = mockPost();
    p.softDelete = jest.fn().mockResolvedValue({});
    Post.findByPk.mockResolvedValue(p);

    const result = await contentService.deletePost("p-1");

    expect(result.success).toBe(true);
    expect(p.softDelete).toHaveBeenCalled();
  });

  it("should throw 404 when post not found", async () => {
    Post.findByPk.mockResolvedValue(null);

    await expect(contentService.deletePost("nonexistent")).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("checkSlug", () => {
  it("should return available: true when slug is free", async () => {
    Post.unscoped.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });

    const result = await contentService.checkSlug("my-awesome-post");

    expect(result.data.available).toBe(true);
    expect(result.data.slug).toBe("my-awesome-post");
  });

  it("should return available: false when slug is taken", async () => {
    // ensureUniqueSlug queries by slug; only the exact slug is "taken".
    Post.unscoped.mockReturnValue({
      findOne: jest.fn(({ where }) =>
        Promise.resolve(where.slug === "taken-slug" ? { id: "x" } : null),
      ),
    });

    const result = await contentService.checkSlug("taken-slug");

    expect(result.data.available).toBe(false);
    expect(result.data.suggestion).toBe("taken-slug-2");
  });

  it("should return slug 'post' for empty input (slugify fallback)", async () => {
    const result = await contentService.checkSlug("");

    expect(result.data.slug).toBe("post");
    expect(result.data.available).toBe(false);
  });
});

// =========================
// POSTS — public
// =========================

describe("listPublishedPosts", () => {
  it("should return only published posts", async () => {
    Post.findAndCountAll.mockResolvedValue({
      count: 2,
      rows: [mockPost({ id: "p-1" }), mockPost({ id: "p-2" })],
    });

    const result = await contentService.listPublishedPosts({ page: 1, limit: 10 });

    expect(result.success).toBe(true);
    expect(result.data.rows.length).toBe(2);
    expect(Post.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "PUBLISHED" }) }),
    );
  });
});

describe("getPublishedPostBySlug", () => {
  it("should return a published post by slug", async () => {
    const p = mockPost();
    Post.findOne.mockResolvedValue(p);

    const result = await contentService.getPublishedPostBySlug("test-post");

    expect(result.success).toBe(true);
    expect(result.data.title).toBe("Test Post");
  });

  it("should throw 404 when post not found", async () => {
    Post.findOne.mockResolvedValue(null);

    await expect(contentService.getPublishedPostBySlug("missing")).rejects.toMatchObject({
      status: 404,
    });
  });
});

// =========================
// CATEGORIES
// =========================

describe("listCategories", () => {
  it("should return all categories", async () => {
    Category.findAll.mockResolvedValue([mockCategory("c-1", "Tech", "tech"), mockCategory("c-2", "News", "news")]);

    const result = await contentService.listCategories();

    expect(result.success).toBe(true);
    expect(result.data.length).toBe(2);
    expect(result.data[0].name).toBe("Tech");
  });
});

describe("createCategory", () => {
  it("should create a category with unique slug", async () => {
    const cat = mockCategory("c-9", "New Cat", "new-cat");
    Category.create.mockResolvedValue(cat);
    Category.unscoped.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });

    const result = await contentService.createCategory({ name: "New Cat" });

    expect(result.success).toBe(true);
    expect(result.data.name).toBe("New Cat");
    expect(Category.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New Cat", slug: "new-cat" }),
    );
  });
});

describe("updateCategory", () => {
  it("should update category fields", async () => {
    const cat = mockCategory("c-1", "Tech", "tech");
    cat.update = jest.fn(function (patch) {
      Object.assign(cat, patch);
      return Promise.resolve(cat);
    });
    Category.findByPk.mockResolvedValue(cat);
    Category.unscoped.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });

    const result = await contentService.updateCategory("c-1", { name: "Tech Renamed" });

    expect(result.success).toBe(true);
    expect(result.data.name).toBe("Tech Renamed");
  });

  it("should throw 404 when category not found", async () => {
    Category.findByPk.mockResolvedValue(null);

    await expect(contentService.updateCategory("missing", { name: "x" })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("deleteCategory", () => {
  it("should soft-delete the category", async () => {
    const cat = mockCategory("c-1");
    cat.softDelete = jest.fn().mockResolvedValue({});
    Category.findByPk.mockResolvedValue(cat);

    const result = await contentService.deleteCategory("c-1");

    expect(result.success).toBe(true);
    expect(cat.softDelete).toHaveBeenCalled();
  });

  it("should throw 404 when category not found", async () => {
    Category.findByPk.mockResolvedValue(null);

    await expect(contentService.deleteCategory("missing")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("should surface a 500 when softDelete fails", async () => {
    const cat = mockCategory("c-1");
    cat.softDelete = jest.fn().mockRejectedValue(new Error("FK constraint"));
    Category.findByPk.mockResolvedValue(cat);

    await expect(contentService.deleteCategory("c-1")).rejects.toMatchObject({
      status: 500,
      message: "FK constraint",
    });
  });

  it("should default the message when softDelete rejects without one", async () => {
    const cat = mockCategory("c-1");
    cat.softDelete = jest.fn().mockRejectedValue(new Error(""));
    Category.findByPk.mockResolvedValue(cat);

    await expect(contentService.deleteCategory("c-1")).rejects.toEqual({
      status: 500,
      message: "Failed to delete category",
    });
  });
});

// =========================
// COVERAGE — pagination / defaults / error normalisation
// =========================

describe("listPosts — pagination and filters", () => {
  it("should apply DEFAULT_LIMIT and page 1 when neither is supplied", async () => {
    Post.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

    const result = await contentService.listPosts({});

    expect(Post.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 0 }),
    );
    expect(result.data.meta).toEqual({ total: 0, page: 1, limit: 10, totalPages: 1 });
  });

  it("should clamp limit to MAX_LIMIT and compute offset from page", async () => {
    Post.findAndCountAll.mockResolvedValue({ count: 250, rows: [] });

    const result = await contentService.listPosts({ page: 3, limit: 500 });

    // MAX_LIMIT (100) wins over the requested 500; offset = (3-1)*100.
    expect(Post.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100, offset: 200 }),
    );
    expect(result.data.meta).toEqual({ total: 250, page: 3, limit: 100, totalPages: 3 });
  });

  it("should treat page 0 as page 1", async () => {
    Post.findAndCountAll.mockResolvedValue({ count: 5, rows: [] });

    const result = await contentService.listPosts({ page: 0, limit: 10 });

    expect(Post.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0 }),
    );
    expect(result.data.meta.page).toBe(1);
  });

  it("should fall back to DEFAULT_LIMIT when limit is not a usable number", async () => {
    Post.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

    await contentService.listPosts({ limit: "abc" });

    expect(Post.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
  });

  it("should search titles with a LIKE filter when `find` is supplied", async () => {
    Post.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

    await contentService.listPosts({ find: "sensor" });

    expect(Post.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { title: { [Op.like]: "%sensor%" } },
      }),
    );
  });

  it("should pass rows through untouched when they have no toJSON", async () => {
    Post.findAndCountAll.mockResolvedValue({ count: 1, rows: [{ id: "plain" }] });

    const result = await contentService.listPosts({});

    expect(result.data.rows).toEqual([{ id: "plain" }]);
  });

  it("should preserve an error's own status and message", async () => {
    Post.findAndCountAll.mockRejectedValue(
      Object.assign(new Error("bad request"), { status: 422 }),
    );

    await expect(contentService.listPosts({})).rejects.toEqual({
      status: 422,
      message: "bad request",
    });
  });

  it("should default the message when the error carries none", async () => {
    Post.findAndCountAll.mockRejectedValue(new Error(""));

    await expect(contentService.listPosts({})).rejects.toEqual({
      status: 500,
      message: "Failed to fetch posts",
    });
  });
});

describe("getPostById — error normalisation", () => {
  it("should default the message when the lookup rejects without one", async () => {
    Post.findByPk.mockRejectedValue(new Error(""));

    await expect(contentService.getPostById("p-1")).rejects.toEqual({
      status: 500,
      message: "Failed to retrieve post",
    });
  });
});

// =========================
// COVERAGE — createPost
// =========================

describe("createPost — branches", () => {
  const setup = (created) => {
    Post.create.mockResolvedValue(created);
    Post.unscoped.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
    Post.findByPk.mockResolvedValue(created);
  };

  it("should derive the slug from an explicit slug field over the title", async () => {
    const created = mockPost();
    created.setCategories = jest.fn();
    setup(created);

    await contentService.createPost(
      { title: "Some Long Title", slug: "Chosen Slug", contentHtml: "<p>x</p>" },
      "u-1",
    );

    expect(Post.create.mock.calls[0][0].slug).toBe("chosen-slug");
  });

  it("should not call setCategories when categoryIds is omitted", async () => {
    const created = mockPost();
    created.setCategories = jest.fn();
    setup(created);

    await contentService.createPost({ title: "No Cats", contentHtml: "<p>x</p>" }, "u-1");

    expect(created.setCategories).not.toHaveBeenCalled();
  });

  it("should not call setCategories when categoryIds is an empty array", async () => {
    const created = mockPost();
    created.setCategories = jest.fn();
    setup(created);

    await contentService.createPost(
      { title: "Empty Cats", contentHtml: "<p>x</p>", categoryIds: [] },
      "u-1",
    );

    expect(created.setCategories).not.toHaveBeenCalled();
  });

  it("should honour an explicit publishedAt when publishing", async () => {
    const when = new Date("2024-01-01T00:00:00.000Z");
    const created = mockPost();
    created.setCategories = jest.fn();
    setup(created);

    await contentService.createPost(
      { title: "T", contentHtml: "<p>x</p>", status: "PUBLISHED", publishedAt: when },
      "u-1",
    );

    expect(Post.create.mock.calls[0][0].publishedAt).toBe(when);
  });

  it("should leave publishedAt null for a draft", async () => {
    const created = mockPost();
    created.setCategories = jest.fn();
    setup(created);

    await contentService.createPost(
      { title: "T", contentHtml: "<p>x</p>", status: "DRAFT" },
      "u-1",
    );

    expect(Post.create.mock.calls[0][0].publishedAt).toBeNull();
  });

  it("should keep an explicit publishedAt on a draft", async () => {
    const when = new Date("2024-02-02T00:00:00.000Z");
    const created = mockPost();
    created.setCategories = jest.fn();
    setup(created);

    await contentService.createPost(
      { title: "T", contentHtml: "<p>x</p>", status: "DRAFT", publishedAt: when },
      "u-1",
    );

    expect(Post.create.mock.calls[0][0].publishedAt).toBe(when);
  });

  it("should compute a minimum of 1 reading minute for empty content", async () => {
    const created = mockPost();
    created.setCategories = jest.fn();
    setup(created);

    await contentService.createPost({ title: "T" }, "u-1");

    expect(Post.create.mock.calls[0][0].readingMinutes).toBe(1);
  });

  it("should scale reading minutes with word count", async () => {
    const created = mockPost();
    created.setCategories = jest.fn();
    setup(created);
    const body = `<p>${"word ".repeat(450).trim()}</p>`;

    await contentService.createPost({ title: "T", contentHtml: body }, "u-1");

    // 450 words / 200 wpm -> ceil(2.25) = 3
    expect(Post.create.mock.calls[0][0].readingMinutes).toBe(3);
  });

  it("should return null data when the post cannot be re-read after commit", async () => {
    const created = mockPost();
    created.setCategories = jest.fn();
    Post.create.mockResolvedValue(created);
    Post.unscoped.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
    Post.findByPk.mockResolvedValue(null);

    const result = await contentService.createPost({ title: "T" }, "u-1");

    expect(result.data).toBeNull();
  });

  it("should roll back and throw 500 when create fails", async () => {
    const t = { commit: jest.fn(), rollback: jest.fn() };
    db.transaction.mockResolvedValue(t);
    Post.unscoped.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
    Post.create.mockRejectedValue(new Error("insert failed"));

    await expect(contentService.createPost({ title: "T" }, "u-1")).rejects.toEqual({
      status: 500,
      message: "insert failed",
    });
    expect(t.rollback).toHaveBeenCalled();
    expect(t.commit).not.toHaveBeenCalled();
  });

  it("should roll back and default the message when create rejects without one", async () => {
    const t = { commit: jest.fn(), rollback: jest.fn() };
    db.transaction.mockResolvedValue(t);
    Post.unscoped.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
    Post.create.mockRejectedValue(new Error(""));

    await expect(contentService.createPost({ title: "T" }, "u-1")).rejects.toEqual({
      status: 500,
      message: "Failed to create post",
    });
    expect(t.rollback).toHaveBeenCalled();
  });
});

// =========================
// COVERAGE — updatePost
// =========================

describe("updatePost — branches", () => {
  const mockUpdatable = (extra = {}) => {
    const p = mockPost(extra);
    p.update = jest.fn(function (patch) {
      Object.assign(p, patch);
      return Promise.resolve(p);
    });
    p.setCategories = jest.fn().mockResolvedValue(true);
    return p;
  };

  it("should re-slug only when a slug is explicitly provided", async () => {
    const p = mockUpdatable();
    Post.findByPk.mockResolvedValue(p);
    Post.unscoped.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });

    await contentService.updatePost("p-1", { slug: "Brand New Slug" });

    expect(p.update.mock.calls[0][0].slug).toBe("brand-new-slug");
  });

  it("should exclude the post's own row when checking its new slug", async () => {
    const p = mockUpdatable();
    const findOne = jest.fn().mockResolvedValue(null);
    Post.findByPk.mockResolvedValue(p);
    Post.unscoped.mockReturnValue({ findOne });

    await contentService.updatePost("p-1", { slug: "new-slug" });

    expect(findOne).toHaveBeenCalledWith({
      where: { slug: "new-slug", id: { [Op.ne]: "p-1" } },
      paranoid: false,
    });
  });

  it("should leave the slug untouched when none is provided", async () => {
    const p = mockUpdatable();
    Post.findByPk.mockResolvedValue(p);

    await contentService.updatePost("p-1", { title: "Renamed" });

    expect(p.update.mock.calls[0][0]).not.toHaveProperty("slug");
  });

  it("should sanitize contentHtml and recompute readingMinutes when supplied", async () => {
    const p = mockUpdatable();
    Post.findByPk.mockResolvedValue(p);
    const body = `<p>${"word ".repeat(200).trim()}</p>`;

    await contentService.updatePost("p-1", { contentHtml: body });

    const patch = p.update.mock.calls[0][0];
    expect(patch.contentHtml).toBe(body);
    expect(patch.readingMinutes).toBe(1);
  });

  it("should recompute readingMinutes even when contentHtml is cleared to empty", async () => {
    const p = mockUpdatable();
    Post.findByPk.mockResolvedValue(p);

    await contentService.updatePost("p-1", { contentHtml: "" });

    expect(p.update.mock.calls[0][0].readingMinutes).toBe(1);
  });

  it("should stamp publishedAt the first time a draft goes PUBLISHED", async () => {
    const p = mockUpdatable({ publishedAt: null });
    Post.findByPk.mockResolvedValue(p);

    await contentService.updatePost("p-1", { status: "PUBLISHED" });

    expect(p.update.mock.calls[0][0].publishedAt).toBeInstanceOf(Date);
  });

  it("should not re-stamp publishedAt on an already published post", async () => {
    const original = new Date("2023-05-05T00:00:00.000Z");
    const p = mockUpdatable({ publishedAt: original });
    Post.findByPk.mockResolvedValue(p);

    await contentService.updatePost("p-1", { status: "PUBLISHED" });

    expect(p.update.mock.calls[0][0]).not.toHaveProperty("publishedAt");
  });

  it("should not override an explicitly supplied publishedAt", async () => {
    const when = new Date("2025-03-03T00:00:00.000Z");
    const p = mockUpdatable({ publishedAt: null });
    Post.findByPk.mockResolvedValue(p);

    await contentService.updatePost("p-1", { status: "PUBLISHED", publishedAt: when });

    expect(p.update.mock.calls[0][0].publishedAt).toBe(when);
  });

  it("should replace categories when categoryIds is an array", async () => {
    const p = mockUpdatable();
    Post.findByPk.mockResolvedValue(p);

    await contentService.updatePost("p-1", { categoryIds: ["c-1", "c-2"] });

    expect(p.setCategories).toHaveBeenCalledWith(
      ["c-1", "c-2"],
      expect.objectContaining({ transaction: expect.anything() }),
    );
  });

  it("should clear categories when categoryIds is an empty array", async () => {
    const p = mockUpdatable();
    Post.findByPk.mockResolvedValue(p);

    await contentService.updatePost("p-1", { categoryIds: [] });

    expect(p.setCategories).toHaveBeenCalledWith([], expect.anything());
  });

  it("should not touch categories when categoryIds is omitted", async () => {
    const p = mockUpdatable();
    Post.findByPk.mockResolvedValue(p);

    await contentService.updatePost("p-1", { title: "x" });

    expect(p.setCategories).not.toHaveBeenCalled();
  });

  it("should roll back and throw 500 when update fails", async () => {
    const t = { commit: jest.fn(), rollback: jest.fn() };
    db.transaction.mockResolvedValue(t);
    const p = mockPost();
    p.update = jest.fn().mockRejectedValue(new Error("update failed"));
    Post.findByPk.mockResolvedValue(p);

    await expect(contentService.updatePost("p-1", { title: "x" })).rejects.toEqual({
      status: 500,
      message: "update failed",
    });
    expect(t.rollback).toHaveBeenCalled();
    expect(t.commit).not.toHaveBeenCalled();
  });

  it("should roll back and default the message when update rejects without one", async () => {
    const t = { commit: jest.fn(), rollback: jest.fn() };
    db.transaction.mockResolvedValue(t);
    const p = mockPost();
    p.update = jest.fn().mockRejectedValue(new Error(""));
    Post.findByPk.mockResolvedValue(p);

    await expect(contentService.updatePost("p-1", { title: "x" })).rejects.toEqual({
      status: 500,
      message: "Failed to update post",
    });
    expect(t.rollback).toHaveBeenCalled();
  });
});

describe("deletePost — error normalisation", () => {
  it("should default the message when softDelete rejects without one", async () => {
    const p = mockPost();
    p.softDelete = jest.fn().mockRejectedValue(new Error(""));
    Post.findByPk.mockResolvedValue(p);

    await expect(contentService.deletePost("p-1")).rejects.toEqual({
      status: 500,
      message: "Failed to delete post",
    });
  });
});

// =========================
// COVERAGE — checkSlug
// =========================

describe("checkSlug — branches", () => {
  it("should exclude the given id so a post keeps its own slug", async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    Post.unscoped.mockReturnValue({ findOne });

    const result = await contentService.checkSlug("my-slug", "p-1");

    expect(findOne).toHaveBeenCalledWith({
      where: { slug: "my-slug", id: { [Op.ne]: "p-1" } },
      paranoid: false,
    });
    expect(result.data.available).toBe(true);
  });

  it("should treat the 'post' slugify fallback as unavailable without querying", async () => {
    const findOne = jest.fn();
    Post.unscoped.mockReturnValue({ findOne });

    const result = await contentService.checkSlug("!!!");

    expect(result.data).toEqual({ slug: "post", available: false, suggestion: "post" });
    expect(findOne).not.toHaveBeenCalled();
  });

  it("should handle a null raw slug", async () => {
    const result = await contentService.checkSlug(null);

    expect(result.data.slug).toBe("post");
    expect(result.data.available).toBe(false);
  });

  it("should walk past several taken slugs to find a free suggestion", async () => {
    Post.unscoped.mockReturnValue({
      findOne: jest.fn(({ where }) =>
        Promise.resolve(["busy", "busy-2", "busy-3"].includes(where.slug) ? { id: "x" } : null),
      ),
    });

    const result = await contentService.checkSlug("busy");

    expect(result.data.suggestion).toBe("busy-4");
    expect(result.data.available).toBe(false);
  });
});

// =========================
// COVERAGE — public listing
// =========================

describe("listPublishedPosts — branches", () => {
  it("should upper-case the type filter", async () => {
    Post.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

    await contentService.listPublishedPosts({ type: "news" });

    expect(Post.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "PUBLISHED", type: "NEWS" },
      }),
    );
  });

  it("should require the category join when filtering by category", async () => {
    Post.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

    await contentService.listPublishedPosts({ category: "tech" });

    expect(Post.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({
        include: [expect.objectContaining({ required: true, where: { slug: "tech" } })],
      }),
    );
  });

  it("should default to page 1 and DEFAULT_LIMIT", async () => {
    Post.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

    const result = await contentService.listPublishedPosts({});

    expect(Post.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 0 }),
    );
    expect(result.data.meta.page).toBe(1);
  });

  it("should throw 500 when the query fails", async () => {
    Post.findAndCountAll.mockRejectedValue(new Error("DB down"));

    await expect(contentService.listPublishedPosts({})).rejects.toEqual({
      status: 500,
      message: "DB down",
    });
  });

  it("should default the message when the query rejects without one", async () => {
    Post.findAndCountAll.mockRejectedValue(new Error(""));

    await expect(contentService.listPublishedPosts({})).rejects.toEqual({
      status: 500,
      message: "Failed to fetch posts",
    });
  });
});

describe("getPublishedPostBySlug — error normalisation", () => {
  it("should throw 500 with the underlying message", async () => {
    Post.findOne.mockRejectedValue(new Error("DB down"));

    await expect(contentService.getPublishedPostBySlug("s")).rejects.toEqual({
      status: 500,
      message: "DB down",
    });
  });

  it("should default the message when the lookup rejects without one", async () => {
    Post.findOne.mockRejectedValue(new Error(""));

    await expect(contentService.getPublishedPostBySlug("s")).rejects.toEqual({
      status: 500,
      message: "Failed to fetch post",
    });
  });
});

// =========================
// COVERAGE — categories
// =========================

describe("listCategories — errors", () => {
  it("should throw 500 with the underlying message", async () => {
    Category.findAll.mockRejectedValue(new Error("DB down"));

    await expect(contentService.listCategories()).rejects.toEqual({
      status: 500,
      message: "DB down",
    });
  });

  it("should default the message when the query rejects without one", async () => {
    Category.findAll.mockRejectedValue(new Error(""));

    await expect(contentService.listCategories()).rejects.toEqual({
      status: 500,
      message: "Failed to fetch categories",
    });
  });
});

describe("createCategory — branches", () => {
  it("should prefer an explicit slug over the name and keep the description", async () => {
    const cat = mockCategory("c-1", "Tech", "custom-slug");
    Category.create.mockResolvedValue(cat);
    Category.unscoped.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });

    await contentService.createCategory({
      name: "Tech",
      slug: "Custom Slug",
      description: "All things tech",
    });

    expect(Category.create).toHaveBeenCalledWith({
      name: "Tech",
      description: "All things tech",
      slug: "custom-slug",
    });
  });

  it("should null out a missing description", async () => {
    Category.create.mockResolvedValue(mockCategory());
    Category.unscoped.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });

    await contentService.createCategory({ name: "Tech" });

    expect(Category.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: null }),
    );
  });

  it("should throw 500 when create fails", async () => {
    Category.unscoped.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
    Category.create.mockRejectedValue(new Error("duplicate"));

    await expect(contentService.createCategory({ name: "Tech" })).rejects.toEqual({
      status: 500,
      message: "duplicate",
    });
  });

  it("should default the message when create rejects without one", async () => {
    Category.unscoped.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
    Category.create.mockRejectedValue(new Error(""));

    await expect(contentService.createCategory({ name: "Tech" })).rejects.toEqual({
      status: 500,
      message: "Failed to create category",
    });
  });
});

describe("updateCategory — branches", () => {
  const mockUpdatableCat = () => {
    const cat = mockCategory("c-1", "Tech", "tech");
    cat.update = jest.fn(function (patch) {
      Object.assign(cat, patch);
      return Promise.resolve(cat);
    });
    return cat;
  };

  it("should patch only the fields that were supplied", async () => {
    const cat = mockUpdatableCat();
    Category.findByPk.mockResolvedValue(cat);

    await contentService.updateCategory("c-1", { description: "New desc" });

    expect(cat.update).toHaveBeenCalledWith({ description: "New desc" });
  });

  it("should send an empty patch when nothing is supplied", async () => {
    const cat = mockUpdatableCat();
    Category.findByPk.mockResolvedValue(cat);

    await contentService.updateCategory("c-1", {});

    expect(cat.update).toHaveBeenCalledWith({});
  });

  it("should allow clearing the description to null", async () => {
    const cat = mockUpdatableCat();
    Category.findByPk.mockResolvedValue(cat);

    await contentService.updateCategory("c-1", { description: null });

    expect(cat.update).toHaveBeenCalledWith({ description: null });
  });

  it("should re-slug and exclude its own row when a slug is supplied", async () => {
    const cat = mockUpdatableCat();
    const findOne = jest.fn().mockResolvedValue(null);
    Category.findByPk.mockResolvedValue(cat);
    Category.unscoped.mockReturnValue({ findOne });

    await contentService.updateCategory("c-1", { slug: "Fresh Slug" });

    expect(cat.update).toHaveBeenCalledWith({ slug: "fresh-slug" });
    expect(findOne).toHaveBeenCalledWith({
      where: { slug: "fresh-slug", id: { [Op.ne]: "c-1" } },
      paranoid: false,
    });
  });

  it("should throw 500 when the update fails", async () => {
    const cat = mockCategory("c-1");
    cat.update = jest.fn().mockRejectedValue(new Error("locked"));
    Category.findByPk.mockResolvedValue(cat);

    await expect(contentService.updateCategory("c-1", { name: "x" })).rejects.toEqual({
      status: 500,
      message: "locked",
    });
  });

  it("should default the message when the update rejects without one", async () => {
    const cat = mockCategory("c-1");
    cat.update = jest.fn().mockRejectedValue(new Error(""));
    Category.findByPk.mockResolvedValue(cat);

    await expect(contentService.updateCategory("c-1", { name: "x" })).rejects.toEqual({
      status: 500,
      message: "Failed to update category",
    });
  });
});
