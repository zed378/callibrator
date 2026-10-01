/**
 * Content validator tests
 *
 * P9-11 (ADR-093): the schemas are Zod, exercised through the shared
 * `checkInput` helper.
 */
const { checkInput } = require("../../validators/input");
const {
  createPost,
  updatePost,
  createCategory,
  updateCategory,
} = require("../../validators/content.validator");

const NOTHING_TO_UPDATE = [{ field: "", message: "Provide at least one field to update" }];
const TYPE_OPTION = 'Invalid option: expected one of "BLOG"|"NEWS"';

describe("Content Validators", () => {
  describe("createPost", () => {
    it("should validate correct blog post data", () => {
      const result = checkInput({ type: "BLOG", title: "My First Blog Post" }, createPost);

      expect(result.ok).toBe(true);
      expect(result.value.type).toBe("BLOG");
      expect(result.value.title).toBe("My First Blog Post");
    });

    it("should validate correct news post data", () => {
      expect(checkInput({ type: "NEWS", title: "Breaking News" }, createPost).ok).toBe(true);
    });

    it("should reject missing type", () => {
      const result = checkInput({ title: "My Post" }, createPost);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "type", message: TYPE_OPTION }]);
    });

    it("should reject missing title", () => {
      const result = checkInput({ type: "BLOG" }, createPost);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        { field: "title", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should reject invalid type value", () => {
      const result = checkInput({ type: "ARTICLE", title: "My Post" }, createPost);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "type", message: TYPE_OPTION }]);
    });

    it("should reject title that is too short", () => {
      const result = checkInput({ type: "BLOG", title: "A" }, createPost);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        { field: "title", message: "Too small: expected string to have >=2 characters" },
      ]);
    });

    it("should allow optional fields", () => {
      const result = checkInput(
        {
          type: "BLOG",
          title: "My Post",
          slug: "my-first-post",
          excerpt: "An excerpt",
          coverImageUrl: "https://example.com/image.jpg",
          contentHtml: "<p>Content here</p>",
          status: "DRAFT",
          featured: true,
          categoryIds: ["123e4567-e89b-12d3-a456-426614174000"],
        },
        createPost,
      );

      expect(result.ok).toBe(true);
    });

    it("converts featured from text and publishedAt to a Date", () => {
      const result = checkInput(
        { type: "BLOG", title: "My Post", featured: "true", publishedAt: "2026-01-01" },
        createPost,
      );

      expect(result.value).toEqual({
        type: "BLOG",
        title: "My Post",
        featured: true,
        publishedAt: new Date("2026-01-01"),
      });
    });

    it("should allow null optional fields", () => {
      const result = checkInput(
        { type: "BLOG", title: "My Post", slug: null, excerpt: null, publishedAt: null },
        createPost,
      );

      expect(result.ok).toBe(true);
    });

    it("should reject invalid UUID in categoryIds", () => {
      const result = checkInput({ type: "BLOG", title: "My Post", categoryIds: ["not-a-uuid"] }, createPost);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "categoryIds.0", message: "Invalid GUID" }]);
    });

    it("should allow empty string for optional string fields", () => {
      const result = checkInput(
        { type: "BLOG", title: "My Post", slug: "", excerpt: "", coverImageUrl: "", contentHtml: "" },
        createPost,
      );

      expect(result.ok).toBe(true);
    });
  });

  describe("updatePost", () => {
    it("should validate partial update data", () => {
      expect(checkInput({ title: "Updated Title" }, updatePost).ok).toBe(true);
    });

    it("should validate a single field update", () => {
      expect(checkInput({ featured: false }, updatePost)).toEqual({ ok: true, value: { featured: false } });
    });

    it("should reject empty object", () => {
      const result = checkInput({}, updatePost);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(NOTHING_TO_UPDATE);
    });

    it("should allow all optional fields", () => {
      const result = checkInput(
        { title: "Updated", slug: "updated-slug", excerpt: "Updated excerpt", status: "PUBLISHED", featured: true },
        updatePost,
      );

      expect(result.ok).toBe(true);
    });
  });

  describe("createCategory", () => {
    it("should validate correct category data", () => {
      expect(checkInput({ name: "Technology" }, createCategory).ok).toBe(true);
    });

    it("should validate category with all fields", () => {
      const result = checkInput(
        { name: "Technology", slug: "technology", description: "Tech related posts" },
        createCategory,
      );

      expect(result.ok).toBe(true);
    });

    it("should reject missing name", () => {
      const result = checkInput({ slug: "technology" }, createCategory);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        { field: "name", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should reject empty name", () => {
      const result = checkInput({ name: "" }, createCategory);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        { field: "name", message: "Too small: expected string to have >=1 characters" },
      ]);
    });

    it("should allow null description", () => {
      expect(checkInput({ name: "Technology", description: null }, createCategory).ok).toBe(true);
    });

    it("should allow empty string for slug", () => {
      expect(checkInput({ name: "Technology", slug: "" }, createCategory).ok).toBe(true);
    });
  });

  describe("updateCategory", () => {
    it("should validate partial update data", () => {
      expect(checkInput({ name: "Updated Category" }, updateCategory).ok).toBe(true);
    });

    it("should validate a single field update", () => {
      expect(checkInput({ slug: "updated-slug" }, updateCategory).ok).toBe(true);
    });

    it("should reject empty object", () => {
      const result = checkInput({}, updateCategory);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(NOTHING_TO_UPDATE);
    });

    it("should allow null description in update", () => {
      expect(checkInput({ description: null }, updateCategory).ok).toBe(true);
    });
  });
});
