/**
 * Notifications Routes Tests
 */

interface NotificationsRouteLayer {
    route?: { path: string; methods: Record<string, boolean> };
}

interface NotificationsRouter {
    handle: unknown;
    stack: NotificationsRouteLayer[];
}

const notificationsRoutes =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is `export =` (CommonJS), as built
    require("../../routes/api/notifications.route") as NotificationsRouter;

describe("Notifications Routes", () => {
  it("should export an Express router", () => {
    expect(notificationsRoutes).toBeDefined();
    expect(typeof notificationsRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(notificationsRoutes.stack)).toBe(true);
    expect(notificationsRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have GET / route", () => {
    const route = notificationsRoutes.stack.find(
      (layer) => layer.route?.path === "/" && layer.route.methods["get"],
    );
    expect(route).toBeDefined();
  });

  it("should have POST /test route", () => {
    const route = notificationsRoutes.stack.find(
      (layer) => layer.route?.path === "/test" && layer.route.methods["post"],
    );
    expect(route).toBeDefined();
  });

  it("should have PATCH /read-all route", () => {
    const route = notificationsRoutes.stack.find(
      (layer) => layer.route?.path === "/read-all" && layer.route.methods["patch"],
    );
    expect(route).toBeDefined();
  });

  it("should have PATCH /:notificationId/read route", () => {
    const route = notificationsRoutes.stack.find(
      (layer) => layer.route?.path === "/:notificationId/read" && layer.route.methods["patch"],
    );
    expect(route).toBeDefined();
  });

  it("should have DELETE /:notificationId route", () => {
    const route = notificationsRoutes.stack.find(
      (layer) => layer.route?.path === "/:notificationId" && layer.route.methods["delete"],
    );
    expect(route).toBeDefined();
  });
});
