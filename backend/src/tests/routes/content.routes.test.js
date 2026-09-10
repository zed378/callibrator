jest.mock("sanitize-html", () => {
  const mock = jest.fn();
  mock.defaults = {
    allowedTags: ["p", "div", "b", "i", "em", "strong", "a"],
    allowedAttributes: {
      a: ["href", "name", "target"]
    }
  };
  mock.simpleTransform = jest.fn().mockReturnValue(jest.fn());
  return mock;
});
const contentRoutes = require("../../routes/api/content.route");

describe("Content Routes", () => {
  it("should export an Express router", () => {
    expect(contentRoutes).toBeDefined();
    expect(typeof contentRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(contentRoutes.stack)).toBe(true);
    expect(contentRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have GET /posts/public route", () => {
    const route = contentRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/posts/public" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /posts/public/:slug route", () => {
    const route = contentRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/posts/public/:slug" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /categories/public route", () => {
    const route = contentRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/categories/public" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /categories route", () => {
    const route = contentRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/categories" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  it("should have PATCH /categories/:id route", () => {
    const route = contentRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/categories/:id" && layer.route.methods.patch,
    );
    expect(route).toBeDefined();
  });

  it("should have DELETE /categories/:id route", () => {
    const route = contentRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/categories/:id" && layer.route.methods.delete,
    );
    expect(route).toBeDefined();
  });
});
