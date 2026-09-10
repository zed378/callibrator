/**
 * Content validator tests
 */
const {
  createPost,
  updatePost,
  createCategory,
  updateCategory,
} = require("../../validators/content.validator");

describe("Content Validators", () => {
  describe("createPost", () => {
    it("should validate correct blog post data", () => {
      const { error, value } = createPost.validate({
        type: "BLOG",
        title: "My First Blog Post",
      });

      expect(error).toBeUndefined();
      expect(value.type).toBe("BLOG");
      expect(value.title).toBe("My First Blog Post");
    });

    it("should validate correct news post data", () => {
      const { error } = createPost.validate({
        type: "NEWS",
        title: "Breaking News",
      });

      expect(error).toBeUndefined();
    });

    it("should reject missing type", () => {
      const { error } = createPost.validate({
        title: "My Post",
      });

      expect(error).toBeDefined();
      expect(error.details[0].path).toContain("type");
    });

    it("should reject missing title", () => {
      const { error } = createPost.validate({
        type: "BLOG",
      });

      expect(error).toBeDefined();
      expect(error.details[0].path).toContain("title");
    });

    it("should reject invalid type value", () => {
      const { error } = createPost.validate({
        type: "ARTICLE",
        title: "My Post",
      });

      expect(error).toBeDefined();
    });

    it("should reject title that is too short", () => {
      const { error } = createPost.validate({
        type: "BLOG",
        title: "A",
      });

      expect(error).toBeDefined();
    });

    it("should allow optional fields", () => {
      const { error } = createPost.validate({
        type: "BLOG",
        title: "My Post",
        slug: "my-first-post",
        excerpt: "An excerpt",
        coverImageUrl: "https://example.com/image.jpg",
        contentHtml: "<p>Content here</p>",
        status: "DRAFT",
        featured: true,
        categoryIds: ["123e4567-e89b-12d3-a456-426614174000"],
      });

      expect(error).toBeUndefined();
    });

    it("should allow null optional fields", () => {
      const { error } = createPost.validate({
        type: "BLOG",
        title: "My Post",
        slug: null,
        excerpt: null,
        publishedAt: null,
      });

      expect(error).toBeUndefined();
    });

    it("should reject invalid UUID in categoryIds", () => {
      const { error } = createPost.validate({
        type: "BLOG",
        title: "My Post",
        categoryIds: ["not-a-uuid"],
      });

      expect(error).toBeDefined();
    });

    it("should allow empty string for optional string fields", () => {
      const { error } = createPost.validate({
        type: "BLOG",
        title: "My Post",
        slug: "",
        excerpt: "",
        coverImageUrl: "",
        contentHtml: "",
      });

      expect(error).toBeUndefined();
    });
  });

  describe("updatePost", () => {
    it("should validate partial update data", () => {
      const { error } = updatePost.validate({
        title: "Updated Title",
      });

      expect(error).toBeUndefined();
    });

    it("should validate a single field update", () => {
      const { error } = updatePost.validate({
        featured: false,
      });

      expect(error).toBeUndefined();
    });

    it("should reject empty object", () => {
      const { error } = updatePost.validate({});

      expect(error).toBeDefined();
    });

    it("should allow all optional fields", () => {
      const { error } = updatePost.validate({
        title: "Updated",
        slug: "updated-slug",
        excerpt: "Updated excerpt",
        status: "PUBLISHED",
        featured: true,
      });

      expect(error).toBeUndefined();
    });
  });

  describe("createCategory", () => {
    it("should validate correct category data", () => {
      const { error } = createCategory.validate({
        name: "Technology",
      });

      expect(error).toBeUndefined();
    });

    it("should validate category with all fields", () => {
      const { error } = createCategory.validate({
        name: "Technology",
        slug: "technology",
        description: "Tech related posts",
      });

      expect(error).toBeUndefined();
    });

    it("should reject missing name", () => {
      const { error } = createCategory.validate({
        slug: "technology",
      });

      expect(error).toBeDefined();
      expect(error.details[0].path).toContain("name");
    });

    it("should reject empty name", () => {
      const { error } = createCategory.validate({
        name: "",
      });

      expect(error).toBeDefined();
    });

    it("should allow null description", () => {
      const { error } = createCategory.validate({
        name: "Technology",
        description: null,
      });

      expect(error).toBeUndefined();
    });

    it("should allow empty string for slug", () => {
      const { error } = createCategory.validate({
        name: "Technology",
        slug: "",
      });

      expect(error).toBeUndefined();
    });
  });

  describe("updateCategory", () => {
    it("should validate partial update data", () => {
      const { error } = updateCategory.validate({
        name: "Updated Category",
      });

      expect(error).toBeUndefined();
    });

    it("should validate a single field update", () => {
      const { error } = updateCategory.validate({
        slug: "updated-slug",
      });

      expect(error).toBeUndefined();
    });

    it("should reject empty object", () => {
      const { error } = updateCategory.validate({});

      expect(error).toBeDefined();
    });

    it("should allow null description in update", () => {
      const { error } = updateCategory.validate({
        description: null,
      });

      expect(error).toBeUndefined();
    });
  });
});
