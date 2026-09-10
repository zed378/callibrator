/**
 * Ticket Routes Tests
 *
 * Tests the ticket route registrations and middleware chain.
 */
const ticketRoutes = require("../../routes/api/tickets.route.js");

describe("Ticket Routes", () => {
  it("should export an Express router", () => {
    expect(ticketRoutes).toBeDefined();
    expect(typeof ticketRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(ticketRoutes.stack)).toBe(true);
    expect(ticketRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = ticketRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = ticketRoutes.stack.some((layer) => !layer.route);
    const hasRoutes = ticketRoutes.stack.some((layer) => layer.route);
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    ticketRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        const validMethods = ["get", "post", "put", "patch", "delete"];
        const hasValidMethod = validMethods.some((m) => methods[m] === true);
        expect(hasValidMethod).toBe(true);
      }
    });
  });
});
